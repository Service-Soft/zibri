import { capturedVariables, isEventHandlerName, isPropPassThrough, PropScope, propScope, scopeFrameFor } from './handlers';
import { SETUP_RUNTIME_PARAM } from './reattach';
import { Expression, JSXElement, JSXName, Statement } from '../../parser/ast';
import { ComponentFunction } from '../../semantics/component';
import { childrenOf, walk, WalkNode } from '../../semantics/walk';
import { printExpression } from '../server/print';

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
    value: Expression,
    /**
     * Names bound by enclosing nested scopes (e.g. `.map` params) that the function references and
     * must therefore be captured per instance at render time.
     */
    captureVars: string[]
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
    byNode: Map<Expression, ClientPropSite>
};

/**
 * Name of the object a setup collects its built client-prop functions in and hands back, keyed by
 * render-time instance id.
 */
export const CLIENT_PROP_VALUES: string = '__clientPropValues';

/**
 * Name of the build-time table of client-prop factories inside a setup.
 */
const CLIENT_PROP_FACTORIES: string = '__clientProps';

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
 * Emits the build-time table of client-prop factories: one factory per site, parameterized by the
 * variables that site captures from enclosing scopes.
 * @param sites - The component's client-prop sites.
 * @returns The table source (empty when there are no sites).
 */
export function clientPropFactories(sites: ClientPropSite[]): string {
    if (sites.length === 0) {
        return '';
    }
    const entries: string[] = sites.map(site => `${site.id}: (${site.captureVars.join(', ')}) => (${printExpression(site.value)})`);
    return `const ${CLIENT_PROP_FACTORIES} = {\n${entries.join(',\n')}\n};`;
}

/**
 * Whether a JSX name refers to a component rather than a host element. Only components receive
 * function props; on a host element a function cannot be rendered and is dropped as an attribute.
 * @param name - The JSX tag name.
 * @returns True for capitalized or dotted tags.
 */
function isComponentName(name: JSXName): boolean {
    return name.kind !== 'JSXIdentifier' || (!!name.name && !name.name.startsWith(name.name[0].toLowerCase()));
}

/**
 * Collects the names the component declares as functions in its own body, so a prop that merely
 * references one (`updateChart={updateChart}`) is recognized as function-valued.
 * @param fn - The component function.
 * @returns The locally declared function names.
 */
function localFunctionNames(fn: ComponentFunction): Set<string> {
    const names: Set<string> = new Set<string>();
    if (fn.body.kind !== 'BlockStatement') {
        return names;
    }
    for (const statement of fn.body.body) {
        addFunctionName(statement, names);
    }
    return names;
}

/**
 * Records the function name a top-level statement declares, if any.
 * @param statement - The statement to inspect.
 * @param names - The accumulator to add to.
 */
function addFunctionName(statement: Statement, names: Set<string>): void {
    if (statement.kind === 'FunctionDeclaration') {
        names.add(statement.id);
        return;
    }
    if (statement.kind !== 'VariableDeclaration') {
        return;
    }
    for (const declarator of statement.declarations) {
        const isFunction: boolean = declarator.init?.kind === 'ArrowFunctionExpression'
            || declarator.init?.kind === 'FunctionExpression';
        if (isFunction && declarator.id.kind === 'IdentifierPattern') {
            names.add(declarator.id.name);
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
 * @param value - The prop value expression.
 * @param locals - The component's locally declared function names.
 * @returns True when the value carries a function.
 */
function isClientFunction(value: Expression, locals: Set<string>): boolean {
    if (value.kind === 'Identifier') {
        return locals.has(value.name);
    }
    let found: boolean = false;
    walk(value, node => {
        if (node.kind === 'ArrowFunctionExpression' || node.kind === 'FunctionExpression') {
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
    const byNode: Map<Expression, ClientPropSite> = new Map<Expression, ClientPropSite>();
    const props: PropScope = propScope(fn);
    const locals: Set<string> = localFunctionNames(fn);
    let counter: number = 0;

    const visit: (node: WalkNode, frames: Set<string>[]) => void = (node: WalkNode, frames: Set<string>[]): void => {
        if (node.kind === 'JSXElement' && isComponentName(node.name)) {
            collectElementProps(node, frames, props, locals, sites, byNode, () => `p${counter++}`);
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
    element: JSXElement,
    frames: Set<string>[],
    props: PropScope,
    locals: Set<string>,
    sites: ClientPropSite[],
    byNode: Map<Expression, ClientPropSite>,
    nextId: () => string
): void {
    for (const attribute of element.attributes) {
        if (attribute.kind !== 'JSXAttribute' || isEventHandlerName(attribute.name)) {
            continue;
        }
        if (!attribute.value || attribute.value.kind !== 'JSXExpressionContainer' || !attribute.value.expression) {
            continue;
        }
        const value: Expression = attribute.value.expression;
        if (!isClientFunction(value, locals) || isPropPassThrough(value, props)) {
            continue;
        }
        const site: ClientPropSite = {
            id: nextId(),
            name: attribute.name,
            value,
            captureVars: capturedVariables(value, frames)
        };
        sites.push(site);
        byNode.set(value, site);
    }
}