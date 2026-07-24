import { CLIENT_PROP_VALUES, CLIENT_PROPS_RUNTIME, clientPropFactories, ClientPropSite, collectClientPropSites } from './client-props';
import { collectHandlerSites, HandlerSite } from './handlers';
import { REATTACH_RUNTIME, SETUP_RUNTIME_PARAM } from './reattach';
import { BlockStatement, Expression, Statement } from '../../parser/ast';
import { collectPatternNames, collectReferencedIdentifiers } from '../../semantics/binding';
import { ClientGlobalAlias } from '../../semantics/client-packages';
import { ComponentFunction, isJsxExpression } from '../../semantics/component';
import { collectTranslationSources, TranslationSources } from '../../semantics/translation-sources';
import { walk, WalkNode } from '../../semantics/walk';
import { printExpression, printPattern, printStatement } from '../server/print';

/**
 * The generated client behavior for a component.
 */
export type ClientScript = {
    /**
     * The client setup-function definition (`function <name>(props) { ... }`), or undefined when
     * the component has no client behavior. The runtime calls it once per instance with the
     * instance's props; each call's locals are isolated by function scope (no renaming needed).
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
     * Every identifier the emitted client code references. Used to check that client code only reads
     * things the browser will actually have.
     */
    referencedIdentifiers: string[]
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

    // The client code written in the markup — handlers and function props — seeds what the body has
    // to provide, so the body is filtered down to the declarations those actually reach.
    const seeds: Set<string> = new Set<string>();
    for (const expression of [...sites.map(site => site.handler), ...propSites.map(site => site.value)]) {
        for (const identifier of collectReferencedIdentifiers(expression)) {
            seeds.add(identifier);
        }
    }

    const bodyStatements: Statement[] = clientBodyStatements(fn, seeds);
    const bodySource: string = bodyStatements.map(printStatement).join('\n');

    // Only identifiers reachable from client code count — props used solely in JSX stay server-side.
    const referenced: Set<string> = new Set<string>(seeds);
    for (const statement of bodyStatements) {
        for (const identifier of collectReferencedIdentifiers(statement)) {
            referenced.add(identifier);
        }
    }

    const propNames: string[] = fn.params.length > 0 ? collectPatternNames(fn.params[0]) : [];
    const referencedProps: string[] = propNames.filter(prop => referenced.has(prop));
    const referencedHooks: string[] = resolveHooks(referenced);
    // Exactly the nodes that end up in the client script: the whole body (so a `$t` inside a function
    // a handler calls is found too) plus the inline handler and function-prop expressions. A `$t` in
    // the jsx is not included, because that one is resolved during the server render.
    const clientNodes: WalkNode[] = [
        ...bodyStatements,
        ...sites.map(site => site.handler),
        ...propSites.map(site => site.value)
    ];
    const referencedTranslations: TranslationSources = collectTranslationSources(clientNodes);

    // A component only runs on the client when it stamps an event handler, hands a function to a
    // nested component, or calls `onClient`. Statement-level body code without any of those is pure
    // server work (an `onServer` block, a computed class name), so emitting a setup for it would ship
    // dead code - and possibly a server-only reference like `GlobalRegistry` - to every page using it.
    const hasClientBehavior: boolean = sites.length > 0 || propSites.length > 0 || referenced.has('onClient');
    if (!hasClientBehavior) {
        return {
            code: undefined,
            setupName: undefined,
            handlerSites: sites,
            clientPropSites: propSites,
            referencedProps: [],
            referencedHooks: [],
            referencedTranslations: { sources: [], complete: true },
            referencedIdentifiers: []
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

    const body: string = [
        clientAliasDefinitions(clientAliases, referenced),
        hookDefinitions(referenced),
        propSites.length > 0 ? `const ${CLIENT_PROP_VALUES} = {};` : '',
        setupBlock,
        // Handed back so the emitted call of a child component can pass in the functions this
        // instance declared for it. An early JSX return skips the block, but then the child was not
        // rendered either, so nothing asks for them.
        propSites.length > 0 ? `return ${CLIENT_PROP_VALUES};` : ''
    ]
        .filter(part => part.trim().length > 0)
        .join('\n');
    const setupName: string = `${name}$$setup`;
    const propsParam: string = fn.params.length > 0 ? printPattern(fn.params[0]) : '__unusedProps';
    return {
        code: `function ${setupName}(${propsParam}, ${SETUP_RUNTIME_PARAM}) {\n${body}\n}`,
        setupName,
        handlerSites: sites,
        clientPropSites: propSites,
        referencedProps,
        referencedHooks,
        referencedTranslations,
        referencedIdentifiers: [...referenced]
    };
}

/**
 * Resolves which render-data hooks the client code needs, adding implied dependencies
 * (`$ts` is implemented in terms of `$t`).
 * @param referenced - Identifiers referenced by the client code.
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
 * @param referenced - The set of identifiers referenced by the component.
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
 * @param referenced - The set of identifiers referenced by the component.
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
        return `${site.id}: { event: '${site.event}', make: (${params}) => (${printExpression(site.handler)}) }`;
    });
    return `const __handlers = {\n${entries.join(',\n')}\n};`;
}

/**
 * Produces the client-relevant statements of a component body.
 *
 * A component body runs on the server, and only the part the client genuinely needs may be shipped —
 * otherwise the page carries server-only code, and every literal in it, for anyone to read. Kept are
 * the statements holding client code (`onClient`) and the declarations those, the handlers and the
 * function props actually reach, transitively. Everything else — `onServer` blocks included — stays
 * on the server.
 *
 * JSX `return` statements are neutralized to a `break`, so early-exit control flow is preserved
 * without rendering markup on the client.
 * @param fn - The component function.
 * @param seeds - Identifiers the markup's client code references, which the body has to provide.
 * @returns The transformed statements.
 */
function clientBodyStatements(fn: ComponentFunction, seeds: Set<string>): Statement[] {
    if (fn.body.kind !== 'BlockStatement') {
        return [];
    }
    // A top-level JSX return is the component's normal end — drop it. `onServer` bodies are removed
    // before anything else looks at the statements, so what they reference cannot keep code alive.
    const candidates: Statement[] = fn.body.body
        .filter(statement => !(statement.kind === 'ReturnStatement' && statement.argument && isJsxExpression(statement.argument)))
        .map(statement => mapStatementTree(statement, dropServerOnlyCallbacks));

    const kept: Set<Statement> = new Set<Statement>(candidates.filter(containsClientCode));
    const needed: Set<string> = new Set<string>(seeds);
    for (const statement of kept) {
        addReferenced(statement, needed);
    }

    // A kept statement can pull in a declaration that pulls in another, so grow until it settles.
    let growing: boolean = true;
    while (growing) {
        growing = false;
        for (const statement of candidates) {
            if (kept.has(statement) || !providesNeededName(statement, needed)) {
                continue;
            }
            kept.add(statement);
            addReferenced(statement, needed);
            growing = true;
        }
    }

    return candidates.filter(statement => kept.has(statement))
        .map(statement => mapStatementTree(statement, jsxReturnToBreak));
}

/**
 * Adds every identifier a statement references to the accumulator.
 * @param statement - The statement to read.
 * @param names - The accumulator to add to.
 */
function addReferenced(statement: Statement, names: Set<string>): void {
    for (const identifier of collectReferencedIdentifiers(statement)) {
        names.add(identifier);
    }
}

/**
 * Whether a statement contains client code, i.e. An `onClient` call. Such a statement is kept no
 * matter what references it, because its callback *is* the client behavior.
 * @param statement - The statement to inspect.
 * @returns True when the statement contains an `onClient` call.
 */
function containsClientCode(statement: Statement): boolean {
    let found: boolean = false;
    walk(statement, node => {
        if (isHookCall(node, 'onClient')) {
            found = true;
        }
        return !found;
    });
    return found;
}

/**
 * Whether a node is a call of the named framework hook.
 * @param node - The node to test.
 * @param hook - The hook name.
 * @returns True for a call of that hook.
 */
function isHookCall(node: WalkNode, hook: string): boolean {
    return node.kind === 'CallExpression' && node.callee.kind === 'Identifier' && node.callee.name === hook;
}

/**
 * Whether a statement provides a name the client code still needs: a declaration of one, or an
 * assignment to one (so a value the client reads is not left at its initial state).
 * @param statement - The statement to inspect.
 * @param needed - The names the client code references.
 * @returns True when the statement has to be kept.
 */
function providesNeededName(statement: Statement, needed: Set<string>): boolean {
    switch (statement.kind) {
        case 'FunctionDeclaration': {
            return needed.has(statement.id);
        }
        case 'VariableDeclaration': {
            return statement.declarations.some(d => collectPatternNames(d.id).some(name => needed.has(name)));
        }
        case 'ExpressionStatement': {
            const assigned: string | undefined = assignedName(statement.expression);
            return assigned !== undefined && needed.has(assigned);
        }
        case 'BlockStatement':
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
        case 'LabeledStatement': {
            // Control flow declares nothing at this level; whatever it holds is kept only when it
            // contains client code.
            return false;
        }
    }
}

/**
 * The name a statement-level assignment or update writes to, or undefined when the expression is
 * neither. Only a plain identifier target counts — a member write mutates a value that is already
 * kept or dropped together with its own declaration.
 * @param expression - The expression to inspect.
 * @returns The assigned name, or undefined.
 */
function assignedName(expression: Expression): string | undefined {
    if (expression.kind === 'AssignmentExpression' && expression.left.kind === 'Identifier') {
        return expression.left.name;
    }
    if (expression.kind === 'UpdateExpression' && expression.argument.kind === 'Identifier') {
        return expression.argument.name;
    }
    return undefined;
}

/**
 * Empties the argument list of every `onServer` call. `onServer` is a no-op in the browser, so
 * keeping its callback would only publish server-side code that cannot even run there.
 * @param statement - The statement to transform.
 * @returns The statement, with `onServer` callbacks dropped.
 */
function dropServerOnlyCallbacks(statement: Statement): Statement {
    if (statement.kind !== 'ExpressionStatement' || !isHookCall(statement.expression, 'onServer')) {
        return statement;
    }
    return { ...statement, expression: { ...statement.expression, arguments: [] } as Expression };
}

/**
 * Replaces a JSX `return` with a `break` to the setup label, so an early exit leaves the setup block
 * without aborting the surrounding script.
 * @param statement - The statement to transform.
 * @returns The transformed statement.
 */
function jsxReturnToBreak(statement: Statement): Statement {
    if (statement.kind !== 'ReturnStatement' || !statement.argument || !isJsxExpression(statement.argument)) {
        return statement;
    }
    return { kind: 'BreakStatement', label: SETUP_LABEL, span: statement.span };
}

/**
 * Applies a transform to a statement and to every statement nested in its control flow, but not
 * into nested functions (those carry their own scope and are transformed where they are used).
 * @param statement - The statement to transform.
 * @param map - The transform applied to each statement.
 * @returns The transformed statement.
 */
function mapStatementTree(statement: Statement, map: (statement: Statement) => Statement): Statement {
    const mapped: Statement = map(statement);
    switch (mapped.kind) {
        case 'BlockStatement': {
            return { ...mapped, body: mapped.body.map(s => mapStatementTree(s, map)) };
        }
        case 'IfStatement': {
            return {
                ...mapped,
                consequent: mapStatementTree(mapped.consequent, map),
                alternate: mapped.alternate ? mapStatementTree(mapped.alternate, map) : undefined
            };
        }
        case 'ForStatement':
        case 'ForOfStatement':
        case 'WhileStatement':
        case 'LabeledStatement': {
            return { ...mapped, body: mapStatementTree(mapped.body, map) };
        }
        case 'TryStatement': {
            return {
                ...mapped,
                block: mapStatementTree(mapped.block, map) as BlockStatement,
                handlerBody: mapped.handlerBody ? mapStatementTree(mapped.handlerBody, map) as BlockStatement : undefined,
                finalizer: mapped.finalizer ? mapStatementTree(mapped.finalizer, map) as BlockStatement : undefined
            };
        }
        case 'SwitchStatement': {
            return {
                ...mapped,
                cases: mapped.cases.map(c => ({ ...c, consequent: c.consequent.map(s => mapStatementTree(s, map)) }))
            };
        }
        case 'ReturnStatement':
        case 'FunctionDeclaration':
        case 'VariableDeclaration':
        case 'ExpressionStatement':
        case 'BreakStatement':
        case 'ContinueStatement':
        case 'ThrowStatement':
        case 'EmptyStatement': {
            return mapped;
        }
    }
}