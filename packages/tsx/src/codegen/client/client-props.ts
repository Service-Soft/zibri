import * as ts from 'typescript';

import { attributeExpression, attributesOf, CapturedVariable, capturedVariables, isEventHandlerName, isPropPassThrough, JsxElementLike, PropScope, propScope, ScopeFrame, scopeFrameFor } from './handlers';
import { SETUP_RUNTIME_PARAM } from './reattach';
import { AccessShape } from '../../runtime/access-shape';
import { ComponentFunction } from '../../semantics/component';
import { childrenOf, unwrapTypeSyntax, walk } from '../../semantics/walk';

/**
 * A function passed as a plain (non event-handler) prop to a nested component, e.g.
 * `<Chart updateChart={updateChart}/>`.
 *
 * Such a value cannot be serialized into the page like other props, and it belongs to the parent's
 * scope anyway - it may close over the parent's other locals. It is therefore compiled into the
 * parent's client setup as a factory and handed to the child's setup at call time.
 */
export type ClientPropSite = {
    /**
     * Stable build-time id, e.g. 'p0'.
     */
    id: string,
    /**
     * The prop name on the child component.
     */
    name: string,
    /**
     * The prop value expression (the function itself).
     */
    value: ts.Expression,
    /**
     * Names bound by enclosing nested scopes (e.g. `.map` params) that the function references and
     * must therefore be captured per instance at render time.
     */
    captureVars: string[],
    /**
     * What the function reads from each captured value, in the order of {@link ClientPropSite.captureVars}.
     */
    captureShapes: AccessShape[]
};

/**
 * The result of collecting client-prop sites: the sites in traversal order and a lookup keyed by the
 * value expression node (used by server codegen to emit a marker in the prop's place).
 */
export type ClientPropCollection = {
    /**
     * The sites in traversal order.
     */
    sites: ClientPropSite[],
    /**
     * Lookup from value expression node to its site.
     */
    byNode: Map<ts.Expression, ClientPropSite>
};

/**
 * Name of the object a setup collects its built client-prop functions in and hands back, keyed by
 * render-time instance id.
 */
export const CLIENT_PROP_VALUES: string = '__clientPropValues';

/**
 * Name of the build-time table of client-prop factories inside a setup.
 */
export const CLIENT_PROP_FACTORIES: string = '__clientProps';

/**
 * Builds this instance's function props from the build-time factories, applying the values captured
 * for each one at render time (a function handed to a component inside a `.map` gets one entry per
 * iteration). Emitted verbatim into the generated client script.
 */
export const CLIENT_PROPS_RUNTIME: string = `(function () {
    var entries = (${SETUP_RUNTIME_PARAM} && ${SETUP_RUNTIME_PARAM}.props) || [];
    for (var i = 0; i < entries.length; i++) {
        var factory = ${CLIENT_PROP_FACTORIES}[entries[i].site];
        if (!factory) { continue; }
        ${CLIENT_PROP_VALUES}[entries[i].id] = factory.apply(null, entries[i].captured || []);
    }
})();`;

/**
 * Whether a JSX name refers to a component rather than a host element. Only components receive
 * function props; on a host element a function cannot be rendered and is dropped as an attribute.
 * @param name - The JSX tag name.
 * @returns True for capitalized or dotted tags.
 */
export function isComponentName(name: ts.JsxTagNameExpression): boolean {
    if (ts.isPropertyAccessExpression(name)) {
        return true;
    }
    const written: string = ts.isIdentifier(name) ? name.text : name.getText();
    return !!written && !written.startsWith(written[0].toLowerCase());
}

/**
 * The tag name of a JSX element.
 * @param element - The element.
 * @returns Its tag name expression.
 */
export function tagNameOf(element: JsxElementLike): ts.JsxTagNameExpression {
    return ts.isJsxElement(element) ? element.openingElement.tagName : element.tagName;
}

/**
 * Collects the names the component declares as functions in its own body, so a prop that merely
 * references one (`updateChart={updateChart}`) is recognized as function-valued.
 * @param fn - The component function.
 * @returns The locally declared function names.
 */
function localFunctionNames(fn: ComponentFunction): Set<string> {
    const names: Set<string> = new Set<string>();
    if (fn.body == undefined || !ts.isBlock(fn.body)) {
        return names;
    }
    for (const statement of fn.body.statements) {
        addFunctionName(statement, names);
    }
    return names;
}

/**
 * Records the function name a top-level statement declares, if any.
 * @param statement - The statement to inspect.
 * @param names - The accumulator to add to.
 */
function addFunctionName(statement: ts.Statement, names: Set<string>): void {
    if (ts.isFunctionDeclaration(statement)) {
        names.add(statement.name?.text ?? '');
        return;
    }
    if (!ts.isVariableStatement(statement)) {
        return;
    }
    for (const declaration of statement.declarationList.declarations) {
        const init: ts.Expression | undefined = declaration.initializer == undefined
            ? undefined
            : unwrapTypeSyntax(declaration.initializer);
        const isFunction: boolean = init != undefined && (ts.isArrowFunction(init) || ts.isFunctionExpression(init));
        if (isFunction && ts.isIdentifier(declaration.name)) {
            names.add(declaration.name.text);
        }
    }
}

/**
 * Whether a prop value carries a function the client needs: written inline, a reference to one of
 * the component's own function declarations, or a value with a function somewhere inside it (a chart
 * config holding a tick `callback`, a column list holding a `render`).
 *
 * The nested case matters because serializing such a value silently drops the function - the object
 * arrives in the browser with the key simply missing. Building the whole value on the client instead
 * keeps it intact.
 *
 * JSX is not looked into: markup is rendered on the server, and a handler inside it is a handler site of
 * its own.
 * @param value - The prop value expression.
 * @param locals - The component's locally declared function names.
 * @returns True when the value carries a function.
 */
function isClientFunction(value: ts.Expression, locals: Set<string>): boolean {
    if (ts.isIdentifier(value)) {
        return locals.has(value.text);
    }
    let found: boolean = false;
    walk(value, node => {
        if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
            return false;
        }
        if (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isMethodDeclaration(node)) {
            found = true;
        }
        return !found;
    });
    return found;
}

/**
 * Collects the function props a component passes to nested components. A function forwarded from the
 * component's own props is left alone: it already carries the marker its declaring ancestor created.
 * @param fn - The component function.
 * @returns The collected sites and a node lookup.
 */
export function collectClientPropSites(fn: ComponentFunction): ClientPropCollection {
    const sites: ClientPropSite[] = [];
    const byNode: Map<ts.Expression, ClientPropSite> = new Map<ts.Expression, ClientPropSite>();
    const props: PropScope = propScope(fn);
    const locals: Set<string> = localFunctionNames(fn);
    let counter: number = 0;

    const visit: (node: ts.Node, frames: ScopeFrame[]) => void = (node: ts.Node, frames: ScopeFrame[]): void => {
        if ((ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) && isComponentName(tagNameOf(node))) {
            collectElementProps(node, frames, props, locals, sites, byNode, () => `p${counter++}`);
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
 * Records the client-prop sites of a single component element.
 * @param element - The component element.
 * @param frames - The enclosing nested scopes.
 * @param props - The component's prop scope.
 * @param locals - The component's locally declared function names.
 * @param sites - The accumulator of sites.
 * @param byNode - The node lookup to populate.
 * @param nextId - Allocates the next site id.
 */
function collectElementProps(
    element: JsxElementLike,
    frames: ScopeFrame[],
    props: PropScope,
    locals: Set<string>,
    sites: ClientPropSite[],
    byNode: Map<ts.Expression, ClientPropSite>,
    nextId: () => string
): void {
    for (const attribute of attributesOf(element)) {
        if (!ts.isJsxAttribute(attribute) || isEventHandlerName(attribute.name.getText())) {
            continue;
        }
        const value: ts.Expression | undefined = attributeExpression(attribute);
        if (value === undefined || !isClientFunction(value, locals) || isPropPassThrough(value, props)) {
            continue;
        }
        const captured: CapturedVariable[] = capturedVariables(value, frames);
        const site: ClientPropSite = {
            id: nextId(),
            name: attribute.name.getText(),
            value,
            captureVars: captured.map(variable => variable.name),
            captureShapes: captured.map(variable => variable.shape)
        };
        sites.push(site);
        byNode.set(value, site);
    }
}