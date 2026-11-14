const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

class AIProviderError extends Error {
  constructor(message, status = 502, { retryable = false, provider = 'unknown' } = {}) {
    super(message);
    this.name = 'AIProviderError';
    this.status = status;
    this.retryable = retryable;
    this.provider = provider;
  }
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function parseRetryAfter(value, capMs) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.min(capMs, Math.max(0, seconds * 1000));
  const dateMs = Date.parse(value);
  return Number.isFinite(dateMs) ? Math.min(capMs, Math.max(0, dateMs - Date.now())) : 0;
}

function safeProviderError(provider, status) {
  const retryable = RETRYABLE_STATUS.has(status);
  const publicStatus = status === 401 || status === 403 ? 401 : status === 429 ? 429 : 502;
  return new AIProviderError(`${provider} provider request failed with HTTP ${status}.`, publicStatus, { retryable, provider });
}

async function requestJson({ provider, url, headers, body, timeoutMs, maxResponseBytes }) {
  const target = new URL(url);
  if (!['https:', 'http:'].includes(target.protocol)) throw new AIProviderError('AI provider URL must use HTTP or HTTPS.', 500, { provider });
  const client = target.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };
    const request = client.request(target, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: timeoutMs
    }, (response) => {
      const chunks = [];
      let bytes = 0;
      response.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > maxResponseBytes) {
          response.destroy();
          finish(reject, new AIProviderError(`${provider} response exceeded ${maxResponseBytes} bytes.`, 502, { provider }));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        if (settled) return;
        if (response.statusCode < 200 || response.statusCode >= 300) {
          const error = safeProviderError(provider, response.statusCode || 502);
          error.retryAfterMs = parseRetryAfter(response.headers['retry-after'], 2_000);
          finish(reject, error);
          return;
        }
        try {
          finish(resolve, JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          finish(reject, new AIProviderError(`${provider} returned malformed JSON.`, 502, { provider }));
        }
      });
      response.on('error', (error) => finish(reject, new AIProviderError(`${provider} response stream failed: ${error.code || 'stream error'}.`, 502, { retryable: true, provider })));
    });
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', (error) => {
      const timedOut = error.message === 'timeout';
      finish(reject, new AIProviderError(timedOut ? `${provider} request timed out.` : `${provider} network request failed.`, 502, { retryable: true, provider }));
    });
    request.end(body);
  });
}

async function withRetry(config, operation) {
  const retries = Math.min(Math.max(Number(config.maxRetries ?? 2), 0), 3);
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try { return await operation(); } catch (error) {
      lastError = error;
      if (!error.retryable || attempt === retries) throw error;
      const backoff = Math.min(2_000, 100 * (2 ** attempt));
      await sleep(error.retryAfterMs || backoff);
    }
  }
  throw lastError;
}

function requestOptions(aiConfig, provider) {
  return {
    provider,
    timeoutMs: Math.min(Math.max(Number(aiConfig.timeoutMs || 25_000), 250), 120_000),
    maxResponseBytes: Math.min(Math.max(Number(aiConfig.maxResponseBytes || 1024 * 1024), 1024), 4 * 1024 * 1024)
  };
}

async function callOpenAICompatible(aiConfig, systemPrompt, userPrompt, messages) {
  const chatMessages = messages?.length
    ? [{ role: 'system', content: systemPrompt }, ...messages]
    : [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }];
  const body = JSON.stringify({ model: aiConfig.model || 'gpt-4o-mini', messages: chatMessages, temperature: 0.2, max_tokens: 1500 });
  const data = await withRetry(aiConfig, () => requestJson({
    ...requestOptions(aiConfig, 'OpenAI'),
    url: aiConfig.baseUrl || 'https://api.openai.com/v1/chat/completions',
    headers: { Authorization: `Bearer ${aiConfig.apiKey}` },
    body
  }));
  const reply = data?.choices?.[0]?.message?.content;
  if (typeof reply !== 'string' || !reply.trim()) throw new AIProviderError('OpenAI returned an invalid completion shape.', 502, { provider: 'OpenAI' });
  return reply;
}

async function callAnthropic(aiConfig, systemPrompt, userPrompt, messages) {
  const chatMessages = messages?.length
    ? messages.map((message) => ({ role: message.role === 'user' ? 'user' : 'assistant', content: message.content }))
    : [{ role: 'user', content: userPrompt }];
  const body = JSON.stringify({ model: aiConfig.model || 'claude-sonnet-4-5', max_tokens: 1500, system: systemPrompt, messages: chatMessages });
  const data = await withRetry(aiConfig, () => requestJson({
    ...requestOptions(aiConfig, 'Anthropic'),
    url: aiConfig.baseUrl || 'https://api.anthropic.com/v1/messages',
    headers: { 'x-api-key': aiConfig.apiKey, 'anthropic-version': '2023-06-01' },
    body
  }));
  const reply = data?.content?.find((item) => item?.type === 'text')?.text;
  if (typeof reply !== 'string' || !reply.trim()) throw new AIProviderError('Anthropic returned an invalid message shape.', 502, { provider: 'Anthropic' });
  return reply;
}

async function callGemini(aiConfig, systemPrompt, userPrompt) {
  const model = aiConfig.model || 'gemini-2.5-flash';
  const endpoint = aiConfig.baseUrl || `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const url = new URL(endpoint.replace('{model}', encodeURIComponent(model)));
  url.searchParams.set('key', aiConfig.apiKey);
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 1500 }
  });
  const data = await withRetry(aiConfig, () => requestJson({ ...requestOptions(aiConfig, 'Gemini'), url, headers: {}, body }));
  const reply = data?.candidates?.[0]?.content?.parts?.find((part) => typeof part?.text === 'string')?.text;
  if (typeof reply !== 'string' || !reply.trim()) throw new AIProviderError('Gemini returned an invalid completion shape.', 502, { provider: 'Gemini' });
  return reply;
}

async function dispatchAI(aiConfig, systemPrompt, userPrompt, messages = null) {
  if (!aiConfig || aiConfig.provider === 'local' || !aiConfig.apiKey) throw new AIProviderError('External AI provider is not configured.', 503);
  const provider = String(aiConfig.provider).toLowerCase();
  if (provider === 'openai') return callOpenAICompatible(aiConfig, systemPrompt, userPrompt, messages);
  if (provider === 'anthropic') return callAnthropic(aiConfig, systemPrompt, userPrompt, messages);
  if (provider === 'gemini') return callGemini(aiConfig, systemPrompt, userPrompt);
  throw new AIProviderError(`Unsupported AI provider: ${provider}.`, 500);
}

module.exports = { AIProviderError, dispatchAI, requestJson, parseRetryAfter };
