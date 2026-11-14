'use strict';

const crypto = require('node:crypto');
const { Sandbox } = require('@vercel/sandbox');
const { VercelSandboxProvider } = require('../../src/execution/vercel_sandbox_provider');
const { HARNESS_STATUS } = require('../../src/execution/adversarial_harness');

class VercelSandboxAdversarialAdapter {
  constructor(options = {}) {
    this.name = 'vercel-sandbox';
    this.region = options.region || process.env.CODEPILOT_QUEUE_REGION || 'iad1';
    this.outputBytes = options.outputBytes || 64 * 1024;
    this.databaseHost = options.databaseHost || process.env.TEST_ADVERSARIAL_DB_HOST || '';
    this.databasePort = Number(options.databasePort || process.env.TEST_ADVERSARIAL_DB_PORT || 5432);
    this.hostCanary = crypto.randomBytes(24).toString('hex');
  }

  async create(timeout = 120_000) {
    const previousCanary = process.env.CODEPILOT_ADVERSARIAL_HOST_CANARY;
    process.env.CODEPILOT_ADVERSARIAL_HOST_CANARY = this.hostCanary;
    try {
      return await Sandbox.create({
        image: 'vercel/sandbox/universal:latest', timeout, resources: { vcpus: 1 }, networkPolicy: 'deny-all',
        persistent: false, ports: [], env: { CI: 'true', CODEPILOT_JOB_ID: `adversarial-${crypto.randomUUID()}` },
        tags: { application: 'codepilot', purpose: 'adversarial-test' }, region: this.region
      });
    } finally {
      if (previousCanary === undefined) delete process.env.CODEPILOT_ADVERSARIAL_HOST_CANARY;
      else process.env.CODEPILOT_ADVERSARIAL_HOST_CANARY = previousCanary;
    }
  }

  async destroy(sandbox) {
    if (!sandbox) return { stopped: true, deleted: true };
    let stopped = false;
    let deleted = false;
    try { await sandbox.stop(); stopped = true; } catch {}
    try { await sandbox.delete({ deleteOrphanSnapshots: true }); deleted = true; } catch {}
    return { stopped, deleted };
  }

  async runNodeProbe(source, { timeoutMs = 15_000, sandboxTimeout = 120_000 } = {}) {
    let sandbox;
    try {
      sandbox = await this.create(sandboxTimeout);
      await sandbox.mkDir('/vercel/sandbox/workspace');
      await sandbox.writeFiles([{ path: '/vercel/sandbox/workspace/attack.js', content: Buffer.from(source), mode: 0o600 }]);
      const command = await sandbox.runCommand({ cmd: 'node', args: ['attack.js'], cwd: '/vercel/sandbox/workspace', env: { CI: 'true', HOME: '/vercel/sandbox' }, timeoutMs });
      const stdout = await command.stdout();
      const stderr = await command.stderr();
      const cleanup = await this.destroy(sandbox);
      sandbox = null;
      const passed = command.exitCode === 0 && cleanup.stopped && cleanup.deleted;
      return {
        status: passed ? HARNESS_STATUS.PASS : HARNESS_STATUS.FAIL,
        actualResult: passed ? 'The attack was denied or contained and the Sandbox was destroyed.' : 'The attack expectation or cleanup failed.',
        evidence: JSON.stringify({ exitCode: command.exitCode, stdout: stdout.slice(-1200), stderr: stderr.slice(-600), cleanup })
      };
    } finally {
      if (sandbox) await this.destroy(sandbox);
    }
  }

  async runScenario(scenario) {
    switch (scenario.number) {
      case 1: return this.runNodeProbe(`
        const fs=require('node:fs');
        const candidates=['/host','/mnt/host','/run/host','/Users/Rishit','/home/runner/work'];
        const accessible=candidates.filter(p=>{try{fs.accessSync(p);return true}catch{return false}});
        const mounts=fs.readFileSync('/proc/mounts','utf8').split('\\n').filter(l=>/\\s(?:\\/host|\\/mnt\\/host|\\/run\\/host)(?:\\s|\\/)/.test(l));
        console.log(JSON.stringify({accessible,suspiciousMountCount:mounts.length})); process.exit(accessible.length||mounts.length?1:0);`);
      case 2: {
        const canaryHash = crypto.createHash('sha256').update(this.hostCanary).digest('hex');
        return this.runNodeProbe(`
          const crypto=require('node:crypto'); const forbidden=/DATABASE|POSTGRES|SESSION|SECRET|TOKEN|API_KEY|BLOB|VERCEL_OIDC|AWS_/i;
          const leakedNames=Object.keys(process.env).filter(k=>forbidden.test(k)&&!['CODEPILOT_JOB_ID'].includes(k));
          const canary=${JSON.stringify(canaryHash)}; const canaryVisible=Object.values(process.env).some(v=>crypto.createHash('sha256').update(String(v)).digest('hex')===canary);
          console.log(JSON.stringify({leakedNames,canaryVisible,environmentNames:Object.keys(process.env).sort()})); process.exit(leakedNames.length||canaryVisible?1:0);`);
      }
      case 3:
        if (!this.databaseHost) return { status: HARNESS_STATUS.BLOCKED, actualResult: 'No non-secret staging database host was provided for the network probe.', evidence: 'TEST_ADVERSARIAL_DB_HOST is absent.' };
        return this.runNodeProbe(tcpProbeScript([[this.databaseHost, this.databasePort]], 'database'));
      case 4: return this.runNodeProbe(fetchProbeScript(['http://169.254.169.254/latest/meta-data/', 'http://169.254.170.2/'], 'metadata'));
      case 5: return this.runNodeProbe(tcpProbeScript([['10.0.0.1', 80], ['172.16.0.1', 80], ['192.168.0.1', 80]], 'private-network'));
      case 6: return this.runNodeProbe(fetchProbeScript(['https://example.com/', 'http://example.com/'], 'outbound-http'));
      case 7: return this.runNodeProbe(`
        const dns=require('node:dns').promises; (async()=>{let resolved=false;let error='';try{await dns.resolve4('example.com');resolved=true}catch(e){error=e.code||e.name}
        console.log(JSON.stringify({resolved,error}));process.exit(resolved?1:0)})()`);
      case 9: return this.runNodeProbe(`
        const fs=require('node:fs'); const targets=['/host/marker','/mnt/host/marker','/run/host/marker']; let escaped=[];
        for(let i=0;i<targets.length;i++){const link='/vercel/sandbox/workspace/link-'+i;try{fs.symlinkSync(targets[i],link);fs.readFileSync(link);escaped.push(targets[i])}catch{}}
        console.log(JSON.stringify({escaped}));process.exit(escaped.length?1:0);`);
      case 10: return this.runNodeProbe(`
        const {spawn}=require('node:child_process'); const children=[]; let error='';
        try{for(let i=0;i<512;i++)children.push(spawn(process.execPath,['-e','setInterval(()=>{},10000)'],{stdio:'ignore'}))}catch(e){error=e.code||e.name}
        setTimeout(()=>{for(const c of children)c.kill('SIGKILL');console.log(JSON.stringify({spawned:children.length,error}));process.exit(0)},500);`, { timeoutMs: 20_000 });
      case 11: return this.runNodeProbe(`
        const {spawnSync}=require('node:child_process'); const code='const a=[];while(true){const b=Buffer.alloc(64*1024*1024,1);a.push(b)}';
        const r=spawnSync(process.execPath,['--max-old-space-size=256','-e',code],{timeout:30000,encoding:'utf8'});
        console.log(JSON.stringify({status:r.status,signal:r.signal,error:r.error&&r.error.code}));process.exit(r.status===0?1:0);`, { timeoutMs: 45_000 });
      case 12: return this.runNodeProbe(`
        const fs=require('node:fs'); const fd=fs.openSync('/vercel/sandbox/workspace/fill.bin','w'); const chunk=Buffer.alloc(64*1024*1024,1); let bytes=0,error='';
        try{while(bytes<70*1024*1024*1024){fs.writeSync(fd,chunk);bytes+=chunk.length}}catch(e){error=e.code||e.name}finally{fs.closeSync(fd)}
        console.log(JSON.stringify({bytes,error}));process.exit(error?0:1);`, { timeoutMs: 10 * 60_000, sandboxTimeout: 12 * 60_000 });
      case 13: return this.outputFlood();
      case 14: return this.commandDeadline();
      case 15: return this.sessionDeadline();
      case 16: return this.isolationProbe('user-workspace');
      case 17: return this.isolationProbe('job-artifact');
      case 18: return this.backgroundPersistence();
      case 19: return this.cancellationProbe();
      case 20: return this.terminationProbe();
      default: return { status: HARNESS_STATUS.NOT_TESTED, actualResult: 'No provider fixture is implemented.', evidence: `scenario=${scenario.number}` };
    }
  }

  async outputFlood() {
    let sandbox;
    try {
      sandbox = await this.create();
      const command = await sandbox.runCommand({ cmd: 'node', args: ['-e', `process.stdout.write('x'.repeat(${this.outputBytes * 3}))`], timeoutMs: 15_000 });
      const provider = new VercelSandboxProvider({ outputBytes: this.outputBytes });
      const output = await provider.collectOutput(null, command);
      const cleanup = await this.destroy(sandbox); sandbox = null;
      const passed = output.outputTruncated && output.actualOutputBytes > this.outputBytes && Buffer.byteLength(output.output) <= this.outputBytes + 64 && cleanup.deleted;
      return { status: passed ? HARNESS_STATUS.PASS : HARNESS_STATUS.FAIL, actualResult: passed ? 'Real provider output was truncated at the configured ceiling.' : 'Output was not bounded as required.', evidence: JSON.stringify({ actualOutputBytes: output.actualOutputBytes, collectedBytes: Buffer.byteLength(output.output), outputTruncated: output.outputTruncated, cleanup }) };
    } finally { if (sandbox) await this.destroy(sandbox); }
  }

  async commandDeadline() {
    let sandbox;
    try {
      sandbox = await this.create();
      let error = null; let command = null;
      try { command = await sandbox.runCommand({ cmd: 'node', args: ['-e', 'while(true){}'], timeoutMs: 1000 }); } catch (caught) { error = caught; }
      const cleanup = await this.destroy(sandbox); sandbox = null;
      const killed = Boolean(error) || (command && command.exitCode !== 0);
      return { status: killed && cleanup.deleted ? HARNESS_STATUS.PASS : HARNESS_STATUS.FAIL, actualResult: killed ? 'Infinite command was terminated by the provider deadline.' : 'Infinite command was not terminated.', evidence: JSON.stringify({ error: error?.name || null, exitCode: command?.exitCode ?? null, cleanup }) };
    } finally { if (sandbox) await this.destroy(sandbox); }
  }

  async sessionDeadline() {
    let sandbox;
    try {
      sandbox = await this.create(3000);
      let error = null; let command = null;
      try { command = await sandbox.runCommand({ cmd: 'node', args: ['-e', 'setTimeout(()=>{},10000)'], timeoutMs: 15_000 }); } catch (caught) { error = caught; }
      const cleanup = await this.destroy(sandbox); sandbox = null;
      const stopped = Boolean(error) || (command && command.exitCode !== 0);
      return { status: stopped && cleanup.deleted ? HARNESS_STATUS.PASS : HARNESS_STATUS.FAIL, actualResult: stopped ? 'Session lifetime stopped the overrun.' : 'Session exceeded its configured lifetime.', evidence: JSON.stringify({ error: error?.name || null, exitCode: command?.exitCode ?? null, cleanup }) };
    } finally { if (sandbox) await this.destroy(sandbox); }
  }

  async isolationProbe(kind) {
    let first; let second;
    const marker = `${kind}-${crypto.randomUUID()}`;
    const markerPath = `/vercel/sandbox/${marker}`;
    try {
      first = await this.create(); second = await this.create();
      await first.writeFiles([{ path: markerPath, content: Buffer.from(marker), mode: 0o600 }]);
      const command = await second.runCommand({ cmd: 'node', args: ['-e', `const fs=require('node:fs');process.exit(fs.existsSync(${JSON.stringify(markerPath)})?1:0)`], timeoutMs: 10_000 });
      const cleanupFirst = await this.destroy(first); first = null;
      const cleanupSecond = await this.destroy(second); second = null;
      const passed = command.exitCode === 0 && cleanupFirst.deleted && cleanupSecond.deleted;
      return { status: passed ? HARNESS_STATUS.PASS : HARNESS_STATUS.FAIL, actualResult: passed ? 'The second Sandbox could not see the first Sandbox marker.' : 'Cross-Sandbox marker access or cleanup failed.', evidence: JSON.stringify({ exitCode: command.exitCode, cleanupFirst, cleanupSecond }) };
    } finally { if (first) await this.destroy(first); if (second) await this.destroy(second); }
  }

  async backgroundPersistence() {
    let sandbox;
    try {
      sandbox = await this.create();
      await sandbox.runCommand({ cmd: 'node', args: ['-e', `setInterval(()=>require('node:fs').appendFileSync('/vercel/sandbox/heartbeat','x'),100)`], detached: true });
      await new Promise((resolve) => setTimeout(resolve, 500));
      const name = sandbox.name;
      const cleanup = await this.destroy(sandbox); sandbox = null;
      let resumed = false;
      try { await Sandbox.get({ name }); resumed = true; } catch {}
      return { status: cleanup.deleted && !resumed ? HARNESS_STATUS.PASS : HARNESS_STATUS.FAIL, actualResult: cleanup.deleted && !resumed ? 'Deleted Sandbox and detached process could not be resumed.' : 'Sandbox remained accessible after deletion.', evidence: JSON.stringify({ cleanup, resumed }) };
    } finally { if (sandbox) await this.destroy(sandbox); }
  }

  async cancellationProbe() {
    let sandbox;
    try {
      sandbox = await this.create();
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 500);
      let error = null; let command = null;
      try { command = await sandbox.runCommand({ cmd: 'node', args: ['-e', 'while(true){}'], signal: controller.signal, timeoutMs: 20_000 }); } catch (caught) { error = caught; }
      const cleanup = await this.destroy(sandbox); sandbox = null;
      const cancelled = controller.signal.aborted && (Boolean(error) || command?.exitCode !== 0);
      return { status: cancelled && cleanup.deleted ? HARNESS_STATUS.PASS : HARNESS_STATUS.FAIL, actualResult: cancelled ? 'Active command was cancelled and Sandbox cleanup completed.' : 'Cancellation did not interrupt the active command.', evidence: JSON.stringify({ aborted: controller.signal.aborted, error: error?.name || null, exitCode: command?.exitCode ?? null, cleanup }) };
    } finally { if (sandbox) await this.destroy(sandbox); }
  }

  async terminationProbe() {
    let sandbox = await this.create();
    const name = sandbox.name;
    const cleanup = await this.destroy(sandbox);
    let commandPossible = false; let lookupPossible = false;
    try { await sandbox.runCommand({ cmd: 'true' }); commandPossible = true; } catch {}
    try { await Sandbox.get({ name }); lookupPossible = true; } catch {}
    sandbox = null;
    const passed = cleanup.stopped && cleanup.deleted && !commandPossible && !lookupPossible;
    return { status: passed ? HARNESS_STATUS.PASS : HARNESS_STATUS.FAIL, actualResult: passed ? 'Stopped/deleted worker became inert and unavailable.' : 'Worker termination could not be established.', evidence: JSON.stringify({ cleanup, commandPossible, lookupPossible }) };
  }
}

function tcpProbeScript(targets, label) {
  return `const net=require('node:net');
  function probe(host,port){return new Promise(r=>{const s=net.connect({host,port});let done=false;const finish=v=>{if(done)return;done=true;s.destroy();r(v)};s.setTimeout(1500,()=>finish(false));s.on('connect',()=>finish(true));s.on('error',()=>finish(false))})}
  (async()=>{const targets=${JSON.stringify(targets)};const results=[];for(const [host,port] of targets)results.push({host,port,connected:await probe(host,port)});console.log(JSON.stringify({label:${JSON.stringify(label)},results}));process.exit(results.some(x=>x.connected)?1:0)})()`;
}

function fetchProbeScript(urls, label) {
  return `(async()=>{const urls=${JSON.stringify(urls)};const results=[];for(const url of urls){let reached=false,error='';try{const r=await fetch(url,{signal:AbortSignal.timeout(2000)});reached=true;error='http-'+r.status}catch(e){error=e.name}results.push({url,reached,error})}console.log(JSON.stringify({label:${JSON.stringify(label)},results}));process.exit(results.some(x=>x.reached)?1:0)})()`;
}

module.exports = { VercelSandboxAdversarialAdapter };
