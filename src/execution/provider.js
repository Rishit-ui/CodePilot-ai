class ExecutionProvider {
  constructor(name) { this.name = name; }
  async createSandbox() { throw new Error('createSandbox must be implemented.'); }
  async uploadWorkspace() { throw new Error('uploadWorkspace must be implemented.'); }
  async executeCommand() { throw new Error('executeCommand must be implemented.'); }
  async collectOutput() { throw new Error('collectOutput must be implemented.'); }
  async collectArtifacts() { throw new Error('collectArtifacts must be implemented.'); }
  async terminateSandbox() { throw new Error('terminateSandbox must be implemented.'); }
  async getExecutionStatus() { throw new Error('getExecutionStatus must be implemented.'); }
}

const EXECUTION_PROFILES = Object.freeze({
  'node-test': Object.freeze({ command: 'npm', args: ['test'], install: null }),
  'node-test-no-scripts': Object.freeze({ command: 'npm', args: ['test', '--ignore-scripts'], install: null }),
  'python-pytest': Object.freeze({ command: 'python3', args: ['-m', 'pytest', '-q'], install: null })
});

function executionProfile(name) {
  const profile = EXECUTION_PROFILES[name];
  if (!profile) throw new Error('Unsupported execution profile. Arbitrary commands are not accepted.');
  return profile;
}

function validateWorkspace(files, limits) {
  if (!Array.isArray(files) || files.length > limits.maxFiles) throw new Error('Workspace file-count limit exceeded.');
  let total = 0;
  return files.map((file) => {
    if (!file || typeof file.path !== 'string' || !Buffer.isBuffer(file.content)) throw new Error('Workspace files require path and Buffer content.');
    const normalized = file.path.replaceAll('\\', '/');
    if (!normalized || normalized.startsWith('/') || normalized.includes('\0') || normalized.split('/').some((part) => !part || part === '.' || part === '..')) {
      throw new Error('Unsafe workspace path.');
    }
    if (file.content.length > limits.maxFileBytes) throw new Error('Workspace file-size limit exceeded.');
    total += file.content.length;
    if (total > limits.maxWorkspaceBytes) throw new Error('Workspace size limit exceeded.');
    return { path: normalized, content: file.content };
  });
}

module.exports = { ExecutionProvider, EXECUTION_PROFILES, executionProfile, validateWorkspace };
