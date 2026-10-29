const { spawn } = require('node:child_process');
const path = require('node:path');

const ALLOWED_RUNNERS = Object.freeze([
  'node --test',
  'npm test',
  'pytest',
  'python -m unittest'
]);

class IsolatedTestRunner {
  constructor(options = {}) {
    this.options = {
      defaultTimeoutMs: options.defaultTimeoutMs || 30000,
      maxOutputBytes: options.maxOutputBytes || 64 * 1024,
      ...options
    };
  }

  /**
   * Builds an isolated process execution command for selected test files.
   * @param {Array<string>} selectedTestFiles
   * @param {string} baseCommand e.g. 'node --test'
   */
  synthesizeCommand(selectedTestFiles = [], baseCommand = 'node --test') {
    if (!selectedTestFiles || selectedTestFiles.length === 0) {
      return { command: null, message: 'No tests selected for execution.' };
    }

    // Sanitize file paths (prevent command injection characters)
    const sanitizedFiles = selectedTestFiles.map((file) => {
      return file.replace(/["'`;&|<>^$]/g, '');
    });

    if (baseCommand === 'node --test') {
      return {
        command: `node --test ${sanitizedFiles.join(' ')}`,
        executable: 'node',
        args: ['--test', ...sanitizedFiles]
      };
    }

    if (baseCommand.startsWith('npm test')) {
      return {
        command: `npm test -- ${sanitizedFiles.join(' ')}`,
        executable: 'npm',
        args: ['test', '--', ...sanitizedFiles]
      };
    }

    return {
      command: `${baseCommand} ${sanitizedFiles.join(' ')}`,
      executable: baseCommand.split(' ')[0],
      args: [...baseCommand.split(' ').slice(1), ...sanitizedFiles]
    };
  }

  /**
   * Executes a test command in a sanitized subprocess environment.
   */
  async execute(commandOrSpec, cwd = process.cwd(), timeoutMs = null) {
    const timeout = timeoutMs || this.options.defaultTimeoutMs;
    const startTime = Date.now();

    let executable;
    let args;
    let fullCommand;

    if (typeof commandOrSpec === 'string') {
      fullCommand = commandOrSpec.trim();
      const parts = fullCommand.split(/\s+/);
      executable = parts[0];
      args = parts.slice(1);
    } else if (commandOrSpec && commandOrSpec.executable) {
      executable = commandOrSpec.executable;
      args = commandOrSpec.args || [];
      fullCommand = commandOrSpec.command;
    } else {
      return {
        status: 'skipped',
        exitCode: 0,
        output: 'No test command to execute.',
        durationMs: 0
      };
    }

    // Security Gate: Verify executable is in allowlist
    const isAllowed = ALLOWED_RUNNERS.some((runner) => fullCommand.startsWith(runner) || fullCommand.startsWith(runner.split(' ')[0]));
    if (!isAllowed) {
      return {
        status: 'error',
        exitCode: -1,
        output: `Security violation: Command "${fullCommand}" is not in the approved test runner allowlist (${ALLOWED_RUNNERS.join(', ')}).`,
        durationMs: 0
      };
    }

    // Security Gate: Strip all secrets and sensitive environment variables
    const cleanEnv = {
      PATH: process.env.PATH,
      NODE_ENV: 'test',
      CI: 'true',
      TMPDIR: process.env.TMPDIR || process.env.TEMP || '/tmp'
    };

    return new Promise((resolve) => {
      let child;
      const spawnTarget = process.platform === 'win32' && executable === 'npm' ? 'npm.cmd' : executable;
      try {
        child = spawn(spawnTarget, args, {
          cwd,
          env: cleanEnv,
          timeout,
          shell: false
        });
      } catch (err) {
        return resolve({
          status: 'error',
          exitCode: -1,
          output: `Failed to spawn test runner: ${err.message}`,
          durationMs: Date.now() - startTime
        });
      }

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (d) => {
        if (stdout.length < this.options.maxOutputBytes) stdout += d.toString();
      });
      child.stderr?.on('data', (d) => {
        if (stderr.length < this.options.maxOutputBytes) stderr += d.toString();
      });

      child.on('close', (code) => {
        const durationMs = Date.now() - startTime;
        const totalOutput = (stdout + (stderr ? `\nSTDERR:\n${stderr}` : '')).slice(0, this.options.maxOutputBytes);
        resolve({
          status: code === 0 ? 'passed' : 'failed',
          exitCode: code,
          output: totalOutput,
          durationMs,
          command: fullCommand
        });
      });

      child.on('error', (err) => {
        resolve({
          status: 'error',
          exitCode: -1,
          output: `Execution error: ${err.message}`,
          durationMs: Date.now() - startTime,
          command: fullCommand
        });
      });
    });
  }
}

module.exports = {
  ALLOWED_RUNNERS,
  IsolatedTestRunner
};
