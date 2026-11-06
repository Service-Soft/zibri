import * as ts from 'typescript';

import { attributeExpression, attributesOf, CapturedVariable, capturedVariables, collectServerOnlyCallbacks, isComponentName, isEventHandlerName, JsxElementLike, ScopeFrame, scopeFrameFor, tagNameOf, visitComponentBody } from './handlers';
import { regionExpressions } from './regions';
import { AccessShape, mergeAccessShapes } from '../../runtime/access-shape';
import { collectReferencedSymbols } from '../../semantics/binding';
import { ComponentFunction } from '../../semantics/component';
import { symbolOf } from '../../semantics/symbols';
import { childrenOf, isHookCall, walk } from '../../semantics/walk';

/**
 * Where a binding writes in the page. A prop is handed to a component, or provided to a context: the binding writes
 * wherever the component forwards it, and follows it in the handle of `useInput` reading it.
 */
export type BindingKind = 'text' | 'attribute' | 'content' | 'prop';

/**
 * An expression of the markup that reads state, and so is written again in the browser when the state changes.
 */
export type BindingSite = {
    /**
     * The build-time id, unique within the component.
     */
    id: string,
    /**
     * Where it writes: a text hole between two comments, an attribute of its element, or the whole text of a
     * `<title>` or `<textarea>`, which hold no comments.
     */
    kind: BindingKind,
    /**
     * The attribute it writes, for an attribute, or the prop it is handed as, for a prop.
     */
    attribute: string | undefined,
    /**
     * Whether it is a state itself, handed to a component as it is, which the component may write, or handed to the
     * `value` or `checked` of a control, which writes what the user enters back.
     */
    handle: boolean,
    /**
     * The expression. For the whole text of an element, its first hole that reads state.
     */
    expression: ts.Expression,
    /**
     * The children of the element, for the whole text of an element: its text and its holes, which together are the
     * text it writes.
     */
    parts: readonly ts.JsxChild[] | undefined,
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
 * The binding sites of a component, and a lookup by their expression.
 */
export type BindingCollection = {
    /**
     * The sites, in source order.
     */
    sites: BindingSite[],
    /**
     * Each site by its expression.
     */
    byNode: Map<ts.Expression, BindingSite>
};

/**
 * Attributes that never bind: they are no attribute of the element, or a handler.
 */
const UNBOUND_ATTRIBUTES: ReadonlySet<string> = new Set(['key', 'ref', 'dangerouslySetInnerHTML', 'children']);

/**
 * The attributes of a control a state itself binds both ways: what the user enters is written back to it.
 */
export const TWO_WAY_ATTRIBUTES: ReadonlySet<string> = new Set(['value', 'checked']);

/**
 * Elements whose text cannot hold a comment, so a binding there writes all of their text.
 */
const CONTENT_ELEMENTS: ReadonlySet<string> = new Set(['title', 'textarea']);

/**
 * Collects the expressions of a component's markup that read its state, directly or through a function the component
 * declares: the text holes and the attributes of its elements, the props of its components, and the values it
 * provides to a context.
 * @param fn - The component.
 * @returns The binding sites.
 */
export function collectBindingSites(fn: ComponentFunction): BindingCollection {
    const sites: BindingSite[] = [];
    const byNode: Map<ts.Expression, BindingSite> = new Map();
    const reaches: (expression: ts.Expression) => boolean = stateReach(fn);
    const states: Set<ts.Symbol> = stateSymbolsOf(fn);
    // a condition or a list the browser renders follows the state itself, the markup in it included
    const regions: Set<ts.Node> = regionExpressions(fn);
    let counter: number = 0;
    const add: BindingRecorder = (kind, attribute, expressions, frames, parts) => {
        if (expressions.some(expression => regions.has(expression))) {
            return;
        }
        const [first] = expressions.filter(reaches);
        // a function handed to a component is built in the browser as a function prop, and reads the state when called
        if (first === undefined || (kind === 'prop' && isFunctionValue(first, fn))) {
            return;
        }
        const captured: CapturedVariable[] = expressions.flatMap(expression => capturedVariables(expression, frames))
            .filter((variable, index, all) => all.findIndex(other => other.name === variable.name) === index);
        const site: BindingSite = {
            id: `b${counter++}`,
            kind,
            attribute,
            handle: (kind === 'prop' || (kind === 'attribute' && attribute !== undefined && TWO_WAY_ATTRIBUTES.has(attribute)))
                && ts.isIdentifier(first) && isState(first, states),
            expression: first,
            parts,
            captureVars: captured.map(variable => variable.name),
            // a variable two holes read is read as much as both read
            captureShapes: captured.map(variable => expressions
                .flatMap(expression => capturedVariables(expression, frames).filter(other => other.name === variable.name))
                .map(other => other.shape)
                .reduce<AccessShape | undefined>((merged, shape) => mergeAccessShapes(merged, shape), undefined) ?? 'whole')
        };
        sites.push(site);
        for (const expression of expressions) {
            byNode.set(expression, site);
        }
    };

    const visit: (node: ts.Node, frames: ScopeFrame[]) => void = (node, frames) => {
        if (regions.has(node)) {
            return;
        }
        if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
            collectElementBindings(node, frames, add);
        }
        const provided: ts.Expression | undefined = isHookCall(node, 'provideContext') ? node.arguments[1] : undefined;
        if (provided !== undefined) {
            add('prop', undefined, [provided], frames, undefined);
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
    return { sites, byNode };
}

/**
 * Records a binding, if one of its expressions reads state: its kind, the attribute it writes, its expressions, the
 * scopes around them, and the children of an element whose whole text it writes.
 */
type BindingRecorder = (
    kind: BindingKind,
    attribute: string | undefined,
    expressions: ts.Expression[],
    frames: ScopeFrame[],
    parts: readonly ts.JsxChild[] | undefined
) => void;

/**
 * Records the bindings of one element: its attributes, for an element of the page, and its text holes, which for a
 * `<title>` or a `<textarea>` are one binding writing its whole text.
 * @param element - The element or fragment.
 * @param frames - The enclosing nested scopes.
 * @param add - Records a binding, if one of its expressions reads state.
 */
function collectElementBindings(element: JsxElementLike | ts.JsxFragment, frames: ScopeFrame[], add: BindingRecorder): void {
    let tag: string | undefined;
    if (!ts.isJsxFragment(element)) {
        const tagName: ts.JsxTagNameExpression = tagNameOf(element);
        tag = tagName.getText();
        // a component is handed a prop, and what it does with it only it knows
        const kind: BindingKind = isComponentName(tagName) ? 'prop' : 'attribute';
        for (const attribute of attributesOf(element)) {
            const name: string | undefined = ts.isJsxAttribute(attribute) ? attribute.name.getText() : undefined;
            const expression: ts.Expression | undefined = ts.isJsxAttribute(attribute) ? attributeExpression(attribute) : undefined;
            if (name !== undefined && expression !== undefined && !UNBOUND_ATTRIBUTES.has(name) && !isEventHandlerName(name)) {
                add(kind, name, [expression], frames, undefined);
            }
        }
    }
    const children: readonly ts.JsxChild[] = ts.isJsxSelfClosingElement(element) ? [] : element.children;
    const holes: ts.Expression[] = children.flatMap(child => ts.isJsxExpression(child) && child.expression != undefined ? [child.expression] : []);
    if (tag !== undefined && CONTENT_ELEMENTS.has(tag)) {
        add('content', undefined, holes, frames, children);
        return;
    }
    for (const hole of holes) {
        add('text', undefined, [hole], frames, undefined);
    }
}

/**
 * Decides whether an expression reads a state of the component: a variable assigned `useState()` at its top, or a
 * function the component declares that reads one, however many calls deep.
 * @param fn - The component.
 * @returns The decision.
 */
export function stateReach(fn: ComponentFunction): (node: ts.Node) => boolean {
    const states: Set<ts.Symbol> = stateSymbolsOf(fn);
    const functionsReaching: Map<ts.Symbol, boolean> = new Map();
    // markup inside the node is left out: what it reads is a binding of its own elements
    const reaches: (node: ts.Node) => boolean = node => [...collectReferencedSymbols(node, new Set([...collectServerOnlyCallbacks(node), ...nestedJsx(node)]))]
        .some(symbol => states.has(symbol) || functionReaches(symbol));
    const functionReaches: (symbol: ts.Symbol) => boolean = symbol => {
        const known: boolean | undefined = functionsReaching.get(symbol);
        if (known !== undefined) {
            return known;
        }
        const body: ts.Node | undefined = localFunctionBody(symbol, fn);
        // false while it is being followed, so a function calling itself ends
        functionsReaching.set(symbol, false);
        const result: boolean = body !== undefined && reaches(body);
        functionsReaching.set(symbol, result);
        return result;
    };
    return reaches;
}

/**
 * The outermost markup inside a node.
 * @param node - The node.
 * @returns The JSX elements and fragments, not those inside them.
 */
export function nestedJsx(node: ts.Node): ts.Node[] {
    const found: ts.Node[] = [];
    walk(node, current => {
        if (current !== node && (ts.isJsxElement(current) || ts.isJsxSelfClosingElement(current) || ts.isJsxFragment(current))) {
            found.push(current);
            return false;
        }
        return true;
    });
    return found;
}

/**
 * The declarations of the states a component creates at its top, as `const name = useState(...)`, and of the handles
 * of what it is handed that follow a state, `useInput` and `useWritableInput`.
 * @param fn - The component.
 * @returns The declarations.
 */
export function stateDeclarations(fn: ComponentFunction): ts.VariableDeclaration[] {
    if (fn.body == undefined || !ts.isBlock(fn.body)) {
        return [];
    }
    return fn.body.statements
        .filter(ts.isVariableStatement)
        .flatMap(statement => [...statement.declarationList.declarations])
        .filter(declaration => {
            const initializer: ts.Expression | undefined = declaration.initializer;
            return initializer !== undefined && STATE_HANDLE_HOOKS.some(hook => isHookCall(initializer, hook));
        });
}

/**
 * The symbols of the handles a component creates at its top whose `value` the page follows.
 * @param fn - The component.
 * @returns The symbols.
 */
function stateSymbolsOf(fn: ComponentFunction): Set<ts.Symbol> {
    return new Set(stateDeclarations(fn).flatMap(declaration => {
        const symbol: ts.Symbol | undefined = ts.isIdentifier(declaration.name) ? symbolOf(declaration.name) : undefined;
        return symbol === undefined ? [] : [symbol];
    }));
}

/**
 * Whether an identifier names one of the handles of a component.
 * @param identifier - The identifier.
 * @param states - The symbols of the handles.
 * @returns True when it does.
 */
function isState(identifier: ts.Identifier, states: ReadonlySet<ts.Symbol>): boolean {
    const symbol: ts.Symbol | undefined = symbolOf(identifier);
    return symbol !== undefined && states.has(symbol);
}

/**
 * Whether a value handed to a component is a function: one written in place, or one the component declares.
 * @param expression - The value.
 * @param fn - The component.
 * @returns True when it is.
 */
export function isFunctionValue(expression: ts.Expression, fn: ComponentFunction): boolean {
    if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) {
        return true;
    }
    const symbol: ts.Symbol | undefined = ts.isIdentifier(expression) ? symbolOf(expression) : undefined;
    return symbol !== undefined && localFunctionBody(symbol, fn) !== undefined;
}

/**
 * The hooks returning a handle whose `value` the page follows.
 */
export const STATE_HANDLE_HOOKS: readonly string[] = ['useState', 'useInput', 'useWritableInput'];

/**
 * The body of a function the component declares, which a symbol names: a function declaration, or a `const` holding
 * a function.
 * @param symbol - The symbol.
 * @param fn - The component.
 * @returns The body, or undefined for any other symbol.
 */
function localFunctionBody(symbol: ts.Symbol, fn: ComponentFunction): ts.Node | undefined {
    const declaration: ts.Declaration | undefined = symbol.valueDeclaration;
    if (declaration === undefined || declaration.getStart() < fn.getStart() || declaration.getEnd() > fn.getEnd()) {
        return undefined;
    }
    if (ts.isFunctionDeclaration(declaration)) {
        return declaration.body;
    }
    const initializer: ts.Expression | undefined = ts.isVariableDeclaration(declaration) ? declaration.initializer : undefined;
    return initializer !== undefined && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) ? initializer.body : undefined;
}
