const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadConfig } = require('./config');
const { Store } = require('./db');
const { ArchiveError, readZip, contentHash } = require('./archive');
const { analyze } = require('./analyzer');
const { validateUrlForSSRF, fetchRemoteZip, SSRFError } = require('./importer');
const { generateArchitectureReport, exportReportToMarkdown } = require('./architecture');
const { answerQuestionWithContext } = require('./ai');
const { generatePlanFromRequirement, createUnifiedDiff } = require('./planner');
const { detectStack, generateDockerfile, generateDockerignore, generateDockerCompose } = require('./docker');
const { evaluateReadiness, executeDeployment } = require('./deployer');
const { runIsolatedTest } = require('./test_runner');

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

function latestOrError(store, projectId, response) {
  const project = store.project(projectId);
  if (!project) {
    noProject(response);
    return null;
  }
  const revision = store.latestRevision(projectId);
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
  const config = options.config || loadConfig(ROOT);
  const store = options.store || new Store(config.dataDir);

  const server = http.createServer(async (request, response) => {
    const requestId = crypto.randomUUID();
    try {
      const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
      const pathname = url.pathname;

      // Extract bearer token or session cookie
      const authHeader = request.headers['authorization'] || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
      const currentUser = token ? store.getSessionUser(token) : null;

      // --- Health & Readiness Endpoints ---
      if (request.method === 'GET' && pathname === '/api/health') {
        return json(response, 200, {
          status: 'ok',
          requestId,
          timestamp: new Date().toISOString(),
          version: '0.2.0',
          capabilities: {
            localMode: true,
            auth: config.authEnabled ? 'enabled' : 'local-open',
            aiProvider: config.ai.provider,
            supportedDeployments: config.deployment.allowedProviders,
            maxUploadMb: Math.round(config.limits.maxUploadBytes / (1024 * 1024))
          }
        });
      }

      if (request.method === 'GET' && pathname === '/api/ready') {
        store.get('SELECT 1 AS ready');
        return json(response, 200, { status: 'ready', requestId });
      }

      // --- Authentication Endpoints ---
      if (request.method === 'POST' && pathname === '/api/auth/register') {
        const body = parseJson(await readBody(request, 16 * 1024));
        const { email, password, name } = body;
        if (!email || !password || !name) {
          return error(response, 400, 'MISSING_FIELDS', 'Email, password, and name are required.');
        }
        if (store.getUserByEmail(email)) {
          return error(response, 409, 'USER_EXISTS', 'A user with this email already exists.');
        }
        const user = store.createUser(email, name, password);
        const session = store.createSession(user.id);
        return json(response, 201, { user, token: session.token, requestId });
      }

      if (request.method === 'POST' && pathname === '/api/auth/login') {
        const body = parseJson(await readBody(request, 16 * 1024));
        const { email, password } = body;
        const user = store.authenticateUser(email, password);
        if (!user) {
          return error(response, 401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
        }
        const session = store.createSession(user.id);
        return json(response, 200, { user, token: session.token, requestId });
      }

      if (request.method === 'GET' && pathname === '/api/auth/me') {
        if (!currentUser) return error(response, 401, 'UNAUTHORIZED', 'Not authenticated.');
        return json(response, 200, { user: currentUser, requestId });
      }

      // --- Workspaces Endpoints ---
      if (request.method === 'GET' && pathname === '/api/workspaces') {
        const userId = currentUser ? currentUser.id : 'anonymous';
        const workspaces = store.getUserWorkspaces(userId);
        return json(response, 200, { workspaces, requestId });
      }

      if (request.method === 'POST' && pathname === '/api/workspaces') {
        const body = parseJson(await readBody(request, 16 * 1024));
        const name = (body.name || '').trim();
        if (!name) return error(response, 422, 'INVALID_NAME', 'Workspace name is required.');
        const userId = currentUser ? currentUser.id : (store.all('SELECT id FROM users LIMIT 1')[0]?.id || 'admin');
        const ws = store.createWorkspace(name, userId);
        return json(response, 201, { workspace: ws, requestId });
      }

      // --- Projects Endpoints ---
      if (request.method === 'GET' && pathname === '/api/projects') {
        const workspaceId = url.searchParams.get('workspaceId');
        return json(response, 200, { projects: store.listProjects(workspaceId), requestId });
      }

      if (request.method === 'POST' && pathname === '/api/projects') {
        const body = parseJson(await readBody(request, 16 * 1024));
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        const description = typeof body.description === 'string' ? body.description.trim() : '';
        const workspaceId = body.workspaceId || null;
        if (!name || name.length > 100) {
          return error(response, 422, 'INVALID_PROJECT_NAME', 'Project name must contain 1–100 characters.');
        }
        const project = store.createProject(name, description, workspaceId, currentUser?.id);
        return json(response, 201, { project, requestId });
      }

      const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
      if (request.method === 'GET' && projectMatch) {
        const summary = store.projectSummary(projectMatch[1]);
        return summary ? json(response, 200, { ...summary, requestId }) : noProject(response);
      }

      if (request.method === 'DELETE' && projectMatch) {
        const deleted = store.deleteProject(projectMatch[1], currentUser?.id);
        return deleted ? json(response, 200, { success: true, requestId }) : noProject(response);
      }

      // --- ZIP Import Endpoint ---
      const importMatch = pathname.match(/^\/api\/projects\/([^/]+)\/import$/);
      if (request.method === 'POST' && importMatch) {
        const projectId = importMatch[1];
        if (!store.project(projectId)) return noProject(response);
        if (request.headers['content-type'] !== 'application/zip') {
          return error(response, 415, 'ZIP_REQUIRED', 'Use Content-Type: application/zip.');
        }

        const job = store.createJob(projectId, 'import', 'Validating archive and analyzing codebase');
        try {
          const archive = await readBody(request, config.limits.maxUploadBytes);
          const hash = contentHash(archive);
          const entries = readZip(archive, config.limits);
          const records = analyze(entries);
          const saved = store.saveRevision(projectId, hash, records, `Imported ${records.files.length} files`);

          store.finishJob(
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
          store.finishJob(job.id, null, 'failed', importError.message);
          throw importError;
        }
      }

      // --- URL / Remote Import Endpoint (SSRF Protected) ---
      const importUrlMatch = pathname.match(/^\/api\/projects\/([^/]+)\/import-url$/);
      if (request.method === 'POST' && importUrlMatch) {
        const projectId = importUrlMatch[1];
        if (!store.project(projectId)) return noProject(response);

        const body = parseJson(await readBody(request, 16 * 1024));
        const urlToFetch = (body.url || '').trim();
        if (!urlToFetch) return error(response, 422, 'URL_REQUIRED', 'A remote archive URL is required.');

        const job = store.createJob(projectId, 'import-url', `Fetching remote archive from ${urlToFetch}`);
        try {
          const archive = await fetchRemoteZip(urlToFetch, config.limits.maxUploadBytes);
          const hash = contentHash(archive);
          const entries = readZip(archive, config.limits);
          const records = analyze(entries);
          const saved = store.saveRevision(projectId, hash, records, `Remote import from ${urlToFetch}`);

          store.finishJob(job.id, saved.revision.id, 'completed', `Imported ${records.files.length} files.`);
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
          store.finishJob(job.id, null, 'failed', err.message);
          if (err instanceof SSRFError) {
            return error(response, 400, 'SSRF_BLOCKED', err.message);
          }
          throw err;
        }
      }

      // --- Files & Source Code Endpoints ---
      const filesMatch = pathname.match(/^\/api\/projects\/([^/]+)\/files$/);
      if (request.method === 'GET' && filesMatch) {
        const context = latestOrError(store, filesMatch[1], response);
        if (!context) return;
        const query = (url.searchParams.get('q') || '').toLowerCase().slice(0, 100);
        const files = store
          .all('SELECT path, language, bytes, excluded_reason AS excludedReason FROM files WHERE revision_id=? ORDER BY path', context.revision.id)
          .filter((f) => !query || f.path.toLowerCase().includes(query));
        return json(response, 200, {
          revisionId: context.revision.id,
          files: files.slice(0, config.limits.maxSearchResults),
          truncated: files.length > config.limits.maxSearchResults,
          requestId
        });
      }

      const fileMatch = pathname.match(/^\/api\/projects\/([^/]+)\/file$/);
      if (request.method === 'GET' && fileMatch) {
        const context = latestOrError(store, fileMatch[1], response);
        if (!context) return;
        const requestedPath = url.searchParams.get('path');
        if (!requestedPath || requestedPath.length > 500) {
          return error(response, 422, 'INVALID_PATH', 'A valid file path is required.');
        }
        const file = store.get(
          'SELECT path, language, bytes, content, excluded_reason AS excludedReason FROM files WHERE revision_id=? AND path=?',
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
        const context = latestOrError(store, graphMatch[1], response);
        if (!context) return;
        const nodes = store.all(
          'SELECT path AS id, path AS label, language FROM files WHERE revision_id=? AND excluded_reason IS NULL ORDER BY path LIMIT 200',
          context.revision.id
        );
        const edges = store.all(
          'SELECT source_path AS source, target_path AS target, type, confidence, line, provenance FROM edges WHERE revision_id=? LIMIT 600',
          context.revision.id
        );
        return json(response, 200, { revisionId: context.revision.id, nodes, edges, requestId });
      }

      const reportMatch = pathname.match(/^\/api\/projects\/([^/]+)\/architecture-report$/);
      if (request.method === 'GET' && reportMatch) {
        const context = latestOrError(store, reportMatch[1], response);
        if (!context) return;
        const report = generateArchitectureReport(store, context.revision.id, context.project);
        return json(response, 200, { revisionId: context.revision.id, report, requestId });
      }

      const reportMdMatch = pathname.match(/^\/api\/projects\/([^/]+)\/architecture-report\.md$/);
      if (request.method === 'GET' && reportMdMatch) {
        const context = latestOrError(store, reportMdMatch[1], response);
        if (!context) return;
        const report = generateArchitectureReport(store, context.revision.id, context.project);
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
        const context = latestOrError(store, findingsMatch[1], response);
        if (!context) return;
        const findings = store.all(
          `SELECT id, severity, category, message, file_path AS filePath, line, evidence, status, suppression_reason 
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
        const updated = store.suppressFinding(findingId, reason, currentUser?.id);
        if (!updated) return error(response, 404, 'FINDING_NOT_FOUND', 'Finding not found.');
        return json(response, 200, { finding: updated, requestId });
      }

      // --- AI Assistant Endpoint ---
      const askMatch = pathname.match(/^\/api\/projects\/([^/]+)\/ask$/);
      if (request.method === 'POST' && askMatch) {
        const context = latestOrError(store, askMatch[1], response);
        if (!context) return;
        const body = parseJson(await readBody(request, 8 * 1024));
        const question = typeof body.question === 'string' ? body.question.trim() : '';
        if (!question || question.length > config.limits.maxQuestionChars) {
          return error(response, 422, 'INVALID_QUESTION', `Question must contain 1–${config.limits.maxQuestionChars} characters.`);
        }
        const result = await answerQuestionWithContext(store, context.project, context.revision, question, config.ai);
        store.audit('assistant.question', context.project.id, `Question answered for revision ${context.revision.id}`, currentUser?.id);
        return json(response, 200, { revisionId: context.revision.id, ...result, requestId });
      }

      // --- Implementation Planner Endpoints ---
      const plansMatch = pathname.match(/^\/api\/projects\/([^/]+)\/plans$/);
      if (request.method === 'GET' && plansMatch) {
        const context = latestOrError(store, plansMatch[1], response);
        if (!context) return;
        const plans = store.listPlans(context.project.id);
        return json(response, 200, { plans, requestId });
      }

      if (request.method === 'POST' && plansMatch) {
        const context = latestOrError(store, plansMatch[1], response);
        if (!context) return;
        const body = parseJson(await readBody(request, 16 * 1024));
        const reqText = (body.requirement || '').trim();
        if (!reqText) return error(response, 422, 'REQUIREMENT_REQUIRED', 'Feature requirement is required.');
        const plan = generatePlanFromRequirement(store, context.project, context.revision, reqText);
        return json(response, 201, { plan, requestId });
      }

      const taskMatch = pathname.match(/^\/api\/projects\/([^/]+)\/tasks\/([^/]+)$/);
      if (request.method === 'PATCH' && taskMatch) {
        const taskId = taskMatch[2];
        const body = parseJson(await readBody(request, 8 * 1024));
        const status = body.status;
        if (!['pending', 'in_progress', 'completed', 'blocked'].includes(status)) {
          return error(response, 422, 'INVALID_STATUS', 'Status must be pending, in_progress, completed, or blocked.');
        }
        const updated = store.updateTaskStatus(taskId, status);
        return json(response, 200, { task: updated, requestId });
      }

      // --- Patches & Code Modifications ---
      const patchesMatch = pathname.match(/^\/api\/projects\/([^/]+)\/patches$/);
      if (request.method === 'GET' && patchesMatch) {
        const context = latestOrError(store, patchesMatch[1], response);
        if (!context) return;
        const patches = store.listPatches(context.project.id);
        return json(response, 200, { patches, requestId });
      }

      if (request.method === 'POST' && patchesMatch) {
        const context = latestOrError(store, patchesMatch[1], response);
        if (!context) return;
        const body = parseJson(await readBody(request, 64 * 1024));
        const { targetFile, newContent, title, planId } = body;
        if (!targetFile || newContent === undefined) {
          return error(response, 422, 'FIELDS_REQUIRED', 'targetFile and newContent are required.');
        }
        const currentFile = store.get('SELECT content FROM files WHERE revision_id=? AND path=?', context.revision.id, targetFile);
        const originalContent = currentFile ? currentFile.content || '' : '';
        const diff = createUnifiedDiff(targetFile, originalContent, newContent);
        const patch = store.createPatch(
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
        const applied = store.applyPatch(patchId, currentUser?.id);
        if (!applied) return error(response, 404, 'PATCH_NOT_FOUND', 'Patch not found or already applied.');
        return json(response, 200, { patch: applied, requestId });
      }

      const patchRollbackMatch = pathname.match(/^\/api\/projects\/([^/]+)\/patches\/([^/]+)\/rollback$/);
      if (request.method === 'POST' && patchRollbackMatch) {
        const patchId = patchRollbackMatch[2];
        const rolledBack = store.rollbackPatch(patchId, currentUser?.id);
        if (!rolledBack) return error(response, 404, 'PATCH_NOT_FOUND', 'Patch not found or not in applied state.');
        return json(response, 200, { patch: rolledBack, requestId });
      }

      // --- Docker Assistant ---
      const dockerMatch = pathname.match(/^\/api\/projects\/([^/]+)\/docker$/);
      if (request.method === 'GET' && dockerMatch) {
        const context = latestOrError(store, dockerMatch[1], response);
        if (!context) return;
        const files = store.all('SELECT path, content FROM files WHERE revision_id=?', context.revision.id);
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
        const context = latestOrError(store, readinessMatch[1], response);
        if (!context) return;
        const readiness = evaluateReadiness(store, context.project.id, context.revision.id);
        return json(response, 200, { revisionId: context.revision.id, ...readiness, requestId });
      }

      const deployMatch = pathname.match(/^\/api\/projects\/([^/]+)\/deploy$/);
      if (request.method === 'POST' && deployMatch) {
        const context = latestOrError(store, deployMatch[1], response);
        if (!context) return;
        const body = parseJson(await readBody(request, 8 * 1024));
        const provider = body.provider || 'mock';
        const environment = body.environment || 'production';

        const deployment = store.createDeployment(context.project.id, context.revision.id, provider, environment);
        // Execute synchronously with host header for live verification
        const result = await executeDeployment(store, deployment.id, config, request.headers.host);
        store.audit('deployment.executed', context.project.id, `Deployment ${deployment.id} to ${provider} resulted in ${result.status}`, currentUser?.id);
        return json(response, 201, { deployment: result, requestId });
      }

      const deploymentsListMatch = pathname.match(/^\/api\/projects\/([^/]+)\/deployments$/);
      if (request.method === 'GET' && deploymentsListMatch) {
        const context = latestOrError(store, deploymentsListMatch[1], response);
        if (!context) return;
        const deployments = store.listDeployments(context.project.id);
        return json(response, 200, { deployments, requestId });
      }

      // --- Test Execution Endpoint ---
      const testRunMatch = pathname.match(/^\/api\/projects\/([^/]+)\/tests\/run$/);
      if (request.method === 'POST' && testRunMatch) {
        const context = latestOrError(store, testRunMatch[1], response);
        if (!context) return;
        const body = parseJson(await readBody(request, 8 * 1024));
        const command = (body.command || 'npm test').trim();

        const result = await runIsolatedTest(command, ROOT, config.limits.commandTimeoutMs);
        store.run(
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
        const events = store.all('SELECT * FROM audit_events ORDER BY created_at DESC LIMIT 100');
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
        console.error(JSON.stringify({ level: 'error', requestId, message: caught.message, stack: caught.stack }));
      }
      return error(
        response,
        status,
        status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED',
        status >= 500 ? 'Unexpected server error.' : caught.message
      );
    }
  });

  return { server, store, config };
}

if (require.main === module) {
  const app = createApp();
  app.server.listen(app.config.port, app.config.host, () => {
    console.log(
      JSON.stringify({
        level: 'info',
        event: 'server.started',
        host: app.config.host,
        port: app.config.port,
        localMode: true
      })
    );
  });
}

module.exports = { createApp };
