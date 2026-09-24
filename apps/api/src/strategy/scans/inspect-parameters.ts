import type { StrategyParamValue } from '@jixie/shared';
import ts from 'typescript';
import { StrategyError } from '../errors.js';

/** Read scan defaults without loading the strategy runtime or evaluating any source expression. */
export async function inspectStrategyParameters(
  code: string,
): Promise<Record<string, StrategyParamValue>> {
  const source = ts.createSourceFile('/strategy.ts', code, ts.ScriptTarget.Latest, true);
  const sdk = ts.createSourceFile(
    '/strategy-sdk.d.ts',
    'declare function defineStrategy(definition: unknown): unknown;',
    ts.ScriptTarget.Latest,
    true,
  );
  // Bind only these in-memory files. Never resolve imports, read libraries or emit user code.
  const sources = new Map([source, sdk].map((file) => [file.fileName, file]));
  const program = ts.createProgram({
    rootNames: [...sources.keys()],
    options: { noLib: true, noResolve: true, noEmit: true, types: [] },
    host: {
      getSourceFile: (fileName) => sources.get(fileName),
      getDefaultLibFileName: () => '',
      writeFile: () => {},
      getCurrentDirectory: () => '/',
      getDirectories: () => [],
      fileExists: (fileName) => sources.has(fileName),
      readFile: (fileName) => sources.get(fileName)?.text,
      getCanonicalFileName: (fileName) => fileName,
      useCaseSensitiveFileNames: () => true,
      getNewLine: () => '\n',
    },
  });
  const diagnostics = program.getSyntacticDiagnostics(source);
  const syntaxError = diagnostics.find(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  if (syntaxError) {
    throw invalid(source, 'syntax', syntaxError.start);
  }

  for (const statement of source.statements) {
    if (
      ts.isExportDeclaration(statement) &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause) &&
      statement.exportClause.elements.some((element) => element.name.text === 'default')
    ) {
      throw invalid(statement, 'export default');
    }
  }
  const exports = source.statements.filter(ts.isExportAssignment);
  if (exports.length !== 1 || exports[0].isExportEquals) {
    throw invalid(source, 'export default');
  }
  const checker = program.getTypeChecker();
  let declaration = unwrap(exports[0].expression);
  if (ts.isIdentifier(declaration)) {
    const reference = declaration;
    const declarations = source.statements
      .filter(ts.isVariableStatement)
      .flatMap((statement) =>
        statement.declarationList.flags & ts.NodeFlags.Const
          ? [...statement.declarationList.declarations]
          : [],
      );
    const candidates = declarations.filter(
      (candidate) => ts.isIdentifier(candidate.name) && candidate.name.text === reference.text,
    );
    const candidate = candidates[0];
    if (candidates.length !== 1 || !candidate.initializer) {
      throw invalid(reference, 'export default');
    }
    const strategySymbol = checker.getSymbolAtLocation(candidate.name);
    if (!strategySymbol || checker.getSymbolAtLocation(reference) !== strategySymbol) {
      throw invalid(reference, 'export default');
    }
    // An escaping/mutated object cannot be safely resolved from its initializer alone.
    visit(source, (node) => {
      if (
        ts.isIdentifier(node) &&
        referenceSymbol(node) === strategySymbol &&
        node !== candidate.name &&
        node !== reference
      ) {
        throw invalid(node, 'export default');
      }
    });
    declaration = unwrap(candidate.initializer);
  }

  if (ts.isCallExpression(declaration)) {
    const factory = unwrap(declaration.expression);
    if (
      !ts.isIdentifier(factory) ||
      factory.text !== 'defineStrategy' ||
      declaration.arguments.length !== 1 ||
      declaration.questionDotToken
    ) {
      throw invalid(declaration, 'defineStrategy');
    }
    // Only the injected SDK factory is supported, not a user-defined or imported replacement.
    const sdkDeclaration = sdk.statements[0] as ts.FunctionDeclaration;
    const factorySymbol = checker.getSymbolAtLocation(sdkDeclaration.name!);
    if (!factorySymbol || checker.getSymbolAtLocation(factory) !== factorySymbol) {
      throw invalid(factory, 'defineStrategy');
    }
    visit(source, (node) => {
      if (ts.isIdentifier(node) && node !== factory && referenceSymbol(node) === factorySymbol) {
        throw invalid(node, 'defineStrategy');
      }
    });
    declaration = unwrap(declaration.arguments[0]);
  }
  if (!ts.isObjectLiteralExpression(declaration)) {
    throw invalid(declaration, 'strategy');
  }

  let parameters: ts.Expression | undefined;
  for (const property of declaration.properties) {
    // A spread or computed key could introduce or replace params, even when none is explicit.
    if (ts.isSpreadAssignment(property) || ts.isComputedPropertyName(property.name)) {
      throw invalid(property, 'strategy');
    }
    if (property.name.text === '__proto__') {
      throw invalid(property, 'strategy');
    }
    if (property.name.text !== 'params') {
      continue;
    }
    if (parameters || !ts.isPropertyAssignment(property)) {
      throw invalid(property, 'params');
    }
    parameters = property.initializer;
  }
  if (!parameters) {
    return {};
  }
  const object = unwrap(parameters);
  if (!ts.isObjectLiteralExpression(object) || object.properties.length > 256) {
    throw invalid(object, 'params');
  }

  const entries: Array<[string, StrategyParamValue]> = [];
  const keys = new Set<string>();
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property) || ts.isComputedPropertyName(property.name)) {
      throw invalid(property, 'params');
    }
    const key = property.name.text;
    if (!key.trim() || key.length > 256 || key === '__proto__' || keys.has(key)) {
      throw invalid(property, 'params');
    }
    keys.add(key);
    const value = unwrap(property.initializer);
    let literal: StrategyParamValue;
    if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
      literal = value.text;
      if (!literal.trim() || literal.length > 100) {
        throw invalid(value, `params.${key}`);
      }
    } else if (ts.isNumericLiteral(value)) {
      literal = Number(value.text);
    } else if (
      ts.isPrefixUnaryExpression(value) &&
      (value.operator === ts.SyntaxKind.MinusToken || value.operator === ts.SyntaxKind.PlusToken) &&
      ts.isNumericLiteral(unwrap(value.operand))
    ) {
      const operand = unwrap(value.operand) as ts.NumericLiteral;
      literal = Number(operand.text) * (value.operator === ts.SyntaxKind.MinusToken ? -1 : 1);
    } else {
      throw invalid(value, `params.${key}`);
    }
    if (typeof literal === 'number' && !Number.isFinite(literal)) {
      throw invalid(value, `params.${key}`);
    }
    entries.push([key, literal]);
  }
  return Object.fromEntries(entries);

  function referenceSymbol(identifier: ts.Identifier): ts.Symbol | undefined {
    const parent = identifier.parent;
    // A shorthand property's own symbol is distinct from the value it captures.
    if (ts.isShorthandPropertyAssignment(parent) && parent.name === identifier) {
      return checker.getShorthandAssignmentValueSymbol(parent);
    }
    if (ts.isExportSpecifier(parent)) {
      return checker.getExportSpecifierLocalTargetSymbol(parent);
    }
    return checker.getSymbolAtLocation(identifier);
  }

  function invalid(node: ts.Node, field: string, position = node.getStart(source)): StrategyError {
    const { line, character } = source.getLineAndCharacterOfPosition(position);
    return new StrategyError('strategy_scan_params_not_static', {
      params: { field, line: line + 1, column: character + 1 },
      details: { field, line: line + 1, column: character + 1, syntax: ts.SyntaxKind[node.kind] },
    });
  }
}

function unwrap(expression: ts.Expression): ts.Expression {
  while (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  ) {
    expression = expression.expression;
  }
  return expression;
}

function visit(node: ts.Node, callback: (node: ts.Node) => void): void {
  callback(node);
  ts.forEachChild(node, (child) => visit(child, callback));
}
