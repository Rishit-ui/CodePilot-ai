const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const MIN_SESSION_SECRET_LENGTH = 32;
const INSECURE_SECRET_PATTERNS = [
  /dev[-_ ]?insecure/i,
  /change[-_ ]?this/i,
  /replace[-_ ]?me/i,
  /local[-_ ]?dev[-_ ]?fallback/i,
  /prod[-_ ]?insecure/i
];

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
  const configuredSecret = env.CODEPILOT_SESSION_SECRET || '';
  const authEnabled = boolean(env.CODEPILOT_AUTH_ENABLED, true);
  if (isProd && !configuredSecret) {
    throw new Error('FATAL: CODEPILOT_SESSION_SECRET must be explicitly set in every production environment.');
  }
  if (configuredSecret && (configuredSecret.length < MIN_SESSION_SECRET_LENGTH || INSECURE_SECRET_PATTERNS.some((pattern) => pattern.test(configuredSecret)))) {
    throw new Error(`FATAL: CODEPILOT_SESSION_SECRET must be at least ${MIN_SESSION_SECRET_LENGTH} characters and must not use a known placeholder.`);
  }
  if (isProd && !authEnabled) {
    throw new Error('FATAL: CODEPILOT_AUTH_ENABLED cannot be disabled in production.');
  }
  // Development gets an unpredictable process-local value when no secret is configured.
  // It is never used as a production fallback and is intentionally not logged.
  const sessionSecret = configuredSecret || crypto.randomBytes(32).toString('hex');

  // Database URL for hosted PostgreSQL (Neon, Supabase, Vercel Postgres, AWS RDS)
  const databaseUrl = env.DATABASE_URL || env.POSTGRES_URL || env.POSTGRES_PRISMA_URL || null;
  const dbSslMode = env.CODEPILOT_DB_SSL_MODE || (isProd ? 'verify-full' : 'prefer');
  if (!['disable', 'prefer', 'require', 'verify-full'].includes(dbSslMode)) {
    throw new Error('FATAL: CODEPILOT_DB_SSL_MODE must be disable, prefer, require, or verify-full.');
  }
  const rateLimitEnabled = boolean(env.CODEPILOT_RATE_LIMIT_ENABLED, true);
  if (isProd && rateLimitEnabled && !databaseUrl) {
    throw new Error('FATAL: DATABASE_URL is required in production for distributed rate limiting and durable persistence.');
  }
  const executionMode = env.CODEPILOT_EXECUTION_MODE || (isProd ? 'disabled' : 'local-development');
  if (!['disabled', 'local-development', 'external-worker'].includes(executionMode)) {
    throw new Error('FATAL: CODEPILOT_EXECUTION_MODE must be disabled, local-development, or external-worker.');
  }
  if (isProd && executionMode === 'local-development') {
    throw new Error('FATAL: local-development execution is forbidden in production.');
  }

  // Direct HTTP upload limit (4.5MB edge proxy limit on Vercel)
  const defaultMaxUpload = isVercel ? 4.5 * 1024 * 1024 : 10 * 1024 * 1024;
  // Extracted total uncompressed ceiling (generous for serverless memory)
  const defaultMaxExtracted = isVercel ? 200 * 1024 * 1024 : 300 * 1024 * 1024;

  return Object.freeze({
    env: nodeEnv,
    isProduction: isProd,
    isVercel,
    host: env.CODEPILOT_HOST || '127.0.0.1',
    port: integer(env.CODEPILOT_PORT, 3000, 1, 65535),
    dataDir: path.resolve(rootDir, env.CODEPILOT_DATA_DIR || (isVercel ? '/tmp/.data' : '.data')),
    databaseUrl,
    database: Object.freeze({
      url: databaseUrl,
      sslMode: dbSslMode,
      poolMax: integer(env.CODEPILOT_DB_POOL_MAX, isVercel ? 3 : 10, 1, 50),
      connectionTimeoutMs: integer(env.CODEPILOT_DB_CONNECTION_TIMEOUT_MS, 5000, 500, 30000),
      queryTimeoutMs: integer(env.CODEPILOT_DB_QUERY_TIMEOUT_MS, 15000, 1000, 120000)
    }),
    sessionSecret,
    authEnabled,
    rateLimit: Object.freeze({
      enabled: rateLimitEnabled,
      failClosed: isProd,
      trustProxy: boolean(env.CODEPILOT_TRUST_PROXY, isVercel),
      trustedProxyHops: integer(env.CODEPILOT_TRUSTED_PROXY_HOPS, isVercel ? 1 : 0, 0, 5),
      authFailureMax: integer(env.CODEPILOT_AUTH_FAILURE_MAX, 5, 2, 100),
      authFailureWindowMs: integer(env.CODEPILOT_AUTH_FAILURE_WINDOW_MS, 15 * 60 * 1000, 1000, 24 * 60 * 60 * 1000),
      policies: Object.freeze(Object.fromEntries([
        ['registration', 5, 10], ['login', 10, 30], ['ai', 30, 100], ['import', 10, 30],
        ['analysis', 30, 100], ['patch', 20, 60], ['execution', 5, 15], ['deployment', 3, 10]
      ].map(([name, subjectMax, ipMax]) => [name, Object.freeze({
        subjectMax: integer(env[`CODEPILOT_RATE_${name.toUpperCase()}_SUBJECT_MAX`], subjectMax, 1, 10000),
        ipMax: integer(env[`CODEPILOT_RATE_${name.toUpperCase()}_IP_MAX`], ipMax, 1, 10000),
        windowMs: integer(env[`CODEPILOT_RATE_${name.toUpperCase()}_WINDOW_MS`], 60_000, 1000, 24 * 60 * 60 * 1000)
      })])))
    }),
    execution: Object.freeze({
      mode: executionMode,
      workerUrl: env.CODEPILOT_WORKER_URL || '',
      workerToken: env.CODEPILOT_WORKER_TOKEN || ''
    }),
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
      maxRemoteDownloadBytes: integer(env.CODEPILOT_MAX_REMOTE_BYTES, 100 * 1024 * 1024, 1024, 250 * 1024 * 1024),
      maxExtractedBytes: integer(env.CODEPILOT_MAX_EXTRACTED_BYTES, defaultMaxExtracted, 1024, 500 * 1024 * 1024),
      maxFiles: integer(env.CODEPILOT_MAX_FILES, 5_000, 10, 50_000),
      maxFileBytes: integer(env.CODEPILOT_MAX_FILE_BYTES, 10 * 1024 * 1024, 1024, 50 * 1024 * 1024),
      maxCompressionRatio: integer(env.CODEPILOT_MAX_COMPRESSION_RATIO, 100, 2, 500),
      maxQuestionChars: 4_000,
      maxSearchResults: 200,
      commandTimeoutMs: integer(env.CODEPILOT_CMD_TIMEOUT_MS, isVercel ? 8_000 : 30_000, 1_000, 120_000)
    })
  });
}

module.exports = { loadConfig, MIN_SESSION_SECRET_LENGTH };
