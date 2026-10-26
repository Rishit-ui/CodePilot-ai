const path = require('node:path').posix;

const LANGUAGE_BY_EXTENSION = Object.freeze({
  '.js': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript', '.ts': 'TypeScript', '.tsx': 'TypeScript', '.jsx': 'JavaScript',
  '.py': 'Python', '.java': 'Java', '.c': 'C', '.h': 'C/C++', '.cpp': 'C++', '.cc': 'C++', '.cs': 'C#',
  '.json': 'JSON', '.yml': 'YAML', '.yaml': 'YAML', '.toml': 'TOML', '.md': 'Markdown', '.html': 'HTML', '.css': 'CSS', '.sql': 'SQL', '.sh': 'Shell', '.dockerfile': 'Dockerfile'
});
const EXCLUDED_DIRECTORIES = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', 'vendor', 'target']);

function languageFor(filePath) {
  if (path.basename(filePath) === 'Dockerfile') return 'Dockerfile';
  return LANGUAGE_BY_EXTENSION[path.extname(filePath).toLowerCase()] || 'Unknown';
}
function lineOf(content, index) { return content.slice(0, index).split('\n').length; }
function isText(buffer) { return !buffer.subarray(0, 4_096).includes(0); }
function excludedReason(filePath) { return filePath.split('/').some((part) => EXCLUDED_DIRECTORIES.has(part)) ? 'generated-or-vendored-directory' : null; }
function redact(content) {
  return content
    .replace(/(AKIA[0-9A-Z]{16})/g, '[REDACTED_AWS_KEY]')
    .replace(/(-----BEGIN [A-Z ]*PRIVATE KEY-----)[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----)/g, '$1\n[REDACTED_PRIVATE_KEY]\n$2')
    .replace(/((?:api[_-]?key|secret|token|password)\s*[=:]\s*["']?)[^\s"']+/gi, '$1[REDACTED]');
}
function resolveImport(source, request, candidates) {
  if (!request.startsWith('.')) return null;
  const base = path.normalize(path.join(path.dirname(source), request));
  const options = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, `${base}.mjs`, path.join(base, 'index.ts'), path.join(base, 'index.js')];
  return options.find((candidate) => candidates.has(candidate)) || null;
}

function analyze(entries) {
  const files = [], symbols = [], edges = [], findings = [];
  const candidates = new Set(entries.map((entry) => entry.path));
  for (const entry of entries) {
    const language = languageFor(entry.path);
    const excluded = excludedReason(entry.path);
    const text = isText(entry.data) ? entry.data.toString('utf8') : null;
    const content = text ? redact(text) : null;
    files.push({ path: entry.path, language, bytes: entry.bytes, content, excludedReason: excluded });
    if (excluded || !content) continue;
    const symbolPattern = /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?(function|class|interface|type|const|let|def)\s+([A-Za-z_$][\w$]*)/g;
    for (const match of content.matchAll(symbolPattern)) symbols.push({ filePath: entry.path, kind: match[1], name: match[2], line: lineOf(content, match.index) });
    if (language === 'JavaScript' || language === 'TypeScript') {
      const imports = /(?:import\s+(?:[^'";]+?\s+from\s+)?|require\s*\()['"]([^'"]+)['"]/g;
      for (const match of content.matchAll(imports)) {
        const resolved = resolveImport(entry.path, match[1], candidates);
        if (resolved) edges.push({ sourcePath: entry.path, targetPath: resolved, type: 'imports', confidence: 'confirmed', line: lineOf(content, match.index), provenance: 'static-import' });
      }
      const routes = /\b(?:app|router)\.(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)/g;
      for (const match of content.matchAll(routes)) symbols.push({ filePath: entry.path, kind: `route:${match[1]}`, name: match[2], line: lineOf(content, match.index) });
    }
    if (language === 'Python') {
      for (const match of content.matchAll(/^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm)) symbols.push({ filePath: entry.path, kind: 'import', name: match[1] || match[2], line: lineOf(content, match.index) });
    }
    for (const match of content.matchAll(/\b(?:process\.env|os\.environ(?:\.get)?)[\[.(]?["']?([A-Z][A-Z0-9_]+)/g)) symbols.push({ filePath: entry.path, kind: 'environment', name: match[1], line: lineOf(content, match.index) });
    for (const match of content.matchAll(/\b(TODO|FIXME|HACK)\b/g)) findings.push({ severity: 'info', category: 'maintenance', message: `${match[1]} marker requires review.`, filePath: entry.path, line: lineOf(content, match.index), evidence: match[0] });
    if (/AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text || '')) findings.push({ severity: 'high', category: 'secret-exposure', message: 'Potential credential material detected and redacted from explorer output.', filePath: entry.path, line: 1, evidence: 'pattern match' });
  }
  if (!files.some((file) => /^(package\.json|pyproject\.toml|requirements\.txt|pom\.xml|go\.mod)$/i.test(file.path))) findings.push({ severity: 'info', category: 'inventory', message: 'No recognized dependency manifest was found.', evidence: 'inventory' });
  return { files, symbols, edges, findings };
}

module.exports = { analyze, languageFor, redact };
