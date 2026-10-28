function lineOf(content, index) {
  return content.slice(0, index).split('\n').length;
}

function analyzeDockerfile(filePath, content) {
  const symbols = [];
  const findings = [];
  const baseImages = [];
  const exposedPorts = [];
  let hasUser = false;
  let hasHealthcheck = false;

  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;

    const fromMatch = line.match(/^FROM\s+([^\s]+)(?:\s+AS\s+([^\s]+))?/i);
    if (fromMatch) {
      baseImages.push({ image: fromMatch[1], stage: fromMatch[2] || null, line: i + 1 });
      symbols.push({ filePath, kind: 'docker-stage', name: fromMatch[2] || fromMatch[1], line: i + 1 });
      if (fromMatch[1].endsWith(':latest')) {
        findings.push({
          severity: 'medium',
          category: 'docker',
          message: `Unpinned base image "${fromMatch[1]}" using :latest tag. Prefer specific version or SHA digest.`,
          filePath,
          line: i + 1,
          evidence: line
        });
      }
    }

    const exposeMatch = line.match(/^EXPOSE\s+([0-9\s/]+)/i);
    if (exposeMatch) {
      exposedPorts.push(exposeMatch[1].trim());
      symbols.push({ filePath, kind: 'docker-expose', name: exposeMatch[1].trim(), line: i + 1 });
    }

    if (line.match(/^USER\s+(?!root\b)[^\s]+/i)) {
      hasUser = true;
    }

    if (line.match(/^HEALTHCHECK\b/i)) {
      hasHealthcheck = true;
    }
  }

  if (!hasUser) {
    findings.push({
      severity: 'low',
      category: 'docker-security',
      message: 'Dockerfile does not specify a non-root USER instruction; container may run as root.',
      filePath,
      line: 1,
      evidence: 'Missing USER'
    });
  }

  if (!hasHealthcheck) {
    findings.push({
      severity: 'info',
      category: 'docker-observability',
      message: 'Dockerfile does not define a HEALTHCHECK instruction.',
      filePath,
      line: 1,
      evidence: 'Missing HEALTHCHECK'
    });
  }

  return { symbols, findings, baseImages, exposedPorts, hasUser, hasHealthcheck };
}

function analyzeDockerCompose(filePath, content) {
  const symbols = [];
  const services = [];

  // Look for services: section
  const serviceRegex = /^[ \t]{2}([a-zA-Z0-9_-]+):/gm;
  let match;
  while ((match = serviceRegex.exec(content)) !== null) {
    const serviceName = match[1];
    if (serviceName !== 'version' && serviceName !== 'services' && serviceName !== 'networks' && serviceName !== 'volumes') {
      services.push(serviceName);
      symbols.push({
        filePath,
        kind: 'compose-service',
        name: serviceName,
        line: lineOf(content, match.index)
      });
    }
  }

  return { symbols, services };
}

module.exports = { analyzeDockerfile, analyzeDockerCompose };
