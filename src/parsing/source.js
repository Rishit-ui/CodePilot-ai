const babel = require('@babel/parser');
const { parser: pythonParser } = require('@lezer/python');

function nodeName(node) {
  if (!node) return null;
  if (node.type === 'Identifier' || node.type === 'JSXIdentifier') return node.name;
  if (node.type === 'StringLiteral') return node.value;
  if (node.type === 'PrivateName') return nodeName(node.id);
  if (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') {
    const left = nodeName(node.object);
    const right = nodeName(node.property);
    return left && right ? `${left}.${right}` : left || right;
  }
  return null;
}

function literalValue(node) {
  if (!node) return null;
  if (node.type === 'StringLiteral' || node.type === 'Literal') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0]?.value?.cooked ?? null;
  }
  return null;
}

function parseJavaScript(content, filePath = 'source.js') {
  const isTypeScript = /\.(?:ts|tsx)$/i.test(filePath);
  const isJsx = /\.(?:jsx|tsx)$/i.test(filePath);
  const result = {
    parser: '@babel/parser', evidence: 'static-ast', recovered: false, errors: [],
    symbols: [], imports: [], exports: [], calls: [], routes: [], tests: [], configKeys: []
  };
  let ast;
  try {
    ast = babel.parse(content, {
      sourceType: 'unambiguous',
      errorRecovery: true,
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
      plugins: [
        ...(isTypeScript ? ['typescript'] : []),
        ...(isJsx ? ['jsx'] : []),
        'decorators-legacy', 'dynamicImport', 'importAttributes', 'classProperties',
        'classPrivateProperties', 'classPrivateMethods', 'topLevelAwait'
      ]
    });
    result.errors = (ast.errors || []).map((error) => ({
      message: error.message, line: error.loc?.line || null, column: error.loc?.column || null
    }));
    result.recovered = result.errors.length > 0;
  } catch (error) {
    result.errors.push({ message: error.message, line: error.loc?.line || null, column: error.loc?.column || null });
    return result;
  }

  const seenConfig = new Set();
  function addConfig(name, line) {
    if (!name) return;
    const key = `${name}:${line}`;
    if (!seenConfig.has(key)) result.configKeys.push({ name, line });
    seenConfig.add(key);
  }

  function visit(node, parent = null) {
    if (!node || typeof node !== 'object' || typeof node.type !== 'string') return;
    const line = node.loc?.start?.line || 1;

    if (node.type === 'FunctionDeclaration' && node.id) {
      result.symbols.push({ kind: 'function', name: node.id.name, line, exported: parent?.type?.startsWith('Export') || false });
    } else if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier' && ['ArrowFunctionExpression', 'FunctionExpression'].includes(node.init?.type)) {
      result.symbols.push({ kind: 'function', name: node.id.name, line, exported: parent?.type?.startsWith('Export') || false });
    } else if (['ClassDeclaration', 'ClassExpression'].includes(node.type) && node.id) {
      result.symbols.push({ kind: 'class', name: node.id.name, line, parent: nodeName(node.superClass) });
    } else if (node.type === 'ClassMethod' || node.type === 'ClassPrivateMethod' || node.type === 'ObjectMethod') {
      const name = nodeName(node.key);
      if (name) result.symbols.push({ kind: 'method', name, line });
    } else if (node.type === 'TSInterfaceDeclaration') {
      result.symbols.push({ kind: 'interface', name: node.id.name, line });
    } else if (node.type === 'TSTypeAliasDeclaration') {
      result.symbols.push({ kind: 'type', name: node.id.name, line });
    }

    if (node.type === 'ImportDeclaration') {
      result.imports.push({ specifier: node.source.value, line, kind: 'esm', dynamic: false });
    } else if (node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration') {
      if (node.source?.value) result.imports.push({ specifier: node.source.value, line, kind: 're-export', dynamic: false });
      result.exports.push({ name: node.declaration?.id?.name || (node.type === 'ExportDefaultDeclaration' ? 'default' : null), line });
    } else if (node.type === 'ImportExpression') {
      const specifier = literalValue(node.source);
      if (specifier) result.imports.push({ specifier, line, kind: 'dynamic', dynamic: true });
    } else if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') {
      const callee = nodeName(node.callee);
      const first = literalValue(node.arguments?.[0]);
      if (callee === 'require' && first) result.imports.push({ specifier: first, line, kind: 'commonjs', dynamic: false });
      if (node.callee?.type === 'Import' && first) result.imports.push({ specifier: first, line, kind: 'dynamic', dynamic: true });
      if (callee) result.calls.push({ name: callee, line });
      const routeMatch = callee?.match(/(?:^|\.)(get|post|put|patch|delete|all|options|head)$/i);
      if (routeMatch && first && /^(?:app|router|server)\./.test(callee)) {
        result.routes.push({ method: routeMatch[1].toUpperCase(), path: first, line });
      }
      if (/^(?:test|it)$/.test(callee || '') && first) result.tests.push({ name: first, line });
    }

    if ((node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') && nodeName(node.object) === 'process.env') {
      addConfig(node.computed ? literalValue(node.property) : nodeName(node.property), line);
    }

    for (const [key, value] of Object.entries(node)) {
      if (['loc', 'start', 'end', 'extra', 'errors', 'tokens', 'comments'].includes(key)) continue;
      if (Array.isArray(value)) value.forEach((child) => visit(child, node));
      else if (value && typeof value === 'object' && typeof value.type === 'string') visit(value, node);
    }
  }
  visit(ast.program);
  return result;
}

function pythonChildren(node) {
  const children = [];
  let child = node.firstChild;
  while (child) {
    children.push(child);
    child = child.nextSibling;
  }
  return children;
}

function pythonNodeText(content, node) {
  return content.slice(node.from, node.to);
}

function pythonLine(content, offset) {
  let line = 1;
  for (let index = 0; index < offset; index += 1) if (content.charCodeAt(index) === 10) line += 1;
  return line;
}

function parsePython(content) {
  const tree = pythonParser.parse(content);
  const result = {
    parser: '@lezer/python', evidence: 'static-ast', recovered: false, errors: [],
    symbols: [], imports: [], exports: [], calls: [], routes: [], tests: [], configKeys: []
  };

  function firstNamed(node, type) {
    const queue = pythonChildren(node);
    while (queue.length) {
      const current = queue.shift();
      if (current.name === type) return current;
      queue.push(...pythonChildren(current));
    }
    return null;
  }

  function visit(node, decorators = []) {
    const line = pythonLine(content, node.from);
    const text = pythonNodeText(content, node);
    if (node.type.isError) {
      result.errors.push({ message: 'Python syntax error', line, column: null });
      result.recovered = true;
    }
    if (node.name === 'FunctionDefinition') {
      const nameNode = firstNamed(node, 'VariableName');
      if (nameNode) result.symbols.push({ kind: 'def', name: pythonNodeText(content, nameNode), line, decorators: [...decorators] });
    } else if (node.name === 'ClassDefinition') {
      const nameNode = firstNamed(node, 'VariableName');
      if (nameNode) result.symbols.push({ kind: 'class', name: pythonNodeText(content, nameNode), line });
    } else if (node.name === 'ImportStatement' || node.name === 'ImportFromStatement') {
      const match = text.match(/^\s*(?:from\s+([^\s]+)\s+import|import\s+([^\s,]+))/);
      const specifier = match?.[1] || match?.[2];
      if (specifier) result.imports.push({ specifier, line, kind: 'python', dynamic: false });
    } else if (node.name === 'CallExpression') {
      const calleeNode = node.firstChild;
      const callee = calleeNode ? pythonNodeText(content, calleeNode) : null;
      if (callee) result.calls.push({ name: callee, line });
      const envMatch = text.match(/^(?:os\.getenv|os\.environ\.get)\(\s*['"]([A-Za-z0-9_]+)['"]/);
      if (envMatch) result.configKeys.push({ name: envMatch[1], line });
    }

    const localDecorators = node.name === 'DecoratedStatement'
      ? pythonChildren(node).filter((child) => child.name === 'Decorator').map((child) => pythonNodeText(content, child))
      : decorators;
    for (const decorator of localDecorators) {
      const route = decorator.match(/@(?:[A-Za-z_][\w]*\.)?(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]/i);
      if (route) result.routes.push({ method: route[1].toUpperCase(), path: route[2], line });
    }
    for (const child of pythonChildren(node)) visit(child, localDecorators);
  }
  visit(tree.topNode);
  return result;
}

module.exports = { parseJavaScript, parsePython };
