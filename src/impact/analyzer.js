const path = require('node:path').posix;
const { parseJavaScript, parsePython } = require('../parsing/source');
const {
  NodeKind, EdgeType, EvidenceSource, ValidationStatus,
  EvidenceRecord, DependencyEdge, TypedDependencyGraph
} = require('./graph');

function resolveImportPath(sourcePath, importSpecifier, candidates) {
  if (!importSpecifier.startsWith('.')) return null;
  const base = path.normalize(path.join(path.dirname(sourcePath), importSpecifier));
  for (const suffix of ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '/index.ts', '/index.tsx', '/index.js', '/index.jsx']) {
    const candidate = `${base}${suffix}`;
    if (candidates.has(candidate)) return candidate;
  }
  return null;
}

function resolvePythonImport(sourcePath, specifier, candidates) {
  const relative = specifier.match(/^(\.+)(.*)$/);
  let base;
  if (relative) {
    base = path.dirname(sourcePath);
    for (let level = 1; level < relative[1].length; level += 1) base = path.dirname(base);
    base = path.join(base, relative[2].replace(/\./g, '/'));
  } else {
    base = specifier.replace(/\./g, '/');
  }
  for (const candidate of [`${base}.py`, path.join(base, '__init__.py')]) {
    if (candidates.has(candidate)) return candidate;
  }
  return null;
}

function isTestPath(filePath) {
  return /(?:^|\/)(?:tests?|__tests__|spec)\/|(?:\.|_)(?:test|spec)\.[a-zA-Z]+$/i.test(filePath);
}

class SourceCodeImpactAnalyzer {
  constructor(options = {}) { this.options = options; }

  buildGraph(entries, revisionId = 'rev_current') {
    const graph = new TypedDependencyGraph(revisionId);
    const candidates = new Set(entries.map((entry) => entry.path));
    const repo = graph.addNode({ id: 'repo:root', kind: NodeKind.REPOSITORY, name: 'Repository Root', metadata: { fileCount: entries.length } });

    for (const entry of entries) {
      if (entry.excludedReason) continue;
      const fileId = `file:${entry.path}`;
      graph.addNode({
        id: fileId, kind: isTestPath(entry.path) ? NodeKind.TEST : NodeKind.FILE,
        name: entry.path, filePath: entry.path,
        metadata: { bytes: entry.bytes, isTest: isTestPath(entry.path), extension: path.extname(entry.path) }
      });
      graph.addEdge(new DependencyEdge({
        sourceId: repo.id, targetId: fileId, type: EdgeType.REFERENCES,
        evidence: [new EvidenceRecord({
          source: EvidenceSource.CONFIG_MANIFEST, revisionId, method: 'repository-file-inventory',
          status: ValidationStatus.CONTRACT_DERIVED, weight: 1, details: { path: entry.path }
        })]
      }));
    }
    for (const entry of entries) {
      if (!entry.excludedReason && entry.content) this.analyzeFile(entry.path, entry.content, graph, candidates, revisionId);
    }
    return graph;
  }

  analyzeFile(filePath, content, graph, candidates, revisionId) {
    const ext = path.extname(filePath).toLowerCase();
    if (['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs'].includes(ext)) {
      this.addParsedFile(filePath, parseJavaScript(content, filePath), graph, candidates, revisionId, 'javascript');
    } else if (ext === '.py') {
      this.addParsedFile(filePath, parsePython(content), graph, candidates, revisionId, 'python');
    }
  }

  addEvidenceEdge(graph, sourceId, targetId, type, parsed, revisionId, method, line, details = {}, status = ValidationStatus.STATICALLY_INFERRED, source = EvidenceSource.STATIC_AST) {
    return graph.addEdge(new DependencyEdge({
      sourceId, targetId, type,
      evidence: [new EvidenceRecord({
        source, sourceLocation: line ? { filePath: details.filePath, line } : null,
        revisionId, method, status, weight: status === ValidationStatus.CONTRACT_DERIVED ? 1 : 0.9,
        details: { ...details, parser: parsed.parser, parserRecovered: parsed.recovered },
        limitations: parsed.recovered ? ['Parser reported recoverable syntax errors in this file.'] : []
      })]
    }));
  }

  uniqueSymbolId(graph, prefix, filePath, name, line) {
    const base = `${prefix}:${filePath}#${name}`;
    return graph.hasNode(base) ? `${base}@${line}` : base;
  }

  addParsedFile(filePath, parsed, graph, candidates, revisionId, language) {
    const fileId = `file:${filePath}`;
    graph.diagnostics.push(...parsed.errors.map((error) => ({
      filePath, language, parser: parsed.parser, severity: 'warning', ...error
    })));
    const symbolsByName = new Map();

    for (const symbol of parsed.symbols) {
      if (!symbol.name) continue;
      const isClass = symbol.kind === 'class' || symbol.kind === 'interface';
      const prefix = isClass ? 'class' : 'fn';
      const id = this.uniqueSymbolId(graph, prefix, filePath, symbol.name, symbol.line);
      graph.addNode({
        id, kind: isClass ? NodeKind.CLASS : NodeKind.FUNCTION, name: symbol.name,
        filePath, line: symbol.line,
        metadata: { declarationKind: symbol.kind, parser: parsed.parser, evidence: parsed.evidence }
      });
      if (!symbolsByName.has(symbol.name)) symbolsByName.set(symbol.name, id);
      this.addEvidenceEdge(graph, fileId, id, EdgeType.REFERENCES, parsed, revisionId,
        `${language}-${symbol.kind}-ast`, symbol.line, { filePath, symbol: symbol.name });

      if (isClass && symbol.parent) {
        const parentId = `class:${symbol.parent}`;
        if (!graph.hasNode(parentId)) graph.addNode({ id: parentId, kind: NodeKind.CLASS, name: symbol.parent, metadata: { unresolved: true } });
        this.addEvidenceEdge(graph, id, parentId, EdgeType.EXTENDS, parsed, revisionId,
          `${language}-inheritance-ast`, symbol.line, { filePath, parent: symbol.parent });
      }
    }

    for (const imported of parsed.imports) {
      const resolved = language === 'python'
        ? resolvePythonImport(filePath, imported.specifier, candidates)
        : resolveImportPath(filePath, imported.specifier, candidates);
      let targetId;
      if (resolved) targetId = `file:${resolved}`;
      else if (!imported.specifier.startsWith('.') || language === 'python') {
        const packageName = imported.specifier.replace(/^\.+/, '').split(/[/.]/)[0] || imported.specifier;
        targetId = `external:${packageName}`;
        if (!graph.hasNode(targetId)) graph.addNode({ id: targetId, kind: NodeKind.EXTERNAL, name: packageName });
      }
      if (targetId && graph.hasNode(targetId)) {
        this.addEvidenceEdge(graph, fileId, targetId, EdgeType.IMPORTS, parsed, revisionId,
          `${language}-${imported.kind}-ast`, imported.line,
          { filePath, specifier: imported.specifier, dynamic: imported.dynamic });
      }
    }

    for (const config of parsed.configKeys) {
      const targetId = `config:${config.name}`;
      if (!graph.hasNode(targetId)) graph.addNode({ id: targetId, kind: NodeKind.CONFIG, name: config.name });
      this.addEvidenceEdge(graph, fileId, targetId, EdgeType.CONFIGURES, parsed, revisionId,
        `${language}-config-access-ast`, config.line, { filePath, key: config.name });
    }

    for (const call of parsed.calls) {
      const localName = call.name.split('.').pop();
      const targetId = symbolsByName.get(localName);
      if (targetId) {
        this.addEvidenceEdge(graph, fileId, targetId, EdgeType.CALLS, parsed, revisionId,
          `${language}-call-ast`, call.line, { filePath, callee: call.name });
      }
    }

    for (const test of parsed.tests) {
      const testId = `test:${filePath}#${test.name}`;
      if (!graph.hasNode(testId)) graph.addNode({ id: testId, kind: NodeKind.TEST, name: test.name, filePath, line: test.line });
      this.addEvidenceEdge(graph, fileId, testId, EdgeType.COVERS, parsed, revisionId,
        'test-declaration-ast', test.line, { filePath, test: test.name });
      for (const imported of graph.getOutEdges(fileId).filter((edge) => edge.type === EdgeType.IMPORTS && edge.targetId.startsWith('file:'))) {
        this.addEvidenceEdge(graph, testId, imported.targetId, EdgeType.COVERS, parsed, revisionId,
          'static-test-import-heuristic', test.line, { filePath, inferredFromImport: imported.targetId },
          ValidationStatus.STATICALLY_INFERRED, EvidenceSource.COVERAGE_MAP);
      }
    }

    for (const route of parsed.routes) {
      const endpointId = `endpoint:${route.method} ${route.path}`;
      if (!graph.hasNode(endpointId)) {
        graph.addNode({ id: endpointId, kind: NodeKind.ENDPOINT, name: `${route.method} ${route.path}`, metadata: { httpMethod: route.method, routePath: route.path } });
      }
      this.addEvidenceEdge(graph, fileId, endpointId, EdgeType.ROUTES_TO, parsed, revisionId,
        `${language}-route-contract-ast`, route.line, { filePath, method: route.method, path: route.path },
        ValidationStatus.CONTRACT_DERIVED, EvidenceSource.API_CONTRACT);
    }
  }

  analyzeJavaScriptSymbolsAndCalls(filePath, content, graph, candidates, revisionId) {
    this.addParsedFile(filePath, parseJavaScript(content, filePath), graph, candidates, revisionId, 'javascript');
  }

  analyzePythonSymbolsAndCalls(filePath, content, graph, candidates, revisionId) {
    this.addParsedFile(filePath, parsePython(content), graph, candidates, revisionId, 'python');
  }
}

module.exports = { SourceCodeImpactAnalyzer, resolveImportPath, resolvePythonImport };
