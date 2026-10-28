function generateArchitectureReport(store, revisionId, project) {
  const files = store.all('SELECT path, language, bytes, excluded_reason FROM files WHERE revision_id=?', revisionId);
  const symbols = store.all('SELECT file_path, name, kind, line FROM symbols WHERE revision_id=?', revisionId);
  const edges = store.all('SELECT source_path, target_path, type, confidence, provenance FROM edges WHERE revision_id=?', revisionId);
  const findings = store.all('SELECT severity, category, message, file_path, line FROM findings WHERE revision_id=?', revisionId);

  // Groupings & analysis
  const languages = {};
  files.forEach((f) => {
    if (f.excluded_reason) return;
    languages[f.language] = (languages[f.language] || 0) + 1;
  });

  const routes = symbols.filter((s) => s.kind.startsWith('route:'));
  const envVars = [...new Set(symbols.filter((s) => s.kind === 'environment').map((s) => s.name))];
  const dbTables = symbols.filter((s) => s.kind === 'db-table');
  const dockerStages = symbols.filter((s) => s.kind === 'docker-stage');
  const composeServices = symbols.filter((s) => s.kind === 'compose-service');

  const highSeverityFindings = findings.filter((f) => f.severity === 'high' || f.severity === 'critical');

  // Generate 15-section comprehensive report
  const report = {
    executiveOverview: {
      title: '1. Executive Overview',
      content: `Project "${project.name}" contains ${files.length} indexed files across ${Object.keys(languages).length} language categories. ${routes.length} HTTP route endpoints and ${envVars.length} distinct environment configuration keys were statically detected. Current health assessment identified ${highSeverityFindings.length} critical/high security finding(s).`
    },
    technologyInventory: {
      title: '2. Technology Inventory',
      languages,
      manifests: files.filter((f) => /package\.json|pyproject\.toml|requirements\.txt|pom\.xml|go\.mod/i.test(f.path)).map((f) => f.path)
    },
    applicationBoundaries: {
      title: '3. Application Boundaries',
      entrypoints: symbols.filter((s) => s.kind === 'entrypoint').map((s) => s.name),
      isMonorepo: files.some((f) => f.path.startsWith('apps/') || f.path.startsWith('packages/'))
    },
    frontendArchitecture: {
      title: '4. Frontend Architecture',
      detected: files.some((f) => f.language === 'TypeScript' || f.language === 'JavaScript' || f.language === 'HTML'),
      uiFilesCount: files.filter((f) => /\.(jsx|tsx|vue|svelte|html|css)$/i.test(f.path)).length
    },
    backendArchitecture: {
      title: '5. Backend Architecture',
      services: composeServices.map((s) => s.name),
      frameworks: routes.length > 0 ? ['HTTP Web Service'] : ['Module/CLI Library']
    },
    apiArchitecture: {
      title: '6. API Architecture',
      routeCount: routes.length,
      endpoints: routes.map((r) => ({ endpoint: r.name, file: r.file_path, line: r.line }))
    },
    databaseArchitecture: {
      title: '7. Database Architecture',
      tables: dbTables.map((t) => t.name),
      hasSql: files.some((f) => f.language === 'SQL' || f.path.includes('migration'))
    },
    authFlow: {
      title: '8. Authentication & Authorization Flow',
      authReferences: symbols.filter((s) => /auth|token|session|login|jwt/i.test(s.name)).map((s) => ({ name: s.name, file: s.file_path }))
    },
    externalIntegrations: {
      title: '9. External Integration Map',
      packages: edges.filter((e) => e.target_path.startsWith('pkg:')).map((e) => e.target_path.replace('pkg:', ''))
    },
    configurationMap: {
      title: '10. Configuration Map',
      environmentVariables: envVars
    },
    testingArchitecture: {
      title: '11. Testing Architecture',
      testFiles: files.filter((f) => /\.(test|spec)\.[a-z]+$/i.test(f.path) || f.path.startsWith('tests/')).map((f) => f.path)
    },
    containerTopology: {
      title: '12. Container Topology',
      hasDockerfile: files.some((f) => f.path.toLowerCase().includes('dockerfile')),
      hasCompose: files.some((f) => f.path.includes('docker-compose')),
      stages: dockerStages.map((s) => s.name),
      services: composeServices.map((s) => s.name)
    },
    deploymentArchitecture: {
      title: '13. Deployment Architecture',
      readiness: highSeverityFindings.length === 0 ? 'Ready for staging verification' : 'Blocked by security findings',
      providerCandidates: ['local-docker', 'render', 'fly', 'vercel']
    },
    risksAndUnknowns: {
      title: '14. Risks & Unknowns',
      findingsCount: findings.length,
      highSeverity: highSeverityFindings.map((f) => ({ message: f.message, file: f.file_path, line: f.line }))
    },
    recommendedNextActions: {
      title: '15. Recommended Next Actions',
      actions: [
        highSeverityFindings.length > 0 ? 'Remediate critical/high credential findings.' : 'Review dependency vulnerabilities.',
        routes.length > 0 ? 'Ensure automated API test coverage for uncovered endpoints.' : 'Add unit and integration tests.',
        !files.some((f) => f.path.toLowerCase().includes('dockerfile')) ? 'Generate optimized Dockerfile and container configuration.' : 'Verify container build and healthcheck.',
        'Run deployment readiness audit before cloud provisioning.'
      ]
    }
  };

  return report;
}

function exportReportToMarkdown(report, projectName) {
  let md = `# CodePilot AI Architecture Report — ${projectName}\n\n`;
  md += `*Generated: ${new Date().toISOString()}*\n\n---\n\n`;

  for (const [key, section] of Object.entries(report)) {
    md += `## ${section.title}\n\n`;
    if (section.content) {
      md += `${section.content}\n\n`;
    }
    if (section.endpoints && section.endpoints.length > 0) {
      md += `### Endpoints (${section.endpoints.length})\n`;
      section.endpoints.forEach((ep) => {
        md += `- \`${ep.endpoint}\` — [${ep.file}:${ep.line}]\n`;
      });
      md += '\n';
    }
    if (section.environmentVariables && section.environmentVariables.length > 0) {
      md += `### Environment Variables (${section.environmentVariables.length})\n`;
      section.environmentVariables.forEach((env) => {
        md += `- \`${env}\`\n`;
      });
      md += '\n';
    }
    if (section.packages && section.packages.length > 0) {
      md += `### External Dependencies\n`;
      [...new Set(section.packages)].slice(0, 30).forEach((pkg) => {
        md += `- \`${pkg}\`\n`;
      });
      md += '\n';
    }
    if (section.actions && section.actions.length > 0) {
      md += `### Action Items\n`;
      section.actions.forEach((act, idx) => {
        md += `${idx + 1}. ${act}\n`;
      });
      md += '\n';
    }
  }

  return md;
}

module.exports = {
  generateArchitectureReport,
  exportReportToMarkdown
};
