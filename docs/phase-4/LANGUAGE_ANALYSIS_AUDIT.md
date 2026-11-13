# Language Analysis Audit

| Language/category | Recognition | Analysis method | Evidence label |
| --- | --- | --- | --- |
| JavaScript, JSX, CommonJS, ESM | Extension + filename | `@babel/parser` syntax tree | `static-ast` |
| TypeScript, TSX | Extension | `@babel/parser` TypeScript/JSX plugins | `static-ast` |
| Python | Extension | `@lezer/python` concrete syntax tree | `static-ast` |
| Dockerfile/Compose | Filename | lexical/regex rules | rule/lexical evidence, not AST |
| SQL | Extension | regex table inventory | lexical evidence, not AST |
| Java, C/C++, C#, Go, Rust, Ruby, PHP, JSON, YAML, TOML, Markdown, HTML, CSS, Shell | Extension only | inventory unless a dedicated rule exists | no AST claim |
| Unknown extension | Inventory | none | unsupported |

Validated parser cases include imports/exports, CommonJS, dynamic imports, functions, nested functions, classes, methods, TypeScript interfaces/types, calls, routes, decorators, aliases, Python relative imports, source lines, syntax errors and parser recovery diagnostics.

AST evidence is `statically-inferred`, not automatically `confirmed`. Confirmation requires independent corroboration, such as a real runtime trace. No runtime trace was generated in Phase 4.

Limitations include dynamic property resolution, reflection, generated code, module alias configuration, Python star-import binding, cross-language calls, type resolution and semantic control/data-flow analysis. The parsers establish syntax structure; they are not compilers or full language servers.
