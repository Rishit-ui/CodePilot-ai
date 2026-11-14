const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { makeZip } = require('../helpers');

const workspaces = [
  ['Project Overview', 'view-overview'], ['Repository Explorer', 'view-code'], ['Architecture Report', 'view-analysis'],
  ['CodePilot Flow', 'view-flow'], ['AI Assistant', 'view-ai'], ['Implementation Planner', 'view-planner'],
  ['Patch Manager', 'view-patches'], ['Security Center', 'view-findings'], ['Impact Analysis', 'view-impact'],
  ['Testing and Debugging', 'view-tests'], ['API Studio', 'view-api'], ['Database Studio', 'view-db'],
  ['Docker and Containers', 'view-docker'], ['Deployment Center', 'view-deploy']
];

let token;
let projectId;
let fixturePath;
const password = 'PhaseSix!12345';
const email = `phase6-${Date.now()}@example.test`;

test.beforeAll(async ({ request }) => {
  const registration = await request.post('/api/auth/register', { data: { name: 'Phase Six Validator', email, password } });
  expect(registration.status(), await registration.text()).toBe(201);
  token = (await registration.json()).token;
  const headers = { Authorization: `Bearer ${token}` };

  const projectResponse = await request.post('/api/projects', { headers, data: { name: 'Phase 6 Browser Fixture', description: 'No-provider deterministic browser validation' } });
  expect(projectResponse.status(), await projectResponse.text()).toBe(201);
  projectId = (await projectResponse.json()).project.id;

  fixturePath = path.join(os.tmpdir(), `codepilot-phase6-${process.pid}.zip`);
  const archive = makeZip([
    { name: 'package.json', content: '{"name":"phase6-browser-fixture","scripts":{"test":"node --test"}}' },
    { name: 'src/server.js', content: 'const express = require("express");\nconst app=express();\napp.get("/health", (_req,res) => res.json({ok:true}));\nmodule.exports={app};' },
    { name: 'src/auth.js', content: 'module.exports = { authorize: (user) => Boolean(user) };' },
    { name: 'tests/server.test.js', content: 'const test=require("node:test"); const assert=require("node:assert"); test("truth",()=>assert.ok(true));' }
  ]);
  fs.writeFileSync(fixturePath, archive);
  const imported = await request.post(`/api/projects/${projectId}/import`, { headers: { ...headers, 'content-type': 'application/zip' }, data: archive });
  expect(imported.status(), await imported.text()).toBe(201);

  const patch = await request.post(`/api/projects/${projectId}/patches`, {
    headers, data: { title: 'Clarify health response', targetFile: 'src/server.js', newContent: 'module.exports={health:{ok:true,status:"staging"}};\n' }
  });
  expect(patch.status(), await patch.text()).toBe(201);
});

test.afterAll(() => {
  if (fixturePath) fs.rmSync(fixturePath, { force: true });
});

async function openProject(page) {
  await page.addInitScript((value) => localStorage.setItem('codepilot_session', value), token);
  await page.goto('/');
  await expect(page.locator('#auth-gate')).toBeHidden();
  await expect(page.locator('#active-project-views')).toBeVisible();
  await expect(page.locator('#top-project-select')).toHaveValue(projectId);
}

test('authentication rejects a wrong password and accepts the registered staging user', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#auth-gate')).toBeVisible();
  await page.locator('#auth-email').fill(email);
  await page.locator('#auth-password').fill('definitely-wrong');
  await page.locator('#auth-submit').click();
  await expect(page.locator('#auth-feedback')).toBeVisible();
  await page.locator('#auth-password').fill(password);
  await page.locator('#auth-submit').click();
  await expect(page.locator('#auth-gate')).toBeHidden();
});

for (const [label, id] of workspaces) {
  test(`${label} workspace loads independently`, async ({ page }) => {
    await openProject(page);
    await page.getByRole('button', { name: label, exact: true }).click();
    await expect(page.locator(`#${id}`)).toBeVisible();
  });
}

test('ZIP import persists a new revision and repository files', async ({ page }) => {
  await openProject(page);
  await page.getByRole('button', { name: 'Project Overview', exact: true }).click();
  await page.locator('#tab-btn-zip').click();
  await page.locator('#zip-file-input').setInputFiles(fixturePath);
  const responsePromise = page.waitForResponse((response) => /\/api\/projects\/[^/]+\/import$/.test(new URL(response.url()).pathname));
  await page.locator('#zip-import-form button[type="submit"]').click();
  expect([200, 201]).toContain((await responsePromise).status());
  await page.getByRole('button', { name: 'Repository Explorer', exact: true }).click();
  await expect(page.locator('#file-list-container')).toContainText('server.js');
});

test('architecture analysis renders and markdown export is authenticated', async ({ page }) => {
  await openProject(page);
  await page.getByRole('button', { name: 'Architecture Report', exact: true }).click();
  await expect(page.locator('#analysis-report-container')).toContainText('System Archetype');
  const exportLink = page.locator('#btn-export-report-overview');
  await expect(exportLink).toHaveAttribute('href', new RegExp(`/api/projects/${projectId}/architecture-report\\.md$`));
  const response = await page.request.get(await exportLink.getAttribute('href'), { headers: { Authorization: `Bearer ${token}` } });
  expect(response.status()).toBe(200);
  expect(await response.text()).toContain('# CodePilot AI Architecture Report');
});

test('repository-grounded AI returns evidence from the imported revision', async ({ page }) => {
  await openProject(page);
  await page.getByRole('button', { name: 'AI Assistant', exact: true }).click();
  await page.locator('#ai-question-input').fill('Where is the health route implemented?');
  await page.locator('#ai-ask-form button[type="submit"]').click();
  await expect(page.locator('#ai-chat-messages')).toContainText('src/server.js');
});

test('impact analysis and test selection work while execution remains disabled', async ({ page }) => {
  await openProject(page);
  await page.getByRole('button', { name: 'Impact Analysis', exact: true }).click();
  await page.locator('#impact-files-input').fill('src/server.js');
  await page.locator('#btn-impact-analyze').click();
  await expect(page.locator('#impact-cone-box')).toContainText('AFFECTED ENDPOINTS: GET /health');
  await expect(page.locator('#impact-cone-box')).not.toContainText('[object Object]');
  await page.locator('#btn-impact-select').click();
  await expect(page.locator('#impact-tests-box')).not.toContainText('Run "Select Tests"');
  await expect(page.locator('#btn-impact-run')).toBeDisabled();
});

test('patch manager renders the staged review without applying it', async ({ page }) => {
  await openProject(page);
  await page.getByRole('button', { name: 'Patch Manager', exact: true }).click();
  await expect(page.locator('#patches-container')).toContainText('Clarify health response');
  await expect(page.locator('#patches-container')).toContainText('draft');
});

test('owned job creation is idempotent while execution jobs remain release-blocked', async ({ page }) => {
  await openProject(page);
  const headers = { Authorization: `Bearer ${token}`, 'Idempotency-Key': `phase7-browser-${Date.now()}` };
  const created = await page.request.post(`/api/projects/${projectId}/jobs`, { headers, data: { jobType: 'source-analysis' } });
  expect(created.status(), await created.text()).toBe(202);
  const first = await created.json();
  const duplicate = await page.request.post(`/api/projects/${projectId}/jobs`, { headers, data: { jobType: 'source-analysis' } });
  expect(duplicate.status(), await duplicate.text()).toBe(200);
  expect((await duplicate.json()).job.id).toBe(first.job.id);
  const blocked = await page.request.post(`/api/projects/${projectId}/jobs`, {
    headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': `phase7-execution-${Date.now()}` },
    data: { jobType: 'test-execution', executionProfile: 'node-test' }
  });
  expect(blocked.status()).toBe(503);
  expect((await blocked.json()).error.code).toBe('EXECUTION_RELEASE_BLOCKED');
});

test('navigation, command palette, theme, and responsive sidebar remain usable', async ({ page }) => {
  await openProject(page);
  await page.keyboard.press('Control+K');
  await expect(page.locator('#command-palette')).toBeVisible();
  await page.keyboard.press('Escape');
  const originalTheme = await page.locator('html').getAttribute('data-theme');
  await page.locator('#btn-theme-toggle').click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', originalTheme);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Toggle navigation sidebar' }).click();
  await expect(page.locator('#main-view')).toBeVisible();
});

