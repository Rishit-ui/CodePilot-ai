const path = require('node:path').posix;
const { parseJavaScript } = require('../parsing/source');

function resolveImport(source, request, candidates) {
  if (!request.startsWith('.')) return null;
  const base = path.normalize(path.join(path.dirname(source), request));
  const options = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, `${base}.mjs`, `${base}.cjs`,
    path.join(base, 'index.ts'), path.join(base, 'index.tsx'), path.join(base, 'index.js'), path.join(base, 'index.jsx')];
  return options.find((candidate) => candidates.has(candidate)) || null;
}

function analyzeJavaScript(filePath, content, candidates) {
  const parsed = parseJavaScript(content, filePath);
  const frameworks = new Set();
  const packageNames = new Set(parsed.imports.filter((entry) => !entry.specifier.startsWith('.')).map((entry) => entry.specifier));
  if (packageNames.has('express')) frameworks.add('Express');
  if ([...packageNames].some((name) => name.startsWith('next/'))) frameworks.add('Next.js');
  if (packageNames.has('react')) frameworks.add('React');
  if (packageNames.has('@nestjs/common')) frameworks.add('NestJS');
  if (packageNames.has('fastify')) frameworks.add('Fastify');

  const symbols = parsed.symbols.map((symbol) => ({
    filePath, kind: symbol.kind, name: symbol.name, line: symbol.line,
    evidence: parsed.evidence, parser: parsed.parser
  }));
  for (const route of parsed.routes) {
    symbols.push({
      filePath, kind: `route:${route.method.toLowerCase()}`, name: `${route.method} ${route.path}`,
      line: route.line, evidence: parsed.evidence, parser: parsed.parser
    });
  }

  const edges = [];
  for (const imported of parsed.imports) {
    const resolved = resolveImport(filePath, imported.specifier, candidates);
    if (resolved) {
      edges.push({
        sourcePath: filePath, targetPath: resolved, type: 'imports', confidence: 'statically-inferred',
        line: imported.line, provenance: `ast-${imported.kind}`, parser: parsed.parser
      });
    } else if (!imported.specifier.startsWith('.')) {
      edges.push({
        sourcePath: filePath, targetPath: `pkg:${imported.specifier}`, type: 'depends-on-package',
        confidence: 'statically-inferred', line: imported.line, provenance: `ast-${imported.kind}`, parser: parsed.parser
      });
    }
  }

  return {
    symbols, edges,
    routes: parsed.routes.map((route) => ({ ...route, filePath, evidence: parsed.evidence, parser: parsed.parser })),
    frameworks: Array.from(frameworks),
    parser: { name: parsed.parser, evidence: parsed.evidence, recovered: parsed.recovered, errors: parsed.errors }
  };
}

module.exports = { analyzeJavaScript, resolveImport };
