import { createHash } from 'node:crypto';

import * as ts from 'typescript';

import { accessShapeOf, namedKeysOf, propertyKeyOf } from './access-shape-analysis';
import { BindingSite, collectBindingSites, STATE_HANDLE_HOOKS } from './bindings';
import { REGION_RUNTIME, regionTable } from './region-code';
import { collectRegions, RegionCollection } from './regions';
import { CLIENT_PROP_VALUES, CLIENT_PROPS_RUNTIME, ClientPropSite, collectClientPropSites } from './client-props';
import { collectHandlerSites, collectServerOnlyCallbacks, HandlerSite } from './handlers';
import { BIND_RUNTIME, REATTACH_RUNTIME, SETUP_RUNTIME_PARAM } from './reattach';
import { SourceSpan } from '../../diagnostics/diagnostic.model';
import { AccessShape, mergeAccessShapes, ReferencedProps, resolveAccessThroughRest } from '../../runtime/access-shape';
import { collectOuterNames, collectOuterReferences, collectPatternBindings, collectReferencedSymbols, declaredSymbols, OuterOrigin } from '../../semantics/binding';
import { ClientGlobalAlias } from '../../semantics/client-packages';
import { ComponentFunction, isJsxExpression, nestedStatements } from '../../semantics/component';
import { symbolOf } from '../../semantics/symbols';
import { collectTranslationSources, TranslationSources } from '../../semantics/translation-sources';
import { isHookCall, unwrapTypeSyntax, walk } from '../../semantics/walk';
import { decodeJsxEntities, normalizeJsxText } from '../server/jsx-text';
import { printClientNode } from '../server/print';

/**
 * The generated client behavior for a component.
 */
export type ClientScript = {
    /**
     * The client setup-function definition (`function <name>(props) { ... }`), or undefined when
     * the component has no client behavior. The runtime calls it once per instance with the
     * instance's props; each call's locals are isolated by function scope (no renaming needed).
     *
     * Type syntax is still in it; it is erased when the module is emitted.
     */
    code: string | undefined,
    /**
     * The name of the setup function to invoke per instance, or undefined when there is no code.
     */
    setupName: string | undefined,
    /**
     * The collected handler sites (used by server codegen to stamp matching elements).
     */
    handlerSites: HandlerSite[],
    /**
     * The functions this component hands to nested components as plain props. Its setup builds them
     * per instance and returns them, so the nested component's setup call can pass them on.
     */
    clientPropSites: ClientPropSite[],
    /**
     * The component's props that the client code actually references. Only these are serialized into
     * the page, so server-only props never reach the browser.
     */
    referencedProps: ReferencedProps,
    /**
     * What the client code reads from each referenced prop. Only that much of a prop is serialized into
     * the page.
     */
    propShapes: Record<string, AccessShape>,
    /**
     * What the client code reads from the value of each state it reads, by the name of the state's variable.
     * Only that much of the initial value is written into the page.
     */
    stateShapes: Record<string, AccessShape>,
    /**
     * Framework hook names (`$t`, `$ts`, `$f`, ...) the client code references and that the runtime
     * must inline with render-time data.
     */
    referencedHooks: string[],
    /**
     * The translation source strings the client code looks up, so the runtime can inline only those
     * instead of the whole translation table.
     */
    referencedTranslations: TranslationSources,
    /**
     * Every name the emitted client code reads from outside the component: imports, module-level
     * declarations and names the template declares nowhere. Used to check that client code only reads
     * things the browser will actually have.
     */
    referencedIdentifiers: string[],
    /**
     * Each name the emitted client code reads from outside the component, where it is declared and
     * where client code first reads it.
     */
    outerNames: OuterName[],
    /**
     * Where the emitted client code loads a module, which it cannot do.
     */
    moduleLoading: ModuleLoadingSite[],
    /**
     * Where the emitted client code holds JSX, which only the server renders.
     */
    jsx: SourceSpan[],
    /**
     * Where the markup reads state, which makes it client code: the browser computes it again when the state changes.
     */
    bindings: SourceSpan[]
};

/**
 * A name client code reads from outside the component.
 */
export type OuterName = {
    /**
     * The name.
     */
    name: string,
    /**
     * Where it is declared.
     */
    origin: OuterOrigin,
    /**
     * Where client code first reads it.
     */
    span: SourceSpan
};

/**
 * A use of `import(...)` or `import.meta` in client code.
 */
export type ModuleLoadingSite = {
    /**
     * Which of the two it is.
     */
    construct: 'import()' | 'import.meta',
    /**
     * Where it is written.
     */
    span: SourceSpan
};

/**
 * Client definitions of the framework hooks a setup defines for itself. `onServer` is a no-op in the
 * browser. A ref is found by the name of its variable among the refs the instance was rendered with. `onClient`
 * is defined once for the page, see `CLIENT_HOOK_SOURCES`.
 */
export const CLIENT_SETUP_HOOKS: Readonly<Record<string, string>> = {
    onServer: 'const onServer = () => {};',
    useRef: `const useRef = (name) => __zibriRef(${SETUP_RUNTIME_PARAM}.refs[name]);`,
    useRefs: `const useRefs = (name) => __zibriRef(${SETUP_RUNTIME_PARAM}.refs[name]);`,
    useState: `const useState = (name) => __zibriState(${SETUP_RUNTIME_PARAM}.states, name);`,
    useInput: `const useInput = (name) => __zibriInput(${SETUP_RUNTIME_PARAM}, name);`,
    useWritableInput: `const useWritableInput = (name) => __zibriInput(${SETUP_RUNTIME_PARAM}, name);`
};

/**
 * Label of the block wrapping the component's client setup. JSX returns become `break` to this
 * label so an early exit skips the remaining setup without aborting the whole script, while the
 * handler table and reattachment (emitted inside the block) can still close over the body's locals.
 */
const SETUP_LABEL: string = '__zibriSetup';

/**
 * The function inside the setup block that attaches the handlers and builds the client props.
 */
const ATTACH_FUNCTION: string = '__zibriAttach';

/**
 * The body statements client code keeps, and what inside them never reaches the client.
 */
type ClientBody = {
    /**
     * The kept top-level statements, in source order.
     */
    statements: ts.Statement[],
    /**
     * What is left out of them: the callbacks of `onServer` blocks, the markup of nested JSX returns,
     * and the nested statements and declarations no client code needs. Every analysis of the kept
     * statements skips these, as the printed script does.
     */
    omitted: ReadonlySet<ts.Node>
};

/**
 * Compiles the client behavior of a component into a named `setup(props)` function. The runtime
 * calls it once per instance with that instance's props; function scope isolates each call's locals,
 * so multiple instances never collide (no renaming needed). The setup contains the component's
 * imperative body (JSX returns neutralized), the lifecycle hooks it uses, an event-handler table,
 * and the reattachment bootstrap.
 * @param fn - The component function.
 * @param name - The component name, used to derive the setup function name.
 * @param clientAliases - The renamed `?client` bindings, so they resolve to their browser global.
 * @returns The client script (or undefined when there is nothing to run) and the handler sites.
 */
export function compileClientScript(fn: ComponentFunction, name: string, clientAliases: ClientGlobalAlias[]): ClientScript {
    const { sites } = collectHandlerSites(fn);
    const { sites: propSites } = collectClientPropSites(fn);
    const { sites: bindingSites } = collectBindingSites(fn);
    const regions: RegionCollection = collectRegions(fn);
    // The client code written in the markup — handlers, function props, and the expressions reading state, which the
    // browser computes again when a state changes, the conditions and lists it renders again among them.
    const markup: ts.Expression[] = [
        ...sites.map(site => site.handler),
        ...propSites.map(site => site.value),
        ...bindingSites.flatMap(bindingExpressions),
        ...regions.sites.map(site => site.expression)
    ];

    // What the markup's client code reads seeds what the body has to provide, so the body is filtered
    // down to the declarations those actually reach.
    // what the regions hold that only the server renders, such as what their components are handed, is no client code
    const markupServerOnly: Set<ts.Node> = new Set<ts.Node>([...markup.flatMap(collectServerOnlyCallbacks), ...regions.serverOnly]);
    const body: ClientBody = clientBody(
        fn,
        new Set(markup.flatMap(expression => [...collectReferencedSymbols(expression, markupServerOnly)]))
    );
    const omitted: ReadonlySet<ts.Node> = new Set<ts.Node>([...body.omitted, ...markupServerOnly]);
    const file: ts.SourceFile = fn.getSourceFile();
    const bodySource: string = body.statements
        .map(statement => printClientNode(neutralizeStatementTree(statement, omitted), file))
        .join('\n');

    // Only what is reachable from client code counts — props used solely in JSX stay server-side.
    const referenced: Set<ts.Symbol> = new Set(
        [...body.statements, ...markup].flatMap(node => [...collectReferencedSymbols(node, omitted)])
    );
    // Exactly the nodes that end up in the client script: the kept body (so a `$t` inside a function a
    // handler calls is found too), the inline handler and function-prop expressions, and the defaults of
    // the props these read. A `$t` in the jsx is not included, because that one is resolved during the
    // server render.
    const clientNodes: ts.Node[] = [
        ...body.statements,
        ...markup,
        ...fn.parameters.length === 0 ? [] : collectReadDefaults(fn.parameters[0], referenced)
    ];
    const outer: Set<string> = new Set(clientNodes.flatMap(node => [...collectOuterNames(node, fn, omitted)]));

    // what the client reads from the props object as a whole, so a prop is picked by its own key however
    // the parameter names it: `props.label`, `{ label: text }` and `{ item: { label } }` alike
    const propsShape: AccessShape | undefined = fn.parameters.length === 0
        ? undefined
        : patternShape(fn.parameters[0].name, referenced, clientNodes, omitted);
    const referencedProps: ReferencedProps = resolveReferencedProps(propsShape);
    const propShapes: Record<string, AccessShape> = propsShape === undefined || propsShape === 'whole' ? {} : propsShape.fields;
    const referencedHooks: string[] = resolveHooks(outer);
    const referencedTranslations: TranslationSources = collectTranslationSources(clientNodes, omitted);

    // A component only runs on the client when it stamps an event handler, hands a function to a
    // nested component, or calls `onClient`. Statement-level body code without any of those is pure
    // server work (an `onServer` block, a computed class name), so emitting a setup for it would ship
    // dead code - and possibly a server-only reference like `GlobalRegistry` - to every page using it.
    const hasClientBehavior: boolean = sites.length > 0 || propSites.length > 0 || bindingSites.length > 0 || regions.sites.length > 0
        || outer.has('onClient') || outer.has('useEffect');
    if (!hasClientBehavior) {
        return {
            code: undefined,
            setupName: undefined,
            handlerSites: sites,
            clientPropSites: propSites,
            referencedProps: [],
            propShapes: {},
            stateShapes: {},
            referencedHooks: [],
            referencedTranslations: { sources: [], complete: true },
            referencedIdentifiers: [],
            outerNames: [],
            moduleLoading: [],
            jsx: [],
            bindings: []
        };
    }

    // The body's locals (handler functions, state) must be visible to the handler table, the
    // client-prop factories and the reattachment, so they all live inside the labeled setup block, in a
    // function declared there. It is hoisted, so a JSX return calls it before it leaves the block: the
    // markup an early return renders has handlers too, and they only read what was declared before it.
    const handedToComponents: HandlerSite[] = sites.filter(site => site.onComponent);
    const handedDown: BindingSite[] = bindingSites.filter(site => site.kind === 'prop');
    const buildsClientProps: boolean = propSites.length > 0 || handedToComponents.length > 0 || handedDown.length > 0;
    const attach: string = [
        handlerTable(sites),
        sites.length > 0 ? REATTACH_RUNTIME : '',
        bindingTable(bindingSites),
        bindingSites.length > 0 ? BIND_RUNTIME : '',
        regionTable(regions.sites, regions),
        regions.sites.length > 0 ? REGION_RUNTIME : '',
        clientPropFactories(propSites, handedToComponents, handedDown),
        buildsClientProps ? CLIENT_PROPS_RUNTIME : ''
    ].filter(part => part.trim().length > 0).join('\n');
    // The attach function takes what it attaches: what this instance was rendered with first, and later what the server
    // rendered for it into a template the page copies, such as the children it handed a component that shows them
    // again. The page finds it, and the functions it built for children, by the instance.
    const setupBlock: string = [
        `${SETUP_LABEL}: {`,
        `__zibriOwn(${SETUP_RUNTIME_PARAM}.owner, ${ATTACH_FUNCTION}${buildsClientProps ? `, ${CLIENT_PROP_VALUES}` : ''});`,
        bodySource,
        `function ${ATTACH_FUNCTION}(${SETUP_RUNTIME_PARAM}) {`,
        attach,
        '}',
        `${ATTACH_FUNCTION}(${SETUP_RUNTIME_PARAM});`,
        '}'
    ].filter(part => part.trim().length > 0).join('\n');

    const setupBody: string = [
        clientAliasDefinitions(clientAliases, outer),
        hookDefinitions(outer),
        buildsClientProps ? `const ${CLIENT_PROP_VALUES} = {};` : '',
        setupBlock,
        // Handed back so the emitted call of a child component can pass in the functions this
        // instance declared for it. An early JSX return builds them before it leaves the block.
        buildsClientProps ? `return ${CLIENT_PROP_VALUES};` : ''
    ]
        .filter(part => part.trim().length > 0)
        .join('\n');
    const setupName: string = `${name}$$setup$${templateHash(file.text)}`;
    const propsParam: string = printClientParameter(fn, referenced, file);
    return {
        code: `function ${setupName}(${propsParam}, ${SETUP_RUNTIME_PARAM}) {\n${setupBody}\n}`,
        setupName,
        handlerSites: sites,
        clientPropSites: propSites,
        referencedProps,
        propShapes,
        stateShapes: resolveStateShapes(body.statements, clientNodes, omitted),
        referencedHooks,
        referencedTranslations,
        referencedIdentifiers: [...outer],
        outerNames: collectOuterNamesOf(clientNodes, fn, omitted),
        moduleLoading: clientNodes.flatMap(node => collectModuleLoading(node, omitted)),
        jsx: clientNodes.flatMap(node => collectJsx(node, omitted, regions.markup)),
        bindings: bindingSites.flatMap(bindingExpressions).map(expression => ({ start: expression.getStart(), end: expression.getEnd() }))
    };
}

/**
 * Prints the parameter of the client setup: what the component's parameter binds and client code reads.
 * The rest of it, the defaults included, is server code, and the page would carry its text for anyone to
 * read. A rest still holds the right fields without its siblings, because the props it leaves out are
 * never written into the page.
 * @param fn - The component function.
 * @param referenced - The variables client code reads.
 * @param file - The template.
 * @returns The parameter's source.
 */
function printClientParameter(fn: ComponentFunction, referenced: ReadonlySet<ts.Symbol>, file: ts.SourceFile): string {
    const parameter: ts.ParameterDeclaration | undefined = fn.parameters[0];
    const name: ts.BindingName | undefined = parameter === undefined ? undefined : clientBindingName(parameter.name, referenced);
    return parameter === undefined || name === undefined
        ? '__unusedProps'
        : printClientNode(ts.factory.updateParameterDeclaration(
            parameter,
            parameter.modifiers,
            parameter.dotDotDotToken,
            name,
            parameter.questionToken,
            parameter.type,
            parameter.initializer
        ), file);
}

/**
 * A binding with only what client code reads.
 * @param name - The binding name or pattern.
 * @param referenced - The variables client code reads.
 * @returns The binding, or undefined when client code reads nothing of it.
 */
function clientBindingName(name: ts.BindingName, referenced: ReadonlySet<ts.Symbol>): ts.BindingName | undefined {
    if (ts.isIdentifier(name)) {
        return isReferenced(name, referenced) ? name : undefined;
    }
    if (ts.isObjectBindingPattern(name)) {
        const elements: ts.BindingElement[] = name.elements.flatMap(element => clientBindingElement(element, referenced) ?? []);
        return elements.length === 0 ? undefined : ts.factory.updateObjectBindingPattern(name, elements);
    }
    // an element of an array pattern is bound by its position, so one that is left out stays a hole
    const elements: ts.ArrayBindingElement[] = name.elements.map(element => ts.isBindingElement(element)
        ? clientBindingElement(element, referenced) ?? ts.factory.createOmittedExpression()
        : element);
    return elements.every(ts.isOmittedExpression) ? undefined : ts.factory.updateArrayBindingPattern(name, elements);
}

/**
 * An element of a binding pattern with only what client code reads.
 * @param element - The element.
 * @param referenced - The variables client code reads.
 * @returns The element, or undefined when client code reads nothing of it.
 */
function clientBindingElement(element: ts.BindingElement, referenced: ReadonlySet<ts.Symbol>): ts.BindingElement | undefined {
    const name: ts.BindingName | undefined = clientBindingName(element.name, referenced);
    return name === undefined
        ? undefined
        : ts.factory.updateBindingElement(element, element.dotDotDotToken, element.propertyName, name, element.initializer);
}

/**
 * Collects the defaults of the component's parameter client code depends on, adding what they read to
 * the variables client code reads, since a default can read another prop.
 * @param parameter - The component's parameter.
 * @param referenced - The variables client code reads, which grows.
 * @returns The defaults.
 */
function collectReadDefaults(parameter: ts.ParameterDeclaration, referenced: Set<ts.Symbol>): ts.Expression[] {
    for (;;) {
        const defaults: ts.Expression[] = readDefaultsOf(parameter, referenced);
        const size: number = referenced.size;
        for (const symbol of defaults.flatMap(initializer => [...collectReferencedSymbols(initializer)])) {
            referenced.add(symbol);
        }
        if (referenced.size === size) {
            return defaults;
        }
    }
}

/**
 * The defaults of a binding that apply to something client code reads.
 * @param declaration - The parameter or binding element.
 * @param referenced - The variables client code reads.
 * @returns The defaults, outermost first.
 */
function readDefaultsOf(declaration: ts.ParameterDeclaration | ts.BindingElement, referenced: ReadonlySet<ts.Symbol>): ts.Expression[] {
    if (!collectPatternBindings(declaration.name).some(binding => isReferenced(binding, referenced))) {
        return [];
    }
    const nested: ts.BindingElement[] = ts.isIdentifier(declaration.name) ? [] : [...declaration.name.elements].filter(ts.isBindingElement);
    return [
        ...declaration.initializer === undefined ? [] : [declaration.initializer],
        ...nested.flatMap(element => readDefaultsOf(element, referenced))
    ];
}

/**
 * What client code reads of the value of each state it reads: the part of what it reads of the handle that is read
 * through `.value`, or all of the value when it hands the handle on whole.
 * @param statements - The statements of the component client code keeps, among them the states it reads.
 * @param nodes - Every node that ends up in the client script.
 * @param omitted - What inside the nodes is left out.
 * @returns The shapes, by the name of each state's variable.
 */
function resolveStateShapes(statements: ts.Statement[], nodes: ts.Node[], omitted: ReadonlySet<ts.Node>): Record<string, AccessShape> {
    const shapes: Record<string, AccessShape> = {};
    for (const declaration of statements.filter(ts.isVariableStatement).flatMap(statement => [...statement.declarationList.declarations])) {
        const symbol: ts.Symbol | undefined = ts.isIdentifier(declaration.name) ? symbolOf(declaration.name) : undefined;
        const initializer: ts.Expression | undefined = declaration.initializer;
        if (symbol === undefined || initializer === undefined || !STATE_HANDLE_HOOKS.some(hook => isHookCall(initializer, hook))) {
            continue;
        }
        const handle: AccessShape = accessShapeOf(symbol, nodes, omitted);
        const value: AccessShape | undefined = handle === 'whole' ? 'whole' : handle.fields['value'];
        if (value !== undefined) {
            shapes[symbol.name] = value;
        }
    }
    return shapes;
}

/**
 * The props client code reads, from what it reads of the props object as a whole.
 * @param shape - What client code reads, or undefined when it reads nothing.
 * @returns The props client code reads.
 */
function resolveReferencedProps(shape: AccessShape | undefined): ReferencedProps {
    if (shape === undefined) {
        return [];
    }
    if (shape === 'whole') {
        return 'all';
    }
    const { fields, restExcept } = shape;
    return restExcept === undefined
        ? Object.keys(fields)
        : { allExcept: restExcept.filter(field => !Object.hasOwn(fields, field)) };
}

/**
 * Collects the names client code reads from outside the component, one per name, at its first read.
 * @param nodes - Every node that ends up in the client script.
 * @param fn - The component function.
 * @param omitted - What inside the nodes is left out.
 * @returns The names, in the order they are first read.
 */
function collectOuterNamesOf(nodes: ts.Node[], fn: ComponentFunction, omitted: ReadonlySet<ts.Node>): OuterName[] {
    const names: Map<string, OuterName> = new Map<string, OuterName>();
    for (const reference of nodes.flatMap(node => collectOuterReferences(node, fn, omitted))) {
        if (!names.has(reference.name)) {
            const span: SourceSpan = { start: reference.identifier.getStart(), end: reference.identifier.getEnd() };
            names.set(reference.name, { name: reference.name, origin: reference.origin, span });
        }
    }
    return [...names.values()];
}

/**
 * Collects the uses of `import(...)` and `import.meta` within a node.
 * @param node - The node to search.
 * @param omitted - What inside the node is left out.
 * @returns The uses, in source order.
 */
function collectModuleLoading(node: ts.Node, omitted: ReadonlySet<ts.Node>): ModuleLoadingSite[] {
    const sites: ModuleLoadingSite[] = [];
    walk(node, current => {
        if (ts.isCallExpression(current) && current.expression.kind === ts.SyntaxKind.ImportKeyword) {
            sites.push({ construct: 'import()', span: { start: current.getStart(), end: current.getEnd() } });
        }
        else if (ts.isMetaProperty(current) && current.keywordToken === ts.SyntaxKind.ImportKeyword) {
            sites.push({ construct: 'import.meta', span: { start: current.getStart(), end: current.getEnd() } });
        }
    }, omitted);
    return sites;
}

/**
 * Collects where client code holds JSX, the outermost element of each piece of markup.
 * @param node - A node that ends up in the client script.
 * @param omitted - What inside the node is left out, such as the markup of an early return.
 * @param rendered - The markup of the conditions and lists the browser renders.
 * @returns The spans of the JSX.
 */
function collectJsx(node: ts.Node, omitted: ReadonlySet<ts.Node>, rendered: ReadonlySet<ts.Node>): SourceSpan[] {
    const sites: SourceSpan[] = [];
    walk(node, current => {
        // the markup of a condition or a list the browser renders is html it builds, and JSX inside its code is not
        if (rendered.has(current)) {
            return true;
        }
        if (ts.isJsxElement(current) || ts.isJsxSelfClosingElement(current) || ts.isJsxFragment(current)) {
            sites.push({ start: current.getStart(), end: current.getEnd() });
            return false;
        }
        return true;
    }, omitted);
    return sites;
}

/**
 * A short fingerprint of a template's source. A page defines each setup once by its name, so the name
 * carries the fingerprint: two different components sharing a name get different setups, and the same
 * template rendered twice shares one.
 * @param source - The template source.
 * @returns The first twelve hex digits of the source's SHA-256.
 */
function templateHash(source: string): string {
    return createHash('sha256')
        .update(source)
        .digest('hex')
        .slice(0, 12);
}

/**
 * Whether a binding's variable is read by client code.
 * @param binding - The binding identifier.
 * @param referenced - The variables client code reads.
 * @returns True when client code reads it.
 */
function isReferenced(binding: ts.Identifier, referenced: ReadonlySet<ts.Symbol>): boolean {
    const symbol: ts.Symbol | undefined = symbolOf(binding);
    return symbol !== undefined && referenced.has(symbol);
}

/**
 * What client code reads from the value a binding pattern takes apart.
 * @param name - The pattern, or the name the value is bound to.
 * @param referenced - The symbols client code references.
 * @param nodes - The client code.
 * @param omitted - The nodes left out of the client code.
 * @returns The shape, or undefined when client code reads nothing of the value.
 */
function patternShape(
    name: ts.BindingName,
    referenced: ReadonlySet<ts.Symbol>,
    nodes: readonly ts.Node[],
    omitted: ReadonlySet<ts.Node>
): AccessShape | undefined {
    if (ts.isIdentifier(name)) {
        const symbol: ts.Symbol | undefined = symbolOf(name);
        return symbol === undefined || !referenced.has(symbol) ? undefined : accessShapeOf(symbol, nodes, omitted);
    }
    if (ts.isArrayBindingPattern(name)) {
        return collectPatternBindings(name).some(binding => isReferenced(binding, referenced)) ? 'whole' : undefined;
    }
    return objectPatternShape(name, referenced, nodes, omitted);
}

/**
 * What client code reads from the value an object binding pattern takes apart.
 * @param pattern - The pattern.
 * @param referenced - The symbols client code references.
 * @param nodes - The client code.
 * @param omitted - The nodes left out of the client code.
 * @returns The shape, or undefined when client code reads nothing of the value.
 */
function objectPatternShape(
    pattern: ts.ObjectBindingPattern,
    referenced: ReadonlySet<ts.Symbol>,
    nodes: readonly ts.Node[],
    omitted: ReadonlySet<ts.Node>
): AccessShape | undefined {
    let shape: AccessShape | undefined = undefined;
    for (const element of pattern.elements) {
        const read: AccessShape | undefined = patternShape(element.name, referenced, nodes, omitted);
        if (read === undefined) {
            continue;
        }
        if (element.dotDotDotToken !== undefined) {
            // a rest holds the fields the pattern does not name, so what is read from it is read from the
            // value, apart from what the pattern names
            const except: string[] | undefined = namedKeysOf(pattern);
            shape = except === undefined ? 'whole' : mergeAccessShapes(shape, resolveAccessThroughRest(read, except));
            continue;
        }
        const key: string | undefined = propertyKeyOf(element);
        shape = key === undefined ? 'whole' : mergeAccessShapes(shape, { fields: { [key]: read } });
    }
    return shape;
}

/**
 * Resolves which render-data hooks the client code needs, adding implied dependencies
 * (`$ts` is implemented in terms of `$t`).
 * @param referenced - Names the client code reads from outside the component.
 * @returns The hook names to inline, in dependency order.
 */
function resolveHooks(referenced: Set<string>): string[] {
    const hooks: string[] = [];
    // what keeps state and runs the bindings, which a page carries only when it uses state. An effect runs again from
    // the same update, after the bindings
    if (['useState', 'useEffect', 'useInput', 'useWritableInput'].some(hook => referenced.has(hook))) {
        hooks.push('useState');
    }
    if (referenced.has('useEffect')) {
        hooks.push('useEffect');
    }
    if (referenced.has('$t') || referenced.has('$ts')) {
        hooks.push('$t');
    }
    if (referenced.has('$ts')) {
        hooks.push('$ts');
    }
    if (referenced.has('$f')) {
        hooks.push('$f');
    }
    return hooks;
}

/**
 * Binds the renamed `?client` imports back to the browser globals the vendor bundle provides, since
 * a rename leaves the local name undefined in the browser.
 *
 * Only referenced aliases are emitted, so a binding used purely as a type never produces a lookup of
 * a global that the bundle does not expose.
 * @param aliases - The renamed `?client` bindings of the template.
 * @param referenced - Names the client code reads from outside the component.
 * @returns The alias definition source.
 */
function clientAliasDefinitions(aliases: ClientGlobalAlias[], referenced: Set<string>): string {
    return aliases
        .filter(alias => referenced.has(alias.local))
        .map(alias => `const ${alias.local} = ${alias.global};`)
        .join('\n');
}

/**
 * Returns the definitions of the lifecycle hooks the component references.
 * @param referenced - Names the client code reads from outside the component.
 * @returns The hook definition source.
 */
function hookDefinitions(referenced: Set<string>): string {
    return Object.entries(CLIENT_SETUP_HOOKS)
        .filter(([name]) => referenced.has(name))
        .map(([, source]) => source)
        .join('\n');
}

/**
 * Builds the `__bindingSites` table mapping each binding site id to where it writes and a factory that makes the
 * function computing it, parameterized by the site's captured variables.
 * @param sites - The binding sites.
 * @returns The table source (empty when there are no sites).
 */
function bindingTable(sites: BindingSite[]): string {
    if (sites.length === 0) {
        return '';
    }
    const entries: string[] = sites.map(site => {
        const params: string = site.captureVars.join(', ');
        const attribute: string = site.attribute === undefined ? 'undefined' : JSON.stringify(site.attribute);
        // the whole text of an element is its text and its holes, which the page joins as the server renders them, and
        // a state handed to a component is followed by its value wherever the component forwards it
        let computed: string = printClientNode(site.expression);
        if (site.handle) {
            computed = `(${computed}).value`;
        }
        else if (site.parts !== undefined) {
            computed = `[${site.parts.flatMap(part => {
                if (ts.isJsxText(part)) {
                    const text: string = decodeJsxEntities(normalizeJsxText(part.text));
                    return text === '' ? [] : [JSON.stringify(text)];
                }
                return ts.isJsxExpression(part) && part.expression != undefined ? [printClientNode(part.expression)] : [];
            }).join(', ')}]`;
        }
        // a state itself is written back where it binds both ways
        const write: string = site.handle ? `, write: (${params}) => (next) => { (${printClientNode(site.expression)}).value = next; }` : '';
        return `${site.id}: { kind: '${site.kind}', attribute: ${attribute}, make: (${params}) => () => (${computed})${write} }`;
    });
    return `const __bindingSites = {\n${entries.join(',\n')}\n};`;
}

/**
 * The factories of the handles a component builds for what it hands down that follows a state, which a component
 * below reads with `useInput` or `useWritableInput`: the state itself, or a value computed when it is read.
 * @param sites - The binding sites of the props and contexts it hands down.
 * @returns The table entries.
 */
function inputFactories(sites: BindingSite[]): string[] {
    return sites.map(site => {
        const params: string = site.captureVars.join(', ');
        return site.handle
            ? `${site.id}: (${params}) => (${printClientNode(site.expression)})`
            : `${site.id}: (...captured) => __zibriDerived(__bindingSites.${site.id}.make(...captured))`;
    });
}

/**
 * The expressions a binding computes: its expression, or every hole of an element whose whole text it writes.
 * @param site - The binding site.
 * @returns The expressions.
 */
function bindingExpressions(site: BindingSite): ts.Expression[] {
    return site.parts === undefined
        ? [site.expression]
        : site.parts.flatMap(part => ts.isJsxExpression(part) && part.expression != undefined ? [part.expression] : []);
}

/**
 * Builds the `__handlers` table mapping each site id to its event and a factory that reconstructs
 * the handler, parameterized by the site's captured variables.
 * @param sites - The handler sites.
 * @returns The table source (empty when there are no sites).
 */
function handlerTable(sites: HandlerSite[]): string {
    if (sites.length === 0) {
        return '';
    }
    const entries: string[] = sites.map(site => {
        const params: string = site.captureVars.join(', ');
        return `${site.id}: { event: '${site.event}', make: (${params}) => (${printClientNode(site.handler)}) }`;
    });
    return `const __handlers = {\n${entries.join(',\n')}\n};`;
}

/**
 * Emits the build-time table of client-prop factories: one factory per site, parameterized by the
 * variables that site captures from enclosing scopes. A handler written on a nested component is a
 * function prop as well, for the component that calls it instead of attaching it. Its factory is the
 * one the handler table already holds.
 * @param sites - The component's client-prop sites.
 * @param handlers - The handler sites written on nested components.
 * @param inputs - The binding sites of the props and contexts the component hands down that follow a state.
 * @returns The table source (empty when there are no sites).
 */
function clientPropFactories(sites: ClientPropSite[], handlers: HandlerSite[], inputs: BindingSite[]): string {
    const entries: string[] = [
        ...sites.map(site => `${site.id}: (${site.captureVars.join(', ')}) => (${printClientNode(site.value)})`),
        ...handlers.map(site => `${site.id}: __handlers.${site.id}.make`),
        ...inputFactories(inputs)
    ];
    return entries.length === 0 ? '' : `const __clientProps = {\n${entries.join(',\n')}\n};`;
}

/**
 * What decides which body statements client code keeps.
 */
type Selection = {
    /**
     * The variables client code reads so far.
     */
    needed: ReadonlySet<ts.Symbol>,
    /**
     * The callbacks of `onServer` blocks, which hold no client code whatever they contain.
     */
    serverOnly: ReadonlySet<ts.Node>
};

/**
 * Produces the client-relevant statements of a component body.
 *
 * A component body runs on the server, and only the part the client genuinely needs may be shipped —
 * otherwise the page carries server-only code, and every literal in it, for anyone to read. Kept are
 * the statements holding client code (`onClient`) and the declarations those, the handlers and the
 * function props actually read, transitively — by the variable they refer to, so a binding that merely
 * shares a name keeps nothing. Inside kept control flow the same rule applies statement by statement,
 * and inside a kept declaration declarator by declarator. Everything else — `onServer` blocks included —
 * stays on the server.
 *
 * JSX `return` statements are neutralized to attaching the handlers and a `break`, so early-exit
 * control flow is preserved without rendering markup on the client, and a statement returning markup
 * early is kept whenever code after it is.
 * @param fn - The component function.
 * @param seeds - The variables the markup's client code reads, which the body has to provide.
 * @returns The kept statements and what inside them is left out.
 */
function clientBody(fn: ComponentFunction, seeds: Set<ts.Symbol>): ClientBody {
    if (fn.body == undefined || !ts.isBlock(fn.body)) {
        return { statements: [], omitted: new Set<ts.Node>() };
    }
    // A top-level JSX return is the component's normal end — drop it. `onServer` bodies are left out
    // before anything else looks at the statements, so what they reference cannot keep code alive.
    const candidates: ts.Statement[] = fn.body.statements.filter(statement => !isJsxReturn(statement));
    const serverOnly: Set<ts.Node> = new Set<ts.Node>(candidates.flatMap(collectServerOnlyCallbacks));
    const needed: Set<ts.Symbol> = new Set<ts.Symbol>(seeds);

    // What is kept can read a declaration that reads another, so grow until it settles.
    for (;;) {
        const selection: Selection = { needed, serverOnly };
        const relevant: ts.Statement[] = candidates.filter(statement => isRelevant(statement, selection));
        // a statement returning markup early, such as `if (!user) return <Login/>;`, ends the body for the
        // client too, or code after it runs that the server never ran
        const statements: ts.Statement[] = candidates.filter((statement, index) => relevant.includes(statement)
            || (nestedJsxReturns(statement).length > 0 && candidates.slice(index + 1).some(later => relevant.includes(later))));
        const omitted: Set<ts.Node> = new Set<ts.Node>(serverOnly);
        for (const statement of statements) {
            omitUnneeded(statement, selection, omitted);
            for (const jsx of nestedJsxReturns(statement)) {
                omitted.add(jsx);
            }
        }
        const size: number = needed.size;
        for (const statement of statements) {
            for (const symbol of collectReferencedSymbols(statement, omitted)) {
                needed.add(symbol);
            }
        }
        if (needed.size === size) {
            return { statements, omitted };
        }
    }
}

/**
 * Whether a statement is one client code needs: it holds client code, declares or assigns a variable
 * client code reads, or is control flow around such a statement.
 * @param statement - The statement.
 * @param selection - What decides.
 * @returns True when the statement is kept.
 */
function isRelevant(statement: ts.Statement, selection: Selection): boolean {
    if (isControlFlow(statement)) {
        return containsClientCode(statement, selection.serverOnly)
            || nestedStatements(statement).some(nested => isRelevant(nested, selection));
    }
    return ts.isVariableStatement(statement)
        ? statement.declarationList.declarations.some(declaration => isDeclarationNeeded(declaration, selection))
        : containsClientCode(statement, selection.serverOnly) || providesNeededVariable(statement, selection.needed);
}

/**
 * Whether a statement nested in kept control flow is kept: a relevant one, or one that decides where
 * control goes next (`return`, `break`, `continue`, `throw`, or control flow holding one), since dropping
 * it would change which client code runs.
 * @param statement - The nested statement.
 * @param selection - What decides.
 * @returns True when the statement is kept.
 */
function isKeptInControlFlow(statement: ts.Statement, selection: Selection): boolean {
    return isRelevant(statement, selection)
        || isJump(statement)
        || (isControlFlow(statement) && nestedStatements(statement).some(nested => isKeptInControlFlow(nested, selection)));
}

/**
 * Records what inside a kept statement client code does not need: the statements of its control flow
 * that are not kept, and the declarations of a declaration statement that are not needed.
 * @param statement - The kept statement.
 * @param selection - What decides.
 * @param omitted - The accumulator of what is left out.
 */
function omitUnneeded(statement: ts.Statement, selection: Selection, omitted: Set<ts.Node>): void {
    if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
            if (!isDeclarationNeeded(declaration, selection)) {
                omitted.add(declaration);
            }
        }
        return;
    }
    if (!isControlFlow(statement)) {
        return;
    }
    for (const nested of nestedStatements(statement)) {
        if (isKeptInControlFlow(nested, selection)) {
            omitUnneeded(nested, selection, omitted);
        }
        else {
            omitted.add(nested);
        }
    }
}

/**
 * Whether a single declaration is needed: it declares a variable client code reads, or its initializer
 * holds client code.
 * @param declaration - The declaration.
 * @param selection - What decides.
 * @returns True when the declaration is kept.
 */
function isDeclarationNeeded(declaration: ts.VariableDeclaration, selection: Selection): boolean {
    return declaredSymbols(declaration).some(symbol => selection.needed.has(symbol))
        || containsClientCode(declaration, selection.serverOnly);
}

/**
 * Whether a statement is control flow: a statement whose nested statements are kept or left out one by
 * one.
 * @param statement - The statement.
 * @returns True for a block, `if`, loop, label, `try` or `switch`.
 */
function isControlFlow(statement: ts.Statement): boolean {
    return ts.isBlock(statement)
        || ts.isIfStatement(statement)
        || ts.isForStatement(statement)
        || ts.isForOfStatement(statement)
        || ts.isForInStatement(statement)
        || ts.isWhileStatement(statement)
        || ts.isDoStatement(statement)
        || ts.isLabeledStatement(statement)
        || ts.isTryStatement(statement)
        || ts.isSwitchStatement(statement);
}

/**
 * Whether a statement transfers control.
 * @param statement - The statement.
 * @returns True for `return`, `break`, `continue` and `throw`.
 */
function isJump(statement: ts.Statement): boolean {
    return ts.isReturnStatement(statement)
        || ts.isBreakStatement(statement)
        || ts.isContinueStatement(statement)
        || ts.isThrowStatement(statement);
}

/**
 * Whether a node contains client code, i.e. An `onClient` or `useEffect` call. Such a statement is kept no matter
 * what references it, because its callback *is* the client behavior.
 * @param node - The node to inspect.
 * @param omitted - What inside the node is left out.
 * @returns True when the node contains an `onClient` or `useEffect` call.
 */
function containsClientCode(node: ts.Node, omitted: ReadonlySet<ts.Node>): boolean {
    let found: boolean = false;
    walk(node, current => {
        if (isHookCall(current, 'onClient') || isHookCall(current, 'useEffect')) {
            found = true;
        }
        return !found;
    }, omitted);
    return found;
}

/**
 * Whether a statement provides a variable the client code reads: a function, class or enum declaration
 * of one, or an assignment to one (so a value the client reads is not left at its initial state).
 * @param statement - The statement to inspect.
 * @param needed - The variables the client code reads.
 * @returns True when the statement has to be kept.
 */
function providesNeededVariable(statement: ts.Statement, needed: ReadonlySet<ts.Symbol>): boolean {
    if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) {
        return declaredSymbols(statement).some(symbol => needed.has(symbol));
    }
    if (ts.isExpressionStatement(statement)) {
        const assigned: ts.Identifier | undefined = assignedIdentifier(statement.expression);
        const symbol: ts.Symbol | undefined = assigned === undefined ? undefined : symbolOf(assigned);
        return symbol !== undefined && needed.has(symbol);
    }
    return false;
}

/**
 * The identifier a statement-level assignment or update writes to, or undefined when the expression is
 * neither. Only a plain identifier target counts — a member write mutates a value that is already
 * kept or dropped together with its own declaration.
 * @param node - The expression to inspect.
 * @returns The assigned identifier, or undefined.
 */
function assignedIdentifier(node: ts.Expression): ts.Identifier | undefined {
    const expression: ts.Expression = unwrapTypeSyntax(node);
    if (ts.isBinaryExpression(expression)
        && expression.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
        && expression.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
        const target: ts.Expression = unwrapTypeSyntax(expression.left);
        return ts.isIdentifier(target) ? target : undefined;
    }
    const isUpdate: boolean = (ts.isPrefixUnaryExpression(expression) || ts.isPostfixUnaryExpression(expression))
        && (expression.operator === ts.SyntaxKind.PlusPlusToken || expression.operator === ts.SyntaxKind.MinusMinusToken);
    if (isUpdate && (ts.isPrefixUnaryExpression(expression) || ts.isPostfixUnaryExpression(expression))) {
        const target: ts.Expression = unwrapTypeSyntax(expression.operand);
        return ts.isIdentifier(target) ? target : undefined;
    }
    return undefined;
}

/**
 * A statement together with every statement nested in its control flow, but not in nested functions
 * (those carry their own scope).
 * @param statement - The statement.
 * @returns The statement and its nested statements.
 */
function statementTree(statement: ts.Statement): ts.Statement[] {
    return [statement, ...nestedStatements(statement).flatMap(statementTree)];
}

/**
 * The markup of the JSX returns nested in a statement's control flow, which the client replaces with a
 * `break`.
 * @param statement - The statement.
 * @returns The returned JSX expressions.
 */
function nestedJsxReturns(statement: ts.Statement): ts.Expression[] {
    return statementTree(statement).flatMap(nested => isJsxReturn(nested) ? [unwrapTypeSyntax(nested.expression)] : []);
}

/**
 * A `return` statement with a value.
 */
type ValueReturn = ts.ReturnStatement & {
    /**
     * The returned value.
     */
    expression: ts.Expression
};

/**
 * Whether a statement returns JSX.
 * @param statement - The statement.
 * @returns True for a `return` of JSX.
 */
function isJsxReturn(statement: ts.Statement): statement is ValueReturn {
    return ts.isReturnStatement(statement) && statement.expression != undefined && isJsxExpression(statement.expression);
}

/**
 * Rebuilds a statement the way the client runs it: every JSX `return` the attaching of the handlers and a
 * `break` to the setup label, so an early exit leaves the setup block without aborting the surrounding
 * script, and everything client code does not need left out.
 * @param statement - The kept statement.
 * @param omitted - What is left out.
 * @returns The statement to print.
 */
function neutralizeStatementTree(statement: ts.Statement, omitted: ReadonlySet<ts.Node>): ts.Statement {
    if (isJsxReturn(statement)) {
        return ts.factory.createBlock([
            ts.factory.createExpressionStatement(
                ts.factory.createCallExpression(ts.factory.createIdentifier(ATTACH_FUNCTION), undefined, [ts.factory.createIdentifier(SETUP_RUNTIME_PARAM)])
            ),
            ts.factory.createBreakStatement(SETUP_LABEL)
        ]);
    }
    if (ts.isVariableStatement(statement)) {
        const list: ts.VariableDeclarationList = statement.declarationList;
        return ts.factory.updateVariableStatement(
            statement,
            statement.modifiers,
            ts.factory.updateVariableDeclarationList(list, list.declarations.filter(declaration => !omitted.has(declaration)))
        );
    }
    return neutralizeControlFlow(statement, omitted);
}

/**
 * Rebuilds the control flow of a statement with {@link neutralizeStatementTree} applied to every
 * statement nested in it.
 * @param statement - The statement.
 * @param omitted - What is left out.
 * @returns The rebuilt statement, or the statement itself when it holds no control flow.
 */
function neutralizeControlFlow(statement: ts.Statement, omitted: ReadonlySet<ts.Node>): ts.Statement {
    const factory: ts.NodeFactory = ts.factory;
    const nested: (child: ts.Statement) => ts.Statement = child => neutralizeNested(child, omitted);
    if (ts.isBlock(statement)) {
        return neutralizeBlock(statement, omitted);
    }
    if (ts.isIfStatement(statement)) {
        const elseStatement: ts.Statement | undefined = statement.elseStatement;
        return factory.updateIfStatement(
            statement,
            statement.expression,
            nested(statement.thenStatement),
            elseStatement == undefined || omitted.has(elseStatement) ? undefined : nested(elseStatement)
        );
    }
    if (ts.isIterationStatement(statement, false)) {
        return neutralizeLoop(statement, nested);
    }
    if (ts.isLabeledStatement(statement)) {
        return factory.updateLabeledStatement(statement, statement.label, nested(statement.statement));
    }
    if (ts.isTryStatement(statement)) {
        const handler: ts.CatchClause | undefined = statement.catchClause;
        return factory.updateTryStatement(
            statement,
            neutralizeBlock(statement.tryBlock, omitted),
            handler == undefined
                ? undefined
                : factory.updateCatchClause(handler, handler.variableDeclaration, neutralizeBlock(handler.block, omitted)),
            statement.finallyBlock == undefined ? undefined : neutralizeBlock(statement.finallyBlock, omitted)
        );
    }
    if (ts.isSwitchStatement(statement)) {
        const kept: (statements: ts.NodeArray<ts.Statement>) => ts.Statement[] = statements => statements
            .filter(child => !omitted.has(child))
            .map(child => neutralizeStatementTree(child, omitted));
        return factory.updateSwitchStatement(
            statement,
            statement.expression,
            factory.updateCaseBlock(statement.caseBlock, statement.caseBlock.clauses.map(clause => ts.isCaseClause(clause)
                ? factory.updateCaseClause(clause, clause.expression, kept(clause.statements))
                : factory.updateDefaultClause(clause, kept(clause.statements))))
        );
    }
    return statement;
}

/**
 * Rebuilds a loop with its body neutralized.
 * @param loop - The loop.
 * @param nested - Neutralizes the body.
 * @returns The rebuilt loop.
 */
function neutralizeLoop(loop: ts.IterationStatement, nested: (child: ts.Statement) => ts.Statement): ts.Statement {
    const factory: ts.NodeFactory = ts.factory;
    if (ts.isForStatement(loop)) {
        return factory.updateForStatement(loop, loop.initializer, loop.condition, loop.incrementor, nested(loop.statement));
    }
    if (ts.isForOfStatement(loop)) {
        return factory.updateForOfStatement(loop, loop.awaitModifier, loop.initializer, loop.expression, nested(loop.statement));
    }
    if (ts.isForInStatement(loop)) {
        return factory.updateForInStatement(loop, loop.initializer, loop.expression, nested(loop.statement));
    }
    if (ts.isWhileStatement(loop)) {
        return factory.updateWhileStatement(loop, loop.expression, nested(loop.statement));
    }
    return ts.isDoStatement(loop) ? factory.updateDoStatement(loop, nested(loop.statement), loop.expression) : loop;
}

/**
 * Applies {@link neutralizeStatementTree} to a statement in a position that needs one, which becomes an
 * empty block when it is left out.
 * @param statement - The nested statement.
 * @param omitted - What is left out.
 * @returns The rebuilt statement.
 */
function neutralizeNested(statement: ts.Statement, omitted: ReadonlySet<ts.Node>): ts.Statement {
    return omitted.has(statement) ? ts.factory.createBlock([]) : neutralizeStatementTree(statement, omitted);
}

/**
 * Applies {@link neutralizeStatementTree} to a block, which stays a block, leaving out what client code
 * does not need.
 * @param block - The block.
 * @param omitted - What is left out.
 * @returns The rebuilt block.
 */
function neutralizeBlock(block: ts.Block, omitted: ReadonlySet<ts.Node>): ts.Block {
    const statements: ts.Statement[] = omitted.has(block)
        ? []
        : block.statements.filter(statement => !omitted.has(statement)).map(statement => neutralizeStatementTree(statement, omitted));
    return ts.factory.updateBlock(block, statements);
}