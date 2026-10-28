const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { Store } = require('../src/db');
const {
  generateFlowDiagram,
  generateArchitectureFlow,
  generateCallGraph,
  generateExecutionFlowchart,
  generateApiLifecycleFlow,
  generateDependencyFlow,
  generateChangeImpactFlow,
  generateErrorPathsFlow
} = require('../src/flow');

test('CodePilot Flow Engine: generates all 7 visual flow diagrams with AST evidence', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-flow-test-'));
  const store = new Store(tmpDir);

  t.after(async () => {
    store.close();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  const project = await store.createProject('Flow Demo Project');
  const records = {
    files: [
      {
        path: 'package.json',
        bytes: 150,
        language: 'json',
        content: JSON.stringify({
          dependencies: { express: '^4.19.0', pg: '^8.11.0', jsonwebtoken: '^9.0.0' }
        })
      },
      {
        path: 'src/server.js',
        bytes: 400,
        language: 'javascript',
        content: 'const express = require("express"); app.get("/api/users", handleUsers); function handleUsers(req, res) { res.json([]); }'
      }
    ],
    symbols: [
      {
        filePath: 'src/server.js',
        name: 'handleUsers',
        kind: 'function',
        line: 10
      },
      {
        filePath: 'src/server.js',
        name: 'GET /api/users',
        kind: 'route:express',
        line: 5
      }
    ],
    edges: [
      {
        sourcePath: 'src/server.js',
        targetPath: 'src/server.js',
        type: 'calls',
        confidence: 0.9,
        line: 5,
        provenance: 'static'
      }
    ],
    findings: [
      {
        severity: 'medium',
        category: 'security',
        message: 'Missing rate limiter on GET /api/users',
        filePath: 'src/server.js',
        line: 5,
        evidence: 'app.get("/api/users")'
      }
    ]
  };

  const summary = JSON.stringify({
    stack: 'Node.js Express API',
    files: 2,
    lines: 40,
    symbols: 2,
    dependencies: 3,
    endpoints: 1
  });

  const { revision } = await store.saveRevision(project.id, 'hash-a1b2c3d', records, summary);
  const revisionId = revision.id;

  // 1. Architecture Flow
  const archFlow = await generateFlowDiagram(store, project.id, revisionId, { type: 'architecture' });
  assert.equal(archFlow.diagramType, 'architecture');
  assert.ok(archFlow.nodes.length >= 3);
  assert.ok(archFlow.edges.length >= 2);
  const clientNode = archFlow.nodes.find(n => n.type === 'client');
  assert.ok(clientNode, 'Must contain client layer node');
  assert.equal(typeof clientNode.x, 'number');
  assert.equal(typeof clientNode.y, 'number');

  // 2. Call Graph Flow
  const callGraph = await generateFlowDiagram(store, project.id, revisionId, { type: 'call-graph' });
  assert.equal(callGraph.diagramType, 'call-graph');
  assert.ok(callGraph.nodes.length >= 1);
  assert.ok(callGraph.nodes.some(n => n.label.includes('handleUsers')));

  // 3. Flowchart Flow
  const flowchart = await generateFlowDiagram(store, project.id, revisionId, { type: 'flowchart' });
  assert.equal(flowchart.diagramType, 'flowchart');
  assert.ok(flowchart.nodes.length >= 2); // always has start + end node
  assert.ok(flowchart.edges.length >= 1);

  // 4. API Lifecycle Flow
  const apiFlow = await generateFlowDiagram(store, project.id, revisionId, { type: 'api-lifecycle' });
  assert.equal(apiFlow.diagramType, 'api-lifecycle');
  assert.ok(apiFlow.nodes.length >= 4);
  assert.ok(apiFlow.nodes.some(n => n.type === 'lifecycle-client'));
  assert.ok(apiFlow.nodes.some(n => n.type === 'lifecycle-route'));

  // 5. Dependency Flow (nodes = internal file modules + external packages from pkg: edges)
  const depFlow = await generateFlowDiagram(store, project.id, revisionId, { type: 'dependency' });
  assert.equal(depFlow.diagramType, 'dependency');
  assert.ok(depFlow.nodes.length >= 1);
  // All dep-flow nodes represent files; labels are their basenames
  assert.ok(depFlow.nodes.some(n => n.label === 'server.js' || n.label === 'package.json'));

  // 6. Change Impact Flow
  const impactFlow = await generateFlowDiagram(store, project.id, revisionId, {
    type: 'change-impact',
    file: 'src/server.js'
  });
  assert.equal(impactFlow.diagramType, 'change-impact');
  assert.ok(impactFlow.nodes.length >= 1);
  // impact_target node uses the .path field
  const targetNode = impactFlow.nodes.find(n => n.id === 'impact_target');
  assert.ok(targetNode, 'Must have impact_target node');
  assert.equal(targetNode.path, 'src/server.js');

  // 7. Error Paths Flow
  const errFlow = await generateFlowDiagram(store, project.id, revisionId, { type: 'error-paths' });
  assert.equal(errFlow.diagramType, 'error-paths');
  assert.ok(errFlow.nodes.length >= 1);
  assert.ok(errFlow.nodes.some(n => n.type === 'vulnerability' || n.type === 'error-node'));
});
