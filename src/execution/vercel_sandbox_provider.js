const { Sandbox } = require('@vercel/sandbox');
const { ExecutionProvider, executionProfile, validateWorkspace } = require('./provider');

class VercelSandboxProvider extends ExecutionProvider {
  constructor(options = {}) {
    super('vercel-sandbox');
    this.options = {
      region: options.region || 'iad1',
      timeoutMs: Math.min(options.timeoutMs || 120_000, 15 * 60_000),
      commandTimeoutMs: Math.min(options.commandTimeoutMs || 60_000, 10 * 60_000),
      outputBytes: Math.min(options.outputBytes || 1024 * 1024, 4 * 1024 * 1024),
      maxFiles: options.maxFiles || 5000,
      maxFileBytes: options.maxFileBytes || 5 * 1024 * 1024,
      maxWorkspaceBytes: options.maxWorkspaceBytes || 100 * 1024 * 1024,
      vcpus: Math.min(options.vcpus || 1, 2)
    };
  }

  async createSandbox(job) {
    const sandbox = await Sandbox.create({
      image: 'vercel/sandbox/universal:latest',
      timeout: this.options.timeoutMs,
      resources: { vcpus: this.options.vcpus },
      networkPolicy: 'deny-all',
      persistent: false,
      ports: [],
      env: { CI: 'true', CODEPILOT_JOB_ID: job.id },
      tags: { application: 'codepilot', job: job.id.slice(-32) },
      region: this.options.region
    });
    return { sandbox, id: sandbox.name, createdAt: Date.now() };
  }

  async uploadWorkspace(handle, files) {
    const validated = validateWorkspace(files, this.options);
    await handle.sandbox.mkDir('/vercel/sandbox/workspace');
    await handle.sandbox.writeFiles(validated.map((file) => ({
      path: `/vercel/sandbox/workspace/${file.path}`,
      content: file.content,
      mode: 0o600
    })));
  }

  async executeCommand(handle, profileName, signal) {
    const profile = executionProfile(profileName);
    return handle.sandbox.runCommand({
      cmd: profile.command,
      args: profile.args,
      cwd: '/vercel/sandbox/workspace',
      env: { CI: 'true', HOME: '/vercel/sandbox' },
      signal,
      timeoutMs: this.options.commandTimeoutMs
    });
  }

  async collectOutput(_handle, command) {
    const stdout = await command.stdout();
    const stderr = await command.stderr();
    const joined = `${stdout}${stderr ? `\n${stderr}` : ''}`;
    const bytes = Buffer.byteLength(joined);
    const output = bytes > this.options.outputBytes
      ? `${Buffer.from(joined).subarray(0, this.options.outputBytes).toString('utf8')}\n[OUTPUT TRUNCATED]`
      : joined;
    return { exitCode: command.exitCode, durationMs: command.durationMs, output, outputTruncated: bytes > this.options.outputBytes, actualOutputBytes: bytes };
  }

  async collectArtifacts() { return []; }

  async terminateSandbox(handle) {
    if (!handle?.sandbox) return;
    try { await handle.sandbox.stop(); } finally {
      await handle.sandbox.delete({ deleteOrphanSnapshots: true }).catch(() => {});
    }
  }

  async getExecutionStatus(handle) { return handle.sandbox.status; }
}

module.exports = { VercelSandboxProvider };
