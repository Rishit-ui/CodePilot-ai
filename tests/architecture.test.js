const test = require('node:test');
const assert = require('node:assert/strict');
const { generateArchitectureReport, exportReportToMarkdown } = require('../src/architecture');

test('generateArchitectureReport produces all 15 specification sections', async () => {
  const dummyStore = {
    all: async (sql, revId) => {
      if (sql.includes('FROM files')) {
        return [
          { path: 'src/index.js', language: 'JavaScript', bytes: 100, excluded_reason: null },
          { path: 'package.json', language: 'JSON', bytes: 50, excluded_reason: null },
          { path: 'Dockerfile', language: 'Dockerfile', bytes: 80, excluded_reason: null }
        ];
      }
      if (sql.includes('FROM symbols')) {
        return [
          { file_path: 'src/index.js', name: 'GET /api/status', kind: 'route:get', line: 10 },
          { file_path: 'src/index.js', name: 'PORT', kind: 'environment', line: 5 }
        ];
      }
      if (sql.includes('FROM edges')) {
        return [
          { source_path: 'src/index.js', target_path: 'pkg:express', type: 'depends-on-package', confidence: 'confirmed', provenance: 'static-import' }
        ];
      }
      if (sql.includes('FROM findings')) {
        return [];
      }
      return [];
    }
  };

  const project = { id: 'p1', name: 'CommerceEngine' };
  const report = await generateArchitectureReport(dummyStore, 'r1', project);

  assert.ok(report.executiveOverview);
  assert.ok(report.technologyInventory);
  assert.ok(report.applicationBoundaries);
  assert.ok(report.frontendArchitecture);
  assert.ok(report.backendArchitecture);
  assert.ok(report.apiArchitecture);
  assert.ok(report.databaseArchitecture);
  assert.ok(report.authFlow);
  assert.ok(report.externalIntegrations);
  assert.ok(report.configurationMap);
  assert.ok(report.testingArchitecture);
  assert.ok(report.containerTopology);
  assert.ok(report.deploymentArchitecture);
  assert.ok(report.risksAndUnknowns);
  assert.ok(report.recommendedNextActions);

  assert.equal(report.apiArchitecture.routeCount, 1);
  assert.equal(report.configurationMap.environmentVariables[0], 'PORT');

  const markdown = exportReportToMarkdown(report, project.name);
  assert.ok(markdown.includes('# CodePilot AI Architecture Report — CommerceEngine'));
  assert.ok(markdown.includes('## 1. Executive Overview'));
  assert.ok(markdown.includes('## 6. API Architecture'));
  assert.ok(markdown.includes('## 15. Recommended Next Actions'));
});
