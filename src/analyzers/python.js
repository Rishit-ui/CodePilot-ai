const { parsePython } = require('../parsing/source');

function analyzePython(filePath, content) {
  const parsed = parsePython(content);
  const frameworks = new Set();
  const roots = new Set(parsed.imports.map((entry) => entry.specifier.replace(/^\.+/, '').split('.')[0]));
  if (roots.has('fastapi')) frameworks.add('FastAPI');
  if (roots.has('flask')) frameworks.add('Flask');
  if (roots.has('django')) frameworks.add('Django');

  const symbols = parsed.symbols.map((symbol) => ({
    filePath, kind: symbol.kind, name: symbol.name, line: symbol.line,
    evidence: parsed.evidence, parser: parsed.parser
  }));
  for (const imported of parsed.imports) {
    symbols.push({ filePath, kind: 'import', name: imported.specifier, line: imported.line, evidence: parsed.evidence, parser: parsed.parser });
  }
  for (const route of parsed.routes) {
    symbols.push({
      filePath, kind: `route:${route.method.toLowerCase()}`, name: `${route.method} ${route.path}`,
      line: route.line, evidence: parsed.evidence, parser: parsed.parser
    });
  }
  const edges = parsed.imports.map((imported) => ({
    sourcePath: filePath,
    targetPath: `pkg:${imported.specifier.replace(/^\.+/, '').split('.')[0] || imported.specifier}`,
    type: 'depends-on-package', confidence: 'statically-inferred', line: imported.line,
    provenance: 'ast-python-import', parser: parsed.parser
  }));
  return {
    symbols, edges,
    routes: parsed.routes.map((route) => ({ ...route, filePath, evidence: parsed.evidence, parser: parsed.parser })),
    frameworks: Array.from(frameworks),
    parser: { name: parsed.parser, evidence: parsed.evidence, recovered: parsed.recovered, errors: parsed.errors }
  };
}

module.exports = { analyzePython };
