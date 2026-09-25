import * as ts from 'typescript';

import { unwrapTypeSyntax } from './walk';

/**
 * A function form that can act as a page/template component.
 */
export type ComponentFunction = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction;

/**
 * A top-level component declaration discovered in a module.
 */
export type ComponentInfo = {
    /**
     * The component name (PascalCase by convention).
     */
    name: string,
    /**
     * The component function.
     */
    fn: ComponentFunction,
    /**
     * Whether the declaration is exported.
     */
    exported: boolean,
    /**
     * Whether the declaration is the default export.
     */
    isDefault: boolean
};

/**
 * Whether a name follows the PascalCase convention used for components.
 * @param name - The identifier to test.
 * @returns True when the first character is an uppercase letter.
 */
export function isPascalCase(name: string): boolean {
    const first: string = name.charAt(0);
    return first >= 'A' && first <= 'Z';
}

/**
 * Operators whose result is one of their operands, so JSX on either side can be what they yield.
 */
const LOGICAL_OPERATORS: ReadonlySet<ts.SyntaxKind> = new Set<ts.SyntaxKind>([
    ts.SyntaxKind.AmpersandAmpersandToken,
    ts.SyntaxKind.BarBarToken,
    ts.SyntaxKind.QuestionQuestionToken
]);

/**
 * Whether an expression evaluates to JSX (unwrapping parentheses, ternaries, `&&`/`||`/`??` and the
 * comma operator, and looking through type-only wrappers).
 * @param node - The expression to inspect.
 * @returns True when the expression yields a JSX element or fragment.
 */
export function isJsxExpression(node: ts.Expression): boolean {
    const expression: ts.Expression = unwrapTypeSyntax(node);
    if (ts.isJsxElement(expression) || ts.isJsxSelfClosingElement(expression) || ts.isJsxFragment(expression)) {
        return true;
    }
    if (ts.isParenthesizedExpression(expression)) {
        return isJsxExpression(expression.expression);
    }
    if (ts.isConditionalExpression(expression)) {
        return isJsxExpression(expression.whenTrue) || isJsxExpression(expression.whenFalse);
    }
    if (ts.isBinaryExpression(expression) && LOGICAL_OPERATORS.has(expression.operatorToken.kind)) {
        return isJsxExpression(expression.left) || isJsxExpression(expression.right);
    }
    if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.CommaToken) {
        return isJsxExpression(expression.right);
    }
    return false;
}

/**
 * Whether a function returns JSX at its own scope (a concise arrow JSX body, or a `return`
 * statement yielding JSX that is not inside a nested function).
 * @param fn - The function to inspect.
 * @returns True when the function is a component (returns JSX).
 */
export function returnsJsx(fn: ComponentFunction): boolean {
    if (fn.body == undefined) {
        return false;
    }
    if (!ts.isBlock(fn.body)) {
        return isJsxExpression(fn.body);
    }
    return statementsReturnJsx(fn.body.statements);
}

/**
 * Whether any `return` statement directly within the given statements (not descending into nested
 * functions) returns JSX.
 * @param statements - The statements to scan.
 * @returns True when a JSX return is found.
 */
function statementsReturnJsx(statements: readonly ts.Statement[]): boolean {
    return statements.some(statementReturnsJsx);
}

/**
 * Whether a statement, or a statement nested in its control flow, returns JSX.
 * @param statement - The statement to scan.
 * @returns True when a JSX return is found.
 */
function statementReturnsJsx(statement: ts.Statement): boolean {
    if (ts.isReturnStatement(statement)) {
        return statement.expression != undefined && isJsxExpression(statement.expression);
    }
    return statementsReturnJsx(nestedStatements(statement));
}

/**
 * The statements directly nested in a statement's control flow: a block's statements, the branches of
 * an `if`, the body of a loop or label, the blocks of a `try` and the statements of each `switch` case.
 * A nested function is not control flow, so nothing inside one is included.
 * @param statement - The statement.
 * @returns The nested statements.
 */
export function nestedStatements(statement: ts.Statement): ts.Statement[] {
    if (ts.isBlock(statement)) {
        return [...statement.statements];
    }
    if (ts.isIfStatement(statement)) {
        return statement.elseStatement == undefined ? [statement.thenStatement] : [statement.thenStatement, statement.elseStatement];
    }
    if (ts.isForStatement(statement) || ts.isForOfStatement(statement) || ts.isForInStatement(statement)
        || ts.isWhileStatement(statement) || ts.isDoStatement(statement) || ts.isLabeledStatement(statement)) {
        return [statement.statement];
    }
    if (ts.isTryStatement(statement)) {
        return [
            statement.tryBlock,
            ...statement.catchClause == undefined ? [] : [statement.catchClause.block],
            ...statement.finallyBlock == undefined ? [] : [statement.finallyBlock]
        ];
    }
    if (ts.isSwitchStatement(statement)) {
        return statement.caseBlock.clauses.flatMap(clause => [...clause.statements]);
    }
    return [];
}

/**
 * Whether a statement carries the given modifier.
 * @param node - The statement to inspect.
 * @param kind - The modifier keyword.
 * @returns True when the modifier is present.
 */
export function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
    return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some(modifier => modifier.kind === kind);
}

/**
 * Finds the top-level component declarations in a module. A component is a PascalCase-named
 * function or const-bound arrow/function that returns JSX.
 * @param file - The parsed template.
 * @returns The discovered components in source order.
 */
export function findComponents(file: ts.SourceFile): ComponentInfo[] {
    return file.statements.flatMap(componentsOf);
}

/**
 * The components one top-level statement declares.
 * @param statement - The statement.
 * @returns Its components, in source order.
 */
function componentsOf(statement: ts.Statement): ComponentInfo[] {
    if (ts.isExportAssignment(statement)) {
        const expression: ts.Expression = unwrapTypeSyntax(statement.expression);
        if (statement.isExportEquals === true || !isComponentFunction(expression) || !returnsJsx(expression)) {
            return [];
        }
        return [{ name: 'default', fn: expression, exported: true, isDefault: true }];
    }
    const exported: boolean = hasModifier(statement, ts.SyntaxKind.ExportKeyword);
    if (ts.isFunctionDeclaration(statement)) {
        const isDefault: boolean = exported && hasModifier(statement, ts.SyntaxKind.DefaultKeyword);
        return asComponent(statement.name?.text ?? '', statement, exported, isDefault);
    }
    if (!ts.isVariableStatement(statement)) {
        return [];
    }
    return statement.declarationList.declarations.flatMap(declaration => {
        const init: ts.Expression | undefined = declaration.initializer == undefined
            ? undefined
            : unwrapTypeSyntax(declaration.initializer);
        return ts.isIdentifier(declaration.name) && init != undefined && isComponentFunction(init)
            ? asComponent(declaration.name.text, init, exported, false)
            : [];
    });
}

/**
 * Whether an expression is a function that can be a component.
 * @param node - The expression to test.
 * @returns True for an arrow function or a function expression.
 */
function isComponentFunction(node: ts.Expression): node is ts.ArrowFunction | ts.FunctionExpression {
    return ts.isArrowFunction(node) || ts.isFunctionExpression(node);
}

/**
 * A function as a component, when it is named like one and returns JSX.
 * @param name - The declared name.
 * @param fn - The function.
 * @param exported - Whether it is exported.
 * @param isDefault - Whether it is the default export.
 * @returns The component, or nothing.
 */
function asComponent(name: string, fn: ComponentFunction, exported: boolean, isDefault: boolean): ComponentInfo[] {
    return isPascalCase(name) && returnsJsx(fn) ? [{ name, fn, exported, isDefault }] : [];
}