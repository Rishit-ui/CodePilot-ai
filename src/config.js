const path = require('node:path');
const fs = require('node:fs');

function readEnvFile(filePath) {
  try {
    const values = {};
    if (!fs.existsSync(filePath)) return values;
    const content = fs.readFileSync(filePath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const match = trimmed.match(/^([A-Za-z0-9_]+)=(.*)$/);
      if (match) {
        let val = match[2].trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        values[match[1]] = val;
      }
    }
    return values;
  } catch {
    return {};
  }
}

function integer(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function boolean(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return value === 'true' || value === '1' || value === true;
}

function loadConfig(rootDir = path.resolve(__dirname, '..')) {
  const fileValues = readEnvFile(path.join(rootDir, '.env'));
  const env = { ...fileValues, ...process.env };

  const nodeEnv = env.NODE_ENV || 'development';
  const isVercel = Boolean(env.VERCEL || env.NEXT_PUBLIC_VERCEL_ENV);
  const isProd = nodeEnv === 'production';

  const sessionSecret = env.CODEPILOT_SESSION_SECRET || (isProd && !isVercel ? null : 'dev-insecure-secret-key-32-chars-min-length-1234');
  if (isProd && !isVercel && !sessionSecret) {
    throw new Error('FATAL: CODEPILOT_SESSION_SECRET must be explicitly set in production mode.');
  }

  // Database URL for hosted PostgreSQL (Neon, Supabase, Vercel Postgres, AWS RDS)
  const databaseUrl = env.DATABASE_URL || env.POSTGRES_URL || env.POSTGRES_PRISMA_URL || null;

  // Adapt upload limit to serverless boundary (4.5MB on Vercel)
  const defaultMaxUpload = isVercel ? 4.5 * 1024 * 1024 : 10 * 1024 * 1024;
  const defaultMaxExtracted = isVercel ? 15 * 1024 * 1024 : 30 * 1024 * 1024;

  return Object.freeze({
    env: nodeEnv,
    isProduction: isProd,
    isVercel,
    host: env.CODEPILOT_HOST || '127.0.0.1',
    port: integer(env.CODEPILOT_PORT, 3000, 1, 65535),
    dataDir: path.resolve(rootDir, env.CODEPILOT_DATA_DIR || (isVercel ? '/tmp/.data' : '.data')),
    databaseUrl,
    sessionSecret: sessionSecret || 'local-dev-fallback-key-for-testing-only',
    authEnabled: boolean(env.CODEPILOT_AUTH_ENABLED, false),
    ai: Object.freeze({
      provider: env.CODEPILOT_AI_PROVIDER || 'local', // 'local' | 'openai' | 'anthropic' | 'gemini'
      apiKey: env.CODEPILOT_AI_API_KEY || '',
      model: env.CODEPILOT_AI_MODEL || (env.CODEPILOT_AI_PROVIDER === 'anthropic' ? 'claude-3-5-sonnet-20241022' : 'gpt-4o-mini'),
      baseUrl: env.CODEPILOT_AI_BASE_URL || ''
    }),
    deployment: Object.freeze({
      allowedProviders: ['local-docker', 'render', 'vercel', 'fly', 'static', 'mock'],
      renderApiKey: env.RENDER_API_KEY || '',
      vercelToken: env.VERCEL_TOKEN || '',
      flyApiToken: env.FLY_API_TOKEN || ''
    }),
    limits: Object.freeze({
      maxUploadBytes: integer(env.CODEPILOT_MAX_UPLOAD_BYTES, defaultMaxUpload, 1024, 100 * 1024 * 1024),
      maxExtractedBytes: integer(env.CODEPILOT_MAX_EXTRACTED_BYTES, defaultMaxExtracted, 1024, 300 * 1024 * 1024),
      maxFiles: integer(env.CODEPILOT_MAX_FILES, 1_500, 10, 50_000),
      maxFileBytes: integer(env.CODEPILOT_MAX_FILE_BYTES, 2 * 1024 * 1024, 1024, 10 * 1024 * 1024),
      maxCompressionRatio: integer(env.CODEPILOT_MAX_COMPRESSION_RATIO, 100, 2, 500),
      maxQuestionChars: 4_000,
      maxSearchResults: 200,
      commandTimeoutMs: integer(env.CODEPILOT_CMD_TIMEOUT_MS, isVercel ? 8_000 : 30_000, 1_000, 120_000)
    })
  });
}

module.exports = { loadConfig };
