import * as ts from 'typescript';

import { accessShapeOf } from './access-shape-analysis';
import { AccessShape } from '../../runtime/access-shape';
import { collectPatternBindings, collectPatternNames, collectReferencedSymbols, declaredSymbols, symbolsOf } from '../../semantics/binding';
import { ComponentFunction } from '../../semantics/component';
import { childrenOf, unwrapTypeSyntax } from '../../semantics/walk';

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
    handler: ts.Expression,
    /**
     * Names bound by enclosing nested scopes (e.g. `.map` params) that the handler references and
     * must therefore be captured per instance at render time.
     */
    captureVars: string[],
    /**
     * What the handler reads from each captured value, in the order of {@link HandlerSite.captureVars}.
     */
    captureShapes: AccessShape[]
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
    byNode: Map<ts.Expression, HandlerSite>
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
 * A JSX element, with or without children.
 */
export type JsxElementLike = ts.JsxElement | ts.JsxSelfClosingElement;

/**
 * Whether a JSX attribute name is an event handler (`onClick`, `onInput`, ...).
 * @param name - The attribute name.
 * @returns True for `on<Uppercase>` names.
 */
export function isEventHandlerName(name: string): boolean {
    return name.length > 2 && name.startsWith('on') && name[2] === name[2].toUpperCase();
}

/**
 * The attributes of a JSX element.
 * @param element - The element.
 * @returns Its attributes, in source order.
 */
export function attributesOf(element: JsxElementLike): readonly ts.JsxAttributeLike[] {
    return (ts.isJsxElement(element) ? element.openingElement.attributes : element.attributes).properties;
}

/**
 * The expression an attribute holds: the one in `={...}` looked through its type-only wrappers, or a JSX
 * element given directly as the value (`icon=<Icon/>`).
 * @param attribute - The attribute.
 * @returns The expression, or undefined for a bare, string or empty attribute.
 */
export function attributeExpression(attribute: ts.JsxAttribute): ts.Expression | undefined {
    const initializer: ts.JsxAttributeValue | undefined = attribute.initializer;
    if (initializer == undefined || ts.isStringLiteral(initializer)) {
        return undefined;
    }
    if (!ts.isJsxExpression(initializer)) {
        return initializer;
    }
    return initializer.expression == undefined ? undefined : unwrapTypeSyntax(initializer.expression);
}

/**
 * Whether a handler expression merely forwards one of the component's own props (a marker created
 * by a parent), rather than defining a new handler.
 * @param handler - The handler expression.
 * @param props - The component's prop scope.
 * @returns True when the handler is a pass-through of a prop.
 */
export function isPropPassThrough(handler: ts.Expression, props: PropScope): boolean {
    if (ts.isIdentifier(handler)) {
        return props.names.has(handler.text);
    }
    if (ts.isPropertyAccessExpression(handler)) {
        const object: ts.Expression = unwrapTypeSyntax(handler.expression);
        return ts.isIdentifier(object) && object.text === props.bare;
    }
    return false;
}

/**
 * Computes the prop scope of a component from its single parameter.
 * @param fn - The component function.
 * @returns The prop scope.
 */
export function propScope(fn: ComponentFunction): PropScope {
    if (fn.parameters.length === 0) {
        return { names: new Set<string>(), bare: undefined };
    }
    const param: ts.ParameterDeclaration = fn.parameters[0];
    if (ts.isIdentifier(param.name) && param.initializer == undefined && param.dotDotDotToken == undefined) {
        return { names: new Set<string>(), bare: param.name.text };
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
    const byNode: Map<ts.Expression, HandlerSite> = new Map<ts.Expression, HandlerSite>();
    const props: PropScope = propScope(fn);
    let counter: number = 0;

    const visit: (node: ts.Node, frames: ScopeFrame[]) => void = (node: ts.Node, frames: ScopeFrame[]): void => {
        if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
            collectElementHandlers(node, frames, props, sites, byNode, () => `h${counter++}`);
        }
        const pushed: ScopeFrame | undefined = scopeFrameFor(node);
        const childFrames: ScopeFrame[] = pushed ? [...frames, pushed] : frames;
        for (const child of childrenOf(node)) {
            visit(child, childFrames);
        }
    };

    if (fn.body != undefined) {
        visit(fn.body, []);
    }
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
    element: JsxElementLike,
    frames: ScopeFrame[],
    props: PropScope,
    sites: HandlerSite[],
    byNode: Map<ts.Expression, HandlerSite>,
    nextId: () => string
): void {
    for (const attribute of attributesOf(element)) {
        if (!ts.isJsxAttribute(attribute) || !isEventHandlerName(attribute.name.getText())) {
            continue;
        }
        const handler: ts.Expression | undefined = attributeExpression(attribute);
        if (handler === undefined || isPropPassThrough(handler, props)) {
            continue;
        }
        const captured: CapturedVariable[] = capturedVariables(handler, frames);
        const site: HandlerSite = {
            id: nextId(),
            event: attribute.name.getText().slice(2)
                .toLowerCase(),
            handler,
            captureVars: captured.map(variable => variable.name),
            captureShapes: captured.map(variable => variable.shape)
        };
        sites.push(site);
        byNode.set(handler, site);
    }
}

/**
 * The variables a nested scope declares: a function's parameters, or a loop's own bindings.
 */
export type ScopeFrame = ReadonlySet<ts.Symbol>;

/**
 * A variable a handler or function prop captures from an enclosing scope.
 */
export type CapturedVariable = {
    /**
     * The variable's name.
     */
    name: string,
    /**
     * What the handler reads from its value.
     */
    shape: AccessShape
};

/**
 * Computes the variables a handler must capture: the variables it reads that an enclosing nested scope
 * declares (not the component's own top scope, whose declarations are available in the client script).
 * @param handler - The handler expression.
 * @param frames - The enclosing nested scopes.
 * @returns The captured variables, in the order the handler first reads them.
 */
export function capturedVariables(handler: ts.Expression, frames: ScopeFrame[]): CapturedVariable[] {
    return [...collectReferencedSymbols(handler)]
        .filter(symbol => frames.some(frame => frame.has(symbol)))
        .map(symbol => ({ name: symbol.name, shape: accessShapeOf(symbol, [handler]) }));
}

/**
 * The variables a node declares as a nested scope, or undefined when it opens no new scope.
 * @param node - The node to inspect.
 * @returns The declared variables, or undefined.
 */
export function scopeFrameFor(node: ts.Node): ScopeFrame | undefined {
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)
        || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node) || ts.isConstructorDeclaration(node)) {
        return new Set(symbolsOf(node.parameters.flatMap(parameter => collectPatternBindings(parameter))));
    }
    if (ts.isForOfStatement(node) || ts.isForInStatement(node)) {
        return new Set(ts.isVariableDeclarationList(node.initializer)
            ? node.initializer.declarations.flatMap(declaredSymbols)
            : symbolsOf(collectPatternBindings(node.initializer)));
    }
    if (ts.isForStatement(node) && node.initializer != undefined && ts.isVariableDeclarationList(node.initializer)) {
        return new Set(node.initializer.declarations.flatMap(declaredSymbols));
    }
    return undefined;
}