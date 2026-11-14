const { send } = require('@vercel/queue');

class NonRetryableQueueError extends Error {
  constructor(message, code = 'QUEUE_MESSAGE_REJECTED') { super(message); this.name = 'NonRetryableQueueError'; this.code = code; this.retryable = false; }
}

const TERMINAL_JOB_STATES = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT', 'EXPIRED', 'BLOCKED']);
const DEFAULT_CONSUMER_JOB_TYPES = Object.freeze(['test-execution']);

function validateQueueEnvelope(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) throw new NonRetryableQueueError('Invalid queue message envelope.', 'INVALID_ENVELOPE');
  if (Object.keys(message).sort().join(',') !== 'jobId,outboxId,version' || message.version !== 1) throw new NonRetryableQueueError('Invalid queue message envelope.', 'INVALID_ENVELOPE');
  if (!/^execjob_[0-9a-f-]{36}$/i.test(message.jobId) || !/^outbox_[0-9a-f-]{36}$/i.test(message.outboxId)) {
    throw new NonRetryableQueueError('Invalid queue message identifiers.', 'INVALID_IDENTIFIERS');
  }
  return message;
}

function validateDeliveryMetadata(metadata, expectedTopic) {
  if (!metadata || typeof metadata !== 'object') throw new NonRetryableQueueError('Authenticated queue delivery metadata is required.', 'MISSING_DELIVERY_METADATA');
  if (typeof metadata.messageId !== 'string' || !metadata.messageId || metadata.messageId.length > 256) throw new NonRetryableQueueError('Invalid queue delivery message ID.', 'INVALID_DELIVERY_METADATA');
  if (typeof metadata.topicName !== 'string' || metadata.topicName !== expectedTopic) throw new NonRetryableQueueError('Queue delivery topic does not match the configured topic.', 'TOPIC_MISMATCH');
  if (!Number.isInteger(Number(metadata.deliveryCount)) || Number(metadata.deliveryCount) < 1) throw new NonRetryableQueueError('Invalid queue delivery count.', 'INVALID_DELIVERY_METADATA');
  return metadata;
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
        const messageId = result?.messageId || null;
        await this.store.markOutboxPublished(row.id, messageId);
        results.push({ outboxId: row.id, status: 'PUBLISHED', messageId });
      } catch (error) {
        const failed = await this.store.markOutboxFailure(row.id, error.message);
        results.push({ outboxId: row.id, status: failed.status, error: 'Queue publication failed.' });
      }
    }
    return results;
  }
}

class JobConsumer {
  constructor({ store, orchestrator, workerId, expectedTopic = null, requireMetadata = false, executionEnabled = true, allowedJobTypes = DEFAULT_CONSUMER_JOB_TYPES }) {
    this.store = store;
    this.orchestrator = orchestrator;
    this.workerId = workerId;
    this.expectedTopic = expectedTopic;
    this.requireMetadata = requireMetadata;
    this.executionEnabled = executionEnabled;
    this.allowedJobTypes = new Set(allowedJobTypes);
  }

  async rejectJob(jobId, reason, code) {
    if (jobId) await this.store.blockWorkflowJob(jobId, reason, `queue.${String(code || 'delivery_rejected').toLowerCase()}`);
    throw new NonRetryableQueueError(reason, code);
  }

  async consume(message, metadataOrSignal, maybeSignal) {
    const envelope = validateQueueEnvelope(message);
    const metadata = metadataOrSignal && typeof metadataOrSignal === 'object' && 'messageId' in metadataOrSignal ? metadataOrSignal : null;
    const signal = metadata ? maybeSignal : metadataOrSignal;
    if (this.requireMetadata) validateDeliveryMetadata(metadata, this.expectedTopic);
    const outbox = await this.store.get('SELECT * FROM job_outbox WHERE id=? AND job_id=?', message.outboxId, message.jobId);
    if (!outbox) throw new NonRetryableQueueError('Queue message has no database outbox record.', 'OUTBOX_NOT_FOUND');
    if (outbox.status === 'PENDING') throw Object.assign(new Error('Queue publication is not yet reconciled in the database.'), { code: 'OUTBOX_PENDING', retryable: true });
    if (outbox.status !== 'PUBLISHED') return this.rejectJob(message.jobId, 'Queue message does not reference a published outbox record.', 'OUTBOX_NOT_PUBLISHED');
    let storedEnvelope;
    try { storedEnvelope = JSON.parse(outbox.payload); } catch { return this.rejectJob(message.jobId, 'Published outbox payload is malformed.', 'OUTBOX_PAYLOAD_INVALID'); }
    try { validateQueueEnvelope(storedEnvelope); } catch { return this.rejectJob(message.jobId, 'Published outbox payload is malformed.', 'OUTBOX_PAYLOAD_INVALID'); }
    if (storedEnvelope.version !== envelope.version || storedEnvelope.jobId !== envelope.jobId || storedEnvelope.outboxId !== envelope.outboxId) {
      return this.rejectJob(message.jobId, 'Queue message does not match its transactional outbox payload.', 'OUTBOX_PAYLOAD_MISMATCH');
    }
    if (this.expectedTopic && outbox.topic !== this.expectedTopic) return this.rejectJob(message.jobId, 'Outbox topic does not match the configured consumer topic.', 'OUTBOX_TOPIC_MISMATCH');
    if (metadata?.topicName && metadata.topicName !== outbox.topic) return this.rejectJob(message.jobId, 'Delivery topic does not match the transactional outbox topic.', 'DELIVERY_TOPIC_MISMATCH');
    if (metadata?.messageId && outbox.queue_message_id && metadata.messageId !== outbox.queue_message_id) return this.rejectJob(message.jobId, 'Delivery message ID does not match the published outbox record.', 'MESSAGE_ID_MISMATCH');

    const job = await this.store.get('SELECT * FROM execution_jobs WHERE id=? AND project_id IS NOT NULL AND actor_id IS NOT NULL', message.jobId);
    if (!job) throw new NonRetryableQueueError('Queue message has no owned database job.', 'JOB_NOT_FOUND');
    const actor = await this.store.get('SELECT id, is_global_admin FROM users WHERE id=?', job.actor_id);
    const access = actor ? await this.store.getProjectAccess(job.project_id, actor) : null;
    if (!access) return this.rejectJob(job.id, 'Job actor is not authorized for the referenced project.', 'JOB_OWNER_MISMATCH');
    if (job.revision_id && !(await this.store.get('SELECT id FROM revisions WHERE id=? AND project_id=?', job.revision_id, job.project_id))) {
      return this.rejectJob(job.id, 'Job revision does not belong to the referenced project.', 'JOB_REVISION_MISMATCH');
    }
    if (!this.allowedJobTypes.has(job.job_type)) return this.rejectJob(job.id, `Unsupported consumer job type: ${job.job_type}.`, 'UNSUPPORTED_JOB_TYPE');
    if (!this.executionEnabled) return this.rejectJob(job.id, 'Execution release verification is false; the worker cannot receive this job.', 'EXECUTION_RELEASE_BLOCKED');
    if (!this.orchestrator) return this.rejectJob(job.id, 'No authorized job processor is configured.', 'PROCESSOR_UNAVAILABLE');

    const claimed = await this.store.claimExecutionJob(message.jobId, this.workerId, 90_000);
    if (!claimed) {
      const existing = await this.store.get('SELECT status FROM execution_jobs WHERE id=?', message.jobId);
      if (existing && (TERMINAL_JOB_STATES.has(existing.status) || ['RUNNING', 'CANCEL_REQUESTED'].includes(existing.status))) {
        await this.store.recordOperationalEvent('queue.duplicate_delivery', 'info', job.project_id, null, `job=${job.id}; status=${existing.status}; message=${metadata?.messageId || 'unknown'}`);
        return { duplicate: true, status: existing.status };
      }
      throw Object.assign(new Error('Job is not currently claimable.'), { code: 'JOB_NOT_CLAIMABLE', retryable: true });
    }
    await this.store.audit('queue.delivery_claimed', claimed.project_id, `Claimed queue delivery for job ${claimed.id}`, claimed.actor_id);
    try {
      const result = await this.orchestrator.execute(claimed, this.workerId, signal);
      await this.store.recordOperationalEvent('queue.delivery_completed', 'info', claimed.project_id, null, `job=${claimed.id}; message=${metadata?.messageId || 'unknown'}`);
      return result;
    } catch (error) {
      await this.store.recordOperationalEvent('queue.delivery_failed', error?.retryable === false ? 'error' : 'warning', claimed.project_id, null, `job=${claimed.id}; code=${error?.code || 'PROCESSING_ERROR'}`);
      throw error;
    }
  }
}

module.exports = { VercelQueuePublisher, OutboxDispatcher, JobConsumer, NonRetryableQueueError, validateQueueEnvelope, validateDeliveryMetadata, DEFAULT_CONSUMER_JOB_TYPES };
