function lineOf(content, index) {
  return content.slice(0, index).split('\n').length;
}

function analyzePython(filePath, content) {
  const symbols = [];
  const edges = [];
  const routes = [];
  const frameworks = new Set();

  if (content.includes('from fastapi') || content.includes('import fastapi') || content.includes('FastAPI()')) {
    frameworks.add('FastAPI');
  }
  if (content.includes('from flask') || content.includes('import flask') || content.includes('Flask(')) {
    frameworks.add('Flask');
  }
  if (content.includes('django') || content.includes('models.Model') || content.includes('django.urls')) {
    frameworks.add('Django');
  }

  // Symbol extraction: def, async def, class
  const symbolPattern = /^[ \t]*(?:async\s+)?(def|class)\s+([A-Za-z_][A-Za-z0-9_]*)/gm;
  for (const match of content.matchAll(symbolPattern)) {
    symbols.push({
      filePath,
      kind: match[1],
      name: match[2],
      line: lineOf(content, match.index)
    });
  }

  // Import extraction: from x import y, import x
  const importPattern = /^[ \t]*(?:from\s+([A-Za-z0-9_.]+)\s+import|import\s+([A-Za-z0-9_.]+))/gm;
  for (const match of content.matchAll(importPattern)) {
    const pkg = match[1] || match[2];
    symbols.push({
      filePath,
      kind: 'import',
      name: pkg,
      line: lineOf(content, match.index)
    });
    edges.push({
      sourcePath: filePath,
      targetPath: `pkg:${pkg.split('.')[0]}`,
      type: 'depends-on-package',
      confidence: 'confirmed',
      line: lineOf(content, match.index),
      provenance: 'python-import'
    });
  }

  // Route extraction: FastAPI / Flask decorators (@app.get('/path'), @router.post('/path'))
  const routePattern = /@[A-Za-z0-9_]+\.(get|post|put|delete|patch)\s*\(\s*["']([^"']+)["']/g;
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

module.exports = { analyzePython };
