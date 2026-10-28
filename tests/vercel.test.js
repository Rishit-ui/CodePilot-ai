const test = require('node:test');
const assert = require('node:assert/strict');
const apiHandler = require('../api/index');
const catchAllHandler = require('../api/[...path]');
const cjsHandler = require('../src/server.cjs');

function createMockResponse() {
  const state = {
    statusCode: null,
    headers: {},
    body: ''
  };
  const res = {
    writeHead(status, h) {
      state.statusCode = status;
      state.headers = h || {};
    },
    end(data) {
      state.body = data || '';
    }
  };
  return { res, state };
}

test('Vercel serverless entry point api/index.js exports a valid request handler function', () => {
  assert.equal(typeof apiHandler, 'function');
  assert.equal(typeof apiHandler.default, 'function');
  assert.equal(typeof apiHandler.createApp, 'function');
});

test('Vercel serverless entry point api/[...path].js exports a valid request handler function', () => {
  assert.equal(typeof catchAllHandler, 'function');
  assert.equal(typeof catchAllHandler.default, 'function');
});

test('Vercel serverless entry point src/server.cjs exports a valid request handler function', () => {
  assert.equal(typeof cjsHandler, 'function');
  assert.equal(typeof cjsHandler.default, 'function');
});

test('Serverless handler handles /api/health directly without listening on fixed ports', async () => {
  const req = {
    method: 'GET',
    url: '/api/health',
    headers: { host: 'localhost' }
  };
  const { res, state } = createMockResponse();

  await apiHandler(req, res);

  assert.equal(state.statusCode, 200);
  assert.ok(state.headers['Content-Type'].includes('application/json'));
  const parsed = JSON.parse(state.body);
  assert.equal(parsed.status, 'ok');
  assert.equal(parsed.version, '0.2.0');
});

test('Serverless handler resolves /api/projects via __path query parameter rewrite', async () => {
  const req = {
    method: 'GET',
    url: '/api/index.js?__path=/api/projects',
    headers: { host: 'localhost' }
  };
  const { res, state } = createMockResponse();

  await apiHandler(req, res);

  assert.equal(state.statusCode, 200);
  const parsed = JSON.parse(state.body);
  assert.ok(Array.isArray(parsed.projects));
});

test('Serverless handler resolves /api/projects via x-matched-path header rewrite', async () => {
  const req = {
    method: 'GET',
    url: '/api/index.js',
    headers: {
      host: 'localhost',
      'x-matched-path': '/api/projects'
    }
  };
  const { res, state } = createMockResponse();

  await apiHandler(req, res);

  assert.equal(state.statusCode, 200);
  const parsed = JSON.parse(state.body);
  assert.ok(Array.isArray(parsed.projects));
});

test('Serverless handler falls back to health status when called directly at /api/index.js', async () => {
  const req = {
    method: 'GET',
    url: '/api/index.js',
    headers: { host: 'localhost' }
  };
  const { res, state } = createMockResponse();

  await apiHandler(req, res);

  assert.equal(state.statusCode, 200);
  const parsed = JSON.parse(state.body);
  assert.equal(parsed.status, 'ok');
});

test('Serverless handler handles trailing slashes gracefully', async () => {
  const req = {
    method: 'GET',
    url: '/api/health/',
    headers: { host: 'localhost' }
  };
  const { res, state } = createMockResponse();

  await apiHandler(req, res);

  assert.equal(state.statusCode, 200);
  const parsed = JSON.parse(state.body);
  assert.equal(parsed.status, 'ok');
});
