async function generatePlanFromRequirement(store, project, revision, requirement) {
  const reqLower = requirement.toLowerCase();
  const files = await store.all('SELECT path, language FROM files WHERE revision_id=? AND excluded_reason IS NULL', revision.id);

  // Identify affected files & components
  const targetFiles = [];
  if (reqLower.includes('auth') || reqLower.includes('login') || reqLower.includes('session')) {
    files.filter((f) => /auth|user|session|login|security/i.test(f.path)).forEach((f) => targetFiles.push(f.path));
  }
  if (reqLower.includes('docker') || reqLower.includes('container')) {
    files.filter((f) => /docker|compose|dockerfile/i.test(f.path)).forEach((f) => targetFiles.push(f.path));
  }
  if (reqLower.includes('api') || reqLower.includes('route') || reqLower.includes('endpoint')) {
    files.filter((f) => /api|server|route|app/i.test(f.path)).forEach((f) => targetFiles.push(f.path));
  }
  if (reqLower.includes('db') || reqLower.includes('database') || reqLower.includes('model') || reqLower.includes('schema')) {
    files.filter((f) => /db|model|schema|migration|sql/i.test(f.path)).forEach((f) => targetFiles.push(f.path));
  }

  // Determine complexity
  let complexity = 'medium';
  if (reqLower.includes('refactor') || reqLower.includes('rewrite') || reqLower.includes('migration') || targetFiles.length > 5) {
    complexity = 'high';
  } else if (targetFiles.length <= 1) {
    complexity = 'low';
  }

  // Construct tasks
  const tasks = [];
  tasks.push({
    title: `Requirement Analysis & Contract Verification`,
    description: `Inspect existing entry points and contracts for "${requirement.slice(0, 60)}"`,
    targetFile: targetFiles[0] || files[0]?.path || null,
    acceptanceCriteria: 'Input validation rules and interfaces specified.'
  });

  tasks.push({
    title: `Core Implementation & Business Logic`,
    description: `Implement the requested capability with server-side authorization and error boundaries.`,
    targetFile: targetFiles[0] || 'src/index.js',
    acceptanceCriteria: 'Code implemented cleanly with no regressions in existing routes.'
  });

  tasks.push({
    title: `Automated Test Verification`,
    description: `Add test cases covering normal behavior, error states, and boundary conditions.`,
    targetFile: files.find((f) => f.path.includes('test'))?.path || 'tests/feature.test.js',
    acceptanceCriteria: 'Automated test suite executes and passes.'
  });

  tasks.push({
    title: `Security & Deployment Validation`,
    description: `Verify that no secrets are exposed and environment configuration is documented.`,
    targetFile: '.env.example',
    acceptanceCriteria: 'Diagnostics pass with zero new high/critical findings.'
  });

  const plan = await store.createPlan(
    project.id,
    revision.id,
    `Implementation Plan: ${requirement.slice(0, 50)}`,
    requirement,
    complexity,
    tasks
  );

  return plan;
}

// Simple unified diff generator
function createUnifiedDiff(filename, oldText, newText) {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  let diff = `--- a/${filename}\n+++ b/${filename}\n@@ -1,${oldLines.length} +1,${newLines.length} @@\n`;

  // Basic line-by-line comparison
  const max = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < max; i++) {
    const o = oldLines[i];
    const n = newLines[i];
    if (o === n) {
      diff += ` ${o || ''}\n`;
    } else {
      if (o !== undefined) diff += `-${o}\n`;
      if (n !== undefined) diff += `+${n}\n`;
    }
  }
  return diff;
}

module.exports = {
  generatePlanFromRequirement,
  createUnifiedDiff
};
