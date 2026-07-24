import { ArrowFunctionExpression, BlockStatement, ExportDeclaration, Expression, FunctionDeclaration,
    FunctionExpression, Program, Statement, VariableDeclaration } from '../parser/ast';

/**
 * A function form that can act as a page/template component.
 */
export type ComponentFunction = FunctionDeclaration | FunctionExpression | ArrowFunctionExpression;

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
 * Whether an expression evaluates to JSX (unwrapping parentheses, ternaries, and `&&`/`||`).
 * @param expr - The expression to inspect.
 * @returns True when the expression yields a JSX element or fragment.
 */
export function isJsxExpression(expr: Expression): boolean {
    switch (expr.kind) {
        case 'JSXElement':
        case 'JSXFragment': {
            return true;
        }
        case 'ParenthesizedExpression': {
            return isJsxExpression(expr.expression);
        }
        case 'ConditionalExpression': {
            return isJsxExpression(expr.consequent) || isJsxExpression(expr.alternate);
        }
        case 'LogicalExpression': {
            return isJsxExpression(expr.left) || isJsxExpression(expr.right);
        }
        case 'SequenceExpression': {
            return isJsxExpression(expr.expressions[expr.expressions.length - 1]);
        }
        case 'Identifier':
        case 'NumericLiteral':
        case 'StringLiteral':
        case 'BooleanLiteral':
        case 'NullLiteral':
        case 'RegexLiteral':
        case 'TemplateLiteral':
        case 'TaggedTemplateExpression':
        case 'ThisExpression':
        case 'ArrayExpression':
        case 'ObjectExpression':
        case 'ArrowFunctionExpression':
        case 'FunctionExpression':
        case 'UnaryExpression':
        case 'UpdateExpression':
        case 'BinaryExpression':
        case 'AssignmentExpression':
        case 'NewExpression':
        case 'MemberExpression':
        case 'SpreadElement':
        case 'CallExpression': {
            return false;
        }
    }
}

/**
 * Whether a function returns JSX at its own scope (a concise arrow JSX body, or a `return`
 * statement yielding JSX that is not inside a nested function).
 * @param fn - The function to inspect.
 * @returns True when the function is a component (returns JSX).
 */
export function returnsJsx(fn: ComponentFunction): boolean {
    if (fn.kind === 'ArrowFunctionExpression' && fn.body.kind !== 'BlockStatement') {
        return isJsxExpression(fn.body);
    }
    const body: BlockStatement = fn.body as BlockStatement;
    return statementsReturnJsx(body.body);
}

/**
 * Whether any `return` statement directly within the given statements (not descending into nested
 * functions) returns JSX.
 * @param statements - The statements to scan.
 * @returns True when a JSX return is found.
 */
// eslint-disable-next-line sonar/cognitive-complexity
function statementsReturnJsx(statements: Statement[]): boolean {
    for (const statement of statements) {
        switch (statement.kind) {
            case 'ReturnStatement': {
                if (statement.argument && isJsxExpression(statement.argument)) {
                    return true;
                }
                break;
            }
            case 'BlockStatement': {
                if (statementsReturnJsx(statement.body)) {
                    return true;
                }
                break;
            }
            case 'IfStatement': {
                if (statementsReturnJsx([statement.consequent])
                    || (statement.alternate && statementsReturnJsx([statement.alternate]))) {
                    return true;
                }
                break;
            }
            case 'ForStatement':
            case 'ForOfStatement':
            case 'WhileStatement':
            case 'LabeledStatement': {
                if (statementsReturnJsx([statement.body])) {
                    return true;
                }
                break;
            }
            case 'TryStatement': {
                if (statementsReturnJsx(statement.block.body)
                    || (statement.handlerBody && statementsReturnJsx(statement.handlerBody.body))
                    || (statement.finalizer && statementsReturnJsx(statement.finalizer.body))) {
                    return true;
                }
                break;
            }
            case 'SwitchStatement': {
                if (statement.cases.some(c => statementsReturnJsx(c.consequent))) {
                    return true;
                }
                break;
            }
            case 'FunctionDeclaration':
            case 'VariableDeclaration':
            case 'ExpressionStatement':
            case 'BreakStatement':
            case 'ContinueStatement':
            case 'ThrowStatement':
            case 'EmptyStatement': {
                break;
            }
        }
    }
    return false;
}

/**
 * Finds the top-level component declarations in a module. A component is a PascalCase-named
 * function or const-bound arrow/function that returns JSX.
 * @param program - The parsed program.
 * @returns The discovered components in source order.
 */
export function findComponents(program: Program): ComponentInfo[] {
    const components: ComponentInfo[] = [];
    for (const item of program.body) {
        switch (item.kind) {
            case 'FunctionDeclaration': {
                pushIfComponent(components, item.id, item, false, false);
                break;
            }
            case 'VariableDeclaration': {
                collectFromVariableDeclaration(components, item, false);
                break;
            }
            case 'ExportDeclaration': {
                collectFromExport(components, item);
                break;
            }
            case 'BlockStatement':
            case 'ExpressionStatement':
            case 'ReturnStatement':
            case 'IfStatement':
            case 'ForStatement':
            case 'ForOfStatement':
            case 'WhileStatement':
            case 'BreakStatement':
            case 'ContinueStatement':
            case 'ThrowStatement':
            case 'TryStatement':
            case 'SwitchStatement':
            case 'EmptyStatement':
            case 'LabeledStatement':
            case 'ImportDeclaration':
                // No default

        }
    }
    return components;
}

// eslint-disable-next-line jsdoc/require-jsdoc
function collectFromExport(components: ComponentInfo[], item: ExportDeclaration): void {
    if (item.declaration?.kind === 'FunctionDeclaration') {
        pushIfComponent(components, item.declaration.id, item.declaration, true, item.default);
    }
    else if (item.declaration?.kind === 'VariableDeclaration') {
        collectFromVariableDeclaration(components, item.declaration, true);
    }
    else if (item.default && item.expression && isComponentFunction(item.expression) && returnsJsx(item.expression)) {
        components.push({ name: 'default', fn: item.expression, exported: true, isDefault: true });
    }
}

// eslint-disable-next-line jsdoc/require-jsdoc
function collectFromVariableDeclaration(
    components: ComponentInfo[],
    declaration: VariableDeclaration,
    exported: boolean
): void {
    for (const declarator of declaration.declarations) {
        if (declarator.id.kind === 'IdentifierPattern' && declarator.init && isComponentFunction(declarator.init)) {
            pushIfComponent(components, declarator.id.name, declarator.init, exported, false);
        }
    }
}

// eslint-disable-next-line jsdoc/require-jsdoc
function isComponentFunction(expr: Expression): expr is ArrowFunctionExpression | FunctionExpression {
    return expr.kind === 'ArrowFunctionExpression' || expr.kind === 'FunctionExpression';
}

// eslint-disable-next-line jsdoc/require-jsdoc
function pushIfComponent(
    components: ComponentInfo[],
    name: string,
    fn: ComponentFunction,
    exported: boolean,
    isDefault: boolean
): void {
    if (isPascalCase(name) && returnsJsx(fn)) {
        components.push({ name, fn, exported, isDefault });
    }
}