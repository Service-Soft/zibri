import { createHash } from 'node:crypto';

import * as ts from 'typescript';

import { accessShapeOf } from './access-shape-analysis';
import { CLIENT_PROP_VALUES, CLIENT_PROPS_RUNTIME, ClientPropSite, collectClientPropSites } from './client-props';
import { collectHandlerSites, HandlerSite } from './handlers';
import { REATTACH_RUNTIME, SETUP_RUNTIME_PARAM } from './reattach';
import { SourceSpan } from '../../diagnostics/diagnostic.model';
import { AccessShape } from '../../runtime/access-shape';
import { collectOuterNames, collectOuterReferences, collectPatternBindings, collectReferencedSymbols, declaredSymbols, OuterOrigin } from '../../semantics/binding';
import { ClientGlobalAlias } from '../../semantics/client-packages';
import { ComponentFunction, isJsxExpression, nestedStatements } from '../../semantics/component';
import { symbolOf } from '../../semantics/symbols';
import { collectTranslationSources, TranslationSources } from '../../semantics/translation-sources';
import { unwrapTypeSyntax, walk } from '../../semantics/walk';
import { printNode } from '../server/print';

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
     * The component's own prop names that the client code actually references. Only these are
     * serialized into the page, so server-only props never reach the browser.
     */
    referencedProps: string[],
    /**
     * What the client code reads from each referenced prop. Only that much of a prop is serialized into
     * the page.
     */
    propShapes: Record<string, AccessShape>,
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
    moduleLoading: ModuleLoadingSite[]
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
 * Client definitions of the framework lifecycle hooks. `onClient` runs its callback in the browser;
 * `onServer` is a no-op there.
 */
const CLIENT_HOOKS: Readonly<Record<string, string>> = {
    onClient: 'const onClient = (fn) => { fn(); };',
    onServer: 'const onServer = () => {};'
};

/**
 * Label of the block wrapping the component's client setup. JSX returns become `break` to this
 * label so an early exit skips the remaining setup without aborting the whole script, while the
 * handler table and reattachment (emitted inside the block) can still close over the body's locals.
 */
const SETUP_LABEL: string = '__zibriSetup';

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
    // The client code written in the markup — handlers and function props.
    const markup: ts.Expression[] = [...sites.map(site => site.handler), ...propSites.map(site => site.value)];

    // What the markup's client code reads seeds what the body has to provide, so the body is filtered
    // down to the declarations those actually reach.
    const body: ClientBody = clientBody(fn, new Set(markup.flatMap(expression => [...collectReferencedSymbols(expression)])));
    const file: ts.SourceFile = fn.getSourceFile();
    const bodySource: string = body.statements
        .map(statement => printNode(neutralizeStatementTree(statement, body.omitted), undefined, file))
        .join('\n');

    // Exactly the nodes that end up in the client script: the kept body (so a `$t` inside a function a
    // handler calls is found too) plus the inline handler and function-prop expressions. A `$t` in the
    // jsx is not included, because that one is resolved during the server render.
    const clientNodes: ts.Node[] = [...body.statements, ...markup];
    // Only what is reachable from client code counts — props used solely in JSX stay server-side.
    const referenced: Set<ts.Symbol> = new Set(clientNodes.flatMap(node => [...collectReferencedSymbols(node, body.omitted)]));
    const outer: Set<string> = new Set(clientNodes.flatMap(node => [...collectOuterNames(node, fn, body.omitted)]));

    const propBindings: ts.Identifier[] = fn.parameters.length === 0
        ? []
        : collectPatternBindings(fn.parameters[0]).filter(binding => isReferenced(binding, referenced));
    const referencedProps: string[] = propBindings.map(binding => binding.text);
    const propShapes: Record<string, AccessShape> = Object.fromEntries(propBindings.flatMap(binding => {
        const symbol: ts.Symbol | undefined = symbolOf(binding);
        return symbol === undefined ? [] : [[binding.text, accessShapeOf(symbol, clientNodes, body.omitted)]];
    }));
    const referencedHooks: string[] = resolveHooks(outer);
    const referencedTranslations: TranslationSources = collectTranslationSources(clientNodes, body.omitted);

    // A component only runs on the client when it stamps an event handler, hands a function to a
    // nested component, or calls `onClient`. Statement-level body code without any of those is pure
    // server work (an `onServer` block, a computed class name), so emitting a setup for it would ship
    // dead code - and possibly a server-only reference like `GlobalRegistry` - to every page using it.
    const hasClientBehavior: boolean = sites.length > 0 || propSites.length > 0 || outer.has('onClient');
    if (!hasClientBehavior) {
        return {
            code: undefined,
            setupName: undefined,
            handlerSites: sites,
            clientPropSites: propSites,
            referencedProps: [],
            propShapes: {},
            referencedHooks: [],
            referencedTranslations: { sources: [], complete: true },
            referencedIdentifiers: [],
            outerNames: [],
            moduleLoading: []
        };
    }

    // The body's locals (handler functions, state) must be visible to the handler table, the
    // client-prop factories and the reattachment, so they all live inside the labeled setup block.
    const setupBlock: string = [
        `${SETUP_LABEL}: {`,
        bodySource,
        handlerTable(sites),
        sites.length > 0 ? REATTACH_RUNTIME : '',
        clientPropFactories(propSites),
        propSites.length > 0 ? CLIENT_PROPS_RUNTIME : '',
        '}'
    ].filter(part => part.trim().length > 0).join('\n');

    const setupBody: string = [
        clientAliasDefinitions(clientAliases, outer),
        hookDefinitions(outer),
        propSites.length > 0 ? `const ${CLIENT_PROP_VALUES} = {};` : '',
        setupBlock,
        // Handed back so the emitted call of a child component can pass in the functions this
        // instance declared for it. An early JSX return skips the block, but then the child was not
        // rendered either, so nothing asks for them.
        propSites.length > 0 ? `return ${CLIENT_PROP_VALUES};` : ''
    ]
        .filter(part => part.trim().length > 0)
        .join('\n');
    const setupName: string = `${name}$$setup$${templateHash(file.text)}`;
    const propsParam: string = fn.parameters.length > 0 ? printNode(fn.parameters[0]) : '__unusedProps';
    return {
        code: `function ${setupName}(${propsParam}, ${SETUP_RUNTIME_PARAM}) {\n${setupBody}\n}`,
        setupName,
        handlerSites: sites,
        clientPropSites: propSites,
        referencedProps,
        propShapes,
        referencedHooks,
        referencedTranslations,
        referencedIdentifiers: [...outer],
        outerNames: collectOuterNamesOf(clientNodes, fn, body.omitted),
        moduleLoading: clientNodes.flatMap(node => collectModuleLoading(node, body.omitted))
    };
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
 * Resolves which render-data hooks the client code needs, adding implied dependencies
 * (`$ts` is implemented in terms of `$t`).
 * @param referenced - Names the client code reads from outside the component.
 * @returns The hook names to inline, in dependency order.
 */
function resolveHooks(referenced: Set<string>): string[] {
    const hooks: string[] = [];
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
    return Object.entries(CLIENT_HOOKS)
        .filter(([name]) => referenced.has(name))
        .map(([, source]) => source)
        .join('\n');
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
        return `${site.id}: { event: '${site.event}', make: (${params}) => (${printNode(site.handler)}) }`;
    });
    return `const __handlers = {\n${entries.join(',\n')}\n};`;
}

/**
 * Emits the build-time table of client-prop factories: one factory per site, parameterized by the
 * variables that site captures from enclosing scopes.
 * @param sites - The component's client-prop sites.
 * @returns The table source (empty when there are no sites).
 */
function clientPropFactories(sites: ClientPropSite[]): string {
    if (sites.length === 0) {
        return '';
    }
    const entries: string[] = sites.map(site => `${site.id}: (${site.captureVars.join(', ')}) => (${printNode(site.value)})`);
    return `const __clientProps = {\n${entries.join(',\n')}\n};`;
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
 * JSX `return` statements are neutralized to a `break`, so early-exit control flow is preserved
 * without rendering markup on the client.
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
    const serverOnly: Set<ts.Node> = new Set<ts.Node>(candidates.flatMap(serverOnlyCallbacks));
    const needed: Set<ts.Symbol> = new Set<ts.Symbol>(seeds);

    // What is kept can read a declaration that reads another, so grow until it settles.
    for (;;) {
        const selection: Selection = { needed, serverOnly };
        const statements: ts.Statement[] = candidates.filter(statement => isRelevant(statement, selection));
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
    if (ts.isVariableStatement(statement)) {
        return statement.declarationList.declarations.some(declaration => isDeclarationNeeded(declaration, selection));
    }
    return containsClientCode(statement, selection.serverOnly) || providesNeededVariable(statement, selection.needed);
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
 * Whether a node contains client code, i.e. An `onClient` call. Such a statement is kept no matter what
 * references it, because its callback *is* the client behavior.
 * @param node - The node to inspect.
 * @param omitted - What inside the node is left out.
 * @returns True when the node contains an `onClient` call.
 */
function containsClientCode(node: ts.Node, omitted: ReadonlySet<ts.Node>): boolean {
    let found: boolean = false;
    walk(node, current => {
        if (isHookCall(current, 'onClient')) {
            found = true;
        }
        return !found;
    }, omitted);
    return found;
}

/**
 * Whether a node is a call of the named framework hook.
 * @param node - The node to test.
 * @param hook - The hook name.
 * @returns True for a call of that hook.
 */
function isHookCall(node: ts.Node, hook: string): node is ts.CallExpression {
    if (!ts.isCallExpression(node)) {
        return false;
    }
    const callee: ts.Expression = unwrapTypeSyntax(node.expression);
    return ts.isIdentifier(callee) && callee.text === hook;
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
 * The `onServer` call a statement consists of, if it is one.
 * @param statement - The statement.
 * @returns The call, or undefined for any other statement.
 */
function onServerCallOf(statement: ts.Statement): ts.CallExpression | undefined {
    if (!ts.isExpressionStatement(statement)) {
        return undefined;
    }
    const expression: ts.Expression = unwrapTypeSyntax(statement.expression);
    return isHookCall(expression, 'onServer') ? expression : undefined;
}

/**
 * The callbacks of the `onServer` blocks in a statement's control flow. `onServer` is a no-op in the
 * browser, so keeping its callback would only publish server-side code that cannot even run there.
 * @param statement - The statement.
 * @returns The arguments of each `onServer` call written as a statement.
 */
function serverOnlyCallbacks(statement: ts.Statement): ts.Expression[] {
    return statementTree(statement).flatMap(nested => onServerCallOf(nested)?.arguments.map(unwrapTypeSyntax) ?? []);
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
 * Rebuilds a statement the way the client runs it: every `onServer` call in its control flow with its
 * callback removed, every JSX `return` a `break` to the setup label, so an early exit leaves the setup
 * block without aborting the surrounding script, and everything client code does not need left out.
 * @param statement - The kept statement.
 * @param omitted - What is left out.
 * @returns The statement to print.
 */
function neutralizeStatementTree(statement: ts.Statement, omitted: ReadonlySet<ts.Node>): ts.Statement {
    const onServerCall: ts.CallExpression | undefined = onServerCallOf(statement);
    if (onServerCall !== undefined && ts.isExpressionStatement(statement)) {
        return ts.factory.updateExpressionStatement(
            statement,
            ts.factory.updateCallExpression(onServerCall, onServerCall.expression, onServerCall.typeArguments, [])
        );
    }
    if (isJsxReturn(statement)) {
        return ts.factory.createBreakStatement(SETUP_LABEL);
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
    if (ts.isDoStatement(loop)) {
        return factory.updateDoStatement(loop, nested(loop.statement), loop.expression);
    }
    return loop;
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