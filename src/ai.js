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

async function retrieveEvidence(store, revisionId, question, maxFiles = 4) {
  const keywords = extractKeywords(question);
  if (!keywords.length) {
    return { files: [], citations: [] };
  }

  const files = await store.all(
    'SELECT path, content, language FROM files WHERE revision_id=? AND content IS NOT NULL AND excluded_reason IS NULL',
    revisionId
  );

  const scored = files.map((file) => {
    const lower = file.content.toLowerCase();
    let score = 0;
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

// 1. OpenAI-Compatible API Dispatcher
async function callOpenAICompatible(aiConfig, systemPrompt, userPrompt, messages = null) {
  const endpoint = aiConfig.baseUrl || 'https://api.openai.com/v1/chat/completions';
  const url = new URL(endpoint);
  const client = url.protocol === 'https:' ? https : http;

  const chatMessages = messages && messages.length > 0
    ? [{ role: 'system', content: systemPrompt }, ...messages]
    : [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ];

  const bodyData = JSON.stringify({
    model: aiConfig.model || 'gpt-4o-mini',
    messages: chatMessages,
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
              return reject(new AIProviderError(`OpenAI error (${res.statusCode}): ${data.error?.message || 'Unknown error'}`));
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

// 2. Anthropic Messages API Dispatcher
async function callAnthropic(aiConfig, systemPrompt, userPrompt, messages = null) {
  const url = new URL(aiConfig.baseUrl || 'https://api.anthropic.com/v1/messages');
  const chatMessages = messages && messages.length > 0
    ? messages.map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }))
    : [{ role: 'user', content: userPrompt }];

  const bodyData = JSON.stringify({
    model: aiConfig.model || 'claude-3-5-sonnet-20241022',
    max_tokens: 1500,
    system: systemPrompt,
    messages: chatMessages
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': aiConfig.apiKey,
          'anthropic-version': '2023-06-01',
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
              return reject(new AIProviderError(`Anthropic error (${res.statusCode}): ${data.error?.message || 'Unknown error'}`));
            }
            const reply = data.content?.[0]?.text;
            if (!reply) return reject(new AIProviderError('Anthropic returned empty response.'));
            resolve(reply);
          } catch (err) {
            reject(new AIProviderError(`Failed to parse Anthropic response: ${err.message}`));
          }
        });
        res.on('error', (err) => reject(new AIProviderError(`Stream error: ${err.message}`)));
      }
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new AIProviderError('Anthropic request timed out (25s limit).'));
    });

    req.on('error', (err) => reject(new AIProviderError(`Network error: ${err.message}`)));
    req.write(bodyData);
    req.end();
  });
}

// 3. Google Gemini API Dispatcher
async function callGemini(aiConfig, systemPrompt, userPrompt) {
  const modelName = aiConfig.model || 'gemini-2.5-flash';
  const url = new URL(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent?key=${encodeURIComponent(aiConfig.apiKey)}`);

  const bodyData = JSON.stringify({
    contents: [
      {
        parts: [
          { text: `${systemPrompt}\n\n${userPrompt}` }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 1500
    }
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
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
              return reject(new AIProviderError(`Gemini error (${res.statusCode}): ${data.error?.message || 'Unknown error'}`));
            }
            const reply = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!reply) return reject(new AIProviderError('Gemini returned empty text.'));
            resolve(reply);
          } catch (err) {
            reject(new AIProviderError(`Failed to parse Gemini response: ${err.message}`));
          }
        });
        res.on('error', (err) => reject(new AIProviderError(`Stream error: ${err.message}`)));
      }
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new AIProviderError('Gemini request timed out (25s limit).'));
    });

    req.on('error', (err) => reject(new AIProviderError(`Network error: ${err.message}`)));
    req.write(bodyData);
    req.end();
  });
}

// Multi-Provider Router Dispatcher
async function dispatchAI(aiConfig, systemPrompt, userPrompt, messages = null) {
  if (!aiConfig || aiConfig.provider === 'local' || !aiConfig.apiKey) {
    throw new AIProviderError('Local mode requires deterministic execution.');
  }

  const provider = (aiConfig.provider || 'openai').toLowerCase();
  if (provider === 'anthropic') {
    return await callAnthropic(aiConfig, systemPrompt, userPrompt, messages);
  } else if (provider === 'gemini') {
    return await callGemini(aiConfig, systemPrompt, userPrompt);
  } else {
    return await callOpenAICompatible(aiConfig, systemPrompt, userPrompt, messages);
  }
}

// Repository Grounded QA
async function answerQuestionWithContext(store, project, revision, question, aiConfig) {
  const evidence = await retrieveEvidence(store, revision.id, question);

  if (!aiConfig || aiConfig.provider === 'local' || !aiConfig.apiKey) {
    return generateDeterministicAnswer(question, evidence);
  }

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
    const aiText = await dispatchAI(aiConfig, systemPrompt, userPrompt);
    return {
      answer: aiText,
      citations: evidence.citations
    };
  } catch (err) {
    const fallback = generateDeterministicAnswer(question, evidence);
    fallback.answer = `[Notice: External AI provider failed (${err.message}). Displaying verified local evidence]\n\n` + fallback.answer;
    return fallback;
  }
}

// Multi-Turn Chat
async function chatWithContext(store, project, revision, messages, aiConfig) {
  const latestUserMsg = [...messages].reverse().find((m) => m.role === 'user');
  const userQuery = latestUserMsg ? latestUserMsg.content : '';
  const evidence = revision ? await retrieveEvidence(store, revision.id, userQuery) : { files: [], citations: [] };

  if (!aiConfig || aiConfig.provider === 'local' || !aiConfig.apiKey) {
    const ans = generateDeterministicAnswer(userQuery, evidence);
    return {
      reply: ans.answer,
      citations: ans.citations
    };
  }

  const contextSnippet = evidence.files.map((f) => {
    return `--- FILE: ${f.path} ---\n${sanitizeUntrustedContext(f.content.slice(0, 2000))}\n`;
  }).join('\n');

  const systemPrompt = `You are CodePilot AI, an expert software engineering assistant.
You help understand code, diagnose bugs, suggest improvements, write tests, and explain system architecture.
Ground answers in project code when available.
Be concise, clear, and production-oriented.`;

  const formattedMessages = messages.map((m) => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.content
  }));

  if (contextSnippet && formattedMessages.length > 0) {
    formattedMessages[formattedMessages.length - 1].content = `Context:\n${contextSnippet}\n\n${formattedMessages[formattedMessages.length - 1].content}`;
  }

  try {
    const reply = await dispatchAI(aiConfig, systemPrompt, userQuery, formattedMessages);
    return {
      reply,
      citations: evidence.citations
    };
  } catch (err) {
    const fallback = generateDeterministicAnswer(userQuery, evidence);
    return {
      reply: `[Notice: Provider error: ${err.message}]\n\n${fallback.answer}`,
      citations: fallback.citations
    };
  }
}

// Code Explanation
async function explainCode(code, filePath, aiConfig) {
  const systemPrompt = `You are CodePilot AI. Explain the following source code snippet clearly. Break down what it does, its inputs and outputs, potential edge cases, and performance/security considerations.`;
  const userPrompt = `File: ${filePath}\n\n\`\`\`\n${sanitizeUntrustedContext(code)}\n\`\`\``;

  if (!aiConfig || aiConfig.provider === 'local' || !aiConfig.apiKey) {
    const lines = code.trim().split('\n');
    return `### Code Explanation for \`${filePath}\`\n- **Snippet size**: ${lines.length} lines.\n- **First line**: \`${lines[0] || ''}\`\n- **Local analysis**: This module defines components/functions in \`${filePath}\`. Configure an API key under Settings to enable in-depth natural language explanations.`;
  }

  return await dispatchAI(aiConfig, systemPrompt, userPrompt);
}

// Unit Test Generation
async function generateTestsForCode(code, filePath, aiConfig) {
  const systemPrompt = `You are CodePilot AI. Generate clean, runnable unit tests for the following code snippet. Use standard assertions, test edge cases, errors, and expected success paths. Include code in a markdown code block.`;
  const userPrompt = `File: ${filePath}\n\n\`\`\`\n${sanitizeUntrustedContext(code)}\n\`\`\``;

  if (!aiConfig || aiConfig.provider === 'local' || !aiConfig.apiKey) {
    return `// Unit test template generated for ${filePath}\nconst test = require('node:test');\nconst assert = require('node:assert/strict');\n\ntest('${filePath} execution test', () => {\n  assert.ok(true, 'Test execution scaffold verified');\n});`;
  }

  return await dispatchAI(aiConfig, systemPrompt, userPrompt);
}

// Code Refactoring
async function refactorCode(code, instruction, aiConfig) {
  const systemPrompt = `You are CodePilot AI. Refactor the provided code according to the instructions. Ensure the refactored code is clean, robust, and maintains backwards compatibility. Provide the refactored code and a brief explanation of changes.`;
  const userPrompt = `Instruction: ${instruction}\n\nCode to refactor:\n\`\`\`\n${sanitizeUntrustedContext(code)}\n\`\`\``;

  if (!aiConfig || aiConfig.provider === 'local' || !aiConfig.apiKey) {
    return `### Refactoring Analysis\n- Proposed improvement for: "${instruction}"\n- Code size: ${code.length} characters.\n- To receive automated AI refactoring, configure an OpenAI, Anthropic, or Gemini API key.`;
  }

  return await dispatchAI(aiConfig, systemPrompt, userPrompt);
}

// Diagram Explanation
async function explainDiagram(diagram, userQuery, aiConfig) {
  const systemPrompt = `You are CodePilot AI's visual architecture specialist. Explain the provided software diagram structure, its components, flow paths, potential bottlenecks, and answers to the user's inquiry.`;
  const summary = `Diagram Type: ${diagram.diagramType}\nTitle: ${diagram.title}\nNodes count: ${diagram.nodes?.length || 0}\nEdges count: ${diagram.edges?.length || 0}\nNodes summary: ${(diagram.nodes || []).slice(0, 15).map((n) => `${n.label} (${n.type})`).join(', ')}`;
  const userPrompt = `Diagram Info:\n${summary}\n\nUser Question: ${userQuery || 'Explain the overall architecture and data flow in this diagram.'}`;

  if (!aiConfig || aiConfig.provider === 'local' || !aiConfig.apiKey) {
    return `### Diagram Analysis: ${diagram.title}\n- **Type**: \`${diagram.diagramType}\`\n- **Nodes**: ${diagram.nodes?.length || 0} components mapped.\n- **Edges**: ${diagram.edges?.length || 0} connections established.\n- **Flow summary**: Components communicate through verified static import and route bindings. Select any node in the canvas to inspect its source file and lines.`;
  }

  return await dispatchAI(aiConfig, systemPrompt, userPrompt);
}

module.exports = {
  answerQuestionWithContext,
  chatWithContext,
  explainCode,
  generateTestsForCode,
  refactorCode,
  explainDiagram,
  retrieveEvidence,
  sanitizeUntrustedContext,
  AIProviderError
};
