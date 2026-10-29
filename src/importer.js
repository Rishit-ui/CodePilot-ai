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

/**
 * Normalizes user-provided GitHub repository links into direct ZIP archive download URLs.
 * Handles:
 * - https://github.com/owner/repo
 * - https://github.com/owner/repo/
 * - https://github.com/owner/repo.git
 * - https://github.com/owner/repo/tree/branch
 * - owner/repo shorthand
 * - Already direct ZIP links (returns as-is)
 */
function normalizeGithubRepoUrl(inputUrl, defaultBranch = 'main') {
  if (!inputUrl || typeof inputUrl !== 'string') return inputUrl;
  let trimmed = inputUrl.trim();

  // If already a direct zip link, return as-is
  if (trimmed.endsWith('.zip') || trimmed.includes('/archive/')) {
    return trimmed;
  }

  // Handle owner/repo shorthand e.g. "Rishit-ui/CodePilot-ai"
  const shorthandMatch = trimmed.match(/^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/);
  if (shorthandMatch) {
    const owner = shorthandMatch[1];
    const repo = shorthandMatch[2].replace(/\.git$/, '');
    return `https://github.com/${owner}/${repo}/archive/refs/heads/${defaultBranch}.zip`;
  }

  // Try parsing standard URL
  try {
    const parsed = new URL(trimmed);
    if (parsed.hostname === 'github.com' || parsed.hostname === 'www.github.com') {
      const parts = parsed.pathname.replace(/^\/+|\/+$/g, '').split('/');
      if (parts.length >= 2) {
        const owner = parts[0];
        const repo = parts[1].replace(/\.git$/, '');

        // If tree branch is specified: /owner/repo/tree/branch-name
        if (parts[2] === 'tree' && parts[3]) {
          const branch = parts.slice(3).join('/');
          return `https://github.com/${owner}/${repo}/archive/refs/heads/${branch}.zip`;
        }

        return `https://github.com/${owner}/${repo}/archive/refs/heads/${defaultBranch}.zip`;
      }
    }
  } catch {
    // Not a valid standard URL, return original for validateUrlForSSRF to handle error
  }

  return trimmed;
}

async function fetchRemoteZip(urlString, maxBytes = 10 * 1024 * 1024, timeoutMs = 15000, redirectCount = 0) {
  if (redirectCount > 5) {
    throw new SSRFError('Too many redirects while fetching remote archive.');
  }

  const parsed = await validateUrlForSSRF(urlString);

  return new Promise((resolve, reject) => {
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.get(
      parsed,
      {
        headers: {
          'User-Agent': 'CodePilotAI-Importer/1.0 (Security Scanner)',
          'Accept': 'application/zip, application/octet-stream, */*'
        },
        timeout: timeoutMs
      },
      (res) => {
        // Handle redirects safely (re-validating SSRF on redirect location)
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = new URL(res.headers.location, parsed).toString();
          return fetchRemoteZip(redirectUrl, maxBytes, timeoutMs, redirectCount + 1).then(resolve).catch(reject);
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

/**
 * Intelligent remote fetch that tries main then falls back to master if 404 (common GitHub pattern)
 */
async function fetchGithubOrRemoteZip(inputUrl, maxBytes = 100 * 1024 * 1024, timeoutMs = 45000) {
  const normalizedMain = normalizeGithubRepoUrl(inputUrl, 'main');
  try {
    return await fetchRemoteZip(normalizedMain, maxBytes, timeoutMs);
  } catch (err) {
    // If GitHub returned 404 for main branch, try fallback to master branch
    if (normalizedMain.includes('/refs/heads/main.zip') && err.message.includes('HTTP 404')) {
      const normalizedMaster = normalizeGithubRepoUrl(inputUrl, 'master');
      return await fetchRemoteZip(normalizedMaster, maxBytes, timeoutMs);
    }
    throw err;
  }
}

module.exports = {
  isPrivateIp,
  validateUrlForSSRF,
  normalizeGithubRepoUrl,
  fetchRemoteZip,
  fetchGithubOrRemoteZip,
  SSRFError
};
