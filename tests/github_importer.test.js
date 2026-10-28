const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeGithubRepoUrl } = require('../src/importer');

test('normalizeGithubRepoUrl converts all GitHub repo link formats into valid archive zip URLs', () => {
  // Standard repo URL
  assert.equal(
    normalizeGithubRepoUrl('https://github.com/Rishit-ui/CodePilot-ai'),
    'https://github.com/Rishit-ui/CodePilot-ai/archive/refs/heads/main.zip'
  );

  // Trailing slash
  assert.equal(
    normalizeGithubRepoUrl('https://github.com/Rishit-ui/CodePilot-ai/'),
    'https://github.com/Rishit-ui/CodePilot-ai/archive/refs/heads/main.zip'
  );

  // With .git suffix
  assert.equal(
    normalizeGithubRepoUrl('https://github.com/Rishit-ui/CodePilot-ai.git'),
    'https://github.com/Rishit-ui/CodePilot-ai/archive/refs/heads/main.zip'
  );

  // Specific branch tree
  assert.equal(
    normalizeGithubRepoUrl('https://github.com/expressjs/express/tree/master'),
    'https://github.com/expressjs/express/archive/refs/heads/master.zip'
  );

  // Shorthand owner/repo
  assert.equal(
    normalizeGithubRepoUrl('facebook/react'),
    'https://github.com/facebook/react/archive/refs/heads/main.zip'
  );

  // Direct zip URL should be untouched
  assert.equal(
    normalizeGithubRepoUrl('https://example.com/bundle.zip'),
    'https://example.com/bundle.zip'
  );
});
