const test = require('node:test');
const assert = require('node:assert/strict');
const apiHandler = require('../api/index');
const cjsHandler = require('../src/server.cjs');

test('Vercel serverless entry point api/index.js exports a valid request handler function', () => {
  assert.equal(typeof apiHandler, 'function');
  assert.equal(typeof apiHandler.default, 'function');
  assert.equal(typeof apiHandler.createApp, 'function');
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

  let statusCode = null;
  let headers = {};
  let body = '';

  const res = {
    writeHead(status, h) {
      statusCode = status;
      headers = h;
    },
    end(data) {
      body = data;
    }
  };

  await apiHandler(req, res);

  assert.equal(statusCode, 200);
  assert.ok(headers['Content-Type'].includes('application/json'));
  const parsed = JSON.parse(body);
  assert.equal(parsed.status, 'ok');
  assert.equal(parsed.version, '0.2.0');
});
