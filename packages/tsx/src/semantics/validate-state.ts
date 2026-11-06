import * as ts from 'typescript';

import { collectReferencedSymbols, isBindingIdentifier } from './binding';
import { ComponentFunction, ComponentInfo } from './component';
import { symbolOf } from './symbols';
import { isFunctionNode, runsWhereItIsWritten, ValidationCode } from './validate';
import { forEachDescendant, isNamedAtTop } from './validate-refs';
import { isHookCall } from './walk';
import { nestedJsx, STATE_HANDLE_HOOKS, stateDeclarations, stateReach } from '../codegen/client/bindings';
import { collectRegions, RegionCollection } from '../codegen/client/regions';
import { attributeExpression, attributesOf, isEventHandlerName } from '../codegen/client/handlers';
import { Diagnostic, DiagnosticSeverity } from '../diagnostics/diagnostic.model';

/**
 * The methods that change an array, a map or a set in place, which a state cannot see.
 */
const CHANGING_METHODS: ReadonlySet<string> = new Set([
    'push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin', 'set', 'add', 'delete', 'clear'
]);

/**
 * The operators that assign.
 */
const ASSIGNMENTS: ReadonlySet<ts.SyntaxKind> = new Set([
    ts.SyntaxKind.EqualsToken,
    ts.SyntaxKind.PlusEqualsToken,
    ts.SyntaxKind.MinusEqualsToken,
    ts.SyntaxKind.AsteriskEqualsToken,
    ts.SyntaxKind.SlashEqualsToken,
    ts.SyntaxKind.PercentEqualsToken,
    ts.SyntaxKind.AsteriskAsteriskEqualsToken,
    ts.SyntaxKind.AmpersandEqualsToken,
    ts.SyntaxKind.BarEqualsToken,
    ts.SyntaxKind.CaretEqualsToken,
    ts.SyntaxKind.LessThanLessThanEqualsToken,
    ts.SyntaxKind.GreaterThanGreaterThanEqualsToken,
    ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
    ts.SyntaxKind.AmpersandAmpersandEqualsToken,
    ts.SyntaxKind.BarBarEqualsToken,
    ts.SyntaxKind.QuestionQuestionEqualsToken
]);

/**
 * Rejects a state the page could not follow: created anywhere but as `const name = useState()` at the top of a
 * component, changed in place through its value, written through the read only handle of `useInput`, or read where
 * the markup does not follow it, which is markup that follows it, a constant computed from it once, and html written
 * raw. A `let` the markup reads and client code writes is refused as well, since the markup never follows it.
 * @param components - The components of the template.
 * @returns One diagnostic per misused state.
 */
export function validateState(components: ComponentInfo[]): Diagnostic[] {
    return components.flatMap(({ fn }) => [
        ...validateCreation(fn),
        ...validateChanges(fn),
        ...validateInputWrites(fn),
        ...validateMarkup(fn),
        ...validateLets(fn)
    ]);
}

/**
 * Refuses a `useState`, `useInput` or `useWritableInput` anywhere but as `const name = useState()` at the top of its
 * component.
 * @param fn - The component.
 * @returns The diagnostics.
 */
function validateCreation(fn: ComponentFunction): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    forEachDescendant(fn, node => {
        const hook: string | undefined = STATE_HANDLE_HOOKS.find(name => isHookCall(node, name));
        if (hook !== undefined && ts.isCallExpression(node) && !isNamedAtTop(node, fn)) {
            diagnostics.push(refusal(node, `'${hook}' needs to be called at the top of a component, as \`const name = ${hook}(value);\`: `
                + 'the page finds the handle by the name of its variable, and a handle that is taken apart is no longer one.'));
        }
    });
    return diagnostics;
}

/**
 * Refuses a write to the handle `useInput` returns, which follows what the component is handed and is read only.
 * @param fn - The component.
 * @returns The diagnostics.
 */
function validateInputWrites(fn: ComponentFunction): Diagnostic[] {
    const inputs: Set<ts.Symbol> = new Set(stateDeclarations(fn)
        .filter(declaration => declaration.initializer !== undefined && isHookCall(declaration.initializer, 'useInput'))
        .flatMap(declaration => {
            const symbol: ts.Symbol | undefined = ts.isIdentifier(declaration.name) ? symbolOf(declaration.name) : undefined;
            return symbol === undefined ? [] : [symbol];
        }));
    const diagnostics: Diagnostic[] = [];
    forEachDescendant(fn, node => {
        const target: ts.Expression | undefined = assignedTarget(node);
        const symbol: ts.Symbol | undefined = target !== undefined && ts.isPropertyAccessExpression(target) && target.name.text === 'value'
            && ts.isIdentifier(target.expression)
            ? symbolOf(target.expression)
            : undefined;
        if (symbol !== undefined && inputs.has(symbol)) {
            diagnostics.push(refusal(node, `'${symbol.name}' follows what the component is handed, and is read only. Hand the component `
                + `the state itself and take it with useWritableInput to write it, such as \`const ${symbol.name} = useWritableInput(value);\`.`));
        }
    });
    return diagnostics;
}

/**
 * Refuses a change to the value of a state in place: a method that changes it, or an assignment to a part of it. The
 * state is the same value afterwards, so nothing of the page follows.
 * @param fn - The component.
 * @returns The diagnostics.
 */
function validateChanges(fn: ComponentFunction): Diagnostic[] {
    const states: Set<ts.Symbol> = stateSymbols(fn);
    const diagnostics: Diagnostic[] = [];
    const message: string = 'The value of a state is changed in place, and the state cannot see it. Assign it a new value instead, '
        + 'such as `list.value = [...list.value, item]`.';
    forEachDescendant(fn, node => {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
            && CHANGING_METHODS.has(node.expression.name.text) && readsValueOf(node.expression.expression, states)) {
            diagnostics.push(refusal(node, message));
        }
        const target: ts.Expression | undefined = assignedTarget(node);
        if (target !== undefined && (ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target))
            && readsValueOf(target.expression, states)) {
            diagnostics.push(refusal(node, message));
        }
    });
    return diagnostics;
}

/**
 * Refuses what the markup cannot follow: markup in an expression that reads state, a constant computed once from a
 * state, and html written raw from one.
 * @param fn - The component.
 * @returns The diagnostics.
 */
function validateMarkup(fn: ComponentFunction): Diagnostic[] {
    const reaches: (node: ts.Node) => boolean = stateReach(fn);
    // markup reading state is a condition or a list the browser renders, which checks the markup in it
    const regions: RegionCollection = collectRegions(fn);
    const diagnostics: Diagnostic[] = [...regions.diagnostics];
    for (const expression of markupExpressions(fn)) {
        const inRegion: boolean = isInRegion(expression, regions);
        if (reaches(expression) && nestedJsx(expression).length > 0 && !inRegion) {
            continue;
        }
        const stale: ts.Identifier | undefined = staleConstant(expression, fn, reaches);
        if (stale !== undefined) {
            diagnostics.push(refusal(stale, `'${stale.text}' is computed from a state once, so the markup reading it would not follow `
                + `the state. Compute it in a function of the component, such as \`function ${stale.text}() { ... }\`, and call that.`));
            continue;
        }
        if (reaches(expression) && !inRegion) {
            const raws: ts.Node[] = isHookCall(expression, '$raw') ? [expression] : [];
            forEachDescendant(expression, node => {
                if (isHookCall(node, '$raw')) {
                    raws.push(node);
                }
            });
            diagnostics.push(...raws.map(node => refusal(node, 'Markup that reads a state writes it again in the browser, where html is '
                + 'never written raw. Write the text, or render the html on the server.')));
        }
    }
    return diagnostics;
}

/**
 * Whether an expression of the markup is a condition or a list the browser renders, or a part of one.
 * @param expression - The expression.
 * @param regions - The regions of the component.
 * @returns True when it is.
 */
function isInRegion(expression: ts.Expression, regions: RegionCollection): boolean {
    for (let current: ts.Node | undefined = expression; current !== undefined; current = current.parent) {
        if (ts.isExpression(current) && regions.byNode.has(current)) {
            return true;
        }
    }
    return false;
}

/**
 * Refuses a `let` of the component that the markup reads and client code writes: the markup is rendered once, and
 * never follows it.
 * @param fn - The component.
 * @returns The diagnostics.
 */
function validateLets(fn: ComponentFunction): Diagnostic[] {
    if (fn.body == undefined || !ts.isBlock(fn.body)) {
        return [];
    }
    const lets: Set<ts.Symbol> = new Set(fn.body.statements
        .filter(ts.isVariableStatement)
        .filter(statement => (statement.declarationList.flags & ts.NodeFlags.Let) !== 0)
        .flatMap(statement => [...statement.declarationList.declarations])
        .flatMap(declaration => {
            const symbol: ts.Symbol | undefined = ts.isIdentifier(declaration.name) ? symbolOf(declaration.name) : undefined;
            return symbol === undefined ? [] : [symbol];
        }));
    const read: Set<ts.Symbol> = new Set(markupExpressions(fn)
        .flatMap(expression => [...collectReferencedSymbols(expression, new Set(nestedJsx(expression)))])
        .filter(symbol => lets.has(symbol)));
    const diagnostics: Diagnostic[] = [];
    const reported: Set<ts.Symbol> = new Set();
    forEachDescendant(fn, node => {
        const target: ts.Expression | undefined = assignedTarget(node);
        const symbol: ts.Symbol | undefined = target !== undefined && ts.isIdentifier(target) ? symbolOf(target) : undefined;
        if (symbol !== undefined && read.has(symbol) && !reported.has(symbol) && isWrittenByClientCode(node, fn)) {
            reported.add(symbol);
            // a warning, as such a template compiled in 3.0: refused from 4.0
            diagnostics.push({
                ...refusal(node, `'${symbol.name}' is read by the markup and written by client code, and the markup is rendered `
                    + `once, so it never follows it. Make it a state, as \`const ${symbol.name} = useState(...)\`, and read \`${symbol.name}.value\`. `
                    + 'A write in onServer, which runs while the server renders, needs no state. This fails the build from 4.0.'),
                severity: DiagnosticSeverity.WARNING
            });
        }
    });
    return diagnostics;
}

/**
 * The expressions of a component's markup the server evaluates: its text holes, and the attributes of its elements and
 * the props of its components that are no handlers.
 * @param fn - The component.
 * @returns The expressions.
 */
function markupExpressions(fn: ComponentFunction): ts.Expression[] {
    const found: ts.Expression[] = [];
    forEachDescendant(fn, node => {
        if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
            for (const attribute of attributesOf(node)) {
                const expression: ts.Expression | undefined = ts.isJsxAttribute(attribute) ? attributeExpression(attribute) : undefined;
                const name: string | undefined = ts.isJsxAttribute(attribute) ? attribute.name.getText() : undefined;
                if (expression !== undefined && name !== undefined && !isEventHandlerName(name) && name !== 'ref' && name !== 'key') {
                    found.push(expression);
                }
            }
        }
        if (ts.isJsxExpression(node) && node.expression != undefined && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
            found.push(node.expression);
        }
    });
    return found;
}

/**
 * Finds a constant of the component an expression reads that is computed from a state when it is declared.
 * @param expression - The expression.
 * @param fn - The component.
 * @param reaches - Whether a node reads state.
 * @returns The read of the constant, or undefined.
 */
function staleConstant(expression: ts.Expression, fn: ComponentFunction, reaches: (node: ts.Node) => boolean): ts.Identifier | undefined {
    let found: ts.Identifier | undefined;
    const visit: (node: ts.Node) => void = node => {
        if (found !== undefined) {
            return;
        }
        if (ts.isIdentifier(node) && !isBindingIdentifier(node)) {
            const declaration: ts.Declaration | undefined = symbolOf(node)?.valueDeclaration;
            const initializer: ts.Expression | undefined = declaration !== undefined && ts.isVariableDeclaration(declaration)
                && declaration.getStart() >= fn.getStart() && declaration.getEnd() <= fn.getEnd()
                ? declaration.initializer
                : undefined;
            if (initializer !== undefined && !isFunctionNode(initializer) && !STATE_HANDLE_HOOKS.some(hook => isHookCall(initializer, hook))
                && reaches(initializer)) {
                found = node;
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(expression);
    return found;
}

/**
 * The variable or property an expression assigns: the left side of an assignment, or the operand of `++`, `--` or
 * `delete`.
 * @param node - The expression.
 * @returns What it assigns, or undefined for any other node.
 */
function assignedTarget(node: ts.Node): ts.Expression | undefined {
    if (ts.isBinaryExpression(node) && ASSIGNMENTS.has(node.operatorToken.kind)) {
        return node.left;
    }
    if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))
        && (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)) {
        return node.operand;
    }
    return ts.isDeleteExpression(node) ? node.expression : undefined;
}

/**
 * Whether an expression is the value of a state, or a part of it: `x.value`, `x.value.a`, `x.value[0]`.
 * @param expression - The expression.
 * @param states - The states of the component.
 * @returns True when it is.
 */
function readsValueOf(expression: ts.Expression, states: ReadonlySet<ts.Symbol>): boolean {
    if (ts.isPropertyAccessExpression(expression) && expression.name.text === 'value' && ts.isIdentifier(expression.expression)) {
        const symbol: ts.Symbol | undefined = symbolOf(expression.expression);
        return symbol !== undefined && states.has(symbol);
    }
    return (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) && readsValueOf(expression.expression, states);
}

/**
 * Whether a write runs in the browser: in a function that does not run where it is written, such as a handler or the
 * callback of `onClient`, rather than at the top of the component or in a callback the render runs.
 * @param node - The write.
 * @param fn - The component.
 * @returns True when client code writes it.
 */
function isWrittenByClientCode(node: ts.Node, fn: ComponentFunction): boolean {
    for (let current: ts.Node = node.parent; current !== fn; current = current.parent) {
        if (isFunctionNode(current) && !runsWhereItIsWritten(current)) {
            return true;
        }
        if (isFunctionNode(current) && ts.isCallExpression(current.parent) && isHookCall(current.parent, 'onClient')) {
            return true;
        }
    }
    return false;
}

/**
 * The symbols of the states a component creates.
 * @param fn - The component.
 * @returns The symbols.
 */
function stateSymbols(fn: ComponentFunction): Set<ts.Symbol> {
    return new Set(stateDeclarations(fn).flatMap(declaration => {
        const symbol: ts.Symbol | undefined = ts.isIdentifier(declaration.name) ? symbolOf(declaration.name) : undefined;
        return symbol === undefined ? [] : [symbol];
    }));
}

/**
 * Refuses a node.
 * @param node - Where the mistake is.
 * @param message - What is wrong, and what to write instead.
 * @returns The diagnostic.
 */
function refusal(node: ts.Node, message: string): Diagnostic {
    return {
        code: ValidationCode.STATE_MISUSED,
        message,
        severity: DiagnosticSeverity.ERROR,
        span: { start: node.getStart(), end: node.getEnd() }
    };
}
