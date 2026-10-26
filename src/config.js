const path = require('node:path');

function readEnvFile(filePath) {
  try {
    const values = {};
    for (const line of require('node:fs').readFileSync(filePath, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match) values[match[1]] = match[2];
    }
    return values;
  } catch { return {}; }
}

function integer(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function loadConfig(rootDir) {
  const fileValues = readEnvFile(path.join(rootDir, '.env'));
  const env = { ...fileValues, ...process.env };
  return Object.freeze({
    host: env.CODEPILOT_HOST || '127.0.0.1',
    port: integer(env.CODEPILOT_PORT, 3000, 1, 65535),
    dataDir: path.resolve(rootDir, env.CODEPILOT_DATA_DIR || '.data'),
    limits: Object.freeze({
      maxUploadBytes: 10 * 1024 * 1024,
      maxExtractedBytes: 25 * 1024 * 1024,
      maxFiles: 1_000,
      maxFileBytes: 2 * 1024 * 1024,
      maxCompressionRatio: 100,
      maxQuestionChars: 2_000,
      maxSearchResults: 100
    })
  });
}

module.exports = { loadConfig };
