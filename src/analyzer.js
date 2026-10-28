const path = require('node:path').posix;
const { analyzeJavaScript } = require('./analyzers/javascript');
const { analyzePython } = require('./analyzers/python');
const { analyzeDockerfile, analyzeDockerCompose } = require('./analyzers/docker');

const LANGUAGE_BY_EXTENSION = Object.freeze({
  '.js': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
  '.ts': 'TypeScript', '.tsx': 'TypeScript', '.jsx': 'JavaScript',
  '.py': 'Python', '.java': 'Java', '.c': 'C', '.h': 'C/C++',
  '.cpp': 'C++', '.cc': 'C++', '.cs': 'C#', '.go': 'Go', '.rs': 'Rust',
  '.rb': 'Ruby', '.php': 'PHP', '.json': 'JSON', '.yml': 'YAML',
  '.yaml': 'YAML', '.toml': 'TOML', '.md': 'Markdown', '.html': 'HTML',
  '.css': 'CSS', '.scss': 'SCSS', '.sql': 'SQL', '.sh': 'Shell',
  '.bash': 'Shell', '.dockerfile': 'Dockerfile', '.env': 'Config'
});

const EXCLUDED_DIRECTORIES = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', '.next', 'vendor',
  'target', '__pycache__', '.venv', 'venv', '.turbo', '.cache'
]);

function languageFor(filePath) {
  const base = path.basename(filePath);
  if (base === 'Dockerfile' || base.startsWith('Dockerfile.')) return 'Dockerfile';
  if (base === 'docker-compose.yml' || base === 'docker-compose.yaml' || base === 'compose.yaml') return 'DockerCompose';
  if (base.startsWith('.env')) return 'Config';
  return LANGUAGE_BY_EXTENSION[path.extname(filePath).toLowerCase()] || 'Unknown';
}

function lineOf(content, index) {
  return content.slice(0, index).split('\n').length;
}

function isText(buffer) {
  return !buffer.subarray(0, 4_096).includes(0);
}

function excludedReason(filePath) {
  return filePath.split('/').some((part) => EXCLUDED_DIRECTORIES.has(part))
    ? 'generated-or-vendored-directory'
    : null;
}

function redact(content) {
  return content
    .replace(/(AKIA[0-9A-Z]{16})/g, '[REDACTED_AWS_KEY]')
    .replace(/(ghp_[0-9a-zA-Z]{20,})/g, '[REDACTED_GITHUB_PAT]')
    .replace(/(-----BEGIN [A-Z ]*PRIVATE KEY-----)[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----)/g, '$1\n[REDACTED_PRIVATE_KEY]\n$2')
    .replace(/((?:api[_-]?key|secret|token|password|auth_token)\s*[=:]\s*["']?)[^\s"']+/gi, '$1[REDACTED]')
    .replace(/(postgres|mysql|mongodb(?:\+srv)?):\/\/[^:]+:([^@]+)@/gi, '$1://[REDACTED_USER]:[REDACTED_PASSWORD]@');
}

function analyze(entries) {
  const files = [];
  const symbols = [];
  const edges = [];
  const findings = [];
  const frameworks = new Set();
  const entrypoints = [];
  const routes = [];
  const databaseEntities = [];
  const candidates = new Set(entries.map((e) => e.path));

  for (const entry of entries) {
    const lang = languageFor(entry.path);
    const excluded = excludedReason(entry.path);
    const text = isText(entry.data) ? entry.data.toString('utf8') : null;
    const content = text ? redact(text) : null;

    files.push({
      path: entry.path,
      language: lang,
      bytes: entry.bytes,
      content,
      excludedReason: excluded
    });

    if (excluded || !content) continue;

    // Detect common entrypoints
    if (
      entry.path === 'index.js' || entry.path === 'server.js' || entry.path === 'src/index.js' ||
      entry.path === 'src/server.js' || entry.path === 'src/main.ts' || entry.path === 'src/index.ts' ||
      entry.path === 'main.py' || entry.path === 'app.py' || entry.path === 'src/main.py' ||
      entry.path === 'main.go' || entry.path === 'cmd/main.go'
    ) {
      entrypoints.push(entry.path);
      symbols.push({ filePath: entry.path, kind: 'entrypoint', name: entry.path, line: 1 });
    }

    // Language specific analyzers
    if (lang === 'JavaScript' || lang === 'TypeScript') {
      const res = analyzeJavaScript(entry.path, content, candidates);
      symbols.push(...res.symbols);
      edges.push(...res.edges);
      routes.push(...res.routes);
      res.frameworks.forEach((f) => frameworks.add(f));
    } else if (lang === 'Python') {
      const res = analyzePython(entry.path, content);
      symbols.push(...res.symbols);
      edges.push(...res.edges);
      routes.push(...res.routes);
      res.frameworks.forEach((f) => frameworks.add(f));
    } else if (lang === 'Dockerfile') {
      const res = analyzeDockerfile(entry.path, content);
      symbols.push(...res.symbols);
      findings.push(...res.findings);
    } else if (lang === 'DockerCompose') {
      const res = analyzeDockerCompose(entry.path, content);
      symbols.push(...res.symbols);
    } else if (lang === 'SQL') {
      // Table detection in SQL
      const tableMatch = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z0-9_."`]+)/gi;
      for (const match of content.matchAll(tableMatch)) {
        const tableName = match[1].replace(/["`]/g, '');
        databaseEntities.push(tableName);
        symbols.push({ filePath: entry.path, kind: 'db-table', name: tableName, line: lineOf(content, match.index) });
      }
    }

    // Generic environment variable references
    const envPattern = /\b(?:process\.env|os\.environ(?:\.get)?|os\.Getenv)\b[\[.(]?["']?([A-Z][A-Z0-9_]+)/g;
    for (const match of content.matchAll(envPattern)) {
      symbols.push({ filePath: entry.path, kind: 'environment', name: match[1], line: lineOf(content, match.index) });
    }

    // Maintenance markers
    const markerPattern = /\b(TODO|FIXME|HACK|XXX)\b(?::?\s*(.*))?/g;
    for (const match of content.matchAll(markerPattern)) {
      const marker = match[1];
      const desc = (match[2] || '').trim().slice(0, 100);
      findings.push({
        severity: 'info',
        category: 'maintenance',
        message: `${marker}: ${desc || 'Marker requires review'}`,
        filePath: entry.path,
        line: lineOf(content, match.index),
        evidence: match[0]
      });
    }

    // Credential exposure checks
    if (text) {
      if (/AKIA[0-9A-Z]{16}/.test(text)) {
        findings.push({
          severity: 'high',
          category: 'secret-exposure',
          message: 'AWS Access Key ID detected and redacted from output.',
          filePath: entry.path,
          line: 1,
          evidence: 'Pattern match AKIA...'
        });
      }
      if (/ghp_[0-9a-zA-Z]{36}/.test(text)) {
        findings.push({
          severity: 'high',
          category: 'secret-exposure',
          message: 'GitHub Personal Access Token detected.',
          filePath: entry.path,
          line: 1,
          evidence: 'Pattern match ghp_...'
        });
      }
      if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) {
        findings.push({
          severity: 'critical',
          category: 'secret-exposure',
          message: 'Private encryption key detected and redacted from explorer output.',
          filePath: entry.path,
          line: 1,
          evidence: 'Private key header'
        });
      }
    }
  }

  // Check for manifest
  const hasManifest = files.some((f) =>
    /^(package\.json|pyproject\.toml|requirements\.txt|pom\.xml|go\.mod|Cargo\.toml)$/i.test(f.path)
  );
  if (!hasManifest) {
    findings.push({
      severity: 'medium',
      category: 'inventory',
      message: 'No standard dependency manifest (package.json, pyproject.toml, requirements.txt, go.mod, pom.xml) found.',
      evidence: 'Inventory audit'
    });
  }

  return {
    files,
    symbols,
    edges,
    findings,
    metadata: {
      frameworks: Array.from(frameworks),
      entrypoints,
      routes,
      databaseEntities
    }
  };
}

module.exports = {
  analyze,
  languageFor,
  redact
};
