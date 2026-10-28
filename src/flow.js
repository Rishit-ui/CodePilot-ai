const path = require('node:path').posix;

/**
 * CodePilot Flow — Visual Software Understanding & Architecture Engine
 * Transforms complex codebases into interactive, source-grounded diagram models.
 */

function sanitizeExcerpt(code, maxLines = 15) {
  if (!code) return '';
  const lines = code.split(/\r?\n/).slice(0, maxLines);
  return lines.join('\n');
}

/**
 * 1. Application Architecture Diagram
 */
async function generateArchitectureFlow(store, revisionId) {
  const files = await store.all(
    'SELECT path, language, bytes, content FROM files WHERE revision_id = ? AND excluded_reason IS NULL',
    revisionId
  );
  const symbols = await store.all(
    'SELECT file_path, name, kind, line FROM symbols WHERE revision_id = ?',
    revisionId
  );
  const edgesData = await store.all(
    'SELECT source_path, target_path, type, confidence FROM edges WHERE revision_id = ?',
    revisionId
  );

  const nodes = [];
  const edges = [];
  const nodeMap = new Map();

  // Categorize nodes into layers
  const layers = {
    client: [],
    api: [],
    core: [],
    database: [],
    external: []
  };

  // Entry points & routes
  const routes = symbols.filter((s) => s.kind.startsWith('route:'));
  const entrypoints = symbols.filter((s) => s.kind === 'entrypoint');
  const dbTables = symbols.filter((s) => s.kind === 'db-table');

  // External package nodes
  const externalPkgs = new Set();
  edgesData.forEach((e) => {
    if (e.target_path.startsWith('pkg:')) {
      externalPkgs.add(e.target_path.replace('pkg:', ''));
    }
  });

  // Client layer (HTML, Frontend JS, CSS)
  files.forEach((f) => {
    const normPath = f.path.replace(/\\/g, '/');
    const lang = (f.language || '').toLowerCase();
    const isClient = normPath.startsWith('public/') || normPath.startsWith('client/') || normPath.startsWith('src/client/') || lang === 'html' || lang === 'css';
    if (isClient) {
      const node = {
        id: `node_file_${f.path}`,
        label: path.basename(f.path),
        subtitle: f.path,
        type: 'client-view',
        layer: 'client',
        path: f.path,
        line: 1,
        evidence: 'static-analysis',
        bytes: f.bytes,
        language: f.language,
        excerpt: sanitizeExcerpt(f.content)
      };
      layers.client.push(node);
      nodeMap.set(f.path, node.id);
      nodeMap.set(normPath, node.id);
    }
  });

  if (layers.client.length === 0) {
    layers.client.push({
      id: 'node_client_user',
      label: 'HTTP Client / User',
      subtitle: 'External Consumer',
      type: 'client',
      layer: 'client',
      evidence: 'static-analysis'
    });
  }

  // API Layer (Detected routes)
  routes.forEach((r, idx) => {
    const methodMatch = r.kind.match(/route:([a-zA-Z]+)/);
    const method = methodMatch ? methodMatch[1].toUpperCase() : 'API';
    const node = {
      id: `node_route_${r.name}_${idx}`,
      label: `${method} ${r.name}`,
      subtitle: `${path.basename(r.file_path)}:${r.line}`,
      type: 'api-endpoint',
      layer: 'api',
      path: r.file_path,
      line: r.line,
      method,
      evidence: 'static-analysis'
    };
    layers.api.push(node);
  });

  // Core Backend / Services Layer
  files.forEach((f) => {
    const normPath = f.path.replace(/\\/g, '/');
    const lang = (f.language || '').toLowerCase();
    const isClient = normPath.startsWith('public/') || lang === 'html' || lang === 'css';
    const isTest = normPath.includes('test') || normPath.startsWith('tests/');
    const isBackendCode = ['javascript', 'typescript', 'python', 'go', 'ruby', 'java', 'rust', 'csharp', 'php'].includes(lang);
    if (!isClient && !isTest && isBackendCode) {
      const isEntry = entrypoints.some((ep) => ep.file_path === f.path || ep.name === f.path);
      const node = {
        id: `node_file_${f.path}`,
        label: path.basename(f.path),
        subtitle: isEntry ? 'Entrypoint Module' : f.path,
        type: isEntry ? 'entrypoint' : 'service-module',
        layer: 'core',
        path: f.path,
        line: 1,
        evidence: 'static-analysis',
        bytes: f.bytes,
        language: f.language,
        excerpt: sanitizeExcerpt(f.content)
      };
      layers.core.push(node);
      nodeMap.set(f.path, node.id);
      nodeMap.set(normPath, node.id);
    }
  });

  // Database Layer
  dbTables.forEach((t) => {
    const node = {
      id: `node_db_${t.name}`,
      label: `table: ${t.name}`,
      subtitle: `${path.basename(t.file_path)}:${t.line}`,
      type: 'database-entity',
      layer: 'database',
      path: t.file_path,
      line: t.line,
      evidence: 'static-analysis'
    };
    layers.database.push(node);
    nodeMap.set(`db:${t.name}`, node.id);
  });

  // External Packages Layer
  Array.from(externalPkgs).slice(0, 10).forEach((pkg) => {
    const node = {
      id: `node_pkg_${pkg}`,
      label: pkg,
      subtitle: 'External Package',
      type: 'external-package',
      layer: 'external',
      evidence: 'configuration-derived'
    };
    layers.external.push(node);
    nodeMap.set(`pkg:${pkg}`, node.id);
  });

  // Calculate layout coordinates (X: Layer swimlanes, Y: Sequential stacking)
  const layerKeys = ['client', 'api', 'core', 'database', 'external'];
  const layerX = {
    client: 80,
    api: 320,
    core: 580,
    database: 840,
    external: 1080
  };

  layerKeys.forEach((key) => {
    const items = layers[key];
    const spacingY = 90;
    const startY = 80;
    items.forEach((item, idx) => {
      item.x = layerX[key];
      item.y = startY + idx * spacingY;
      item.width = 190;
      item.height = 64;
      nodes.push(item);
    });
  });

  // Generate Edges
  // 1. Client to API (fetch calls)
  layers.client.forEach((cNode) => {
    layers.api.forEach((apiNode) => {
      edges.push({
        id: `edge_${cNode.id}_${apiNode.id}`,
        source: cNode.id,
        target: apiNode.id,
        label: 'HTTP fetch',
        type: 'routes-to',
        evidence: 'static-analysis'
      });
    });
  });

  // 2. API to Core handlers
  layers.api.forEach((apiNode) => {
    const targetFile = nodeMap.get(apiNode.path);
    if (targetFile) {
      edges.push({
        id: `edge_${apiNode.id}_${targetFile}`,
        source: apiNode.id,
        target: targetFile,
        label: 'handled by',
        type: 'handler',
        evidence: 'static-analysis'
      });
    }
  });

  // 3. Module-to-Module imports
  edgesData.forEach((e, idx) => {
    const srcId = nodeMap.get(e.source_path);
    const tgtId = nodeMap.get(e.target_path);
    if (srcId && tgtId && srcId !== tgtId) {
      edges.push({
        id: `edge_import_${idx}`,
        source: srcId,
        target: tgtId,
        label: e.type === 'depends-on-package' ? 'depends on' : 'imports',
        type: e.type,
        confidence: e.confidence,
        evidence: 'static-analysis'
      });
    }
  });

  // 4. Core to DB
  layers.database.forEach((dbNode) => {
    layers.core.forEach((coreNode) => {
      if (coreNode.path.includes('db') || coreNode.path.includes('server')) {
        edges.push({
          id: `edge_${coreNode.id}_${dbNode.id}`,
          source: coreNode.id,
          target: dbNode.id,
          label: 'queries schema',
          type: 'queries',
          evidence: 'static-analysis'
        });
      }
    });
  });

  return {
    diagramType: 'architecture',
    title: 'Application Architecture & Component Flow',
    description: 'High-level software topology showing client views, API routes, backend services, persistence, and external packages.',
    evidenceType: 'static-analysis',
    nodes,
    edges,
    layers: layerKeys
  };
}

/**
 * 2. Function Call Graph
 */
async function generateCallGraph(store, revisionId, targetSymbol = null) {
  const files = await store.all(
    'SELECT path, content, language FROM files WHERE revision_id = ? AND excluded_reason IS NULL',
    revisionId
  );
  const symbols = await store.all(
    "SELECT file_path, name, kind, line FROM symbols WHERE revision_id = ? AND kind IN ('function', 'entrypoint', 'route', 'const', 'class')",
    revisionId
  );

  const functionSymbols = symbols.filter((s) => s.kind === 'function' || s.kind === 'entrypoint');
  const fileContentMap = new Map();
  files.forEach((f) => fileContentMap.set(f.path, f.content || ''));

  const nodes = [];
  const edges = [];
  const nodeMap = new Map();

  // Create nodes for functions
  functionSymbols.forEach((fn, idx) => {
    const isTarget = targetSymbol && fn.name.toLowerCase() === targetSymbol.toLowerCase();
    const content = fileContentMap.get(fn.file_path) || '';
    const lines = content.split(/\r?\n/);
    const startIdx = Math.max(0, fn.line - 1);
    const excerpt = lines.slice(startIdx, startIdx + 12).join('\n');

    const node = {
      id: `fn_${fn.file_path}_${fn.name}`,
      label: `${fn.name}()`,
      subtitle: `${path.basename(fn.file_path)}:${fn.line}`,
      type: fn.kind === 'entrypoint' ? 'entrypoint' : 'function',
      path: fn.file_path,
      line: fn.line,
      isTarget: Boolean(isTarget),
      evidence: 'static-analysis',
      excerpt: sanitizeExcerpt(excerpt)
    };
    nodes.push(node);
    nodeMap.set(fn.name, node);
  });

  // Detect call relationships by inspecting function bodies
  functionSymbols.forEach((caller) => {
    const callerNode = nodeMap.get(caller.name);
    if (!callerNode) return;
    const content = fileContentMap.get(caller.file_path) || '';
    const callerExcerpt = callerNode.excerpt || '';

    functionSymbols.forEach((callee) => {
      if (caller.name === callee.name) return; // avoid self-loop unless recursive
      const callPattern = new RegExp(`\\b${callee.name}\\s*\\(`, 'g');
      if (callPattern.test(callerExcerpt) || callPattern.test(content)) {
        const calleeNode = nodeMap.get(callee.name);
        if (calleeNode) {
          edges.push({
            id: `call_${callerNode.id}_${calleeNode.id}`,
            source: callerNode.id,
            target: calleeNode.id,
            label: 'calls',
            type: 'function-call',
            evidence: 'static-analysis'
          });
        }
      }
    });
  });

  // Calculate 2D layout (levels by caller in-degree / depth)
  const cols = Math.min(5, Math.max(3, Math.ceil(Math.sqrt(nodes.length))));
  const spacingX = 260;
  const spacingY = 110;
  nodes.forEach((n, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    n.x = 80 + col * spacingX;
    n.y = 80 + row * spacingY;
    n.width = 200;
    n.height = 68;
  });

  return {
    diagramType: 'call-graph',
    title: targetSymbol ? `Call Graph: ${targetSymbol}()` : 'Global Function Call Graph',
    description: 'Traces caller and callee relationships across codebase entrypoints and utility modules.',
    evidenceType: 'static-analysis',
    nodes: nodes.slice(0, 40), // keep performant
    edges
  };
}

/**
 * 3. Program Execution Flowchart
 */
async function generateExecutionFlowchart(store, revisionId, targetSymbol = null) {
  const symbols = await store.all(
    "SELECT file_path, name, kind, line FROM symbols WHERE revision_id = ? AND kind IN ('function', 'entrypoint')",
    revisionId
  );
  
  const chosenSymbol = targetSymbol 
    ? symbols.find((s) => s.name.toLowerCase() === targetSymbol.toLowerCase()) || symbols[0]
    : symbols[0];

  if (!chosenSymbol) {
    return {
      diagramType: 'flowchart',
      title: 'Execution Flowchart',
      description: 'No functions found to generate execution flowchart.',
      evidenceType: 'static-analysis',
      nodes: [],
      edges: []
    };
  }

  const file = await store.get(
    'SELECT path, content FROM files WHERE revision_id = ? AND path = ?',
    revisionId,
    chosenSymbol.file_path
  );

  const nodes = [];
  const edges = [];
  const content = file ? file.content : '';
  const lines = content.split(/\r?\n/).slice(Math.max(0, chosenSymbol.line - 1), chosenSymbol.line + 60);

  let currentY = 60;
  const startX = 350;
  const nodeW = 220;
  const nodeH = 56;
  const stepY = 100;

  // 1. Entry node
  const startNode = {
    id: 'flow_entry',
    label: `Start: ${chosenSymbol.name}()`,
    subtitle: `${path.basename(chosenSymbol.file_path)}:${chosenSymbol.line}`,
    type: 'flow-start',
    x: startX,
    y: currentY,
    width: nodeW,
    height: nodeH,
    evidence: 'static-analysis'
  };
  nodes.push(startNode);

  let lastNodeId = startNode.id;
  let conditionCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('//') || line.startsWith('/*')) continue;

    // Detect Condition (if statement)
    if (line.startsWith('if ') || line.startsWith('if(')) {
      conditionCount++;
      currentY += stepY;
      const condMatch = line.match(/if\s*\((.*?)\)/);
      const conditionExpr = condMatch ? condMatch[1].slice(0, 40) : line.slice(0, 40);

      const condNode = {
        id: `flow_cond_${conditionCount}`,
        label: `Condition: ${conditionExpr}`,
        subtitle: `Line ${chosenSymbol.line + i}`,
        type: 'flow-decision',
        x: startX,
        y: currentY,
        width: nodeW + 30,
        height: nodeH + 10,
        evidence: 'static-analysis',
        path: chosenSymbol.file_path,
        line: chosenSymbol.line + i,
        excerpt: line
      };
      nodes.push(condNode);

      edges.push({
        id: `edge_${lastNodeId}_${condNode.id}`,
        source: lastNodeId,
        target: condNode.id,
        label: 'proceed',
        type: 'flow-step',
        evidence: 'static-analysis'
      });

      // Branch: True / Reject or early exit
      currentY += stepY;
      const branchTrue = {
        id: `flow_then_${conditionCount}`,
        label: 'Branch (Then / Guard Hit)',
        subtitle: 'Validation or early handling',
        type: 'flow-branch',
        x: startX - 180,
        y: currentY,
        width: 170,
        height: 50,
        evidence: 'static-analysis'
      };
      nodes.push(branchTrue);

      edges.push({
        id: `edge_${condNode.id}_${branchTrue.id}`,
        source: condNode.id,
        target: branchTrue.id,
        label: 'true',
        type: 'flow-condition-true',
        evidence: 'static-analysis'
      });

      // Branch: False / Continue
      const branchFalse = {
        id: `flow_else_${conditionCount}`,
        label: 'Branch (Else / Continue)',
        subtitle: 'Normal execution flow',
        type: 'flow-step',
        x: startX + 180,
        y: currentY,
        width: 170,
        height: 50,
        evidence: 'static-analysis'
      };
      nodes.push(branchFalse);

      edges.push({
        id: `edge_${condNode.id}_${branchFalse.id}`,
        source: condNode.id,
        target: branchFalse.id,
        label: 'false',
        type: 'flow-condition-false',
        evidence: 'static-analysis'
      });

      lastNodeId = branchFalse.id;
      if (conditionCount >= 3) break; // keep flowchart concise
    } else if (line.includes('await ') || line.includes('store.') || line.includes('fetch(')) {
      currentY += stepY;
      const asyncStep = {
        id: `flow_step_${i}`,
        label: `Async I/O: ${line.slice(0, 35)}…`,
        subtitle: `Line ${chosenSymbol.line + i}`,
        type: 'flow-async',
        x: startX,
        y: currentY,
        width: nodeW,
        height: nodeH,
        evidence: 'static-analysis',
        path: chosenSymbol.file_path,
        line: chosenSymbol.line + i,
        excerpt: line
      };
      nodes.push(asyncStep);

      edges.push({
        id: `edge_${lastNodeId}_${asyncStep.id}`,
        source: lastNodeId,
        target: asyncStep.id,
        label: 'await',
        type: 'flow-step',
        evidence: 'static-analysis'
      });
      lastNodeId = asyncStep.id;
    }
  }

  // Final Return / Exit Node
  currentY += stepY;
  const exitNode = {
    id: 'flow_exit',
    label: 'Return / Complete',
    subtitle: 'Function termination',
    type: 'flow-end',
    x: startX,
    y: currentY,
    width: nodeW,
    height: nodeH,
    evidence: 'static-analysis'
  };
  nodes.push(exitNode);

  edges.push({
    id: `edge_${lastNodeId}_${exitNode.id}`,
    source: lastNodeId,
    target: exitNode.id,
    label: 'returns',
    type: 'flow-step',
    evidence: 'static-analysis'
  });

  return {
    diagramType: 'flowchart',
    title: `Execution Flowchart: ${chosenSymbol.name}()`,
    description: `Control flow AST sequence for ${chosenSymbol.name} in ${chosenSymbol.file_path}, showing conditionals, async calls, and terminations.`,
    evidenceType: 'static-analysis',
    nodes,
    edges
  };
}

/**
 * 4. Data-Flow & API Lifecycle Diagram
 */
async function generateApiLifecycleFlow(store, revisionId, routeName = null) {
  const symbols = await store.all('SELECT file_path, name, kind, line FROM symbols WHERE revision_id = ?', revisionId);
  const routes = symbols.filter((s) => s.kind.startsWith('route:'));
  const targetRoute = routeName 
    ? routes.find((r) => r.name.toLowerCase() === routeName.toLowerCase()) || routes[0]
    : routes[0] || { name: '/api/projects', file_path: 'src/server.js', line: 194 };

  const nodes = [
    {
      id: 'step_client',
      label: '1. Client Browser',
      subtitle: 'fetch() request initiated',
      type: 'lifecycle-client',
      x: 100,
      y: 180,
      width: 180,
      height: 70,
      evidence: 'static-analysis'
    },
    {
      id: 'step_gateway',
      label: `2. HTTP Route Match`,
      subtitle: targetRoute.name,
      type: 'lifecycle-route',
      x: 340,
      y: 180,
      width: 200,
      height: 70,
      path: targetRoute.file_path,
      line: targetRoute.line,
      evidence: 'static-analysis'
    },
    {
      id: 'step_middleware',
      label: '3. Auth & SSRF Validation',
      subtitle: 'Session token & header check',
      type: 'lifecycle-middleware',
      x: 600,
      y: 180,
      width: 210,
      height: 70,
      evidence: 'static-analysis'
    },
    {
      id: 'step_controller',
      label: '4. Service Handler',
      subtitle: 'Business logic execution',
      type: 'lifecycle-handler',
      x: 870,
      y: 180,
      width: 200,
      height: 70,
      evidence: 'static-analysis'
    },
    {
      id: 'step_db',
      label: '5. Database Query',
      subtitle: 'Store SQL SELECT/INSERT',
      type: 'lifecycle-db',
      x: 1130,
      y: 180,
      width: 190,
      height: 70,
      evidence: 'static-analysis'
    },
    {
      id: 'step_response',
      label: '6. JSON Response',
      subtitle: 'HTTP 200 / 201 Created',
      type: 'lifecycle-response',
      x: 600,
      y: 340,
      width: 210,
      height: 70,
      evidence: 'static-analysis'
    }
  ];

  const edges = [
    { id: 'l1', source: 'step_client', target: 'step_gateway', label: 'HTTP GET/POST', type: 'request-flow', evidence: 'static-analysis' },
    { id: 'l2', source: 'step_gateway', target: 'step_middleware', label: 'route matched', type: 'request-flow', evidence: 'static-analysis' },
    { id: 'l3', source: 'step_middleware', target: 'step_controller', label: 'authorized', type: 'request-flow', evidence: 'static-analysis' },
    { id: 'l4', source: 'step_controller', target: 'step_db', label: 'SQL execute', type: 'request-flow', evidence: 'static-analysis' },
    { id: 'l5', source: 'step_db', target: 'step_response', label: 'records returned', type: 'data-flow', evidence: 'static-analysis' },
    { id: 'l6', source: 'step_response', target: 'step_client', label: 'res.json(payload)', type: 'response-flow', evidence: 'static-analysis' }
  ];

  return {
    diagramType: 'api-lifecycle',
    title: `API Request Lifecycle: ${targetRoute.name}`,
    description: `End-to-end data flow for ${targetRoute.name} from client trigger through authentication, controller dispatch, SQL query, and JSON response.`,
    evidenceType: 'static-analysis',
    nodes,
    edges
  };
}

/**
 * 5. Dependency & Coupling Graph
 */
async function generateDependencyFlow(store, revisionId) {
  const edgesData = await store.all('SELECT source_path, target_path, type, confidence FROM edges WHERE revision_id = ?', revisionId);
  const files = await store.all('SELECT path, language, bytes FROM files WHERE revision_id = ? AND excluded_reason IS NULL', revisionId);

  const inDegree = new Map();
  const outDegree = new Map();

  edgesData.forEach((e) => {
    outDegree.set(e.source_path, (outDegree.get(e.source_path) || 0) + 1);
    inDegree.set(e.target_path, (inDegree.get(e.target_path) || 0) + 1);
  });

  const nodes = [];
  const edges = [];
  const nodeMap = new Map();

  // Create nodes with coupling score
  files.slice(0, 30).forEach((f, idx) => {
    const inCount = inDegree.get(f.path) || 0;
    const outCount = outDegree.get(f.path) || 0;
    const isHighCoupling = inCount >= 3 || outCount >= 4;

    const node = {
      id: `dep_${f.path}`,
      label: path.basename(f.path),
      subtitle: `${f.path} (in: ${inCount}, out: ${outCount})`,
      type: isHighCoupling ? 'high-coupling' : 'module-dependency',
      path: f.path,
      line: 1,
      inCount,
      outCount,
      isHighCoupling,
      evidence: 'static-analysis'
    };
    nodes.push(node);
    nodeMap.set(f.path, node);
  });

  // Layout in concentric / layered grid
  const cols = 5;
  const spacingX = 230;
  const spacingY = 100;
  nodes.forEach((n, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    n.x = 80 + col * spacingX;
    n.y = 80 + row * spacingY;
    n.width = 190;
    n.height = 64;
  });

  // Edges
  edgesData.forEach((e, idx) => {
    const sNode = nodeMap.get(e.source_path);
    const tNode = nodeMap.get(e.target_path);
    if (sNode && tNode) {
      edges.push({
        id: `dep_edge_${idx}`,
        source: sNode.id,
        target: tNode.id,
        label: e.type,
        type: e.type,
        evidence: 'static-analysis'
      });
    }
  });

  return {
    diagramType: 'dependency',
    title: 'Module Dependency & Coupling Topology',
    description: 'Visualizes internal imports, external package coupling scores, and architectural hub modules.',
    evidenceType: 'static-analysis',
    nodes,
    edges
  };
}

/**
 * 6. Change-Impact / Blast Radius Diagram
 */
async function generateChangeImpactFlow(store, revisionId, targetPath = null) {
  const files = await store.all('SELECT path, language FROM files WHERE revision_id = ? AND excluded_reason IS NULL', revisionId);
  const edgesData = await store.all('SELECT source_path, target_path, type FROM edges WHERE revision_id = ?', revisionId);
  const routes = await store.all("SELECT file_path, name FROM symbols WHERE revision_id = ? AND kind LIKE 'route:%'", revisionId);

  const selectedFile = targetPath || (files[0] ? files[0].path : 'src/server.js');

  // Direct callers (who imports target)
  const directCallers = edgesData.filter((e) => e.target_path === selectedFile).map((e) => e.source_path);
  // Transitive callers
  const transitiveCallers = edgesData.filter((e) => directCallers.includes(e.target_path)).map((e) => e.source_path);
  // Affected routes
  const affectedRoutes = routes.filter((r) => r.file_path === selectedFile || directCallers.includes(r.file_path));
  // Test coverage
  const testFiles = files.filter((f) => f.path.includes('test') && (f.path.includes(path.basename(selectedFile, path.extname(selectedFile))) || directCallers.includes(f.path)));

  const nodes = [
    {
      id: 'impact_target',
      label: path.basename(selectedFile),
      subtitle: `Target File: ${selectedFile}`,
      type: 'impact-target',
      x: 480,
      y: 200,
      width: 220,
      height: 70,
      evidence: 'static-analysis',
      path: selectedFile,
      line: 1
    }
  ];

  const edges = [];

  // Direct Callers (Left side)
  directCallers.slice(0, 5).forEach((caller, idx) => {
    const node = {
      id: `impact_direct_${idx}`,
      label: path.basename(caller),
      subtitle: 'Direct Downstream Dependent',
      type: 'impact-direct',
      x: 160,
      y: 100 + idx * 85,
      width: 200,
      height: 60,
      path: caller,
      line: 1,
      evidence: 'static-analysis'
    };
    nodes.push(node);
    edges.push({
      id: `edge_impact_${idx}`,
      source: node.id,
      target: 'impact_target',
      label: 'imports target',
      type: 'impact-edge',
      evidence: 'static-analysis'
    });
  });

  // Affected Routes (Top Right)
  affectedRoutes.slice(0, 4).forEach((rt, idx) => {
    const node = {
      id: `impact_route_${idx}`,
      label: rt.name,
      subtitle: 'Affected API Route',
      type: 'impact-route',
      x: 800,
      y: 80 + idx * 80,
      width: 200,
      height: 60,
      path: rt.file_path,
      line: 1,
      evidence: 'static-analysis'
    };
    nodes.push(node);
    edges.push({
      id: `edge_rt_${idx}`,
      source: 'impact_target',
      target: node.id,
      label: 'powers endpoint',
      type: 'impact-edge',
      evidence: 'static-analysis'
    });
  });

  // Test Files (Bottom Right)
  testFiles.slice(0, 3).forEach((tf, idx) => {
    const node = {
      id: `impact_test_${idx}`,
      label: path.basename(tf.path),
      subtitle: 'Covering Test Suite',
      type: 'impact-test',
      x: 800,
      y: 320 + idx * 80,
      width: 200,
      height: 60,
      path: tf.path,
      line: 1,
      evidence: 'static-analysis'
    };
    nodes.push(node);
    edges.push({
      id: `edge_tf_${idx}`,
      source: 'impact_target',
      target: node.id,
      label: 'verified by test',
      type: 'impact-edge',
      evidence: 'static-analysis'
    });
  });

  return {
    diagramType: 'change-impact',
    title: `Change-Impact Blast Radius: ${path.basename(selectedFile)}`,
    description: `Analyzes direct callers, affected API endpoints, and regression test suites potentially impacted if ${selectedFile} changes.`,
    evidenceType: 'static-analysis',
    nodes,
    edges
  };
}

/**
 * 7. Error & Failure Paths
 */
async function generateErrorPathsFlow(store, revisionId) {
  const findings = await store.all('SELECT severity, category, message, file_path, line FROM findings WHERE revision_id = ?', revisionId);
  const files = await store.all('SELECT path, content FROM files WHERE revision_id = ? AND excluded_reason IS NULL', revisionId);

  const nodes = [];
  const edges = [];

  let yOffset = 80;

  // Security findings become vulnerability nodes
  findings.forEach((finding, idx) => {
    const node = {
      id: `finding-${idx}`,
      label: `[${finding.severity.toUpperCase()}] ${finding.message.slice(0, 45)}`,
      subtitle: `${finding.file_path || 'unknown'}:${finding.line || '?'}`,
      type: 'vulnerability',
      x: 200,
      y: yOffset,
      width: 280,
      height: 70,
      path: finding.file_path,
      line: finding.line,
      severity: finding.severity,
      evidence: 'static-analysis'
    };
    nodes.push(node);

    const outcomeNode = {
      id: `finding_outcome_${idx}`,
      label: 'Potential Exploit / Error Surface',
      subtitle: `Category: ${finding.category || 'security'}`,
      type: 'error-outcome',
      x: 600,
      y: yOffset,
      width: 240,
      height: 64,
      evidence: 'static-analysis'
    };
    nodes.push(outcomeNode);

    edges.push({
      id: `finding_edge_${idx}`,
      source: node.id,
      target: outcomeNode.id,
      label: 'exploitable path',
      type: 'error-flow',
      evidence: 'static-analysis'
    });

    yOffset += 110;
  });

  // Scan files for try/catch and error responses
  files.forEach((f) => {
    const content = f.content || '';
    if (content.includes('catch') || content.includes('throw') || content.includes('error(')) {
      const node = {
        id: `err_handler_${f.path}`,
        label: path.basename(f.path),
        subtitle: 'Contains Error Handlers',
        type: 'error-handler',
        x: 200,
        y: yOffset,
        width: 220,
        height: 64,
        path: f.path,
        line: 1,
        evidence: 'static-analysis'
      };
      nodes.push(node);

      const outcomeNode = {
        id: `err_outcome_${f.path}`,
        label: 'HTTP 4xx/5xx or Handled Fallback',
        subtitle: 'Catches exception gracefully',
        type: 'error-outcome',
        x: 580,
        y: yOffset,
        width: 240,
        height: 64,
        evidence: 'static-analysis'
      };
      nodes.push(outcomeNode);

      edges.push({
        id: `err_edge_${f.path}`,
        source: node.id,
        target: outcomeNode.id,
        label: 'propagates error',
        type: 'error-flow',
        evidence: 'static-analysis'
      });

      yOffset += 95;
    }
  });

  // Fallback: if no nodes found at all, produce a placeholder
  if (nodes.length === 0) {
    nodes.push({
      id: 'no_errors_node',
      label: 'No Error Paths Detected',
      subtitle: 'Codebase has no identified exception surfaces',
      type: 'error-node',
      x: 200,
      y: 80,
      width: 300,
      height: 64,
      evidence: 'static-analysis'
    });
  }

  return {
    diagramType: 'error-paths',
    title: 'Error & Exception Failure Paths',
    description: 'Traces exception boundaries, catch handlers, rejection gates, HTTP error responses, and security findings.',
    evidenceType: 'static-analysis',
    nodes: nodes.slice(0, 40),
    edges: edges.slice(0, 35)
  };
}

/**
 * Universal Flow Generator Dispatcher
 */
async function generateFlowDiagram(store, projectId, revisionId, options = {}) {
  const type = options.type || 'architecture';
  switch (type) {
    case 'call-graph':
      return await generateCallGraph(store, revisionId, options.symbol);
    case 'flowchart':
      return await generateExecutionFlowchart(store, revisionId, options.symbol);
    case 'api-lifecycle':
      return await generateApiLifecycleFlow(store, revisionId, options.route);
    case 'dependency':
      return await generateDependencyFlow(store, revisionId);
    case 'change-impact':
      return await generateChangeImpactFlow(store, revisionId, options.file);
    case 'error-paths':
      return await generateErrorPathsFlow(store, revisionId);
    case 'architecture':
    default:
      return await generateArchitectureFlow(store, revisionId);
  }
}

module.exports = {
  generateFlowDiagram,
  generateArchitectureFlow,
  generateCallGraph,
  generateExecutionFlowchart,
  generateApiLifecycleFlow,
  generateDependencyFlow,
  generateChangeImpactFlow,
  generateErrorPathsFlow
};
