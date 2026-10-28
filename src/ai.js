const https = require('node:https');
const http = require('node:http');
const { URL } = require('node:url');

class AIProviderError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = 'AIProviderError';
    this.status = status;
  }
}

function sanitizeUntrustedContext(text) {
  if (!text) return '';
  // Prevent prompt injection vectors trying to impersonate system role
  return text
    .replace(/<\|im_start\|>/g, '[SANITIZED]')
    .replace(/<\|im_end\|>/g, '[SANITIZED]')
    .replace(/\[SYSTEM_PROMPT\]/gi, '[SANITIZED]')
    .replace(/```(?:system|instruction)/gi, '```text');
}

function extractKeywords(question) {
  const words = question.toLowerCase().match(/[a-z0-9_\-\.]{2,}/g) || [];
  const stopWords = new Set(['the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'any', 'can', 'had', 'her', 'was', 'one', 'our', 'out', 'day', 'get', 'has', 'him', 'his', 'how', 'man', 'new', 'now', 'old', 'see', 'two', 'way', 'who', 'boy', 'did', 'its', 'let', 'put', 'say', 'she', 'too', 'use', 'what', 'where', 'when', 'which', 'there', 'their', 'about', 'would', 'these', 'other', 'words', 'could', 'write', 'first', 'water', 'after', 'where', 'right', 'think', 'three', 'years', 'place', 'sound', 'great', 'again', 'still', 'every', 'small', 'found', 'those', 'never', 'under', 'might', 'while', 'house', 'world', 'below', 'asked', 'going', 'large', 'until', 'along', 'shall', 'being', 'often', 'earth', 'began', 'since', 'study', 'night', 'light', 'above', 'paper', 'parts', 'young', 'story', 'point', 'times', 'heard', 'whole', 'white', 'given', 'means', 'music', 'miles', 'thing', 'today', 'later', 'using', 'money', 'lines', 'order', 'group', 'among', 'learn', 'known', 'space', 'table', 'early', 'trees', 'short', 'hands', 'state', 'black', 'shown', 'stood', 'front', 'voice', 'kinds', 'makes', 'comes', 'close', 'power', 'lived', 'vowel', 'taken', 'built', 'heart', 'ready', 'quite', 'class', 'bring', 'round']);
  return [...new Set(words.filter((w) => !stopWords.has(w)))].slice(0, 16);
}

function retrieveEvidence(store, revisionId, question, maxFiles = 4) {
  const keywords = extractKeywords(question);
  if (!keywords.length) {
    return { files: [], citations: [] };
  }

  const files = store.all(
    'SELECT path, content, language FROM files WHERE revision_id=? AND content IS NOT NULL AND excluded_reason IS NULL',
    revisionId
  );

  const scored = files.map((file) => {
    const lower = file.content.toLowerCase();
    let score = 0;
    // Boost matching filename
    const pathLower = file.path.toLowerCase();
    for (const kw of keywords) {
      if (pathLower.includes(kw)) score += 5;
      const count = (lower.match(new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\b`, 'g')) || []).length;
      score += count;
    }
    return { ...file, score };
  })
  .filter((f) => f.score > 0)
  .sort((a, b) => b.score - a.score)
  .slice(0, maxFiles);

  const citations = [];
  scored.forEach((file) => {
    const lines = file.content.split(/\r?\n/);
    lines.forEach((line, idx) => {
      const lineLower = line.toLowerCase();
      if (keywords.some((kw) => lineLower.includes(kw)) && citations.length < 8) {
        citations.push({
          path: file.path,
          line: idx + 1,
          excerpt: line.trim().slice(0, 200)
        });
      }
    });
  });

  return { files: scored, citations };
}

function generateDeterministicAnswer(question, evidence) {
  if (!evidence.citations.length) {
    return {
      answer: 'No direct source evidence was found matching the keywords in your question for this revision. Try searching for specific symbol names, file paths, endpoints, or environment variables.',
      citations: []
    };
  }

  const uniqueFiles = [...new Set(evidence.citations.map((c) => c.path))];
  const summary = `Found verifiable evidence in ${uniqueFiles.join(', ')}.\n\nKey code references:\n` +
    evidence.citations.map((c) => `- \`${c.path}:${c.line}\`: "${c.excerpt}"`).join('\n') +
    `\n\nThis deterministic local assistant quotes ground-truth source lines and does not extrapolate unverified claims.`;

  return {
    answer: summary,
    citations: evidence.citations
  };
}

async function callOpenAICompatible(aiConfig, systemPrompt, userPrompt) {
  const endpoint = aiConfig.baseUrl || 'https://api.openai.com/v1/chat/completions';
  const url = new URL(endpoint);
  const client = url.protocol === 'https:' ? https : http;

  const bodyData = JSON.stringify({
    model: aiConfig.model || 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.2,
    max_tokens: 1500
  });

  return new Promise((resolve, reject) => {
    const req = client.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${aiConfig.apiKey}`,
          'Content-Length': Buffer.byteLength(bodyData)
        },
        timeout: 25000
      },
      (res) => {
        const chunks = [];
        res.on('data', (d) => chunks.push(d));
        res.on('end', () => {
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (res.statusCode !== 200) {
              return reject(new AIProviderError(`API error (${res.statusCode}): ${data.error?.message || 'Unknown provider error'}`));
            }
            const reply = data.choices?.[0]?.message?.content;
            if (!reply) return reject(new AIProviderError('Provider returned empty completion.'));
            resolve(reply);
          } catch (err) {
            reject(new AIProviderError(`Failed to parse AI response: ${err.message}`));
          }
        });
        res.on('error', (err) => reject(new AIProviderError(`Stream error: ${err.message}`)));
      }
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new AIProviderError('AI provider request timed out (25s limit).'));
    });

    req.on('error', (err) => reject(new AIProviderError(`Network error: ${err.message}`)));
    req.write(bodyData);
    req.end();
  });
}

async function answerQuestionWithContext(store, project, revision, question, aiConfig) {
  const evidence = retrieveEvidence(store, revision.id, question);

  // If local provider or no API key, use verified deterministic evidence synthesis
  if (!aiConfig || aiConfig.provider === 'local' || !aiConfig.apiKey) {
    return generateDeterministicAnswer(question, evidence);
  }

  // Construct grounded prompt with citations
  const contextSnippet = evidence.files.map((f) => {
    return `--- FILE: ${f.path} ---\n${sanitizeUntrustedContext(f.content.slice(0, 3000))}\n`;
  }).join('\n');

  const systemPrompt = `You are CodePilot AI, a codebase intelligence assistant.
Answer questions strictly based on the provided repository evidence.
Always cite exact files and line numbers whenever referencing code.
If evidence is missing or uncertain, state clearly what could not be determined.
Do not hallucinate files or dependencies.`;

  const userPrompt = `Project: ${project.name} (Revision: ${revision.id})\n\nRepository Evidence:\n${contextSnippet}\n\nUser Question: ${question}\n\nPlease provide a clear, accurate, and evidence-grounded answer:`;

  try {
    const aiText = await callOpenAICompatible(aiConfig, systemPrompt, userPrompt);
    return {
      answer: aiText,
      citations: evidence.citations
    };
  } catch (err) {
    // Graceful fallback to deterministic evidence if remote provider fails
    const fallback = generateDeterministicAnswer(question, evidence);
    fallback.answer = `[Notice: External AI provider failed (${err.message}). Displaying verified local evidence]\n\n` + fallback.answer;
    return fallback;
  }
}

module.exports = {
  answerQuestionWithContext,
  retrieveEvidence,
  sanitizeUntrustedContext,
  AIProviderError
};
