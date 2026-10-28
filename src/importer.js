const https = require('node:https');
const http = require('node:http');
const dns = require('node:dns').promises;
const net = require('node:net');
const { URL } = require('node:url');

class SSRFError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SSRFError';
    this.status = 400;
  }
}

function isPrivateIp(ip) {
  if (!net.isIP(ip)) return true;
  // IPv4 checks
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    // 0.0.0.0/8
    if (parts[0] === 0) return true;
    // 127.0.0.0/8 (Loopback)
    if (parts[0] === 127) return true;
    // 10.0.0.0/8 (Private)
    if (parts[0] === 10) return true;
    // 172.16.0.0/12 (Private)
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    // 192.168.0.0/16 (Private)
    if (parts[0] === 192 && parts[1] === 168) return true;
    // 169.254.0.0/16 (Link-local & AWS/GCP/Azure Cloud Metadata)
    if (parts[0] === 169 && parts[1] === 254) return true;
    // 100.64.0.0/10 (Carrier-grade NAT)
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
    // Broadcast / Multicast
    if (parts[0] >= 224) return true;
    return false;
  }
  // IPv6 checks
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::' || lower.startsWith('fe80:') || lower.startsWith('fc00:') || lower.startsWith('fd00:')) {
      return true;
    }
    return false;
  }
  return true;
}

async function validateUrlForSSRF(urlString) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new SSRFError('Invalid URL format.');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new SSRFError(`Unsupported protocol "${parsed.protocol}". Only HTTP/HTTPS are allowed.`);
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block localhost and standard dangerous domains
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname === 'metadata.google.internal' ||
    hostname === 'instance-data'
  ) {
    throw new SSRFError(`Access to host "${hostname}" is blocked by SSRF policy.`);
  }

  // Resolve hostname to IP addresses and verify all are public
  try {
    const addresses = await dns.lookup(hostname, { all: true });
    if (!addresses || addresses.length === 0) {
      throw new SSRFError(`Could not resolve hostname "${hostname}".`);
    }
    for (const addr of addresses) {
      if (isPrivateIp(addr.address)) {
        throw new SSRFError(`Resolved IP ${addr.address} for host "${hostname}" is private or restricted.`);
      }
    }
  } catch (err) {
    if (err instanceof SSRFError) throw err;
    throw new SSRFError(`DNS resolution failure for host "${hostname}": ${err.message}`);
  }

  return parsed;
}

async function fetchRemoteZip(urlString, maxBytes = 10 * 1024 * 1024, timeoutMs = 15000) {
  const parsed = await validateUrlForSSRF(urlString);

  return new Promise((resolve, reject) => {
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.get(
      parsed,
      {
        headers: {
          'User-Agent': 'CodePilotAI-Importer/1.0 (Security Scanner)',
          'Accept': 'application/zip, application/octet-stream'
        },
        timeout: timeoutMs
      },
      (res) => {
        // Handle redirects safely (re-validating SSRF on redirect location)
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = new URL(res.headers.location, parsed).toString();
          return fetchRemoteZip(redirectUrl, maxBytes, timeoutMs).then(resolve).catch(reject);
        }

        if (res.statusCode !== 200) {
          return reject(new SSRFError(`Remote server returned HTTP ${res.statusCode}`));
        }

        const chunks = [];
        let totalSize = 0;

        res.on('data', (chunk) => {
          totalSize += chunk.length;
          if (totalSize > maxBytes) {
            req.destroy();
            return reject(new SSRFError(`Remote file exceeded maximum allowed size of ${maxBytes} bytes.`));
          }
          chunks.push(chunk);
        });

        res.on('end', () => {
          resolve(Buffer.concat(chunks));
        });

        res.on('error', (err) => reject(new SSRFError(`Network stream error: ${err.message}`)));
      }
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new SSRFError(`Request timed out after ${timeoutMs}ms`));
    });

    req.on('error', (err) => reject(new SSRFError(`Connection error: ${err.message}`)));
  });
}

module.exports = {
  isPrivateIp,
  validateUrlForSSRF,
  fetchRemoteZip,
  SSRFError
};
