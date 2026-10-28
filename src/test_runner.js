const { spawn } = require('node:child_process');

const ALLOWED_TEST_COMMANDS = [
  'npm test',
  'node --test',
  'pytest',
  'python -m unittest',
  'go test ./...',
  'cargo test'
];

function isCommandAllowed(command) {
  const trimmed = command.trim();
  return ALLOWED_TEST_COMMANDS.some((allowed) => trimmed === allowed || trimmed.startsWith(`${allowed} `));
}

async function runIsolatedTest(command, cwd, timeoutMs = 30000) {
  if (!isCommandAllowed(command)) {
    return {
      status: 'error',
      exitCode: -1,
      output: `Command "${command}" is rejected. Only approved test runners (${ALLOWED_TEST_COMMANDS.join(', ')}) are allowed.`,
      durationMs: 0
    };
  }

  const startTime = Date.now();
  const parts = command.trim().split(/\s+/);
  const cmd = parts[0];
  const args = parts.slice(1);

  // Sanitized environment without secrets
  const cleanEnv = {
    PATH: process.env.PATH,
    NODE_ENV: 'test',
    CI: 'true'
  };

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, {
        cwd,
        env: cleanEnv,
        timeout: timeoutMs,
        shell: process.platform === 'win32'
      });
    } catch (err) {
      return resolve({
        status: 'error',
        exitCode: -1,
        output: `Failed to spawn process: ${err.message}`,
        durationMs: Date.now() - startTime
      });
    }

    let output = '';

    child.stdout?.on('data', (d) => { output += d.toString(); });
    child.stderr?.on('data', (d) => { output += d.toString(); });

    child.on('close', (code) => {
      const durationMs = Date.now() - startTime;
      resolve({
        status: code === 0 ? 'passed' : 'failed',
        exitCode: code,
        output: output.slice(0, 50000), // Cap output
        durationMs
      });
    });

    child.on('error', (err) => {
      resolve({
        status: 'error',
        exitCode: -1,
        output: output + `\nProcess error: ${err.message}`,
        durationMs: Date.now() - startTime
      });
    });
  });
}

module.exports = {
  isCommandAllowed,
  runIsolatedTest,
  ALLOWED_TEST_COMMANDS
};
