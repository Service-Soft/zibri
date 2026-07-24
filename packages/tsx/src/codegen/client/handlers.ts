import { Expression, JSXElement, Pattern, VariableDeclaration } from '../../parser/ast';
import { collectFreeIdentifiers, collectPatternNames, collectReferencedIdentifiers } from '../../semantics/binding';
import { ComponentFunction } from '../../semantics/component';
import { childrenOf, WalkNode } from '../../semantics/walk';

/**
 * A collected event-handler site on a host element within a component.
 */
export type HandlerSite = {
    /**
     * Stable build-time id, e.g. 'h0'.
     */
    id: string,
    /**
     * The DOM event name, e.g. 'click'.
     */
    event: string,
    /**
     * The handler value expression.
     */
    handler: Expression,
    /**
     * Names bound by enclosing nested scopes (e.g. `.map` params) that the handler references and
     * must therefore be captured per instance at render time.
     */
    captureVars: string[]
};

/**
 * The result of collecting handler sites: the sites in traversal order and a lookup keyed by the
 * handler expression node (used by server codegen to stamp the matching element).
 */
export type HandlerCollection = {
    /**
     * The handler sites in traversal order.
     */
    sites: HandlerSite[],
    /**
     * Lookup from handler expression node to its site.
     */
    byNode: Map<Expression, HandlerSite>
};

/**
 * The prop names a component receives, used to distinguish a new handler (inline/local) from a
 * pass-through of a prop that already carries a handler marker.
 */
export type PropScope = {
    /**
     * Destructured prop names.
     */
    names: Set<string>,
    /**
     * The bare props parameter name (`props`), when the component does not destructure.
     */
    bare: string | undefined
};

/**
 * Whether a JSX attribute name is an event handler (`onClick`, `onInput`, ...).
 * @param name - The attribute name.
 * @returns True for `on<Uppercase>` names.
 */
export function isEventHandlerName(name: string): boolean {
    return name.length > 2 && name.startsWith('on') && name[2] === name[2].toUpperCase();
}

/**
 * Whether a handler expression merely forwards one of the component's own props (a marker created
 * by a parent), rather than defining a new handler.
 * @param handler - The handler expression.
 * @param props - The component's prop scope.
 * @returns True when the handler is a pass-through of a prop.
 */
export function isPropPassThrough(handler: Expression, props: PropScope): boolean {
    if (handler.kind === 'Identifier') {
        return props.names.has(handler.name);
    }
    if (handler.kind === 'MemberExpression' && !handler.computed && handler.object.kind === 'Identifier') {
        return handler.object.name === props.bare;
    }
    return false;
}

/**
 * Computes the prop scope of a component from its single parameter.
 * @param fn - The component function.
 * @returns The prop scope.
 */
export function propScope(fn: ComponentFunction): PropScope {
    if (fn.params.length === 0) {
        return { names: new Set<string>(), bare: undefined };
    }
    const param: Pattern = fn.params[0];
    if (param.kind === 'IdentifierPattern') {
        return { names: new Set<string>(), bare: param.name };
    }
    return { names: new Set(collectPatternNames(param)), bare: undefined };
}

/**
 * Collects the event-handler sites within a component. Handlers written as inline functions or
 * references to local declarations become new sites (with captured loop variables); handlers that
 * forward a prop are left for the parent's site and are not recorded.
 * @param fn - The component function.
 * @returns The collected handler sites and a node lookup (new sites only).
 */
export function collectHandlerSites(fn: ComponentFunction): HandlerCollection {
    const sites: HandlerSite[] = [];
    const byNode: Map<Expression, HandlerSite> = new Map<Expression, HandlerSite>();
    const props: PropScope = propScope(fn);
    let counter: number = 0;

    const visit: (node: WalkNode, frames: Set<string>[]) => void = (node: WalkNode, frames: Set<string>[]): void => {
        if (node.kind === 'JSXElement') {
            collectElementHandlers(node, frames, props, sites, byNode, () => `h${counter++}`);
        }
        const pushed: Set<string> | undefined = scopeFrameFor(node);
        const childFrames: Set<string>[] = pushed ? [...frames, pushed] : frames;
        for (const child of childrenOf(node)) {
            visit(child, childFrames);
        }
    };

    visit(fn.body, []);
    return { sites, byNode };
}

/**
 * Records the new handler sites of a single element (host or component).
 * @param element - The element.
 * @param frames - The enclosing nested scopes.
 * @param props - The component's prop scope.
 * @param sites - The accumulator of sites.
 * @param byNode - The node lookup to populate.
 * @param nextId - Allocates the next site id.
 */
function collectElementHandlers(
    element: JSXElement,
    frames: Set<string>[],
    props: PropScope,
    sites: HandlerSite[],
    byNode: Map<Expression, HandlerSite>,
    nextId: () => string
): void {
    for (const attribute of element.attributes) {
        if (attribute.kind !== 'JSXAttribute' || !isEventHandlerName(attribute.name)) {
            continue;
        }
        if (!attribute.value || attribute.value.kind !== 'JSXExpressionContainer' || !attribute.value.expression) {
            continue;
        }
        const handler: Expression = attribute.value.expression;
        if (isPropPassThrough(handler, props)) {
            continue;
        }
        const site: HandlerSite = {
            id: nextId(),
            event: attribute.name.slice(2).toLowerCase(),
            handler,
            captureVars: capturedVariables(handler, frames)
        };
        sites.push(site);
        byNode.set(handler, site);
    }
}

/**
 * Computes the variables a handler must capture: its free identifiers that are bound by an
 * enclosing nested scope (not the component's own top scope, whose declarations are available in
 * the client script).
 * @param handler - The handler expression.
 * @param frames - The enclosing nested scopes.
 * @returns The capture variable names, in stable order.
 */
export function capturedVariables(handler: Expression, frames: Set<string>[]): string[] {
    const enclosing: Set<string> = new Set<string>();
    for (const frame of frames) {
        for (const name of frame) {
            enclosing.add(name);
        }
    }
    if (enclosing.size === 0) {
        return [];
    }
    const free: Set<string> = handler.kind === 'ArrowFunctionExpression' || handler.kind === 'FunctionExpression'
        ? collectFreeIdentifiers(handler)
        : collectReferencedIdentifiers(handler);
    return [...free].filter(name => enclosing.has(name));
}

/**
 * The set of names a node introduces as a nested scope, or undefined when it opens no new scope.
 * @param node - The node to inspect.
 * @returns The bound names, or undefined.
 */
export function scopeFrameFor(node: WalkNode): Set<string> | undefined {
    if (node.kind === 'ArrowFunctionExpression' || node.kind === 'FunctionExpression' || node.kind === 'FunctionDeclaration') {
        return new Set(node.params.flatMap(collectPatternNames));
    }
    if (node.kind === 'ForOfStatement') {
        return new Set(forBindingNames(node.left));
    }
    if (node.kind === 'ForStatement' && node.init && node.init.kind === 'VariableDeclaration') {
        return new Set(node.init.declarations.flatMap(d => collectPatternNames(d.id)));
    }
    return undefined;
}

/**
 * Collects the binding names introduced by a for-of loop target.
 * @param left - The for-of binding target.
 * @returns The bound names.
 */
function forBindingNames(left: VariableDeclaration | Pattern): string[] {
    if (left.kind === 'VariableDeclaration') {
        return left.declarations.flatMap(d => collectPatternNames(d.id));
    }
    return collectPatternNames(left);
}