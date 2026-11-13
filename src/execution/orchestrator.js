class ExecutionOrchestrator {
  constructor({ store, provider, workspaceLoader, artifactWriter = null }) {
    this.store = store;
    this.provider = provider;
    this.workspaceLoader = workspaceLoader;
    this.artifactWriter = artifactWriter;
  }

  async execute(job, workerId, signal) {
    let handle = null;
    const started = Date.now();
    try {
      const current = await this.store.get('SELECT * FROM execution_jobs WHERE id=?', job.id);
      if (!current || Number(current.cancel_requested)) throw Object.assign(new Error('Job was cancelled before sandbox creation.'), { code: 'CANCELLED' });
      const files = await this.workspaceLoader(current);
      const sandboxStartedAt = Date.now();
      handle = await this.provider.createSandbox(current);
      await this.store.recordResourceUsage(current.actor_id, current.project_id, current.id, 'sandbox_startup_ms', Date.now() - sandboxStartedAt, 'ms');
      await this.store.run('UPDATE execution_jobs SET provider=?, provider_execution_id=?, progress_stage=?, updated_at=? WHERE id=? AND lease_owner=?', this.provider.name, handle.id, 'sandbox-created', new Date().toISOString(), current.id, workerId);
      await this.provider.uploadWorkspace(handle, files);
      await this.store.run("UPDATE execution_jobs SET progress_stage='executing', updated_at=? WHERE id=? AND lease_owner=?", new Date().toISOString(), current.id, workerId);
      const command = await this.provider.executeCommand(handle, current.execution_profile, signal);
      const output = await this.provider.collectOutput(handle, command);
      await this.store.recordResourceUsage(current.actor_id, current.project_id, current.id, 'output_bytes', output.actualOutputBytes || Buffer.byteLength(output.output || ''), 'bytes');
      const artifacts = await this.provider.collectArtifacts(handle, current);
      if (this.artifactWriter) {
        for (const artifact of artifacts) await this.artifactWriter(current, artifact);
      }
      const result = {
        status: output.exitCode === 0 ? 'PASS' : 'FAIL',
        executed: true,
        exitCode: output.exitCode,
        durationMs: output.durationMs,
        output: output.output,
        outputTruncated: output.outputTruncated,
        provider: this.provider.name,
        providerExecutionId: handle.id
      };
      const completed = await this.store.completeExecutionJob(current.id, workerId, result, this.provider.name, handle.id);
      if (!completed) throw new Error('Job completion lost its lease or was cancelled.');
      await this.store.recordResourceUsage(current.actor_id, current.project_id, current.id, 'worker_duration_ms', Date.now() - started, 'ms');
      return completed;
    } catch (error) {
      const timedOut = error?.name === 'TimeoutError' || /timed? out|timeout/i.test(error?.message || '');
      await this.store.failWorkflowJob(job.id, workerId, error?.code === 'CANCELLED' ? 'Cancelled before execution' : error.message, { timedOut });
      throw error;
    } finally {
      if (handle) {
        await this.provider.terminateSandbox(handle).catch(async (error) => {
          await this.store.recordOperationalEvent('sandbox.termination_failed', 'error', job.project_id, null, `job=${job.id}; provider=${this.provider.name}; ${error.message}`);
        });
        await this.store.recordResourceUsage(job.actor_id, job.project_id, job.id, 'sandbox_terminated', 1, 'count').catch(() => {});
      }
    }
  }
}

module.exports = { ExecutionOrchestrator };
