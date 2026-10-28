const path = require('node:path').posix;

function lineOf(content, index) {
  return content.slice(0, index).split('\n').length;
}

function resolveImport(source, request, candidates) {
  if (!request.startsWith('.')) return null;
  const base = path.normalize(path.join(path.dirname(source), request));
  const options = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.mjs`,
    `${base}.cjs`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
    path.join(base, 'index.js'),
    path.join(base, 'index.jsx')
  ];
  return options.find((candidate) => candidates.has(candidate)) || null;
}

function analyzeJavaScript(filePath, content, candidates) {
  const symbols = [];
  const edges = [];
  const routes = [];
  const frameworks = new Set();

  // Framework detection patterns
  if (content.includes('express()') || content.includes("require('express')") || content.includes('from "express"') || content.includes("from 'express'")) {
    frameworks.add('Express');
  }
  if (content.includes('next/server') || content.includes('next/router') || content.includes('next/navigation') || content.includes('NextResponse')) {
    frameworks.add('Next.js');
  }
  if (content.includes('react') && (content.includes('useState') || content.includes('useEffect') || content.includes('React.Component'))) {
    frameworks.add('React');
  }
  if (content.includes('@nestjs/common') || content.includes('@Controller')) {
    frameworks.add('NestJS');
  }
  if (content.includes('fastify()') || content.includes('fastify')) {
    frameworks.add('Fastify');
  }

  // Symbol extraction: function, class, interface, type, const, export
  const symbolPattern = /(?:^|\n)\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(function|class|interface|type|const|let)\s+([A-Za-z_$][\w$]*)/g;
  for (const match of content.matchAll(symbolPattern)) {
    symbols.push({
      filePath,
      kind: match[1],
      name: match[2],
      line: lineOf(content, match.index)
    });
  }

  // ES module imports
  const esImports = /(?:^|\n)\s*import\s+(?:(?:(?:[A-Za-z0-9_{}\s*,*]+)\s+from\s+)?|)(?:['"])([^'"]+)(?:['"])/g;
  for (const match of content.matchAll(esImports)) {
    const importTarget = match[1];
    const resolved = resolveImport(filePath, importTarget, candidates);
    if (resolved) {
      edges.push({
        sourcePath: filePath,
        targetPath: resolved,
        type: 'imports',
        confidence: 'confirmed',
        line: lineOf(content, match.index),
        provenance: 'static-es-import'
      });
    } else if (!importTarget.startsWith('.')) {
      edges.push({
        sourcePath: filePath,
        targetPath: `pkg:${importTarget}`,
        type: 'depends-on-package',
        confidence: 'confirmed',
        line: lineOf(content, match.index),
        provenance: 'package-dependency'
      });
    }
  }

  // CommonJS require
  const cjsImports = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const match of content.matchAll(cjsImports)) {
    const importTarget = match[1];
    const resolved = resolveImport(filePath, importTarget, candidates);
    if (resolved) {
      edges.push({
        sourcePath: filePath,
        targetPath: resolved,
        type: 'imports',
        confidence: 'confirmed',
        line: lineOf(content, match.index),
        provenance: 'static-require'
      });
    } else if (!importTarget.startsWith('.')) {
      edges.push({
        sourcePath: filePath,
        targetPath: `pkg:${importTarget}`,
        type: 'depends-on-package',
        confidence: 'confirmed',
        line: lineOf(content, match.index),
        provenance: 'package-dependency'
      });
    }
  }

  // HTTP Routes: Express / Fastify style (app.get, router.post)
  const routePattern = /\b(?:app|router|server)\.(get|post|put|patch|delete|all|options|head)\s*\(\s*['"]([^'"]+)['"]/g;
  for (const match of content.matchAll(routePattern)) {
    const method = match[1].toUpperCase();
    const routePath = match[2];
    routes.push({
      method,
      path: routePath,
      filePath,
      line: lineOf(content, match.index)
    });
    symbols.push({
      filePath,
      kind: `route:${method.toLowerCase()}`,
      name: `${method} ${routePath}`,
      line: lineOf(content, match.index)
    });
  }

  return { symbols, edges, routes, frameworks: Array.from(frameworks) };
}

module.exports = { analyzeJavaScript };
