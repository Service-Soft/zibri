import * as ts from 'typescript';

import { isFunctionValue, stateDeclarations, stateReach, TWO_WAY_ATTRIBUTES } from './bindings';
import { attributeExpression, attributesOf, CapturedVariable, capturedVariables, isComponentName, isEventHandlerName, ScopeFrame, scopeFrameFor, tagNameOf, visitComponentBody } from './handlers';
import { Diagnostic, DiagnosticSeverity } from '../../diagnostics/diagnostic.model';
import { AccessShape } from '../../runtime/access-shape';
import { collectPatternBindings, collectReferencedSymbols } from '../../semantics/binding';
import { ComponentFunction } from '../../semantics/component';
import { symbolOf } from '../../semantics/symbols';
import { ValidationCode } from '../../semantics/validate';
import { childrenOf, isHookCall, walk } from '../../semantics/walk';

/**
 * Markup written in JSX: an element, or a fragment.
 */
export type JsxMarkup = ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment;

/**
 * A condition rendered in the browser: `cond && <x/>` or `cond ? <a/> : <b/>`.
 */
export type ConditionForm = {
    /**
     * The kind of form.
     */
    kind: 'if',
    /**
     * The condition.
     */
    condition: ts.Expression,
    /**
     * The markup while it holds, if any.
     */
    whenTrue: JsxMarkup | undefined,
    /**
     * The markup while it does not, if any.
     */
    whenFalse: JsxMarkup | undefined
};

/**
 * A list rendered in the browser: `items.map(item => <li key={item.id}/>)`.
 */
export type ListForm = {
    /**
     * The kind of form.
     */
    kind: 'map',
    /**
     * The items.
     */
    list: ts.Expression,
    /**
     * The function rendering a row.
     */
    callback: ts.ArrowFunction | ts.FunctionExpression,
    /**
     * The one root element of a row.
     */
    row: ts.JsxElement | ts.JsxSelfClosingElement,
    /**
     * The key of a row.
     */
    key: ts.Expression
};

/**
 * A form of markup the browser renders.
 */
export type RegionForm = ConditionForm | ListForm;

/**
 * A hole of the markup holding a condition or a list that reads state, which the browser renders again when it changes.
 */
export type RegionSite = {
    /**
     * The build-time id, unique within the component.
     */
    id: string,
    /**
     * The expression of the hole.
     */
    expression: ts.Expression,
    /**
     * Its form.
     */
    form: RegionForm,
    /**
     * The variables of enclosing loops and callbacks it reads, captured at render time.
     */
    captureVars: string[],
    /**
     * What it reads from each captured variable.
     */
    captureShapes: AccessShape[]
};

/**
 * The regions of a component.
 */
export type RegionCollection = {
    /**
     * The regions, in source order.
     */
    sites: RegionSite[],
    /**
     * Each region by its expression.
     */
    byNode: Map<ts.Expression, RegionSite>,
    /**
     * The markup of every region, nested ones included, which is html the browser renders rather than JSX in client
     * code.
     */
    markup: Set<ts.Node>,
    /**
     * The attributes in regions holding a state itself on the `value` or `checked` of a control, which bind both ways.
     */
    twoWay: Set<ts.Expression>,
    /**
     * The id of every condition and list, nested ones included, by its expression: what the server renders its
     * templates under, and the page finds them by.
     */
    forms: Map<ts.Expression, string>,
    /**
     * The branches and rows holding html only the server renders, however deep: the server renders each into a
     * template, which the page copies.
     */
    templated: Set<JsxMarkup>,
    /**
     * What a component inside a region is handed that the page follows, by its attribute: a value reading a state or a
     * row, a state itself, or a function.
     */
    partProps: Map<ts.JsxAttribute, PartPropKind>,
    /**
     * The holes of a region holding html of the server: a value reading neither a state nor a row, such as the
     * children of the component.
     */
    opaque: Set<ts.Expression>,
    /**
     * What of the regions only the server reads: the tags of their components, what they are handed that the page does
     * not follow, and the holes holding html of the server. None of it is client code.
     */
    serverOnly: Set<ts.Node>,
    /**
     * Markup reading state that the browser cannot render.
     */
    diagnostics: Diagnostic[]
};

/**
 * How a component inside a region is handed a prop the page follows: a value reading a state or a row, a state itself,
 * or a function.
 */
export type PartPropKind = 'value' | 'state' | 'function';

/**
 * What a check of the markup of a region knows about where it is.
 */
type MarkupContext = {
    /**
     * The states of the component.
     */
    states: ReadonlySet<ts.Symbol>,
    /**
     * The parameters of the rows the markup is inside.
     */
    rows: ReadonlySet<ts.Symbol>,
    /**
     * Whether a node reads a state of the component.
     */
    reaches: (node: ts.Node) => boolean,
    /**
     * The component.
     */
    fn: ComponentFunction
};

/**
 * The forms markup reading state is written in.
 */
const FORMS: string = '`cond && <p/>`, `cond ? <a/> : <b/>` or `items.map(item => <li key={item.id}/>)`';

/**
 * Collects the holes of a component's markup holding a condition or a list that reads its state, and refuses markup
 * reading state in any other form, or holding what the browser cannot render: a component, raw html, a row without a
 * key or with more than one root.
 * @param fn - The component.
 * @returns The regions, and what is refused.
 */
export function collectRegions(fn: ComponentFunction): RegionCollection {
    const collection: RegionCollection = {
        sites: [],
        byNode: new Map(),
        markup: new Set(),
        twoWay: new Set(),
        forms: new Map(),
        templated: new Set(),
        partProps: new Map(),
        opaque: new Set(),
        serverOnly: new Set(),
        diagnostics: []
    };
    const reaches: (node: ts.Node) => boolean = stateReach(fn);
    const states: Set<ts.Symbol> = new Set(stateDeclarations(fn).flatMap(declaration => {
        const symbol: ts.Symbol | undefined = ts.isIdentifier(declaration.name) ? symbolOf(declaration.name) : undefined;
        return symbol === undefined ? [] : [symbol];
    }));
    let counter: number = 0;
    const visit: (node: ts.Node, frames: ScopeFrame[]) => void = (node, frames) => {
        if (ts.isJsxExpression(node) && node.expression != undefined && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))
            && containsJsx(node.expression) && reaches(node.expression)) {
            const form: RegionForm | undefined = resolveForm(node.expression, collection);
            const before: number = collection.diagnostics.length;
            if (form !== undefined) {
                validateForm(node.expression, form, collection, { states, rows: new Set(), reaches, fn });
            }
            if (form !== undefined && collection.diagnostics.length === before) {
                const captured: CapturedVariable[] = capturedVariables(node.expression, frames, collection.serverOnly);
                const site: RegionSite = {
                    id: `r${counter++}`,
                    expression: node.expression,
                    form,
                    captureVars: captured.map(variable => variable.name),
                    captureShapes: captured.map(variable => variable.shape)
                };
                collection.sites.push(site);
                collection.byNode.set(node.expression, site);
            }
            return;
        }
        const pushed: ScopeFrame | undefined = scopeFrameFor(node);
        const childFrames: ScopeFrame[] = pushed ? [...frames, pushed] : frames;
        for (const child of childrenOf(node)) {
            visit(child, childFrames);
        }
    };
    if (fn.body != undefined) {
        visitComponentBody(fn.body, visit);
    }
    return collection;
}

/**
 * The expressions of a component's regions, which the bindings, handlers and props of its markup leave to them.
 * @param fn - The component.
 * @returns The expressions.
 */
export function regionExpressions(fn: ComponentFunction): Set<ts.Node> {
    return new Set(collectRegions(fn).sites.map(site => site.expression));
}

/**
 * Whether an expression holds markup.
 * @param node - The expression.
 * @returns True when JSX is written in it.
 */
export function containsJsx(node: ts.Node): boolean {
    let found: boolean = false;
    walk(node, current => {
        found ||= ts.isJsxElement(current) || ts.isJsxSelfClosingElement(current) || ts.isJsxFragment(current);
        return !found;
    });
    return found;
}

/**
 * Reads the form of markup reading state, or refuses it.
 * @param expression - The expression of the hole.
 * @param collection - Where a refusal is recorded.
 * @returns The form, or undefined when it is refused.
 */
export function resolveForm(expression: ts.Expression, collection: Pick<RegionCollection, 'diagnostics'>): RegionForm | undefined {
    const written: ts.Expression = skipParentheses(expression);
    if (ts.isBinaryExpression(written) && written.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
        const right: ts.Expression = skipParentheses(written.right);
        if (isMarkup(right) && !containsJsx(written.left)) {
            return { kind: 'if', condition: written.left, whenTrue: right, whenFalse: undefined };
        }
    }
    if (ts.isConditionalExpression(written) && !containsJsx(written.condition)) {
        const whenTrue: JsxMarkup | null | undefined = branchOf(written.whenTrue);
        const whenFalse: JsxMarkup | null | undefined = branchOf(written.whenFalse);
        if (whenTrue !== undefined && whenFalse !== undefined) {
            return { kind: 'if', condition: written.condition, whenTrue: whenTrue ?? undefined, whenFalse: whenFalse ?? undefined };
        }
    }
    if (ts.isCallExpression(written) && ts.isPropertyAccessExpression(written.expression) && written.expression.name.text === 'map'
        && !containsJsx(written.expression.expression)) {
        const callback: ts.Expression | undefined = written.arguments[0];
        if (callback !== undefined && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
            return resolveList(written.expression.expression, callback, collection);
        }
    }
    collection.diagnostics.push(refusal(expression, `Markup that reads a state is rendered in the browser when the state changes, written as ${FORMS}. `
        + 'Write it as one of them.'));
    return undefined;
}

/**
 * Reads a list, or refuses a row without one root element with a key.
 * @param list - The items.
 * @param callback - The function rendering a row.
 * @param collection - Where a refusal is recorded.
 * @returns The list, or undefined when it is refused.
 */
function resolveList(
    list: ts.Expression,
    callback: ts.ArrowFunction | ts.FunctionExpression,
    collection: Pick<RegionCollection, 'diagnostics'>
): ListForm | undefined {
    const returned: ts.Expression | undefined = rowOf(callback);
    if (returned === undefined || !isMarkup(returned)) {
        collection.diagnostics.push(refusal(callback, 'A row of a list the browser renders returns its markup and nothing else, such as '
            + '`items.map(item => <li key={item.id}>{item.name}</li>)`.'));
        return undefined;
    }
    if (ts.isJsxFragment(returned)) {
        collection.diagnostics.push(refusal(returned, 'A row of a list the browser renders needs one root element, which holds its key.'));
        return undefined;
    }
    const keyAttribute: ts.JsxAttribute | undefined = attributesOf(returned)
        .find((attribute): attribute is ts.JsxAttribute => ts.isJsxAttribute(attribute) && attribute.name.getText() === 'key');
    const key: ts.Expression | undefined = keyAttribute === undefined ? undefined : keyExpression(keyAttribute);
    if (key === undefined) {
        collection.diagnostics.push(refusal(returned, 'A row of a list the browser renders needs a key on its root element, such as '
            + '`<li key={item.id}>`: a row whose key stays keeps its element when the list changes.'));
        return undefined;
    }
    return { kind: 'map', list, callback, row: returned, key };
}

/**
 * Checks the markup of a form, and records it: its id, its two-way attributes, what its components are handed, its
 * holes of html of the server, and the branches and rows needing a template.
 * @param expression - The expression of the form.
 * @param form - The form.
 * @param collection - Where it is recorded.
 * @param context - Where the form is.
 * @returns True when it holds html only the server renders, however deep.
 */
function validateForm(expression: ts.Expression, form: RegionForm, collection: RegionCollection, context: MarkupContext): boolean {
    collection.forms.set(expression, `f${collection.forms.size}`);
    const inner: MarkupContext = form.kind === 'if'
        ? context
        : { ...context, rows: new Set([...context.rows, ...form.callback.parameters.flatMap(parameter => symbolsOfPattern(parameter.name))]) };
    const markup: JsxMarkup[] = form.kind === 'if'
        ? [form.whenTrue, form.whenFalse].filter((branch): branch is JsxMarkup => branch !== undefined)
        : [form.row];
    let holdsServerHtml: boolean = false;
    for (const node of markup) {
        if (validateMarkup(node, collection, inner)) {
            collection.templated.add(node);
            holdsServerHtml = true;
        }
    }
    return holdsServerHtml;
}

/**
 * Checks one element or fragment of markup the browser renders, and the markup inside it.
 * @param node - The element or fragment.
 * @param collection - Where it is recorded.
 * @param context - Where the markup is.
 * @returns True when it holds html only the server renders, however deep.
 */
function validateMarkup(node: JsxMarkup, collection: RegionCollection, context: MarkupContext): boolean {
    collection.markup.add(node);
    let holdsServerHtml: boolean = false;
    if (!ts.isJsxFragment(node)) {
        const component: boolean = isComponentName(tagNameOf(node));
        if (component) {
            holdsServerHtml = true;
            collection.serverOnly.add(tagNameOf(node));
        }
        for (const attribute of attributesOf(node)) {
            if (component) {
                validateComponentAttribute(attribute, collection, context);
            }
            else {
                validateAttribute(attribute, collection, context.states);
            }
        }
    }
    const children: readonly ts.JsxChild[] = ts.isJsxSelfClosingElement(node) ? [] : node.children;
    for (const child of children) {
        if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)) {
            holdsServerHtml = validateMarkup(child, collection, context) || holdsServerHtml;
            continue;
        }
        if (!ts.isJsxExpression(child) || child.expression == undefined) {
            continue;
        }
        if (!containsJsx(child.expression)) {
            validateNoRaw(child.expression, collection);
            // a value of the server, such as the children of the component, is html the server renders
            if (!isLiteral(child.expression) && !readsStateOrRow(child.expression, context)) {
                collection.opaque.add(child.expression);
                collection.serverOnly.add(child.expression);
                holdsServerHtml = true;
            }
            continue;
        }
        // markup reading neither a state nor the row, such as a list of a prop, is the server's: the same html in every
        // copy. Not when it holds code the page runs, which markup the browser renders attaches itself
        if (!readsStateOrRow(child.expression, context) && !holdsClientCode(child.expression)) {
            validateNoRaw(child.expression, collection);
            collection.opaque.add(child.expression);
            collection.serverOnly.add(child.expression);
            holdsServerHtml = true;
            continue;
        }
        const nested: RegionForm | undefined = resolveForm(child.expression, collection);
        if (nested !== undefined) {
            holdsServerHtml = validateForm(child.expression, nested, collection, context) || holdsServerHtml;
        }
    }
    return holdsServerHtml;
}

/**
 * Whether markup holds what the page runs or reaches: a handler, a ref, or a component, whose setup runs in the
 * browser.
 * @param expression - The expression holding the markup.
 * @returns True when it does.
 */
function holdsClientCode(expression: ts.Expression): boolean {
    let found: boolean = false;
    walk(expression, node => {
        if (ts.isJsxAttribute(node)) {
            const name: string = node.name.getText();
            found ||= isEventHandlerName(name) || name === 'ref';
        }
        if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
            found ||= isComponentName(tagNameOf(node));
        }
        return !found;
    });
    return found;
}

/**
 * Checks what a component inside markup the browser renders is handed, and records how: a prop reading a state or a
 * row, or a function, is followed by the page, and any other stays on the server.
 * @param attribute - The attribute.
 * @param collection - Where it is recorded.
 * @param context - Where the component is.
 */
function validateComponentAttribute(attribute: ts.JsxAttributeLike, collection: RegionCollection, context: MarkupContext): void {
    if (ts.isJsxSpreadAttribute(attribute)) {
        if (readsStateOrRow(attribute.expression, context)) {
            collection.diagnostics.push(refusal(attribute, 'A component inside markup the browser renders is handed what follows a state or '
                + 'a row by name, such as `todo={todo}`: the page follows each prop by its name.'));
            return;
        }
        collection.serverOnly.add(attribute.expression);
        return;
    }
    const name: string = attribute.name.getText();
    const expression: ts.Expression | undefined = attributeExpression(attribute);
    if (name === 'key' || expression === undefined) {
        return;
    }
    if (isEventHandlerName(name) || isFunctionValue(expression, context.fn)) {
        collection.partProps.set(attribute, 'function');
        return;
    }
    if (readsStateOrRow(expression, context)) {
        const symbol: ts.Symbol | undefined = ts.isIdentifier(expression) ? symbolOf(expression) : undefined;
        collection.partProps.set(attribute, symbol !== undefined && context.states.has(symbol) ? 'state' : 'value');
        return;
    }
    collection.serverOnly.add(expression);
}

/**
 * Whether an expression of markup the browser renders reads a state of the component or the item of a row.
 * @param expression - The expression.
 * @param context - Where it is.
 * @returns True when it does.
 */
function readsStateOrRow(expression: ts.Expression, context: MarkupContext): boolean {
    return context.reaches(expression) || [...collectReferencedSymbols(expression, new Set())].some(symbol => context.rows.has(symbol));
}

/**
 * Whether an expression is written as a value, which is the same wherever it renders.
 * @param expression - The expression.
 * @returns True for a string, a number or a template without holes.
 */
function isLiteral(expression: ts.Expression): boolean {
    const written: ts.Expression = skipParentheses(expression);
    return ts.isStringLiteral(written) || ts.isNumericLiteral(written) || ts.isNoSubstitutionTemplateLiteral(written);
}

/**
 * The symbols a binding pattern declares.
 * @param name - The pattern.
 * @returns The symbols.
 */
function symbolsOfPattern(name: ts.BindingName): ts.Symbol[] {
    return collectPatternBindings(name).flatMap(identifier => {
        const symbol: ts.Symbol | undefined = symbolOf(identifier);
        return symbol === undefined ? [] : [symbol];
    });
}

/**
 * Checks an attribute of an element the browser renders, and records one binding a state both ways.
 * @param attribute - The attribute.
 * @param collection - Where it is recorded.
 * @param states - The states of the component.
 */
function validateAttribute(attribute: ts.JsxAttributeLike, collection: RegionCollection, states: ReadonlySet<ts.Symbol>): void {
    if (ts.isJsxSpreadAttribute(attribute)) {
        validateNoRaw(attribute.expression, collection);
        return;
    }
    const name: string = attribute.name.getText();
    if (name === 'dangerouslySetInnerHTML') {
        collection.diagnostics.push(refusal(attribute, 'Markup the browser renders when a state changes never writes html raw. Write '
            + 'the text, or render the html on the server.'));
        return;
    }
    const expression: ts.Expression | undefined = attributeExpression(attribute);
    if (expression === undefined || isEventHandlerName(name)) {
        return;
    }
    validateNoRaw(expression, collection);
    const symbol: ts.Symbol | undefined = ts.isIdentifier(expression) ? symbolOf(expression) : undefined;
    if (TWO_WAY_ATTRIBUTES.has(name) && symbol !== undefined && states.has(symbol)) {
        collection.twoWay.add(expression);
    }
}

/**
 * Refuses raw html in markup the browser renders.
 * @param expression - An expression of the markup.
 * @param collection - Where a refusal is recorded.
 */
function validateNoRaw(expression: ts.Expression, collection: Pick<RegionCollection, 'diagnostics'>): void {
    walk(expression, current => {
        if (isHookCall(current, '$raw')) {
            collection.diagnostics.push(refusal(current, 'Markup the browser renders when a state changes never writes html raw. Write '
                + 'the text, or render the html on the server.'));
        }
    });
}

/**
 * The markup a function rendering a row returns: its expression body, or the one statement of its body returning it.
 * @param callback - The function.
 * @returns The markup, or undefined for a body doing more.
 */
function rowOf(callback: ts.ArrowFunction | ts.FunctionExpression): ts.Expression | undefined {
    if (!ts.isBlock(callback.body)) {
        return skipParentheses(callback.body);
    }
    const [only] = callback.body.statements;
    return callback.body.statements.length === 1 && ts.isReturnStatement(only) && only.expression !== undefined
        ? skipParentheses(only.expression)
        : undefined;
}

/**
 * The value of a key attribute.
 * @param attribute - The attribute.
 * @returns The expression, or a string written as it is.
 */
function keyExpression(attribute: ts.JsxAttribute): ts.Expression | undefined {
    const initializer: ts.JsxAttributeValue | undefined = attribute.initializer;
    return initializer !== undefined && ts.isStringLiteral(initializer) ? initializer : attributeExpression(attribute);
}

/**
 * A branch of a ternary: markup, or nothing.
 * @param expression - The branch.
 * @returns The markup, null for nothing, or undefined for anything else.
 */
function branchOf(expression: ts.Expression): JsxMarkup | null | undefined {
    const written: ts.Expression = skipParentheses(expression);
    if (isMarkup(written)) {
        return written;
    }
    const nothing: boolean = written.kind === ts.SyntaxKind.NullKeyword || written.kind === ts.SyntaxKind.FalseKeyword
        || (ts.isIdentifier(written) && written.text === 'undefined');
    return nothing ? null : undefined;
}

/**
 * Whether an expression is markup.
 * @param expression - The expression.
 * @returns True for an element or a fragment.
 */
function isMarkup(expression: ts.Expression): expression is JsxMarkup {
    return ts.isJsxElement(expression) || ts.isJsxSelfClosingElement(expression) || ts.isJsxFragment(expression);
}

/**
 * An expression without the parentheses around it.
 * @param expression - The expression.
 * @returns What they hold.
 */
function skipParentheses(expression: ts.Expression): ts.Expression {
    return ts.isParenthesizedExpression(expression) ? skipParentheses(expression.expression) : expression;
}

/**
 * Refuses markup reading state.
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
