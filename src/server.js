const { SourceCodeImpactAnalyzer } = require('./impact/analyzer');
const { EvidenceReconciler } = require('./impact/reconcile');
const { ChangeImpactEngine } = require('./impact/impact');
const { RegressionTestSelector, SelectionStrategy } = require('./impact/test-selector');
const { IsolatedTestRunner, TEST_STATUS } = require('./impact/runner');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadConfig } = require('./config');
const { Store } = require('./db');
const { validateEmail, validatePasswordStrength, hasPermission } = require('./auth');
const { ArchiveError, readZip, contentHash } = require('./archive');
const { analyze } = require('./analyzer');
const { validateUrlForSSRF, fetchRemoteZip, fetchGithubOrRemoteZip, normalizeGithubRepoUrl, SSRFError } = require('./importer');
const { generateArchitectureReport, exportReportToMarkdown } = require('./architecture');
const {
  answerQuestionWithContext,
  chatWithContext,
  explainCode,
  generateTestsForCode,
  refactorCode,
  explainDiagram
} = require('./ai');
const { generateFlowDiagram } = require('./flow');
const { generatePlanFromRequirement, createUnifiedDiff } = require('./planner');
const { detectStack, generateDockerfile, generateDockerignore, generateDockerCompose } = require('./docker');
const { evaluateReadiness, executeDeployment } = require('./deployer');
const { runIsolatedTest } = require('./test_runner');
const { enforceRateLimit, requestIp } = require('./rate_limit');
const { VercelQueuePublisher, OutboxDispatcher } = require('./queue/vercel_queue');
const { VercelBlobStorage } = require('./storage/vercel_blob');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

function json(response, status, data) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(JSON.stringify(data));
}

function error(response, status, code, message) {
  json(response, status, { error: { code, message } });
}

function noProject(response) {
  return error(response, 404, 'PROJECT_NOT_FOUND', 'Project was not found.');
}

function readBody(request, limit) {
  if (request.body) {
    if (Buffer.isBuffer(request.body)) return Promise.resolve(request.body);
    if (typeof request.body === 'string') return Promise.resolve(Buffer.from(request.body, 'utf8'));
    if (typeof request.body === 'object') return Promise.resolve(Buffer.from(JSON.stringify(request.body), 'utf8'));
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('Request body exceeds the permitted size limit.'), { status: 413 }));
        request.destroy();
      } else {
        chunks.push(chunk);
      }
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function parseJson(buffer) {
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch {
    const err = new Error('Request must contain valid JSON.');
    err.status = 400;
    throw err;
  }
}

async function ensureProject(store, projectId, allowAutoCreate = false) {
  if (!projectId || typeof projectId !== 'string') return null;
  let project = await store.project(projectId);
  if (!project && allowAutoCreate && projectId.startsWith('project_')) {
    try {
      await store.run(
        'INSERT OR IGNORE INTO projects (id, name, created_at) VALUES (?, ?, ?)',
        projectId,
        'Active Project',
        new Date().toISOString()
      );
      project = await store.project(projectId);
    } catch {
      // Ignore conflict
    }
  }
  return project;
}

const PUBLIC_API_ROUTES = new Set([
  'GET /api',
  'GET /api/health',
  'GET /api/ready',
  'POST /api/auth/register',
  'POST /api/auth/login'
]);

function requiredProjectPermission(method, pathname) {
  if (method === 'GET') return 'read';
  if (method === 'DELETE' && /^\/api\/projects\/[^/]+$/.test(pathname)) return 'delete';
  if (/\/deploy$/.test(pathname)) return 'deploy';
  return 'write';
}

function isSafeRepositoryPath(candidate) {
  if (typeof candidate !== 'string' || !candidate || candidate.includes('\0') || candidate.includes('\\')) return false;
  if (candidate.startsWith('/') || /^[A-Za-z]:/.test(candidate)) return false;
  const normalized = path.posix.normalize(candidate);
  return normalized === candidate && !normalized.split('/').some((part) => part === '..' || part === '.' || part === '');
}

function nestedResource(pathname) {
  const patterns = [
    ['finding', /^\/api\/projects\/[^/]+\/findings\/([^/]+)\/suppress$/],
    ['diagram', /^\/api\/projects\/[^/]+\/diagrams\/([^/]+)$/],
    ['task', /^\/api\/projects\/[^/]+\/tasks\/([^/]+)$/],
    ['note', /^\/api\/projects\/[^/]+\/notes\/([^/]+)$/],
    ['conversation', /^\/api\/projects\/[^/]+\/conversations\/([^/]+)$/],
    ['apiRequest', /^\/api\/projects\/[^/]+\/api-requests\/([^/]+)$/],
    ['operation', /^\/api\/projects\/[^/]+\/operations\/([^/]+)$/],
    ['patch', /^\/api\/projects\/[^/]+\/patches\/([^/]+)\/(?:apply|rollback)$/]
  ];
  for (const [type, pattern] of patterns) {
    const match = pathname.match(pattern);
    if (match) return { type, id: match[1] };
  }
  return null;
}

async function latestOrError(store, projectId, response) {
  const project = await ensureProject(store, projectId);
  if (!project) {
    noProject(response);
    return null;
  }
  const revision = await store.latestRevision(projectId);
  if (!revision) {
    error(response, 409, 'REVISION_REQUIRED', 'Import a revision before using this feature.');
    return null;
  }
  return { project, revision };
}

function serveStatic(request, response, pathname) {
  const candidate = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = path.resolve(PUBLIC, candidate);
  if (!file.startsWith(`${PUBLIC}${path.sep}`) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    return false;
  }
  response.writeHead(200, {
    'Content-Type': CONTENT_TYPES[path.extname(file)] || 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"
  });
  fs.createReadStream(file).pipe(response);
  return true;
}

function createApp(options = {}) {
  const suppliedConfig = options.config || loadConfig(ROOT);
  // Partial embedded/test configurations must opt out explicitly. An omitted
  // flag never creates an accidental authentication bypass.
  const config = Object.freeze({
    ...suppliedConfig,
    authEnabled: suppliedConfig.authEnabled !== false,
    rateLimit: suppliedConfig.rateLimit || { enabled: false, failClosed: false, policies: {} },
    execution: suppliedConfig.execution || { mode: 'local-development', workerUrl: '', workerToken: '', releaseVerified: false, provider: 'disabled' },
    queue: suppliedConfig.queue || { provider: 'disabled', topic: 'codepilot-jobs', region: 'iad1' },
    storage: suppliedConfig.storage || { provider: 'disabled', maxObjectBytes: 250 * 1024 * 1024, uploadTtlMs: 600000, artifactRetentionDays: 7 },
    quotas: suppliedConfig.quotas || { jobsPerHour: 10, concurrentJobs: 2, storageBytesPerUser: 500 * 1024 * 1024 }
  });
  const store = options.store || new Store({ dataDir: config.dataDir, databaseUrl: config.databaseUrl, database: config.database, sessionSecret: config.sessionSecret });
  const queuePublisher = options.queuePublisher || (config.queue.provider === 'vercel-queues' ? new VercelQueuePublisher(config.queue) : null);
  const outboxDispatcher = queuePublisher ? new OutboxDispatcher({ store, publisher: queuePublisher }) : null;
  const objectStorage = options.objectStorage || (config.storage.provider === 'vercel-blob' ? new VercelBlobStorage(config.storage) : null);

  const handleRequest = async (request, response) => {
    const requestId = crypto.randomUUID();
    try {
      const host = request.headers['x-forwarded-host'] || request.headers.host || 'localhost';
      const proto = request.headers['x-forwarded-proto'] || 'http';
      const url = new URL(request.url, `${proto}://${host}`);

      // Resolve effective pathname across Vercel rewrites, proxy headers, and direct calls
      let rawPath = url.pathname;
      if (url.searchParams.has('__path')) {
        rawPath = url.searchParams.get('__path');
      } else if (request.headers['x-matched-path']) {
        const h = request.headers['x-matched-path'];
        if (h && h !== '/api/index.js' && h !== '/api/index') rawPath = h;
      } else if (request.headers['x-forwarded-uri']) {
        const h = request.headers['x-forwarded-uri'];
        if (h && h !== '/api/index.js' && h !== '/api/index') rawPath = h;
      } else if (request.headers['x-original-url']) {
        const h = request.headers['x-original-url'];
        if (h && h !== '/api/index.js' && h !== '/api/index') rawPath = h;
      }

      // Merge extra query parameters if present in rawPath
      if (rawPath.includes('?')) {
        const extraSearch = new URLSearchParams(rawPath.slice(rawPath.indexOf('?') + 1));
        for (const [key, val] of extraSearch.entries()) {
          if (!url.searchParams.has(key)) {
            url.searchParams.set(key, val);
          }
        }
      }

      // Strip query parameters if present in rawPath
      let pathname = rawPath.split('?')[0];

      // Normalize trailing slash (except root '/')
      if (pathname.length > 1 && pathname.endsWith('/')) {
        pathname = pathname.slice(0, -1);
      }

      // If mapped directly to /api/index.js or /api/index, treat as /api/health
      if (pathname === '/api/index.js' || pathname === '/api/index') {
        pathname = '/api/health';
      }

      // Extract bearer token or session cookie
      const authHeader = request.headers['authorization'] || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
      const currentUser = token ? await store.getSessionUser(token) : null;

      if (!(await enforceRateLimit({ store, request, response, config: config.rateLimit, user: currentUser, pathname, json }))) return;

      // --- Health & Readiness Endpoints ---
      if (request.method === 'GET' && (pathname === '/api/health' || pathname === '/api')) {
        return json(response, 200, {
          status: 'ok',
          requestId,
          timestamp: new Date().toISOString(),
          version: '0.2.0',
          capabilities: {
            serverless: config.isVercel,
            database: store.dialect,
            auth: config.authEnabled ? 'enabled' : 'local-open',
            execution: config.execution.mode,
            executionReleaseVerified: Boolean(config.execution.releaseVerified),
            queue: config.queue.provider,
            privateStorage: config.storage.provider,
            aiProvider: config.ai.provider,
            supportedDeployments: config.deployment.allowedProviders,
            maxUploadMb: Math.round(config.limits.maxUploadBytes / (1024 * 1024))
          }
        });
      }

      if (request.method === 'GET' && pathname === '/api/ready') {
        try {
          const database = await store.ping();
          return json(response, 200, {
            status: 'ready',
            dependencies: {
              database,
              rateLimitStore: config.rateLimit.enabled ? { status: 'available', backend: store.dialect } : { status: 'disabled' },
              queue: { status: outboxDispatcher ? 'configured-not-probed' : 'disabled', provider: config.queue.provider },
              privateStorage: { status: objectStorage ? 'configured-not-probed' : 'disabled', provider: config.storage.provider },
              aiProvider: config.ai.provider === 'local'
                ? { status: 'local-deterministic', provider: 'local' }
                : { status: 'configured-not-probed', provider: config.ai.provider },
              worker: config.execution.releaseVerified && config.execution.mode === 'external-worker'
                ? { status: 'configured-not-probed', provider: config.execution.provider }
                : { status: 'disabled', releaseVerified: false }
            },
            requestId
          });
        } catch {
          await store.recordOperationalEvent('readiness.database_unavailable', 'error', null, requestId, 'Database readiness probe failed').catch(() => {});
          return json(response, 503, {
            status: 'not-ready',
            dependencies: {
              database: { status: 'unavailable' },
              rateLimitStore: config.rateLimit.enabled ? { status: 'unavailable', backend: store.dialect } : { status: 'disabled' },
              queue: { status: outboxDispatcher ? 'configured-not-probed' : 'disabled' },
              privateStorage: { status: objectStorage ? 'configured-not-probed' : 'disabled' },
              aiProvider: config.ai.provider === 'local' ? { status: 'local-deterministic' } : { status: 'configured-not-probed' },
              worker: { status: 'disabled', releaseVerified: false }
            },
            requestId
          });
        }
      }

      // --- Authentication Endpoints ---
      if (request.method === 'POST' && pathname === '/api/auth/register') {
        const body = parseJson(await readBody(request, 16 * 1024));
        const { email, password, name } = body;
        if (!email || !password || !name) {
          return error(response, 400, 'MISSING_FIELDS', 'Email, password, and name are required.');
        }
        if (!validateEmail(email)) {
          return error(response, 400, 'INVALID_EMAIL', 'Please provide a valid email address.');
        }
        const pwCheck = validatePasswordStrength(password);
        if (!pwCheck.valid) {
          return error(response, 400, 'WEAK_PASSWORD', pwCheck.reason);
        }
        if (await store.getUserByEmail(email)) {
          return error(response, 409, 'USER_EXISTS', 'A user with this email already exists.');
        }
        const user = await store.createUser(email, name, password);
        const session = await store.createSession(user.id);
        return json(response, 201, { user, token: session.token, requestId });
      }

      if (request.method === 'POST' && pathname === '/api/auth/login') {
        const body = parseJson(await readBody(request, 16 * 1024));
        const { email, password } = body;
        const user = await store.authenticateUser(email, password);
        if (!user) {
          if (config.rateLimit.enabled) {
            const ip = requestIp(request, config.rateLimit);
            const failureIdentity = crypto.createHash('sha256').update(`${String(email || '').toLowerCase()}|${ip}`).digest('hex');
            const failure = await store.consumeRateLimit(`rl:auth-failure:${failureIdentity}`, config.rateLimit.authFailureMax, config.rateLimit.authFailureWindowMs);
            await store.audit('security.authentication_failed', null, 'Login failed for a redacted account identifier.', null);
            if (!failure.allowed) {
              response.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8', 'Retry-After': String(failure.retryAfterSeconds), 'Cache-Control': 'no-store' });
              return response.end(JSON.stringify({ error: { code: 'AUTH_RATE_LIMITED', message: 'Too many failed login attempts. Retry later.' } }));
            }
          }
          return error(response, 401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
        }
        const session = await store.createSession(user.id);
        return json(response, 200, { user, token: session.token, requestId });
      }

      // Central authentication gate. Development bypass is accepted only when
      // explicitly configured outside production by CODEPILOT_AUTH_ENABLED=false.
      const publicRoute = PUBLIC_API_ROUTES.has(`${request.method} ${pathname}`);
      if (pathname.startsWith('/api/') && !publicRoute && config.authEnabled && !currentUser) {
        return error(response, 401, 'UNAUTHORIZED', 'A valid authenticated session is required.');
      }

      // Central project authorization gate covers every present and future
      // /api/projects/:id route before endpoint-specific database access.
      const scopedProjectMatch = pathname.match(/^\/api\/projects\/([^/]+)(?:\/|$)/);
      if (scopedProjectMatch && config.authEnabled) {
        const projectId = scopedProjectMatch[1];
        const access = await store.getProjectAccess(projectId, currentUser);
        if (!access) return error(response, 404, 'PROJECT_NOT_FOUND', 'Project was not found.');
        const permission = requiredProjectPermission(request.method, pathname);
        if (!hasPermission(access.role, permission)) {
          return error(response, 403, 'FORBIDDEN', `Project role ${access.role} does not permit ${permission} access.`);
        }
        const nested = nestedResource(pathname);
        if (nested && !(await store.resourceBelongsToProject(nested.type, nested.id, projectId))) {
          return error(response, 404, 'RESOURCE_NOT_FOUND', 'The requested project resource was not found.');
        }
      }

      if (request.method === 'GET' && pathname === '/api/auth/me') {
        if (!currentUser) return error(response, 401, 'UNAUTHORIZED', 'Not authenticated.');
        return json(response, 200, { user: currentUser, requestId });
      }

      // --- Durable jobs and private artifacts ---
      if (request.method === 'GET' && pathname === '/api/jobs') {
        if (!currentUser) return error(response, 401, 'UNAUTHORIZED', 'A valid user is required for job access.');
        const jobs = await store.listExecutionJobsForUser(currentUser, 50);
        return json(response, 200, { jobs, requestId });
      }

      const jobMatch = pathname.match(/^\/api\/jobs\/([^/]+)$/);
      if (request.method === 'GET' && jobMatch) {
        if (!currentUser) return error(response, 401, 'UNAUTHORIZED', 'A valid user is required for job access.');
        const job = await store.getExecutionJobForUser(jobMatch[1], currentUser);
        if (!job) return error(response, 404, 'JOB_NOT_FOUND', 'Job was not found.');
        return json(response, 200, { job, requestId });
      }

      const cancelJobMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/cancel$/);
      if (request.method === 'POST' && cancelJobMatch) {
        if (!currentUser) return error(response, 401, 'UNAUTHORIZED', 'A valid user is required for job access.');
        const job = await store.cancelWorkflowJob(cancelJobMatch[1], currentUser.id);
        if (!job) return error(response, 409, 'JOB_NOT_CANCELLABLE', 'Job was not found or is already terminal.');
        await store.audit('job.cancellation_requested', job.project_id, `Cancellation requested for job ${job.id}`, currentUser.id);
        return json(response, 202, { job, requestId });
      }

      const retryJobMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/retry$/);
      if (request.method === 'POST' && retryJobMatch) {
        if (!currentUser) return error(response, 401, 'UNAUTHORIZED', 'A valid user is required for job access.');
        const job = await store.retryWorkflowJob(retryJobMatch[1], currentUser.id);
        if (!job) return error(response, 409, 'JOB_NOT_RETRYABLE', 'Job is not eligible for retry.');
        if (outboxDispatcher) await outboxDispatcher.dispatch(1);
        return json(response, 202, { job, requestId });
      }

      const artifactDownloadMatch = pathname.match(/^\/api\/artifacts\/([^/]+)\/download$/);
      if (request.method === 'POST' && artifactDownloadMatch) {
        if (!currentUser) return error(response, 401, 'UNAUTHORIZED', 'A valid user is required for artifact access.');
        if (!objectStorage) return error(response, 503, 'STORAGE_UNAVAILABLE', 'Private object storage is not configured.');
        const artifact = await store.getArtifactForUser(artifactDownloadMatch[1], currentUser);
        if (!artifact) return error(response, 404, 'ARTIFACT_NOT_FOUND', 'Artifact was not found.');
        const download = await objectStorage.authorizeDownload(artifact.object_key);
        await store.audit('artifact.download_authorized', artifact.project_id, `Authorized short-lived download for artifact ${artifact.id}`, currentUser.id);
        return json(response, 200, { artifact: { id: artifact.id, kind: artifact.kind, sizeBytes: artifact.size_bytes, sha256: artifact.sha256 }, ...download, requestId });
      }

      if (request.method === 'GET' && pathname === '/api/operations/metrics') {
        if (!currentUser?.is_global_admin) return error(response, 403, 'FORBIDDEN', 'Global administrator access is required.');
        return json(response, 200, { metrics: await store.operationalMetrics(), requestId });
      }

      const createJobMatch = pathname.match(/^\/api\/projects\/([^/]+)\/jobs$/);
      if (request.method === 'POST' && createJobMatch) {
        if (!currentUser) return error(response, 401, 'UNAUTHORIZED', 'A valid user is required to create jobs.');
        if (!outboxDispatcher) return error(response, 503, 'QUEUE_UNAVAILABLE', 'Durable queue publication is not configured.');
        const body = parseJson(await readBody(request, 16 * 1024));
        const allowedTypes = new Set(['repository-ingestion', 'source-analysis', 'architecture-graph', 'impact-analysis', 'test-execution', 'report-generation', 'docker-analysis']);
        if (!allowedTypes.has(body.jobType)) return error(response, 422, 'INVALID_JOB_TYPE', 'Unsupported job type.');
        if (body.jobType === 'test-execution' && (!config.execution.releaseVerified || config.execution.mode === 'disabled')) {
          return error(response, 503, 'EXECUTION_RELEASE_BLOCKED', 'Repository execution remains disabled until real-provider adversarial verification passes.');
        }
        const idempotencyKey = String(request.headers['idempotency-key'] || body.idempotencyKey || '');
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const recent = await store.get('SELECT COUNT(*) AS count FROM execution_jobs WHERE actor_id=? AND created_at>=?', currentUser.id, oneHourAgo);
        const active = await store.get("SELECT COUNT(*) AS count FROM execution_jobs WHERE actor_id=? AND status IN ('QUEUED','DISPATCHED','RUNNING','CANCEL_REQUESTED')", currentUser.id);
        if (Number(recent.count) >= config.quotas.jobsPerHour || Number(active.count) >= config.quotas.concurrentJobs) {
          return error(response, 429, 'JOB_QUOTA_EXCEEDED', 'Per-user job quota is exhausted.');
        }
        const revision = await store.latestRevision(createJobMatch[1]);
        const executionProfile = body.jobType === 'test-execution' ? body.executionProfile : null;
        if (body.jobType === 'test-execution' && !['node-test', 'node-test-no-scripts', 'python-pytest'].includes(executionProfile)) {
          return error(response, 422, 'INVALID_EXECUTION_PROFILE', 'Select a predefined execution profile.');
        }
        const created = await store.createWorkflowJob({
          projectId: createJobMatch[1], actorId: currentUser.id, revisionId: revision?.id || null,
          jobType: body.jobType, executionProfile, payload: { revisionId: revision?.id || null },
          idempotencyKey, topic: config.queue.topic
        });
        const publication = await outboxDispatcher.dispatch(1);
        const job = await store.getExecutionJobForUser(created.job.id, currentUser);
        return json(response, created.created ? 202 : 200, { job, publication, duplicate: !created.created, requestId });
      }

      const uploadAuthorizeMatch = pathname.match(/^\/api\/projects\/([^/]+)\/uploads\/authorize$/);
      if (request.method === 'POST' && uploadAuthorizeMatch) {
        if (!currentUser) return error(response, 401, 'UNAUTHORIZED', 'A valid user is required to upload.');
        if (!objectStorage) return error(response, 503, 'STORAGE_UNAVAILABLE', 'Private object storage is not configured.');
        const body = parseJson(await readBody(request, 8 * 1024));
        const sizeBytes = Number(body.sizeBytes);
        const sha256 = String(body.sha256 || '').toLowerCase();
        const contentType = String(body.contentType || '');
        if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > config.storage.maxObjectBytes || !/^[a-f0-9]{64}$/.test(sha256) || !['application/zip', 'application/x-zip-compressed'].includes(contentType)) {
          return error(response, 422, 'INVALID_UPLOAD', 'ZIP size, content type, and SHA-256 are required.');
        }
        const usage = await store.get("SELECT COALESCE(SUM(expected_size), 0) AS bytes FROM upload_intents WHERE owner_id=? AND status IN ('AUTHORIZED','VERIFIED')", currentUser.id);
        if (Number(usage.bytes) + sizeBytes > config.quotas.storageBytesPerUser) {
          return error(response, 429, 'STORAGE_QUOTA_EXCEEDED', 'Per-user private storage quota is exhausted.');
        }
        const objectKey = `codepilot/${currentUser.id}/${crypto.randomUUID()}.zip`;
        const intent = await store.createUploadIntent({ projectId: uploadAuthorizeMatch[1], ownerId: currentUser.id, objectKey, expectedSize: sizeBytes, expectedSha256: sha256, contentType, ttlMs: config.storage.uploadTtlMs });
        const authorization = await objectStorage.authorizeUpload({ objectKey, contentType, sizeBytes, ttlMs: config.storage.uploadTtlMs });
        await store.audit('upload.authorized', uploadAuthorizeMatch[1], `Authorized private direct upload ${intent.id}`, currentUser.id);
        return json(response, 201, { intent: { id: intent.id, objectKey, expiresAt: intent.expires_at }, authorization, requestId });
      }

      const uploadCompleteMatch = pathname.match(/^\/api\/projects\/([^/]+)\/uploads\/([^/]+)\/complete$/);
      if (request.method === 'POST' && uploadCompleteMatch) {
        if (!currentUser) return error(response, 401, 'UNAUTHORIZED', 'A valid user is required to complete an upload.');
        if (!objectStorage) return error(response, 503, 'STORAGE_UNAVAILABLE', 'Private object storage is not configured.');
        const intent = await store.getUploadIntentForUser(uploadCompleteMatch[2], currentUser);
        if (!intent || intent.project_id !== uploadCompleteMatch[1]) return error(response, 404, 'UPLOAD_NOT_FOUND', 'Upload intent was not found.');
        const actual = await objectStorage.verifyObject(intent.object_key, Number(intent.expected_size));
        const verified = await store.completeUploadIntent(intent.id, currentUser.id, actual);
        if (!verified || verified.status !== 'VERIFIED') return error(response, 422, 'UPLOAD_VERIFICATION_FAILED', 'Stored object size or SHA-256 did not match the authorization.');
        await store.recordResourceUsage(currentUser.id, intent.project_id, null, 'upload_bytes', Number(verified.actual_size), 'bytes');
        let job = null;
        if (outboxDispatcher) {
          const created = await store.createWorkflowJob({ projectId: intent.project_id, actorId: currentUser.id, jobType: 'repository-ingestion', payload: { uploadIntentId: intent.id, objectKey: intent.object_key, sha256: verified.actual_sha256 }, idempotencyKey: `ingest:${intent.id}`, topic: config.queue.topic });
          await outboxDispatcher.dispatch(1);
          job = created.job;
        }
        return json(response, 202, { upload: verified, job, requestId });
      }

      // --- Workspaces Endpoints ---
      if (request.method === 'GET' && pathname === '/api/workspaces') {
        const userId = currentUser ? currentUser.id : 'anonymous';
        const workspaces = await store.getUserWorkspaces(userId);
        return json(response, 200, { workspaces, requestId });
      }

      if (request.method === 'POST' && pathname === '/api/workspaces') {
        const body = parseJson(await readBody(request, 16 * 1024));
        const name = (body.name || '').trim();
        if (!name) return error(response, 422, 'INVALID_NAME', 'Workspace name is required.');
        const firstUser = await store.get('SELECT id FROM users LIMIT 1');
        const userId = currentUser ? currentUser.id : (firstUser ? firstUser.id : 'admin');
        const ws = await store.createWorkspace(name, userId);
        return json(response, 201, { workspace: ws, requestId });
      }

      // --- Projects Endpoints ---
      if (request.method === 'GET' && pathname === '/api/projects') {
        const workspaceId = url.searchParams.get('workspaceId');
        const projects = await store.listProjects(workspaceId, config.authEnabled ? currentUser.id : null);
        return json(response, 200, { projects, requestId });
      }

      if (request.method === 'POST' && pathname === '/api/projects') {
        const body = parseJson(await readBody(request, 16 * 1024));
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        const description = typeof body.description === 'string' ? body.description.trim() : '';
        const workspaceId = body.workspaceId || null;
        if (!name || name.length > 100) {
          return error(response, 422, 'INVALID_PROJECT_NAME', 'Project name must contain 1–100 characters.');
        }
        if (workspaceId && config.authEnabled) {
          const role = await store.getWorkspaceRole(workspaceId, currentUser.id);
          if (!hasPermission(role, 'write')) return error(response, 403, 'FORBIDDEN', 'Workspace role does not permit project creation.');
        }
        const project = await store.createProject(name, description, workspaceId, currentUser?.id || null);
        return json(response, 201, { project, requestId });
      }

      const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
      if (request.method === 'GET' && projectMatch) {
        const summary = await store.projectSummary(projectMatch[1]);
        return summary ? json(response, 200, { ...summary, requestId }) : noProject(response);
      }

      if (request.method === 'DELETE' && projectMatch) {
        const deleted = await store.deleteProject(projectMatch[1], currentUser?.id);
        return deleted ? json(response, 200, { success: true, requestId }) : noProject(response);
      }

      if (request.method === 'PATCH' && projectMatch) {
        const body = parseJson(await readBody(request, 16 * 1024));
        const updated = await store.updateProject(projectMatch[1], body, currentUser?.id || null);
        return updated ? json(response, 200, { project: updated, requestId }) : error(response, 422, 'INVALID_PROJECT', 'Project update is invalid.');
      }

      // --- ZIP Import Endpoint ---
      const importMatch = pathname.match(/^\/api\/projects\/([^/]+)\/import$/);
      if (request.method === 'POST' && importMatch) {
        const projectId = importMatch[1];
        if (!(await ensureProject(store, projectId))) return noProject(response);
        if (request.headers['content-type'] !== 'application/zip') {
          return error(response, 415, 'ZIP_REQUIRED', 'Use Content-Type: application/zip.');
        }

        const job = await store.createJob(projectId, 'import', 'Validating archive and analyzing codebase');
        try {
          const archive = await readBody(request, config.limits.maxUploadBytes);
          const hash = contentHash(archive);
          const entries = readZip(archive, config.limits);
          const records = analyze(entries);
          const saved = await store.saveRevision(projectId, hash, records, `Imported ${records.files.length} files`);

          await store.finishJob(
            job.id,
            saved.revision.id,
            'completed',
            saved.duplicate ? 'Duplicate revision reused.' : `Imported ${records.files.length} files.`
          );

          return json(response, saved.duplicate ? 200 : 201, {
            revision: saved.revision,
            duplicate: saved.duplicate,
            job: { id: job.id, status: 'completed' },
            summary: {
              files: records.files.length,
              symbols: records.symbols.length,
              edges: records.edges.length,
              findings: records.findings.length,
              frameworks: records.metadata.frameworks
            },
            requestId
          });
        } catch (importError) {
          await store.finishJob(job.id, null, 'failed', importError.message);
          await store.recordOperationalEvent('import.failed', 'error', projectId, requestId, importError.message);
          throw importError;
        }
      }

      // --- URL / Remote Import Endpoint (SSRF Protected) ---
      const importUrlMatch = pathname.match(/^\/api\/projects\/([^/]+)\/import-url$/);
      if (request.method === 'POST' && importUrlMatch) {
        const projectId = importUrlMatch[1];
        if (!(await ensureProject(store, projectId))) return noProject(response);

        const body = parseJson(await readBody(request, 16 * 1024));
        const rawUrl = (body.url || body.repo || '').trim();
        if (!rawUrl) return error(response, 422, 'URL_REQUIRED', 'A remote archive URL or GitHub repository link is required.');

        const job = await store.createJob(projectId, 'import-url', `Fetching repository from ${rawUrl}`);
        try {
          const remoteDownloadLimit = config.limits.maxRemoteDownloadBytes || 100 * 1024 * 1024;
          const remoteLimits = {
            ...config.limits,
            maxUploadBytes: remoteDownloadLimit
          };
          const archive = await fetchGithubOrRemoteZip(rawUrl, remoteDownloadLimit, config.isVercel ? 28000 : 45000);
          const hash = contentHash(archive);
          const entries = readZip(archive, remoteLimits);
          const records = analyze(entries);
          const saved = await store.saveRevision(projectId, hash, records, `Remote import from ${rawUrl}`);

          await store.finishJob(job.id, saved.revision.id, 'completed', `Imported ${records.files.length} files.`);
          return json(response, 201, {
            revision: saved.revision,
            duplicate: saved.duplicate,
            job: { id: job.id, status: 'completed' },
            summary: {
              files: records.files.length,
              symbols: records.symbols.length,
              edges: records.edges.length,
              findings: records.findings.length
            },
            requestId
          });
        } catch (err) {
          await store.finishJob(job.id, null, 'failed', err.message);
          if (err instanceof SSRFError) {
            return error(response, 400, 'SSRF_BLOCKED', err.message);
          }
          throw err;
        }
      }

      // --- Files & Source Code Endpoints ---
      const filesMatch = pathname.match(/^\/api\/projects\/([^/]+)\/files$/);
      if (request.method === 'GET' && filesMatch) {
        const context = await latestOrError(store, filesMatch[1], response);
        if (!context) return;
        const query = (url.searchParams.get('q') || '').toLowerCase().slice(0, 100);
        const allFiles = await store.all(
          'SELECT path, language, bytes, excluded_reason AS "excludedReason" FROM files WHERE revision_id=? ORDER BY path',
          context.revision.id
        );
        const files = allFiles.filter((f) => !query || f.path.toLowerCase().includes(query));
        return json(response, 200, {
          revisionId: context.revision.id,
          files: files.slice(0, config.limits.maxSearchResults),
          truncated: files.length > config.limits.maxSearchResults,
          requestId
        });
      }

      const fileMatch = pathname.match(/^\/api\/projects\/([^/]+)\/file$/);
      if (request.method === 'GET' && fileMatch) {
        const context = await latestOrError(store, fileMatch[1], response);
        if (!context) return;
        const requestedPath = url.searchParams.get('path');
        if (!requestedPath || requestedPath.length > 500) {
          return error(response, 422, 'INVALID_PATH', 'A valid file path is required.');
        }
        const file = await store.get(
          'SELECT path, language, bytes, content, excluded_reason AS "excludedReason" FROM files WHERE revision_id=? AND path=?',
          context.revision.id,
          requestedPath
        );
        if (!file) return error(response, 404, 'FILE_NOT_FOUND', 'File was not found in this revision.');
        if (file.path.startsWith('.env') || file.excludedReason === 'generated-or-vendored-directory') {
          return error(response, 403, 'FILE_RESTRICTED', 'This file is withheld from the explorer to reduce noise or accidental exposure.');
        }
        return json(response, 200, { file, requestId });
      }

      // --- Architecture Graph & Reports ---
      const graphMatch = pathname.match(/^\/api\/projects\/([^/]+)\/graph$/);
      if (request.method === 'GET' && graphMatch) {
        const context = await latestOrError(store, graphMatch[1], response);
        if (!context) return;
        const nodes = await store.all(
          'SELECT path AS id, path AS label, language FROM files WHERE revision_id=? AND excluded_reason IS NULL ORDER BY path LIMIT 200',
          context.revision.id
        );
        const edges = await store.all(
          'SELECT source_path AS source, target_path AS target, type, confidence, line, provenance FROM edges WHERE revision_id=? LIMIT 600',
          context.revision.id
        );
        return json(response, 200, { revisionId: context.revision.id, nodes, edges, requestId });
      }

      const reportMatch = pathname.match(/^\/api\/projects\/([^/]+)\/architecture-report$/);
      if (request.method === 'GET' && reportMatch) {
        const context = await latestOrError(store, reportMatch[1], response);
        if (!context) return;
        const report = await generateArchitectureReport(store, context.revision.id, context.project);
        return json(response, 200, { revisionId: context.revision.id, report, requestId });
      }

      const reportMdMatch = pathname.match(/^\/api\/projects\/([^/]+)\/architecture-report\.md$/);
      if (request.method === 'GET' && reportMdMatch) {
        const context = await latestOrError(store, reportMdMatch[1], response);
        if (!context) return;
        const report = await generateArchitectureReport(store, context.revision.id, context.project);
        const md = exportReportToMarkdown(report, context.project.name);
        response.writeHead(200, {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Content-Disposition': `attachment; filename="${context.project.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-architecture.md"`
        });
        return response.end(md);
      }

      // --- Findings & Diagnostics ---
      const findingsMatch = pathname.match(/^\/api\/projects\/([^/]+)\/findings$/);
      if (request.method === 'GET' && findingsMatch) {
        const context = await latestOrError(store, findingsMatch[1], response);
        if (!context) return;
        const findings = await store.all(
          `SELECT id, severity, category, message, file_path AS "filePath", line, evidence, status, suppression_reason 
           FROM findings 
           WHERE revision_id=? 
           ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END, file_path`,
          context.revision.id
        );
        return json(response, 200, { revisionId: context.revision.id, findings, requestId });
      }

      const suppressMatch = pathname.match(/^\/api\/projects\/([^/]+)\/findings\/([^/]+)\/suppress$/);
      if (request.method === 'POST' && suppressMatch) {
        const findingId = suppressMatch[2];
        const body = parseJson(await readBody(request, 8 * 1024));
        const reason = (body.reason || '').trim();
        if (!reason) return error(response, 422, 'REASON_REQUIRED', 'A valid justification reason is required to suppress a finding.');
        const updated = await store.suppressFinding(findingId, reason, currentUser?.id);
        if (!updated) return error(response, 404, 'FINDING_NOT_FOUND', 'Finding not found.');
        return json(response, 200, { finding: updated, requestId });
      }

      // --- AI Assistant Endpoint ---
      const askMatch = pathname.match(/^\/api\/projects\/([^/]+)\/ask$/);
      if (request.method === 'POST' && askMatch) {
        const context = await latestOrError(store, askMatch[1], response);
        if (!context) return;
        const body = parseJson(await readBody(request, 8 * 1024));
        const question = typeof body.question === 'string' ? body.question.trim() : '';
        if (!question || question.length > config.limits.maxQuestionChars) {
          return error(response, 422, 'INVALID_QUESTION', `Question must contain 1–${config.limits.maxQuestionChars} characters.`);
        }
        const result = await answerQuestionWithContext(store, context.project, context.revision, question, config.ai);
        await store.audit('assistant.question', context.project.id, `Question answered for revision ${context.revision.id}`, currentUser?.id);
        return json(response, 200, { revisionId: context.revision.id, ...result, requestId });
      }

      // --- CodePilot Flow Visual Intelligence Endpoints ---
      const flowMatch = pathname.match(/^\/api\/projects\/([^/]+)\/flow$/);
      if (request.method === 'GET' && flowMatch) {
        const context = await latestOrError(store, flowMatch[1], response);
        if (!context) return;
        const diagramType = url.searchParams.get('type') || 'architecture';
        const symbol = url.searchParams.get('symbol') || null;
        const file = url.searchParams.get('file') || null;
        const route = url.searchParams.get('route') || null;

        const diagram = await generateFlowDiagram(store, context.project.id, context.revision.id, {
          type: diagramType,
          symbol,
          file,
          route
        });
        return json(response, 200, { diagram, requestId });
      }

      const flowExplainMatch = pathname.match(/^\/api\/projects\/([^/]+)\/flow\/explain$/);
      if (request.method === 'POST' && flowExplainMatch) {
        const context = await latestOrError(store, flowExplainMatch[1], response);
        if (!context) return;
        const body = parseJson(await readBody(request, 64 * 1024));
        const explanation = await explainDiagram(body.diagram || {}, body.query || '', config.ai);
        return json(response, 200, { explanation, requestId });
      }

      const diagramsMatch = pathname.match(/^\/api\/projects\/([^/]+)\/diagrams$/);
      if (request.method === 'GET' && diagramsMatch) {
        const diagrams = await store.listDiagrams(diagramsMatch[1]);
        return json(response, 200, { diagrams, requestId });
      }

      if (request.method === 'POST' && diagramsMatch) {
        const context = await latestOrError(store, diagramsMatch[1], response);
        if (!context) return;
        const body = parseJson(await readBody(request, 128 * 1024));
        const { title, diagramType, graphData } = body;
        if (!title || !diagramType || !graphData) {
          return error(response, 422, 'FIELDS_REQUIRED', 'title, diagramType, and graphData are required.');
        }
        const saved = await store.saveDiagram(context.project.id, context.revision.id, title, diagramType, graphData);
        return json(response, 201, { diagram: saved, requestId });
      }

      const diagramItemMatch = pathname.match(/^\/api\/projects\/([^/]+)\/diagrams\/([^/]+)$/);
      if (request.method === 'GET' && diagramItemMatch) {
        const diagram = await store.getDiagram(diagramItemMatch[2]);
        if (!diagram) return error(response, 404, 'NOT_FOUND', 'Diagram not found.');
        return json(response, 200, { diagram, requestId });
      }

      if (request.method === 'DELETE' && diagramItemMatch) {
        const deleted = await store.deleteDiagram(diagramItemMatch[2]);
        if (!deleted) return error(response, 404, 'NOT_FOUND', 'Diagram not found.');
        return json(response, 200, { success: true, requestId });
      }

      // --- Multi-Turn AI Conversations & Code Actions ---
      const aiChatMatch = pathname.match(/^\/api\/projects\/([^/]+)\/ai\/chat$/);
      if (request.method === 'POST' && aiChatMatch) {
        const projectId = aiChatMatch[1];
        const project = await ensureProject(store, projectId);
        if (!project) return noProject(response);
        const revision = await store.latestRevision(projectId);
        const body = parseJson(await readBody(request, 64 * 1024));
        const messages = body.messages || [];
        let convoId = body.conversationId;

        if (convoId && !(await store.resourceBelongsToProject('conversation', convoId, projectId))) {
          return error(response, 404, 'RESOURCE_NOT_FOUND', 'Conversation was not found in this project.');
        }

        if (!convoId) {
          const firstUserMsg = messages.find((m) => m.role === 'user');
          const title = firstUserMsg ? firstUserMsg.content.slice(0, 30) : 'New Conversation';
          const newConvo = await store.createConversation(projectId, title);
          convoId = newConvo.id;
        }

        const latestMsg = messages[messages.length - 1];
        if (latestMsg && latestMsg.role === 'user') {
          await store.addMessage(convoId, projectId, revision?.id, 'user', latestMsg.content);
        }

        const result = await chatWithContext(store, project, revision, messages, config.ai);
        await store.addMessage(convoId, projectId, revision?.id, 'assistant', result.reply, result.citations);

        return json(response, 200, {
          conversationId: convoId,
          reply: result.reply,
          citations: result.citations,
          requestId
        });
      }

      const convosMatch = pathname.match(/^\/api\/projects\/([^/]+)\/conversations$/);
      if (request.method === 'GET' && convosMatch) {
        const conversations = await store.listConversations(convosMatch[1]);
        return json(response, 200, { conversations, requestId });
      }

      if (request.method === 'POST' && convosMatch) {
        const body = parseJson(await readBody(request, 8 * 1024));
        const title = (body.title || 'New Conversation').trim();
        const convo = await store.createConversation(convosMatch[1], title);
        return json(response, 201, { conversation: convo, requestId });
      }

      const convoItemMatch = pathname.match(/^\/api\/projects\/([^/]+)\/conversations\/([^/]+)$/);
      if (request.method === 'GET' && convoItemMatch) {
        const conversation = await store.getConversation(convoItemMatch[2]);
        if (!conversation) return error(response, 404, 'NOT_FOUND', 'Conversation not found.');
        const messages = await store.listMessages(convoItemMatch[2]);
        return json(response, 200, { conversation, messages, requestId });
      }

      if (request.method === 'DELETE' && convoItemMatch) {
        const deleted = await store.deleteConversation(convoItemMatch[2]);
        return json(response, 200, { success: Boolean(deleted), requestId });
      }

      // Code AI actions (explain, generate tests, refactor)
      const aiExplainMatch = pathname.match(/^\/api\/projects\/([^/]+)\/ai\/explain$/);
      if (request.method === 'POST' && aiExplainMatch) {
        const body = parseJson(await readBody(request, 32 * 1024));
        const explanation = await explainCode(body.code || '', body.filePath || 'code', config.ai);
        return json(response, 200, { explanation, requestId });
      }

      const aiTestMatch = pathname.match(/^\/api\/projects\/([^/]+)\/ai\/generate-tests$/);
      if (request.method === 'POST' && aiTestMatch) {
        const body = parseJson(await readBody(request, 32 * 1024));
        const testCode = await generateTestsForCode(body.code || '', body.filePath || 'code', config.ai);
        return json(response, 200, { testCode, requestId });
      }

      const aiRefactorMatch = pathname.match(/^\/api\/projects\/([^/]+)\/ai\/refactor$/);
      if (request.method === 'POST' && aiRefactorMatch) {
        const body = parseJson(await readBody(request, 32 * 1024));
        const originalCode = body.code || '';
        const goal = body.goal || body.instruction || 'Improve code readability and safety';
        const refactoredCode = await refactorCode(originalCode, goal, config.ai);
        const { createUnifiedDiff } = require('./planner');
        const diff = createUnifiedDiff(body.filePath || 'code', originalCode, refactoredCode);
        return json(response, 200, { refactoredCode, diff, requestId });
      }

      // --- Productivity: Tasks & Kanban Endpoints ---
      const projectTasksMatch = pathname.match(/^\/api\/projects\/([^/]+)\/tasks$/);
      if (request.method === 'GET' && projectTasksMatch) {
        const status = url.searchParams.get('status') || null;
        const tasks = await store.listTasks(projectTasksMatch[1], status);
        return json(response, 200, { tasks, requestId });
      }

      if (request.method === 'POST' && projectTasksMatch) {
        const body = parseJson(await readBody(request, 16 * 1024));
        const { title, description, priority, targetFile, dueDate } = body;
        if (!title) return error(response, 422, 'TITLE_REQUIRED', 'Task title is required.');
        const task = await store.createTask(projectTasksMatch[1], title, description, priority, targetFile, dueDate);
        return json(response, 201, { task, requestId });
      }

      const taskItemMatch = pathname.match(/^\/api\/projects\/([^/]+)\/tasks\/([^/]+)$/);
      if (request.method === 'GET' && taskItemMatch) {
        let task = await store.getTask(taskItemMatch[2]);
        if (!task) {
          task = await store.get('SELECT * FROM plan_tasks WHERE id = ?', taskItemMatch[2]);
        }
        if (!task) return error(response, 404, 'NOT_FOUND', 'Task not found.');
        return json(response, 200, { task, requestId });
      }

      if (request.method === 'PATCH' && taskItemMatch) {
        const body = parseJson(await readBody(request, 16 * 1024));
        const kanbanTask = await store.getTask(taskItemMatch[2]);
        if (kanbanTask) {
          const updated = await store.updateTask(taskItemMatch[2], body);
          return json(response, 200, { task: updated, requestId });
        }
        const planTask = await store.get('SELECT * FROM plan_tasks WHERE id = ?', taskItemMatch[2]);
        if (planTask) {
          const status = body?.status;
          if (!['pending', 'in_progress', 'completed', 'blocked'].includes(status)) {
            return error(response, 422, 'INVALID_STATUS', 'Status must be pending, in_progress, completed, or blocked.');
          }
          const updated = await store.updateTaskStatus(taskItemMatch[2], status);
          return json(response, 200, { task: updated, requestId });
        }
        return error(response, 404, 'NOT_FOUND', 'Task not found.');
      }

      if (request.method === 'DELETE' && taskItemMatch) {
        const deleted = await store.deleteTask(taskItemMatch[2]);
        return json(response, 200, { success: Boolean(deleted), requestId });
      }

      const taskGenMatch = pathname.match(/^\/api\/projects\/([^/]+)\/tasks\/generate$/);
      if (request.method === 'POST' && taskGenMatch) {
        const projectId = taskGenMatch[1];
        const body = parseJson(await readBody(request, 16 * 1024));
        const reqText = (body.requirement || 'Enhance test coverage and resolve security findings').trim();
        const findings = await store.all(
          'SELECT f.message, f.file_path FROM findings f JOIN revisions r ON f.revision_id = r.id WHERE r.project_id = ? LIMIT 5',
          projectId
        );
        
        const tasksCreated = [];
        tasksCreated.push(await store.createTask(projectId, `Review requirement: ${reqText.slice(0, 40)}`, reqText, 'high'));
        for (const f of findings) {
          tasksCreated.push(await store.createTask(projectId, `Fix: ${f.message.slice(0, 50)}`, `Investigate in ${f.file_path}`, 'medium', f.file_path));
        }
        return json(response, 201, { tasks: tasksCreated, requestId });
      }

      // --- Notes & Knowledge Base Endpoints ---
      const notesMatch = pathname.match(/^\/api\/projects\/([^/]+)\/notes$/);
      if (request.method === 'GET' && notesMatch) {
        const category = url.searchParams.get('category') || null;
        const notes = await store.listNotes(notesMatch[1], category);
        return json(response, 200, { notes, requestId });
      }

      if (request.method === 'POST' && notesMatch) {
        const body = parseJson(await readBody(request, 32 * 1024));
        const { title, content, category, tags } = body;
        if (!title || !content) return error(response, 422, 'FIELDS_REQUIRED', 'title and content are required.');
        const note = await store.createNote(notesMatch[1], title, content, category, tags);
        return json(response, 201, { note, requestId });
      }

      const noteItemMatch = pathname.match(/^\/api\/projects\/([^/]+)\/notes\/([^/]+)$/);
      if (request.method === 'GET' && noteItemMatch) {
        const note = await store.getNote(noteItemMatch[2]);
        if (!note) return error(response, 404, 'NOT_FOUND', 'Note not found.');
        return json(response, 200, { note, requestId });
      }

      if (request.method === 'PATCH' && noteItemMatch) {
        const body = parseJson(await readBody(request, 32 * 1024));
        const updated = await store.updateNote(noteItemMatch[2], body);
        if (!updated) return error(response, 404, 'NOT_FOUND', 'Note not found.');
        return json(response, 200, { note: updated, requestId });
      }

      if (request.method === 'DELETE' && noteItemMatch) {
        const deleted = await store.deleteNote(noteItemMatch[2]);
        return json(response, 200, { success: Boolean(deleted), requestId });
      }

      // --- API Studio Endpoints ---
      const apiReqMatch = pathname.match(/^\/api\/projects\/([^/]+)\/api-requests$/);
      if (request.method === 'GET' && apiReqMatch) {
        const requests = await store.listApiRequests(apiReqMatch[1]);
        return json(response, 200, { requests, requestId });
      }

      if (request.method === 'POST' && apiReqMatch) {
        const body = parseJson(await readBody(request, 16 * 1024));
        const { name, method, url: targetUrl, headers, body: reqBody, collectionName } = body;
        if (!name || !targetUrl) return error(response, 422, 'FIELDS_REQUIRED', 'name and url are required.');
        const saved = await store.saveApiRequest(apiReqMatch[1], name, method || 'GET', targetUrl, headers, reqBody, collectionName);
        return json(response, 201, { request: saved, requestId });
      }

      const apiReqItemMatch = pathname.match(/^\/api\/projects\/([^/]+)\/api-requests\/([^/]+)$/);
      if (request.method === 'DELETE' && apiReqItemMatch) {
        const deleted = await store.deleteApiRequest(apiReqItemMatch[2]);
        return json(response, 200, { success: Boolean(deleted), requestId });
      }

      const apiExecMatch = pathname.match(/^\/api\/projects\/([^/]+)\/api-requests\/execute$/);
      if (request.method === 'POST' && apiExecMatch) {
        const body = parseJson(await readBody(request, 32 * 1024));
        const targetUrl = (body.url || '').trim();
        const method = (body.method || 'GET').toUpperCase();
        if (!targetUrl) return error(response, 422, 'URL_REQUIRED', 'A target URL is required.');

        // Validate URL against SSRF
        try {
          await validateUrlForSSRF(targetUrl);
        } catch (ssrfErr) {
          return error(response, 400, 'SSRF_BLOCKED', ssrfErr.message);
        }

        const parsedUrl = new URL(targetUrl);
        const client = parsedUrl.protocol === 'https:' ? https : http;
        const startTime = Date.now();

        try {
          const execRes = await new Promise((resolve, reject) => {
            const req = client.request(
              parsedUrl,
              {
                method,
                headers: body.headers || {},
                timeout: 10000
              },
              (res) => {
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => {
                  resolve({
                    status: res.statusCode,
                    statusText: res.statusMessage,
                    headers: res.headers,
                    body: Buffer.concat(chunks).toString('utf8'),
                    durationMs: Date.now() - startTime
                  });
                });
                res.on('error', reject);
              }
            );
            req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out (10s limit).')); });
            req.on('error', reject);
            if (body.body) req.write(typeof body.body === 'string' ? body.body : JSON.stringify(body.body));
            req.end();
          });

          return json(response, 200, { result: execRes, requestId });
        } catch (execErr) {
          return json(response, 200, {
            result: {
              status: 0,
              statusText: 'Network Error',
              headers: {},
              body: execErr.message,
              durationMs: Date.now() - startTime
            },
            requestId
          });
        }
      }

      // --- Database Studio Endpoints ---
      const dbSchemaMatch = pathname.match(/^\/api\/projects\/([^/]+)\/db-schema$/);
      if (request.method === 'GET' && dbSchemaMatch) {
        if (config.authEnabled && !currentUser.is_global_admin) {
          return error(response, 403, 'FORBIDDEN', 'Platform database inspection requires a global administrator.');
        }
        let tables = [];
        if (store.dialect === 'postgres') {
          const res = await store.all(
            "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name"
          );
          tables = res.map((r) => ({ name: r.table_name }));
        } else {
          const res = await store.all(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
          );
          tables = res.map((r) => ({ name: r.name }));
        }
        return json(response, 200, { dialect: store.dialect, tables, requestId });
      }

      const dbQueryMatch = pathname.match(/^\/api\/projects\/([^/]+)\/db-query$/);
      if (request.method === 'POST' && dbQueryMatch) {
        if (config.authEnabled && !currentUser.is_global_admin) {
          return error(response, 403, 'FORBIDDEN', 'Platform database queries require a global administrator.');
        }
        const body = parseJson(await readBody(request, 8 * 1024));
        const rawSql = (body.query || body.sql || '').trim();
        if (!rawSql) return error(response, 422, 'SQL_REQUIRED', 'SQL query statement is required.');

        // Restrict execution to safe queries (SELECT, EXPLAIN, PRAGMA)
        const isSafe = /^(SELECT|EXPLAIN|PRAGMA|SHOW)\b/i.test(rawSql);
        if (!isSafe) {
          return error(response, 400, 'READ_ONLY_QUERY_REQUIRED', 'Only read/audit queries (SELECT, EXPLAIN, PRAGMA) are permitted via Studio.');
        }

        const startT = Date.now();
        try {
          const rows = await store.all(rawSql);
          const executionTimeMs = Date.now() - startT;
          const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
          return json(response, 200, { rows: rows.slice(0, 100), columns, rowCount: rows.length, executionTimeMs, requestId });
        } catch (dbErr) {
          return error(response, 400, 'QUERY_FAILED', dbErr.message);
        }
      }

      // --- Global Cross-App Search Endpoint ---
      const searchMatch = pathname.match(/^\/api\/projects\/([^/]+)\/search$/);
      if (request.method === 'GET' && searchMatch) {
        const query = url.searchParams.get('q') || '';
        const grouped = await store.globalSearch(searchMatch[1], query);
        // Flatten into a unified results array for the Command Palette
        const results = [
          ...grouped.files.map(f => ({ type: 'file', name: f.path, language: f.language, bytes: f.bytes })),
          ...grouped.symbols.map(s => ({ type: 'symbol', name: s.name, kind: s.kind, file: s.file_path, line: s.line })),
          ...grouped.findings.map(f => ({ type: 'finding', name: f.message, severity: f.severity, file: f.file_path, line: f.line })),
          ...grouped.tasks.map(t => ({ type: 'task', name: t.title, id: t.id, status: t.status, priority: t.priority })),
          ...grouped.notes.map(n => ({ type: 'note', name: n.title, id: n.id, category: n.category })),
          ...grouped.diagrams.map(d => ({ type: 'diagram', name: d.title, id: d.id, diagramType: d.diagram_type }))
        ];
        return json(response, 200, { results, grouped, requestId });
      }

      // --- Operations / Background Jobs Framework ---
      const opsMatch = pathname.match(/^\/api\/projects\/([^/]+)\/operations$/);
      if (request.method === 'GET' && opsMatch) {
        const operations = await store.listOperations(opsMatch[1]);
        return json(response, 200, { operations, requestId });
      }

      if (request.method === 'POST' && opsMatch) {
        const projectId = opsMatch[1];
        const project = await ensureProject(store, projectId);
        if (!project) return noProject(response);
        const revision = await store.latestRevision(projectId);
        const body = parseJson(await readBody(request, 16 * 1024));
        const { type, name, config: opConfig } = body;
        if (!type || !name) return error(response, 422, 'FIELDS_REQUIRED', 'type and name are required.');

        const op = await store.createOperation(projectId, revision?.id, type, name, opConfig || {});

        if (config.isVercel) {
          if (config.execution.mode !== 'external-worker' || !config.execution.workerUrl || !config.execution.workerToken) {
            const failed = await store.updateOperation(op.id, {
              status: 'failed', stage: 'worker-unavailable', progress: 0,
              errorMessage: 'External worker is not configured; serverless background execution was not started.'
            });
            await store.recordOperationalEvent('worker.unavailable', 'error', projectId, requestId, 'External worker is not configured.');
            return json(response, 503, { operation: failed, error: { code: 'WORKER_UNAVAILABLE', message: 'External worker is unavailable.' }, requestId });
          }
          const queuedJob = await store.enqueueExecutionJob(projectId, currentUser?.id || null, type, { operationId: op.id, config: opConfig || {} });
          const pending = await store.updateOperation(op.id, {
            status: 'pending', stage: 'queued', progress: 0,
            summary: 'Persisted for an external worker. No in-function background execution was started.'
          });
          return json(response, 202, { operation: pending, job: queuedJob, requestId });
        }

        // Run operation workflow stages based on type
        (async () => {
          try {
            if (type === 'repository-analysis') {
              await store.addOperationEvent(op.id, 'file-discovery', 'Scanning repository directory tree and discovering files');
              await store.updateOperation(op.id, { stage: 'file-discovery', progress: 20 });
              
              await store.addOperationEvent(op.id, 'ast-parsing', 'Parsing source files for symbols, function invocations, and route definitions');
              await store.updateOperation(op.id, { stage: 'ast-parsing', progress: 50 });

              await store.addOperationEvent(op.id, 'security-audit', 'Executing credential scanning and security heuristics');
              await store.updateOperation(op.id, { stage: 'security-audit', progress: 80 });

              await store.addOperationEvent(op.id, 'graph-index', 'Generating component dependency edges and architecture flow topology');
              await store.updateOperation(op.id, {
                status: 'completed',
                stage: 'completed',
                progress: 100,
                summary: 'Analysis completed successfully. Architecture topology and security findings are ready for review.'
              });
            } else if (type === 'security-scan') {
              await store.addOperationEvent(op.id, 'pattern-matching', 'Analyzing source code for secrets, API keys, and insecure configurations');
              await store.updateOperation(op.id, { stage: 'pattern-matching', progress: 50 });

              await store.addOperationEvent(op.id, 'dependency-audit', 'Inspecting package manifests for unpinned dependencies');
              await store.updateOperation(op.id, {
                status: 'completed',
                stage: 'completed',
                progress: 100,
                summary: 'Security scan finished. Findings catalog updated.'
              });
            } else if (type === 'generate-flow') {
              await store.addOperationEvent(op.id, 'extract-graph', 'Building AST relationships for visual architecture');
              await store.updateOperation(op.id, {
                status: 'completed',
                stage: 'completed',
                progress: 100,
                summary: 'Visual diagram topology generated.'
              });
            } else {
              await store.addOperationEvent(op.id, 'execution', `Executing ${name}`);
              await store.updateOperation(op.id, {
                status: 'completed',
                stage: 'completed',
                progress: 100,
                summary: `Operation ${name} completed.`
              });
            }
          } catch (runErr) {
            await store.recordOperationalEvent('operation.failed', 'error', projectId, requestId, runErr.message);
            await store.addOperationEvent(op.id, 'error', runErr.message, 'error');
            await store.updateOperation(op.id, {
              status: 'failed',
              stage: 'error',
              progress: 0,
              errorMessage: runErr.message
            });
          }
        })();

        return json(response, 201, { operation: op, requestId });
      }

      const opItemMatch = pathname.match(/^\/api\/projects\/([^/]+)\/operations\/([^/]+)$/);
      if (request.method === 'GET' && opItemMatch) {
        const op = await store.getOperation(opItemMatch[2]);
        if (!op) return error(response, 404, 'NOT_FOUND', 'Operation was not found.');
        return json(response, 200, { operation: op, requestId });
      }

      // --- AI Settings Configuration ---
      if (request.method === 'GET' && pathname === '/api/settings/ai') {
        return json(response, 200, {
          provider: config.ai.provider,
          model: config.ai.model,
          hasApiKey: Boolean(config.ai.apiKey),
          availableProviders: ['local', 'openai', 'anthropic', 'gemini'],
          requestId
        });
      }

      // --- Implementation Planner Endpoints ---
      const plansMatch = pathname.match(/^\/api\/projects\/([^/]+)\/plans$/);
      if (request.method === 'GET' && plansMatch) {
        const context = await latestOrError(store, plansMatch[1], response);
        if (!context) return;
        const plans = await store.listPlans(context.project.id);
        return json(response, 200, { plans, requestId });
      }

      if (request.method === 'POST' && plansMatch) {
        const context = await latestOrError(store, plansMatch[1], response);
        if (!context) return;
        const body = parseJson(await readBody(request, 16 * 1024));
        const reqText = (body.requirement || '').trim();
        if (!reqText) return error(response, 422, 'REQUIREMENT_REQUIRED', 'Feature requirement is required.');
        const plan = await generatePlanFromRequirement(store, context.project, context.revision, reqText);
        return json(response, 201, { plan, requestId });
      }


      // --- Patches & Code Modifications ---
      const patchesMatch = pathname.match(/^\/api\/projects\/([^/]+)\/patches$/);
      if (request.method === 'GET' && patchesMatch) {
        const context = await latestOrError(store, patchesMatch[1], response);
        if (!context) return;
        const patches = await store.listPatches(context.project.id);
        return json(response, 200, { patches, requestId });
      }

      if (request.method === 'POST' && patchesMatch) {
        const context = await latestOrError(store, patchesMatch[1], response);
        if (!context) return;
        const body = parseJson(await readBody(request, 64 * 1024));
        const { targetFile, newContent, title, planId } = body;
        if (!targetFile || newContent === undefined) {
          return error(response, 422, 'FIELDS_REQUIRED', 'targetFile and newContent are required.');
        }
        if (!isSafeRepositoryPath(targetFile)) {
          return error(response, 422, 'INVALID_TARGET_PATH', 'targetFile must be a normalized repository-relative path.');
        }
        const currentFile = await store.get('SELECT content FROM files WHERE revision_id=? AND path=?', context.revision.id, targetFile);
        if (!currentFile) return error(response, 404, 'TARGET_FILE_NOT_FOUND', 'The patch target does not exist in the selected revision.');
        const originalContent = currentFile.content || '';
        const diff = createUnifiedDiff(targetFile, originalContent, newContent);
        const patch = await store.createPatch(
          context.project.id,
          context.revision.id,
          planId || null,
          title || `Update ${targetFile}`,
          targetFile,
          diff,
          originalContent,
          newContent
        );
        return json(response, 201, { patch, requestId });
      }

      const patchApplyMatch = pathname.match(/^\/api\/projects\/([^/]+)\/patches\/([^/]+)\/apply$/);
      if (request.method === 'POST' && patchApplyMatch) {
        const patchId = patchApplyMatch[2];
        const applied = await store.applyPatch(patchId, currentUser?.id);
        if (!applied) return error(response, 404, 'PATCH_NOT_FOUND', 'Patch not found or already applied.');
        if (applied.error) return error(response, 409, applied.error, 'Patch application was blocked because the revision or patch state changed.');
        return json(response, 200, { patch: applied, requestId });
      }

      const patchRollbackMatch = pathname.match(/^\/api\/projects\/([^/]+)\/patches\/([^/]+)\/rollback$/);
      if (request.method === 'POST' && patchRollbackMatch) {
        const patchId = patchRollbackMatch[2];
        const rolledBack = await store.rollbackPatch(patchId, currentUser?.id);
        if (!rolledBack) return error(response, 404, 'PATCH_NOT_FOUND', 'Patch not found or not in applied state.');
        if (rolledBack.error) return error(response, 409, rolledBack.error, 'Patch rollback was blocked because the revision or patch state changed.');
        return json(response, 200, { patch: rolledBack, requestId });
      }

      // --- Docker Assistant ---
      const dockerMatch = pathname.match(/^\/api\/projects\/([^/]+)\/docker$/);
      if (request.method === 'GET' && dockerMatch) {
        const context = await latestOrError(store, dockerMatch[1], response);
        if (!context) return;
        const files = await store.all('SELECT path, content FROM files WHERE revision_id=?', context.revision.id);
        const stack = detectStack(files);
        const dockerfile = generateDockerfile(stack);
        const dockerignore = generateDockerignore();
        const dockerCompose = generateDockerCompose(context.project.name, stack);

        return json(response, 200, {
          revisionId: context.revision.id,
          stack,
          dockerfile,
          dockerignore,
          dockerCompose,
          requestId
        });
      }

      // --- Deployment & Live Verification ---
      const readinessMatch = pathname.match(/^\/api\/projects\/([^/]+)\/deployment-readiness$/);
      if (request.method === 'GET' && readinessMatch) {
        const context = await latestOrError(store, readinessMatch[1], response);
        if (!context) return;
        const readiness = await evaluateReadiness(store, context.project.id, context.revision.id);
        return json(response, 200, { revisionId: context.revision.id, ...readiness, requestId });
      }

      const deployMatch = pathname.match(/^\/api\/projects\/([^/]+)\/deploy$/);
      if (request.method === 'POST' && deployMatch) {
        const context = await latestOrError(store, deployMatch[1], response);
        if (!context) return;
        const body = parseJson(await readBody(request, 8 * 1024));
        const provider = body.provider || 'mock';
        const environment = body.environment || 'production';

        const deployment = await store.createDeployment(context.project.id, context.revision.id, provider, environment);
        // Execute synchronously with host header for live verification
        const result = await executeDeployment(store, deployment.id, config, request.headers.host);
        await store.audit('deployment.executed', context.project.id, `Deployment ${deployment.id} to ${provider} resulted in ${result.status}`, currentUser?.id);
        if (result.status !== 'verified') {
          await store.recordOperationalEvent('deployment.verification_failed', 'error', context.project.id, requestId, `deployment=${deployment.id}; provider=${provider}; status=${result.status}`);
        }
        return json(response, 201, { deployment: result, requestId });
      }

      const deploymentsListMatch = pathname.match(/^\/api\/projects\/([^/]+)\/deployments$/);
      if (request.method === 'GET' && deploymentsListMatch) {
        const context = await latestOrError(store, deploymentsListMatch[1], response);
        if (!context) return;
        const deployments = await store.listDeployments(context.project.id);
        return json(response, 200, { deployments, requestId });
      }


      // --- Impact Engine Endpoints ---
      const impactGraphMatch = pathname.match(/^\/api\/projects\/([^/]+)\/impact\/graph$/);
      if (request.method === 'GET' && impactGraphMatch) {
        const context = await latestOrError(store, impactGraphMatch[1], response);
        if (!context) return;

        const files = await store.all(
          'SELECT path, content, bytes, excluded_reason AS "excludedReason" FROM files WHERE revision_id = ?',
          context.revision.id
        );
        const analyzer = new SourceCodeImpactAnalyzer();
        const reconciler = new EvidenceReconciler();
        const graph = analyzer.buildGraph(files, context.revision.id);
        reconciler.reconcileGraph(graph, [], context.revision.id);

        return json(response, 200, {
          graph: graph.toJSON(),
          requestId
        });
      }

      const impactAnalyzeMatch = pathname.match(/^\/api\/projects\/([^/]+)\/impact\/analyze$/);
      if (request.method === 'POST' && impactAnalyzeMatch) {
        const context = await latestOrError(store, impactAnalyzeMatch[1], response);
        if (!context) return;
        const body = parseJson(await readBody(request, 64 * 1024));
        const changedFiles = Array.isArray(body.changedFiles) ? body.changedFiles : [];

        const files = await store.all(
          'SELECT path, content, bytes, excluded_reason AS "excludedReason" FROM files WHERE revision_id = ?',
          context.revision.id
        );
        const analyzer = new SourceCodeImpactAnalyzer();
        const reconciler = new EvidenceReconciler();
        const engine = new ChangeImpactEngine();

        const graph = analyzer.buildGraph(files, context.revision.id);
        reconciler.reconcileGraph(graph, [], context.revision.id);
        const impact = engine.analyzeImpact(graph, changedFiles);

        return json(response, 200, {
          impact,
          metrics: graph.computeMetrics(),
          requestId
        });
      }

      const impactSelectMatch = pathname.match(/^\/api\/projects\/([^/]+)\/impact\/select-tests$/);
      if (request.method === 'POST' && impactSelectMatch) {
        const context = await latestOrError(store, impactSelectMatch[1], response);
        if (!context) return;
        const body = parseJson(await readBody(request, 64 * 1024));
        const changedFiles = Array.isArray(body.changedFiles) ? body.changedFiles : [];
        const strategy = body.strategy || SelectionStrategy.EVIDENCE_AWARE;

        const files = await store.all(
          'SELECT path, content, bytes, excluded_reason AS "excludedReason" FROM files WHERE revision_id = ?',
          context.revision.id
        );
        const analyzer = new SourceCodeImpactAnalyzer();
        const reconciler = new EvidenceReconciler();
        const selector = new RegressionTestSelector();

        const graph = analyzer.buildGraph(files, context.revision.id);
        reconciler.reconcileGraph(graph, [], context.revision.id);
        const selection = selector.selectTests(graph, changedFiles, strategy);

        if (store.saveImpactAnalysis) {
          await store.saveImpactAnalysis(
            context.project.id,
            context.revision.id,
            changedFiles,
            strategy,
            selection.summary,
            selection.selectedTestFiles
          );
        }

        return json(response, 200, {
          selection,
          requestId
        });
      }

      const impactRunMatch = pathname.match(/^\/api\/projects\/([^/]+)\/impact\/run-tests$/);
      if (request.method === 'POST' && impactRunMatch) {
        const context = await latestOrError(store, impactRunMatch[1], response);
        if (!context) return;
        const body = parseJson(await readBody(request, 64 * 1024));
        const changedFiles = Array.isArray(body.changedFiles) ? body.changedFiles : [];
        const strategy = body.strategy || SelectionStrategy.EVIDENCE_AWARE;
        const baseCommand = body.command || 'node --test';

        const files = await store.all(
          'SELECT path, content, bytes, excluded_reason AS "excludedReason" FROM files WHERE revision_id = ?',
          context.revision.id
        );
        const analyzer = new SourceCodeImpactAnalyzer();
        const reconciler = new EvidenceReconciler();
        const selector = new RegressionTestSelector();
        const runner = new IsolatedTestRunner();

        const graph = analyzer.buildGraph(files, context.revision.id);
        reconciler.reconcileGraph(graph, [], context.revision.id);
        const selection = selector.selectTests(graph, changedFiles, strategy);

        if (config.isVercel || config.isProduction || config.execution.mode !== 'local-development') {
          return json(response, 200, {
            selection,
            execution: {
              status: TEST_STATUS.BLOCKED,
              exitCode: null,
              output: 'Execution is disabled in production until a separately isolated external worker is configured and verified.',
              durationMs: null,
              executed: false
            },
            requestId
          });
        }

        const synth = runner.synthesizeCommand(selection.selectedTestFiles, baseCommand);
        const execution = synth.command
          ? await runner.execute(synth, ROOT, config.limits.commandTimeoutMs)
          : { status: TEST_STATUS.NOT_EXECUTED, exitCode: null, output: 'No tests were selected for execution.', durationMs: null, executed: false };

        return json(response, 200, {
          selection,
          execution,
          requestId
        });
      }

      const impactHistoryMatch = pathname.match(/^\/api\/projects\/([^/]+)\/impact\/history$/);
      if (request.method === 'GET' && impactHistoryMatch) {
        const context = await latestOrError(store, impactHistoryMatch[1], response);
        if (!context) return;
        const history = store.listImpactAnalyses ? await store.listImpactAnalyses(context.project.id) : [];
        return json(response, 200, { history, requestId });
      }

      // --- Test Execution Endpoint ---
      const testRunMatch = pathname.match(/^\/api\/projects\/([^/]+)\/tests\/run$/);
      if (request.method === 'POST' && testRunMatch) {
        const context = await latestOrError(store, testRunMatch[1], response);
        if (!context) return;
        const body = parseJson(await readBody(request, 8 * 1024));
        const command = (body.command || 'npm test').trim();

        if (config.isVercel || config.isProduction || config.execution.mode !== 'local-development') {
          return json(response, 200, {
            result: {
              status: TEST_STATUS.BLOCKED,
              exitCode: null,
              output: 'Execution is disabled in production until a separately isolated external worker is configured and verified.',
              durationMs: null,
              executed: false
            },
            requestId
          });
        }

        const result = await runIsolatedTest(command, ROOT, config.limits.commandTimeoutMs);
        await store.run(
          'INSERT INTO test_runs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          `test_${crypto.randomUUID()}`,
          context.project.id,
          context.revision.id,
          'isolated',
          command,
          result.status,
          result.exitCode,
          result.output,
          result.durationMs,
          new Date().toISOString()
        );

        return json(response, 200, { result, requestId });
      }

      // --- Audit Log ---
      if (request.method === 'GET' && pathname === '/api/audit') {
        const events = config.authEnabled
          ? await store.listAuditEventsForUser(currentUser)
          : await store.all('SELECT * FROM audit_events ORDER BY created_at DESC LIMIT 100');
        return json(response, 200, { events, requestId });
      }

      // --- Static Files ---
      if (pathname.startsWith('/api/')) {
        return error(response, 404, 'NOT_FOUND', 'API endpoint was not found.');
      }
      if (request.method === 'GET' && serveStatic(request, response, pathname)) {
        return;
      }

      return error(response, 404, 'NOT_FOUND', 'Resource was not found.');
    } catch (caught) {
      const status = caught.status || (caught instanceof ArchiveError ? caught.status : 500);
      if (status >= 500) {
        await store.recordOperationalEvent('api.error', 'error', null, requestId, caught.message).catch(() => {});
        console.error(JSON.stringify({ level: 'error', event: 'api.error', requestId, message: String(caught.message || 'Unexpected error').slice(0, 500) }));
      }
      return error(
        response,
        status,
        status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED',
        status >= 500 ? 'Unexpected server error.' : caught.message
      );
    }
  };

  const server = http.createServer(handleRequest);
  return { server, store, config, handler: handleRequest };
}

let defaultAppInstance = null;
function getDefaultApp() {
  if (!defaultAppInstance) {
    defaultAppInstance = createApp();
  }
  return defaultAppInstance;
}

// Universal Serverless Request Handler
const serverlessHandler = (request, response) => {
  const app = getDefaultApp();
  return app.handler(request, response);
};

// Satisfy both CommonJS / ESM default export & factory function conventions
serverlessHandler.default = serverlessHandler;
serverlessHandler.handler = serverlessHandler;
serverlessHandler.createApp = createApp;
serverlessHandler.loadConfig = loadConfig;

if (require.main === module) {
  const app = createApp();
  app.server.listen(app.config.port, app.config.host, () => {
    console.log(
      JSON.stringify({
        level: 'info',
        event: 'server.started',
        host: app.config.host,
        port: app.config.port,
        localMode: !app.config.isVercel
      })
    );
  });

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(JSON.stringify({ level: 'info', event: 'server.stopping', signal }));

    const deadline = setTimeout(() => {
      console.error(JSON.stringify({ level: 'error', event: 'server.shutdown_timeout' }));
      process.exit(1);
    }, 10_000);
    deadline.unref();

    try {
      await new Promise((resolve, reject) => {
        app.server.close((error) => (error ? reject(error) : resolve()));
        app.server.closeIdleConnections?.();
      });
      await app.store.close();
      clearTimeout(deadline);
      console.log(JSON.stringify({ level: 'info', event: 'server.stopped' }));
      process.exit(0);
    } catch (error) {
      clearTimeout(deadline);
      console.error(JSON.stringify({ level: 'error', event: 'server.shutdown_failed', message: String(error.message || error).slice(0, 500) }));
      process.exit(1);
    }
  };

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

module.exports = serverlessHandler;
