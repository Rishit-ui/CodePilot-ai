const path = require('node:path').posix;
const {
  NodeKind,
  EdgeType,
  EvidenceSource,
  ValidationStatus,
  DependencyNode,
  EvidenceRecord,
  DependencyEdge,
  TypedDependencyGraph
} = require('./graph');

function lineOf(content, index) {
  return content.slice(0, index).split('\n').length;
}

function resolveImportPath(sourcePath, importSpecifier, candidates) {
  if (!importSpecifier.startsWith('.')) return null;
  const base = path.normalize(path.join(path.dirname(sourcePath), importSpecifier));
  const candidateExtensions = [
    '',
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.mjs',
    '.cjs',
    '/index.ts',
    '/index.tsx',
    '/index.js',
    '/index.jsx'
  ];

  for (const ext of candidateExtensions) {
    const candidate = `${base}${ext}`;
    if (candidates.has(candidate)) return candidate;
  }
  return null;
}

class SourceCodeImpactAnalyzer {
  constructor(options = {}) {
    this.options = options;
  }

  /**
   * Analyzes an array of repository entries and constructs a TypedDependencyGraph
   * @param {Array<{ path: string, content: string|null, bytes: number, excludedReason: string|null }>} entries
   * @param {string} revisionId
   */
  buildGraph(entries, revisionId = 'rev_current') {
    const graph = new TypedDependencyGraph(revisionId);
    const candidates = new Set(entries.map((e) => e.path));

    // 1. Add Repository Root Node
    const repoNode = graph.addNode({
      id: 'repo:root',
      kind: NodeKind.REPOSITORY,
      name: 'Repository Root',
      metadata: { fileCount: entries.length }
    });

    // 2. Pre-populate file nodes
    for (const entry of entries) {
      if (entry.excludedReason) continue;
      const fileId = `file:${entry.path}`;
      const isTestFile = /(?:^|\/)(?:tests?|__tests__|spec)\/|(?:\.|\_)(?:test|spec)\.[a-zA-Z]+$/i.test(entry.path);

      graph.addNode({
        id: fileId,
        kind: isTestFile ? NodeKind.TEST : NodeKind.FILE,
        name: entry.path,
        filePath: entry.path,
        metadata: {
          bytes: entry.bytes,
          isTest: isTestFile,
          extension: path.extname(entry.path)
        }
      });

      // Edge from repo to file
      graph.addEdge(new DependencyEdge({
        sourceId: repoNode.id,
        targetId: fileId,
        type: EdgeType.REFERENCES,
        evidence: [new EvidenceRecord({
          source: EvidenceSource.STATIC_AST,
          revisionId,
          method: 'repository-manifest',
          status: ValidationStatus.CONFIRMED,
          weight: 1.0,
          details: { path: entry.path }
        })]
      }));
    }

    // 3. Extract symbol nodes, calls, imports, routes, and config references
    for (const entry of entries) {
      if (entry.excludedReason || !entry.content) continue;
      this.analyzeFile(entry.path, entry.content, graph, candidates, revisionId);
    }

    return graph;
  }

  analyzeFile(filePath, content, graph, candidates, revisionId) {
    const fileId = `file:${filePath}`;
    const ext = path.extname(filePath).toLowerCase();

    // 1. Config Key Extraction
    const configRegex = /\b(?:process\.env\.([A-Za-z0-9_]+)|env\[['"]([A-Za-z0-9_]+)['"]\]|os\.getenv\(['"]([A-Za-z0-9_]+)['"]\))/g;
    for (const match of content.matchAll(configRegex)) {
      const configKey = match[1] || match[2] || match[3];
      if (configKey) {
        const configNodeId = `config:${configKey}`;
        if (!graph.hasNode(configNodeId)) {
          graph.addNode({
            id: configNodeId,
            kind: NodeKind.CONFIG,
            name: configKey
          });
        }
        graph.addEdge(new DependencyEdge({
          sourceId: fileId,
          targetId: configNodeId,
          type: EdgeType.CONFIGURES,
          evidence: [new EvidenceRecord({
            source: EvidenceSource.CONFIG_MANIFEST,
            sourceLocation: { filePath, line: lineOf(content, match.index) },
            revisionId,
            method: 'env-access-visitor',
            status: ValidationStatus.CONFIRMED,
            weight: 0.95
          })]
        }));
      }
    }

    // 2. JavaScript / TypeScript Analysis
    if (['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs'].includes(ext)) {
      this.analyzeJavaScriptSymbolsAndCalls(filePath, content, graph, candidates, revisionId);
    }

    // 3. Python Analysis
    if (ext === '.py') {
      this.analyzePythonSymbolsAndCalls(filePath, content, graph, candidates, revisionId);
    }
  }

  analyzeJavaScriptSymbolsAndCalls(filePath, content, graph, candidates, revisionId) {
    const fileId = `file:${filePath}`;
    const definedSymbols = new Map(); // name -> nodeId

    // Function declarations: async function foo(...) / function foo(...)
    const fnRegex = /(?:^|\n)\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g;
    for (const match of content.matchAll(fnRegex)) {
      const fnName = match[1];
      const fnId = `fn:${filePath}#${fnName}`;
      const line = lineOf(content, match.index);
      const node = graph.addNode({
        id: fnId,
        kind: NodeKind.FUNCTION,
        name: fnName,
        filePath,
        line
      });
      definedSymbols.set(fnName, fnId);

      // Edge from File to Function (membership)
      graph.addEdge(new DependencyEdge({
        sourceId: fileId,
        targetId: fnId,
        type: EdgeType.REFERENCES,
        evidence: [new EvidenceRecord({
          source: EvidenceSource.STATIC_AST,
          sourceLocation: { filePath, line },
          revisionId,
          method: 'js-fn-declaration',
          status: ValidationStatus.CONFIRMED,
          weight: 1.0
        })]
      }));
    }

    // Arrow function / expressions: const foo = (async)? (...) => ...
    const arrowRegex = /(?:^|\n)\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g;
    for (const match of content.matchAll(arrowRegex)) {
      const fnName = match[1];
      const fnId = `fn:${filePath}#${fnName}`;
      const line = lineOf(content, match.index);
      if (!graph.hasNode(fnId)) {
        graph.addNode({
          id: fnId,
          kind: NodeKind.FUNCTION,
          name: fnName,
          filePath,
          line
        });
        definedSymbols.set(fnName, fnId);

        graph.addEdge(new DependencyEdge({
          sourceId: fileId,
          targetId: fnId,
          type: EdgeType.REFERENCES,
          evidence: [new EvidenceRecord({
            source: EvidenceSource.STATIC_AST,
            sourceLocation: { filePath, line },
            revisionId,
            method: 'js-arrow-declaration',
            status: ValidationStatus.CONFIRMED,
            weight: 1.0
          })]
        }));
      }
    }

    // Classes: class Foo extends Bar
    const classRegex = /(?:^|\n)\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)(?:\s+extends\s+([A-Za-z_$][\w$]*))?/g;
    for (const match of content.matchAll(classRegex)) {
      const className = match[1];
      const parentClass = match[2];
      const classId = `class:${filePath}#${className}`;
      const line = lineOf(content, match.index);

      graph.addNode({
        id: classId,
        kind: NodeKind.CLASS,
        name: className,
        filePath,
        line,
        metadata: { parentClass }
      });
      definedSymbols.set(className, classId);

      graph.addEdge(new DependencyEdge({
        sourceId: fileId,
        targetId: classId,
        type: EdgeType.REFERENCES,
        evidence: [new EvidenceRecord({
          source: EvidenceSource.STATIC_AST,
          sourceLocation: { filePath, line },
          revisionId,
          method: 'js-class-declaration',
          status: ValidationStatus.CONFIRMED,
          weight: 1.0
        })]
      }));

      if (parentClass) {
        // Inheritance edge
        const parentId = `class:${parentClass}`; // Inferred if unresolved locally
        if (!graph.hasNode(parentId)) {
          graph.addNode({ id: parentId, kind: NodeKind.CLASS, name: parentClass });
        }
        graph.addEdge(new DependencyEdge({
          sourceId: classId,
          targetId: parentId,
          type: EdgeType.EXTENDS,
          evidence: [new EvidenceRecord({
            source: EvidenceSource.STATIC_AST,
            sourceLocation: { filePath, line },
            revisionId,
            method: 'js-class-inheritance',
            status: ValidationStatus.STATICALLY_INFERRED,
            weight: 0.9
          })]
        }));
      }
    }

    // Imports (ES & CommonJS)
    const importRegex = /(?:import\s+(?:(?:[A-Za-z0-9_{}\s*,*]+)\s+from\s+)?|require\s*\(\s*)['"]([^'"]+)['"]/g;
    for (const match of content.matchAll(importRegex)) {
      const specifier = match[1];
      const resolved = resolveImportPath(filePath, specifier, candidates);
      const line = lineOf(content, match.index);

      if (resolved) {
        const targetFileId = `file:${resolved}`;
        graph.addEdge(new DependencyEdge({
          sourceId: fileId,
          targetId: targetFileId,
          type: EdgeType.IMPORTS,
          evidence: [new EvidenceRecord({
            source: EvidenceSource.STATIC_AST,
            sourceLocation: { filePath, line },
            revisionId,
            method: 'js-static-import',
            status: ValidationStatus.CONFIRMED,
            weight: 1.0,
            details: { specifier }
          })]
        }));
      } else if (!specifier.startsWith('.')) {
        // External package dependency
        const pkgNodeId = `external:${specifier}`;
        if (!graph.hasNode(pkgNodeId)) {
          graph.addNode({
            id: pkgNodeId,
            kind: NodeKind.EXTERNAL,
            name: specifier
          });
        }
        graph.addEdge(new DependencyEdge({
          sourceId: fileId,
          targetId: pkgNodeId,
          type: EdgeType.IMPORTS,
          evidence: [new EvidenceRecord({
            source: EvidenceSource.STATIC_AST,
            sourceLocation: { filePath, line },
            revisionId,
            method: 'js-package-import',
            status: ValidationStatus.CONFIRMED,
            weight: 0.95,
            details: { package: specifier }
          })]
        }));
      }
    }

    // Test declarations: test('name', ...) / it('name', ...) / describe('name', ...)
    const testRegex = /\b(?:test|it)\s*\(\s*['"`]([^'"`]+)['"`]/g;
    for (const match of content.matchAll(testRegex)) {
      const testName = match[1];
      const line = lineOf(content, match.index);
      const testNodeId = `test:${filePath}#${testName}`;

      graph.addNode({
        id: testNodeId,
        kind: NodeKind.TEST,
        name: testName,
        filePath,
        line
      });

      // Edge from file to test case
      graph.addEdge(new DependencyEdge({
        sourceId: fileId,
        targetId: testNodeId,
        type: EdgeType.COVERS,
        evidence: [new EvidenceRecord({
          source: EvidenceSource.STATIC_AST,
          sourceLocation: { filePath, line },
          revisionId,
          method: 'test-case-declaration',
          status: ValidationStatus.CONFIRMED,
          weight: 1.0
        })]
      }));

      // Infer coverage from test file imports
      const outImports = graph.getOutEdges(fileId).filter((e) => e.type === EdgeType.IMPORTS);
      for (const importEdge of outImports) {
        graph.addEdge(new DependencyEdge({
          sourceId: testNodeId,
          targetId: importEdge.targetId,
          type: EdgeType.COVERS,
          evidence: [new EvidenceRecord({
            source: EvidenceSource.COVERAGE_MAP,
            sourceLocation: { filePath, line },
            revisionId,
            method: 'static-test-import-heuristic',
            status: ValidationStatus.STATICALLY_INFERRED,
            weight: 0.75,
            details: { inferredFromImport: importEdge.targetId }
          })]
        }));
      }
    }

    // HTTP Endpoint routes: app.get('/path', handler) / router.post('/path', ...)
    const routeRegex = /\b(?:app|router)\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/g;
    for (const match of content.matchAll(routeRegex)) {
      const httpMethod = match[1].toUpperCase();
      const routePath = match[2];
      const line = lineOf(content, match.index);
      const endpointId = `endpoint:${httpMethod} ${routePath}`;

      if (!graph.hasNode(endpointId)) {
        graph.addNode({
          id: endpointId,
          kind: NodeKind.ENDPOINT,
          name: `${httpMethod} ${routePath}`,
          metadata: { httpMethod, routePath }
        });
      }

      graph.addEdge(new DependencyEdge({
        sourceId: fileId,
        targetId: endpointId,
        type: EdgeType.ROUTES_TO,
        evidence: [new EvidenceRecord({
          source: EvidenceSource.API_CONTRACT,
          sourceLocation: { filePath, line },
          revisionId,
          method: 'express-route-pattern',
          status: ValidationStatus.CONTRACT_DERIVED,
          weight: 1.0
        })]
      }));
    }
  }

  analyzePythonSymbolsAndCalls(filePath, content, graph, candidates, revisionId) {
    const fileId = `file:${filePath}`;

    // def foo(...)
    const fnRegex = /(?:^|\n)\s*(?:async\s+)?def\s+([A-Za-z_][\w]*)\s*\(/g;
    for (const match of content.matchAll(fnRegex)) {
      const fnName = match[1];
      const fnId = `fn:${filePath}#${fnName}`;
      const line = lineOf(content, match.index);

      graph.addNode({
        id: fnId,
        kind: NodeKind.FUNCTION,
        name: fnName,
        filePath,
        line
      });

      graph.addEdge(new DependencyEdge({
        sourceId: fileId,
        targetId: fnId,
        type: EdgeType.REFERENCES,
        evidence: [new EvidenceRecord({
          source: EvidenceSource.STATIC_AST,
          sourceLocation: { filePath, line },
          revisionId,
          method: 'python-def-declaration',
          status: ValidationStatus.CONFIRMED,
          weight: 1.0
        })]
      }));
    }

    // class Foo(...)
    const classRegex = /(?:^|\n)\s*class\s+([A-Za-z_][\w]*)(?:\s*\(([^)]*)\))?:/g;
    for (const match of content.matchAll(classRegex)) {
      const className = match[1];
      const classId = `class:${filePath}#${className}`;
      const line = lineOf(content, match.index);

      graph.addNode({
        id: classId,
        kind: NodeKind.CLASS,
        name: className,
        filePath,
        line
      });

      graph.addEdge(new DependencyEdge({
        sourceId: fileId,
        targetId: classId,
        type: EdgeType.REFERENCES,
        evidence: [new EvidenceRecord({
          source: EvidenceSource.STATIC_AST,
          sourceLocation: { filePath, line },
          revisionId,
          method: 'python-class-declaration',
          status: ValidationStatus.CONFIRMED,
          weight: 1.0
        })]
      }));
    }

    // Python imports: from foo import bar / import foo
    const importRegex = /(?:^|\n)\s*(?:from\s+([A-Za-z0-9_.]+)\s+import\s+([A-Za-z0-9_,\s*]+)|import\s+([A-Za-z0-9_.]+))/g;
    for (const match of content.matchAll(importRegex)) {
      const mod = match[1] || match[3];
      const line = lineOf(content, match.index);
      if (mod) {
        const potentialPath = `${mod.replace(/\./g, '/')}.py`;
        if (candidates.has(potentialPath)) {
          graph.addEdge(new DependencyEdge({
            sourceId: fileId,
            targetId: `file:${potentialPath}`,
            type: EdgeType.IMPORTS,
            evidence: [new EvidenceRecord({
              source: EvidenceSource.STATIC_AST,
              sourceLocation: { filePath, line },
              revisionId,
              method: 'python-import',
              status: ValidationStatus.CONFIRMED,
              weight: 0.95
            })]
          }));
        } else {
          const pkgId = `external:${mod.split('.')[0]}`;
          if (!graph.hasNode(pkgId)) {
            graph.addNode({ id: pkgId, kind: NodeKind.EXTERNAL, name: mod.split('.')[0] });
          }
          graph.addEdge(new DependencyEdge({
            sourceId: fileId,
            targetId: pkgId,
            type: EdgeType.IMPORTS,
            evidence: [new EvidenceRecord({
              source: EvidenceSource.STATIC_AST,
              sourceLocation: { filePath, line },
              revisionId,
              method: 'python-package-import',
              status: ValidationStatus.CONFIRMED,
              weight: 0.9
            })]
          }));
        }
      }
    }
  }
}

module.exports = {
  SourceCodeImpactAnalyzer,
  resolveImportPath
};
