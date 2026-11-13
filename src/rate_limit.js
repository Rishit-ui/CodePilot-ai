const crypto = require('node:crypto');
const net = require('node:net');

function requestIp(request, config) {
  const remote = request.socket?.remoteAddress || request.connection?.remoteAddress || 'unknown';
  if (!config.trustProxy) return net.isIP(remote) ? remote : 'unknown';
  const forwarded = String(request.headers['x-forwarded-for'] || '').split(',').map((value) => value.trim()).filter(Boolean);
  if (!forwarded.length) return net.isIP(remote) ? remote : 'unknown';
  const index = Math.max(0, forwarded.length - 1 - config.trustedProxyHops);
  const candidate = forwarded[index];
  return net.isIP(candidate) ? candidate : (net.isIP(remote) ? remote : 'unknown');
}

function routePolicy(method, pathname) {
  if (method === 'POST' && pathname === '/api/auth/register') return 'registration';
  if (method === 'POST' && pathname === '/api/auth/login') return 'login';
  if (/\/ai\/(?:chat|explain|generate-tests|refactor)$/.test(pathname) || /\/ask$/.test(pathname)) return 'ai';
  if (/\/(?:import|import-url)$/.test(pathname)) return 'import';
  if (/\/(?:architecture-report|flow)$/.test(pathname) || /\/impact\/(?:graph|analyze|select-tests)$/.test(pathname)) return 'analysis';
  if (/\/patches(?:\/[^/]+\/(?:apply|rollback))?$/.test(pathname)) return 'patch';
  if (/\/(?:tests\/run|impact\/run-tests)$/.test(pathname)) return 'execution';
  if (/\/deploy$/.test(pathname)) return 'deployment';
  return null;
}

function anonymousIdentity(ip) {
  return crypto.createHash('sha256').update(ip).digest('hex').slice(0, 24);
}

async function enforceRateLimit({ store, request, response, config, user, pathname, json }) {
  if (!config.enabled) return true;
  const policyName = routePolicy(request.method, pathname);
  if (!policyName) return true;
  const policy = config.policies[policyName];
  const ip = requestIp(request, config);
  const identity = user?.id || `ip-${anonymousIdentity(ip)}`;
  try {
    const checks = [
      await store.consumeRateLimit(`rl:${policyName}:subject:${identity}`, policy.subjectMax, policy.windowMs),
      await store.consumeRateLimit(`rl:${policyName}:ip:${anonymousIdentity(ip)}`, policy.ipMax, policy.windowMs)
    ];
    const denied = checks.find((check) => !check.allowed);
    if (!denied) return true;
    await store.audit('security.rate_limited', null, `policy=${policyName}; scope=${user ? 'user' : 'anonymous'}`, user?.id || null);
    response.writeHead(429, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Retry-After': String(denied.retryAfterSeconds)
    });
    response.end(JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Request limit exceeded. Retry later.' } }));
    return false;
  } catch (error) {
    if (!config.failClosed) return true;
    json(response, 503, { error: { code: 'RATE_LIMIT_UNAVAILABLE', message: 'Security rate-limit service is unavailable.' } });
    return false;
  }
}

module.exports = { requestIp, routePolicy, enforceRateLimit };
