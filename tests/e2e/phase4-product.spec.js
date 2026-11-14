const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { makeZip } = require('../helpers');

test('all product workspaces navigate, authenticate, remain responsive, and expose the execution block truthfully', async ({ page }) => {
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/');

  await expect(page.locator('#auth-gate')).toBeVisible();
  await page.locator('#auth-mode-toggle').click();
  await page.locator('#auth-name').fill('Phase Four Validator');
  await page.locator('#auth-email').fill('phase4-browser@example.com');
  await page.locator('#auth-password').fill('PhaseFour!12345');
  await page.locator('#auth-submit').click();
  await expect(page.locator('#auth-gate')).toBeHidden();

  await page.locator('#btn-new-project-modal').click();
  await page.locator('#modal-project-name').fill('Browser Validation Fixture');
  await page.locator('#modal-project-desc').fill('Controlled no-execution browser fixture');
  await page.locator('#project-create-modal-form button[type="submit"]').click();
  await expect(page.locator('#active-project-views')).toBeVisible();

  const fixturePath = path.join(os.tmpdir(), `codepilot-phase4-browser-${process.pid}.zip`);
  fs.writeFileSync(fixturePath, makeZip([
    { name: 'package.json', content: '{"name":"browser-fixture"}' },
    { name: 'src/index.js', content: 'const express = require("express");\nconst app=express();\napp.get("/health", () => ({ok:true}));\nmodule.exports={app};' },
    { name: 'tests/index.test.js', content: 'const subject=require("../src/index");\ntest("exports app",()=>subject.app);' }
  ]));
  await page.locator('#tab-btn-zip').click();
  await page.locator('#zip-file-input').setInputFiles(fixturePath);
  const importResponsePromise = page.waitForResponse((response) => /\/api\/projects\/[^/]+\/import$/.test(new URL(response.url()).pathname));
  await page.locator('#zip-import-form button[type="submit"]').click();
  const importResponse = await importResponsePromise;
  expect(importResponse.status(), await importResponse.text()).toBe(201);
  const projectState = await page.evaluate(async () => {
    const projectId = document.querySelector('#top-project-select').value;
    const token = localStorage.getItem('codepilot_session');
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, { headers: { Authorization: `Bearer ${token}` } });
    return { projectId, status: response.status, body: await response.json() };
  });
  expect(projectState.status, JSON.stringify(projectState.body)).toBe(200);
  expect(projectState.body.revision, JSON.stringify(projectState.body)).toBeTruthy();
  await page.evaluate((projectId) => selectProject(projectId), projectState.projectId);
  await expect(page.locator('#overview-revision-meta')).not.toContainText('No revision imported yet.', { timeout: 10_000 });

  const workspaces = [
    ['Project Overview', 'view-overview'], ['Repository Explorer', 'view-code'], ['Architecture Report', 'view-analysis'],
    ['CodePilot Flow', 'view-flow'], ['AI Assistant', 'view-ai'], ['Implementation Planner', 'view-planner'],
    ['Patch Manager', 'view-patches'], ['Security Center', 'view-findings'], ['Impact Analysis', 'view-impact'],
    ['Testing and Debugging', 'view-tests'], ['API Studio', 'view-api'], ['Database Studio', 'view-db'],
    ['Docker and Containers', 'view-docker'], ['Deployment Center', 'view-deploy']
  ];
  for (const [label, id] of workspaces) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await expect(page.locator(`#${id}`)).toBeVisible();
  }

  await page.getByRole('button', { name: 'Testing and Debugging', exact: true }).click();
  await expect(page.locator('#btn-run-tests')).toBeDisabled();
  await expect(page.locator('#execution-disabled-note')).toContainText('isolated worker passes adversarial verification');

  await page.keyboard.press('Control+K');
  await expect(page.locator('#command-palette')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#command-palette')).toBeHidden();

  const beforeTheme = await page.locator('html').getAttribute('data-theme');
  await page.locator('#btn-theme-toggle').click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', beforeTheme);

  const screenshotDir = path.resolve('artifacts/phase6/screenshots');
  fs.mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotDir, 'desktop-testing-disabled.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Toggle navigation sidebar' }).click();
  await expect(page.locator('#main-view')).toBeVisible();
  await page.screenshot({ path: path.join(screenshotDir, 'mobile-responsive.png'), fullPage: true });

  assertNoErrors(consoleErrors, 'console');
  assertNoErrors(pageErrors, 'page');
});

function assertNoErrors(errors, kind) {
  expect(errors, `Unexpected ${kind} errors:\n${errors.join('\n')}`).toEqual([]);
}
