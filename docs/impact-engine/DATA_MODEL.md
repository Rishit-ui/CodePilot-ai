# CodePilot Impact Engine — Data Model

## Graph Node

Each node in the `TypedDependencyGraph` represents an entity in the codebase.

```js
{
  id: string,           // Unique identifier (e.g. "file:src/api/routes.js")
  kind: NodeKind,       // FILE | FUNCTION | CLASS | MODULE | ENDPOINT | CONFIG_KEY | TEST
  label: string,        // Human-readable name
  metadata: {
    filePath?: string,
    language?: string,  // "javascript" | "typescript" | "python" | "dockerfile"
    lineStart?: number,
    lineEnd?: number,
    framework?: string,
  }
}
```

### NodeKind Enumeration

| Value | Meaning |
|-------|---------|
| `FILE` | A source file |
| `FUNCTION` | A named function or method |
| `CLASS` | A class definition |
| `MODULE` | A package or module (e.g. npm dependency) |
| `ENDPOINT` | An HTTP route (e.g. `GET /api/health`) |
| `CONFIG_KEY` | An environment variable or configuration key |
| `TEST` | A test file or test declaration |

## Graph Edge

Each edge represents a directed dependency relationship with attached evidence.

```js
{
  from: string,         // Source node ID
  to: string,           // Target node ID
  type: EdgeType,       // See below
  evidence: EvidenceRecord[],
  validationStatus: ValidationStatus,  // CORROBORATED | UNVERIFIED | CONTRADICTED | INVALIDATED
  confidence: number,   // 0.0 – 1.0
  weight: number        // Derived from evidence strength and rule outcomes
}
```

### EdgeType Enumeration

| Value | Meaning |
|-------|---------|
| `IMPORTS` | Static import / require |
| `CALLS` | Function or method call |
| `EXTENDS` | Class inheritance |
| `IMPLEMENTS` | Interface / protocol implementation |
| `ROUTES_TO` | HTTP handler routes to a function |
| `CONFIGURES` | Code reads a config key |
| `TESTS` | Test file exercises a target |
| `RUNTIME_CALLS` | Call observed in runtime trace |
| `API_USES` | Cross-service dependency from API spec |

## Evidence Record

Evidence records attach source-specific justification to each edge.

```js
{
  source: EvidenceSource, // STATIC_ANALYSIS | RUNTIME_TRACE | API_SPEC | CONFIG_FILE | TEST_COVERAGE
  revisionId: string,     // Git revision or ingestion revision that produced this evidence
  data: object,           // Source-specific payload
  timestamp: number       // Unix ms
}
```

### EvidenceSource Enumeration

| Value | Meaning |
|-------|---------|
| `STATIC_ANALYSIS` | Derived from AST or regex parsing |
| `RUNTIME_TRACE` | From instrumented execution |
| `API_SPEC` | From OpenAPI / Swagger specification |
| `CONFIG_FILE` | From configuration files (docker-compose, .env, etc.) |
| `TEST_COVERAGE` | From test coverage reports |

## ValidationStatus Enumeration

| Value | Meaning |
|-------|---------|
| `CORROBORATED` | Multiple independent evidence sources agree |
| `UNVERIFIED` | Only a single evidence source |
| `CONTRADICTED` | Evidence sources disagree (conflict recorded) |
| `INVALIDATED` | A source revision has been marked stale |

## Impact Analysis Result

The result returned by `ChangeImpactEngine.computeImpact()`:

```js
{
  changedFiles: string[],          // Input: files that changed
  direct: string[],                // Nodes directly importing/calling changed files
  transitive: string[],            // Nodes reachable through dependency chains
  uncertainty: string[],           // Nodes with CONTRADICTED or UNVERIFIED edges
  affectedEndpoints: string[],     // HTTP endpoints in the impact cone
  affectedConfigKeys: string[]     // Config keys in the impact cone
}
```

## Test Selection Result

```js
{
  strategy: "all" | "changed-file" | "evidence-aware",
  selectedTests: Array<{ file: string, kind: NodeKind, label: string }>,
  totalAvailable: number,
  selectedCount: number,
  reduction: number  // 0.0 – 1.0 (fraction of tests not executed)
}
```

## Database Schema

The `impact_analyses` table in SQLite (`src/db.js`):

```sql
CREATE TABLE IF NOT EXISTS impact_analyses (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  changed_files TEXT,      -- JSON array of file paths
  direct_count INTEGER,
  transitive_count INTEGER,
  uncertainty_count INTEGER,
  strategy TEXT,
  selected_count INTEGER,
  total_available INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
```

### Columns

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT | UUID v4 primary key |
| `project_id` | TEXT | FK to `projects.id` |
| `changed_files` | TEXT | JSON-serialized array of changed file paths |
| `direct_count` | INTEGER | Size of direct impact set |
| `transitive_count` | INTEGER | Size of transitive impact set |
| `uncertainty_count` | INTEGER | Size of uncertainty cone |
| `strategy` | TEXT | Test selection strategy used |
| `selected_count` | INTEGER | Number of tests selected |
| `total_available` | INTEGER | Total tests in the graph |
| `created_at` | TEXT | ISO timestamp |
