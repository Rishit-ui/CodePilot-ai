const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { loadConfig } = require('./config');
const { Store } = require('./db');
const { ArchiveError, readZip, contentHash } = require('./archive');
const { analyze } = require('./analyzer');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const CONTENT_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8' };

function json(response, status, data) { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); response.end(JSON.stringify(data)); }
function error(response, status, code, message) { json(response, status, { error: { code, message } }); }
function noProject(response) { return error(response, 404, 'PROJECT_NOT_FOUND', 'Project was not found.'); }
function readBody(request, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    request.on('data', (chunk) => { size += chunk.length; if (size > limit) { reject(Object.assign(new Error('Request body exceeds the permitted size.'), { status: 413 })); request.destroy(); } else chunks.push(chunk); });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}
function parseJson(buffer) { try { return JSON.parse(buffer.toString('utf8')); } catch { const errorValue = new Error('Request must contain valid JSON.'); errorValue.status = 400; throw errorValue; } }
function latestOrError(store, projectId, response) { const project = store.project(projectId); if (!project) { noProject(response); return null; } const revision = store.latestRevision(projectId); if (!revision) { error(response, 409, 'REVISION_REQUIRED', 'Import a revision before using this feature.'); return null; } return { project, revision }; }
function answerQuestion(store, projectId, revision, question, limit) {
  const words = [...new Set(question.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) || [])].slice(0, 16);
  const files = store.all('SELECT path, content FROM files WHERE revision_id=? AND content IS NOT NULL AND excluded_reason IS NULL', revision.id);
  const ranked = files.map((file) => {
    const lower = file.content.toLowerCase();
    return { ...file, score: words.reduce((total, word) => total + (lower.match(new RegExp(`\\b${word.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\b`, 'g')) || []).length, 0) };
  }).filter((file) => file.score > 0).sort((a, b) => b.score - a.score).slice(0, 3);
  if (!ranked.length) return { answer: 'I could not find source evidence for that question in the current revision. Try a symbol name, filename, route, or configuration key.', citations: [] };
  const citations = ranked.map((file) => {
    const lines = file.content.split(/\r?\n/); const hit = lines.findIndex((line) => words.some((word) => line.toLowerCase().includes(word)));
    return { path: file.path, line: hit + 1, excerpt: lines[hit].slice(0, 240) };
  });
  return { answer: `Evidence from ${citations.map((citation) => `${citation.path}:${citation.line}`).join(', ')} is available below. This deterministic local assistant does not infer behavior beyond the cited source.`, citations };
}
function serveStatic(request, response, pathname) {
  const candidate = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = path.resolve(PUBLIC, candidate);
  if (!file.startsWith(`${PUBLIC}${path.sep}`) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return false;
  response.writeHead(200, { 'Content-Type': CONTENT_TYPES[path.extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'" });
  fs.createReadStream(file).pipe(response); return true;
}

function createApp(options = {}) {
  const config = options.config || loadConfig(ROOT);
  const store = options.store || new Store(config.dataDir);
  const server = http.createServer(async (request, response) => {
    const requestId = crypto.randomUUID();
    try {
      const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
      const pathname = url.pathname;
      if (request.method === 'GET' && pathname === '/api/health') return json(response, 200, { status: 'ok', requestId, time: new Date().toISOString(), capabilities: { localMode: true, auth: 'not-configured', aiProvider: 'not-configured', deploymentProvider: 'not-configured' } });
      if (request.method === 'GET' && pathname === '/api/ready') { store.get('SELECT 1 AS ready'); return json(response, 200, { status: 'ready', requestId }); }
      if (request.method === 'GET' && pathname === '/api/projects') return json(response, 200, { projects: store.listProjects(), requestId });
      if (request.method === 'POST' && pathname === '/api/projects') {
        const body = parseJson(await readBody(request, 16 * 1024)); const name = typeof body.name === 'string' ? body.name.trim() : '';
        if (!name || name.length > 100) return error(response, 422, 'INVALID_PROJECT_NAME', 'Project name must contain 1–100 characters.');
        return json(response, 201, { project: store.createProject(name), requestId });
      }
      const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
      if (request.method === 'GET' && projectMatch) { const summary = store.projectSummary(projectMatch[1]); return summary ? json(response, 200, { ...summary, requestId }) : noProject(response); }
      const importMatch = pathname.match(/^\/api\/projects\/([^/]+)\/import$/);
      if (request.method === 'POST' && importMatch) {
        const projectId = importMatch[1]; if (!store.project(projectId)) return noProject(response);
        if (request.headers['content-type'] !== 'application/zip') return error(response, 415, 'ZIP_REQUIRED', 'Use Content-Type: application/zip.');
        const job = store.createJob(projectId, 'import', 'Validating archive');
        try {
          const archive = await readBody(request, config.limits.maxUploadBytes); const hash = contentHash(archive); const entries = readZip(archive, config.limits); const records = analyze(entries); const saved = store.saveRevision(projectId, hash, records);
          store.finishJob(job.id, saved.revision.id, 'completed', saved.duplicate ? 'Duplicate revision reused.' : `Imported ${records.files.length} files.`);
          return json(response, saved.duplicate ? 200 : 201, { revision: saved.revision, duplicate: saved.duplicate, job: { id: job.id, status: 'completed' }, summary: { files: records.files.length, symbols: records.symbols.length, edges: records.edges.length, findings: records.findings.length }, requestId });
        } catch (importError) { store.finishJob(job.id, null, 'failed', importError.message); throw importError; }
      }
      const filesMatch = pathname.match(/^\/api\/projects\/([^/]+)\/files$/);
      if (request.method === 'GET' && filesMatch) {
        const context = latestOrError(store, filesMatch[1], response); if (!context) return;
        const query = (url.searchParams.get('q') || '').toLowerCase().slice(0, 100);
        const files = store.all('SELECT path, language, bytes, excluded_reason AS excludedReason FROM files WHERE revision_id=? ORDER BY path', context.revision.id).filter((file) => !query || file.path.toLowerCase().includes(query));
        return json(response, 200, { revisionId: context.revision.id, files: files.slice(0, config.limits.maxSearchResults), truncated: files.length > config.limits.maxSearchResults, requestId });
      }
      const fileMatch = pathname.match(/^\/api\/projects\/([^/]+)\/file$/);
      if (request.method === 'GET' && fileMatch) {
        const context = latestOrError(store, fileMatch[1], response); if (!context) return;
        const requestedPath = url.searchParams.get('path'); if (!requestedPath || requestedPath.length > 500) return error(response, 422, 'INVALID_PATH', 'A valid file path is required.');
        const file = store.get('SELECT path, language, bytes, content, excluded_reason AS excludedReason FROM files WHERE revision_id=? AND path=?', context.revision.id, requestedPath);
        if (!file) return error(response, 404, 'FILE_NOT_FOUND', 'File was not found in this revision.');
        if (file.path.startsWith('.env') || file.excludedReason === 'generated-or-vendored-directory') return error(response, 403, 'FILE_RESTRICTED', 'This file is withheld from the explorer to reduce accidental exposure or noise.');
        return json(response, 200, { file, requestId });
      }
      const graphMatch = pathname.match(/^\/api\/projects\/([^/]+)\/graph$/);
      if (request.method === 'GET' && graphMatch) { const context = latestOrError(store, graphMatch[1], response); if (!context) return; return json(response, 200, { revisionId: context.revision.id, nodes: store.all('SELECT path AS id, path AS label, language FROM files WHERE revision_id=? AND excluded_reason IS NULL ORDER BY path LIMIT 150', context.revision.id), edges: store.all('SELECT source_path AS source, target_path AS target, type, confidence, line, provenance FROM edges WHERE revision_id=? LIMIT 500', context.revision.id), requestId }); }
      const findingsMatch = pathname.match(/^\/api\/projects\/([^/]+)\/findings$/);
      if (request.method === 'GET' && findingsMatch) { const context = latestOrError(store, findingsMatch[1], response); if (!context) return; return json(response, 200, { revisionId: context.revision.id, findings: store.all('SELECT id,severity,category,message,file_path AS filePath,line,evidence FROM findings WHERE revision_id=? ORDER BY CASE severity WHEN \'high\' THEN 1 WHEN \'medium\' THEN 2 ELSE 3 END, file_path', context.revision.id), requestId }); }
      const askMatch = pathname.match(/^\/api\/projects\/([^/]+)\/ask$/);
      if (request.method === 'POST' && askMatch) {
        const context = latestOrError(store, askMatch[1], response); if (!context) return;
        const body = parseJson(await readBody(request, 8 * 1024)); const question = typeof body.question === 'string' ? body.question.trim() : '';
        if (!question || question.length > config.limits.maxQuestionChars) return error(response, 422, 'INVALID_QUESTION', 'Question must contain 1–2000 characters.');
        const result = answerQuestion(store, context.project.id, context.revision, question, config.limits); store.audit('assistant.question', context.project.id, `Question answered against ${context.revision.id}`);
        return json(response, 200, { revisionId: context.revision.id, ...result, requestId });
      }
      const readinessMatch = pathname.match(/^\/api\/projects\/([^/]+)\/deployment-readiness$/);
      if (request.method === 'GET' && readinessMatch) {
        const context = latestOrError(store, readinessMatch[1], response); if (!context) return;
        const highFindings = store.get("SELECT COUNT(*) AS count FROM findings WHERE revision_id=? AND severity='high'", context.revision.id).count;
        const hasDockerfile = store.get("SELECT COUNT(*) AS count FROM files WHERE revision_id=? AND (path='Dockerfile' OR path LIKE '%/Dockerfile')", context.revision.id).count > 0;
        return json(response, 200, { revisionId: context.revision.id, status: highFindings ? 'blocked' : 'incomplete', checks: [{ name: 'Source revision', status: 'passed', detail: 'Immutable revision is available.' }, { name: 'Potential secret findings', status: highFindings ? 'blocked' : 'passed', detail: `${highFindings} high-severity finding(s).` }, { name: 'Container configuration', status: hasDockerfile ? 'present-unverified' : 'missing', detail: hasDockerfile ? 'Dockerfile detected but not built by this local analysis.' : 'No Dockerfile detected.' }, { name: 'Provider adapter', status: 'not-configured', detail: 'No cloud provider, credentials, or deployment authorization is configured.' }, { name: 'Production authentication', status: 'not-configured', detail: 'This local-mode server must not be exposed publicly.' }], requestId });
      }
      if (request.method === 'GET' && pathname === '/api/audit') return json(response, 200, { events: store.all('SELECT * FROM audit_events ORDER BY created_at DESC LIMIT 100'), requestId });
      if (pathname.startsWith('/api/')) return error(response, 404, 'NOT_FOUND', 'API endpoint was not found.');
      if (request.method === 'GET' && serveStatic(request, response, pathname)) return;
      return error(response, 404, 'NOT_FOUND', 'Resource was not found.');
    } catch (caught) {
      const status = caught.status || (caught instanceof ArchiveError ? caught.status : 500);
      if (status >= 500) console.error(JSON.stringify({ level: 'error', requestId, message: caught.message, stack: caught.stack }));
      return error(response, status, status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED', status >= 500 ? 'Unexpected server error.' : caught.message);
    }
  });
  return { server, store, config };
}

if (require.main === module) { const app = createApp(); app.server.listen(app.config.port, app.config.host, () => console.log(JSON.stringify({ level: 'info', event: 'server.started', host: app.config.host, port: app.config.port, localMode: true }))); }

module.exports = { createApp };
