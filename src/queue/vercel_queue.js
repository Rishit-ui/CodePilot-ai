const { send } = require('@vercel/queue');

class NonRetryableQueueError extends Error {
  constructor(message) { super(message); this.name = 'NonRetryableQueueError'; this.retryable = false; }
}

class VercelQueuePublisher {
  constructor({ region = 'iad1' } = {}) { this.region = region; }
  async publish(outbox) {
    const payload = JSON.parse(outbox.payload);
    if (Object.keys(payload).sort().join(',') !== 'jobId,outboxId,version' || payload.version !== 1) throw new Error('Invalid queue envelope.');
    return send(outbox.topic, payload, {
      idempotencyKey: outbox.idempotency_key,
      retentionSeconds: 24 * 60 * 60,
      region: this.region
    });
  }
}

class OutboxDispatcher {
  constructor({ store, publisher }) { this.store = store; this.publisher = publisher; }
  async dispatch(limit = 10) {
    const rows = await this.store.pendingOutbox(limit);
    const results = [];
    for (const row of rows) {
      try {
        const result = await this.publisher.publish(row);
        await this.store.markOutboxPublished(row.id, result.messageId || null);
        results.push({ outboxId: row.id, status: 'PUBLISHED', messageId: result.messageId || null });
      } catch (error) {
        const failed = await this.store.markOutboxFailure(row.id, error.message);
        results.push({ outboxId: row.id, status: failed.status, error: 'Queue publication failed.' });
      }
    }
    return results;
  }
}

class JobConsumer {
  constructor({ store, orchestrator, workerId }) { this.store = store; this.orchestrator = orchestrator; this.workerId = workerId; }
  async consume(message, signal) {
    if (!message || message.version !== 1 || typeof message.jobId !== 'string' || typeof message.outboxId !== 'string' || Object.keys(message).length !== 3) {
      throw new NonRetryableQueueError('Invalid queue message envelope.');
    }
    const outbox = await this.store.get('SELECT * FROM job_outbox WHERE id=? AND job_id=?', message.outboxId, message.jobId);
    if (!outbox || outbox.status !== 'PUBLISHED') throw new NonRetryableQueueError('Queue message has no published database outbox record.');
    const claimed = await this.store.claimExecutionJob(message.jobId, this.workerId, 90_000);
    if (!claimed) {
      const existing = await this.store.get('SELECT status FROM execution_jobs WHERE id=?', message.jobId);
      if (existing && ['RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT', 'EXPIRED'].includes(existing.status)) return { duplicate: true, status: existing.status };
      throw new Error('Job is not claimable.');
    }
    return this.orchestrator.execute(claimed, this.workerId, signal);
  }
}

module.exports = { VercelQueuePublisher, OutboxDispatcher, JobConsumer, NonRetryableQueueError };
