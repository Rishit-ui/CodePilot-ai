const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { performance } = require('node:perf_hooks');
const { analyze } = require('../../src/analyzer');
const { SourceCodeImpactAnalyzer } = require('../../src/impact/analyzer');
const { Store } = require('../../src/db');
const { generateArchitectureReport } = require('../../src/architecture');
const { createApp } = require('../../src/server');

function fixtures(count) {
  return Array.from({ length: count }, (_, index) => {
    const previous = index ? `import { value${index - 1} } from './module${index - 1}.js';\n` : '';
    const source = `${previous}export function value${index}() { return ${index ? `value${index - 1}() + 1` : '0'}; }`;
    return { path: `src/module${index}.js`, bytes: Buffer.byteLength(source), data: Buffer.from(source), isOversized: false };
  });
}

async function measure(operation) {
  const started = performance.now();
  const value = await operation();
  return { value, durationMs: performance.now() - started };
}

function request(server, pathname) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    http.get({ host: '127.0.0.1', port: server.address().port, path: pathname }, (response) => {
      response.resume();
      response.on('end', () => resolve({ status: response.statusCode, durationMs: performance.now() - started }));
    }).on('error', reject);
  });
}

async function runPerformanceBenchmark() {
  const analyzer = new SourceCodeImpactAnalyzer();
  const measurements = [];
  for (const size of [50, 200, 1000]) {
    const entries = fixtures(size);
    const heapBefore = process.memoryUsage().heapUsed;
    const analyzed = await measure(() => analyze(entries));
    const graphEntries = analyzed.value.files.map((file) => ({ path: file.path, content: file.content, bytes: file.bytes, excludedReason: file.excludedReason }));
    const graph = await measure(() => analyzer.buildGraph(graphEntries, `performance-${size}`));
    const serialized = await measure(() => JSON.stringify(graph.value.toJSON()));
    measurements.push({
      files: size, bytes: entries.reduce((sum, item) => sum + item.bytes, 0),
      indexingAndParsingMs: analyzed.durationMs,
      parserThroughputFilesPerSecond: size / (analyzed.durationMs / 1000),
      graphConstructionMs: graph.durationMs,
      graphNodes: graph.value.nodes.size, graphEdges: graph.value.edges.size,
      graphSerializationMs: serialized.durationMs, serializedGraphBytes: Buffer.byteLength(serialized.value),
      heapDeltaBytes: process.memoryUsage().heapUsed - heapBefore
    });
  }

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-phase4-performance-'));
  const store = new Store({ dataDir, sessionSecret: 'phase4-performance-secret-value-over-32-characters' });
  const persistenceEntries = fixtures(200);
  const analysis = analyze(persistenceEntries);
  const user = await store.createUser('performance@example.com', 'Performance', 'StrongPerf!123');
  const workspace = await store.createWorkspace('Performance', user.id);
  const project = await store.createProject('Performance Fixture', '', workspace.id, user.id);
  const save = await measure(() => store.saveRevision(project.id, 'performance-hash', analysis, 'Performance fixture'));
  const load = await measure(() => store.all('SELECT path, content FROM files WHERE revision_id=?', save.value.revision.id));
  const report = await measure(() => generateArchitectureReport(store, save.value.revision.id, project));

  const repeatedHeapStart = process.memoryUsage().heapUsed;
  const repeatedDurations = [];
  for (let iteration = 0; iteration < 10; iteration += 1) {
    const repeated = await measure(() => analyze(fixtures(200)));
    repeatedDurations.push(repeated.durationMs);
  }
  const repeatedHeapEnd = process.memoryUsage().heapUsed;

  const apiDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-phase4-api-performance-'));
  const app = createApp({
    config: {
      env: 'test', isProduction: false, host: '127.0.0.1', port: 0,
      dataDir: apiDataDir,
      sessionSecret: 'phase4-api-performance-secret-over-32-characters', authEnabled: false,
      rateLimit: { enabled: false, policies: {} }, ai: { provider: 'local' },
      execution: { mode: 'disabled', releaseVerified: false, provider: 'disabled' },
      queue: { provider: 'disabled' }, storage: { provider: 'disabled' }, deployment: { allowedProviders: [] }, limits: {}
    }
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const apiSamples = [];
  for (let index = 0; index < 20; index += 1) apiSamples.push((await request(app.server, '/api/health')).durationMs);
  await new Promise((resolve) => app.server.close(resolve));
  await app.store.close();
  fs.rmSync(apiDataDir, { recursive: true, force: true });

  const result = {
    generatedAt: new Date().toISOString(),
    environment: { node: process.version, platform: process.platform, architecture: process.arch, cpuCount: os.cpus().length, totalMemoryBytes: os.totalmem() },
    repositorySizes: measurements,
    persistence: { files: 200, revisionSaveMs: save.durationMs, fileRetrievalMs: load.durationMs, retrievedFiles: load.value.length, reportGenerationMs: report.durationMs, reportSections: Object.keys(report.value).length },
    repeatedProcessing: { iterations: 10, filesPerIteration: 200, durationsMs: repeatedDurations, heapDeltaBytes: repeatedHeapEnd - repeatedHeapStart, note: 'Heap delta is a coarse process-level observation, not proof of a leak or absence of one.' },
    localApi: { endpoint: '/api/health', samples: 20, averageMs: apiSamples.reduce((sum, value) => sum + value, 0) / apiSamples.length, minMs: Math.min(...apiSamples), maxMs: Math.max(...apiSamples) },
    limitations: ['Synthetic in-memory source fixtures.', 'Single Windows workstation and SQLite.', 'No browser graph-frame benchmark.', 'No managed PostgreSQL, queue, storage, sandbox, or network-latency measurement.']
  };
  await store.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  const output = path.resolve('results/phase4/performance_results.json');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(result, null, 2));
  return result;
}

if (require.main === module) runPerformanceBenchmark().then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => { console.error(error); process.exitCode = 1; });
module.exports = { runPerformanceBenchmark };
