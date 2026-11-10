import ts from 'typescript';
import { Diagnostic, DiagnosticSeverity, SourceSpan } from 'zibri-tsx';

import { isBindingIdentifier } from './binding';
import { browserGlobals, browserOnlyGlobals, declaredValueNames } from './browser-globals';
import { ComponentInfo, findComponents, hasModifier } from './component';
import { readImports, TemplateImport } from './imports';
import { isAmbient, symbolOf } from './symbols';
import { isHookCall, walk } from './walk';
import { ModuleLoadingSite, OuterName } from '../codegen/client/client-codegen';

/**
 * Diagnostic codes produced by dialect validation.
 */
export enum ValidationCode {
    /**
     * A component declared more than one parameter.
     */
    MULTIPLE_PARAMS = 'ZTSX001',
    /**
     * A component was declared async.
     */
    ASYNC_COMPONENT = 'ZTSX002',
    /**
     * Client code referenced a binding from an ordinary import.
     */
    SERVER_IMPORT_IN_CLIENT_CODE = 'ZTSX003',
    /**
     * An email component was nested somewhere the schema does not allow.
     */
    ILLEGAL_EMAIL_NESTING = 'ZTSX004',
    /**
     * An email template contains client-only code, which emails cannot run.
     */
    CLIENT_CODE_IN_EMAIL = 'ZTSX005',
    /**
     * A component holds syntax the analysis has no case for.
     */
    UNSUPPORTED_SYNTAX = 'ZTSX006',
    /**
     * Client code used `import(...)` or `import.meta`.
     */
    MODULE_LOADING_IN_CLIENT_CODE = 'ZTSX008',
    /**
     * Client code read a name that does not exist where it runs.
     */
    UNAVAILABLE_NAME_IN_CLIENT_CODE = 'ZTSX009',
    /**
     * JSX, or a hook only a component can call, was written outside a component.
     */
    RENDER_SYNTAX_OUTSIDE_COMPONENT = 'ZTSX010',
    /**
     * A component read `arguments` at its own scope, where it is not the component's props.
     */
    ARGUMENTS_IN_COMPONENT = 'ZTSX011',
    /**
     * Client code holds JSX, which only the server renders.
     */
    JSX_IN_CLIENT_CODE = 'ZTSX012',
    /**
     * A `?client` import names a file of the application rather than a package.
     */
    CLIENT_IMPORT_OF_A_FILE = 'ZTSX013',
    /**
     * Code running while the server renders read a name only the browser has.
     */
    BROWSER_NAME_DURING_RENDER = 'ZTSX014',
    /**
     * A ref is created or put somewhere it cannot work.
     */
    REF_MISUSED = 'ZTSX015',
    /**
     * A state is created, changed or read somewhere the page could not follow it.
     */
    STATE_MISUSED = 'ZTSX016',
    /**
     * An effect is called somewhere, or with a list, the page could not run it from.
     */
    EFFECT_MISUSED = 'ZTSX017',
    /**
     * A markdown template holds what cannot be printed as a page: a syntax error, raw html in a `.md` file, or
     * frontmatter that is no yaml mapping.
     */
    MARKDOWN_INVALID = 'ZTSX018',
    /**
     * A code block of a markdown template names a language the highlighter does not know, so its code is not
     * highlighted.
     */
    CODE_LANGUAGE_UNKNOWN = 'ZTSX019'
}

/**
 * The hooks of client code that only a component can call, as each instance of a component has a setup
 * of its own in the page. Code outside a component has none, so nothing would run what they are given.
 */
const CLIENT_COMPONENT_HOOKS: readonly string[] = [
    'onClient',
    'useRef',
    'useRefs',
    'useState',
    'useEffect',
    'useInput',
    'useWritableInput'
];

/**
 * The span of a node, in the offsets diagnostics use.
 * @param node - The node.
 * @returns Its span.
 */
export function spanOf(node: ts.Node): Diagnostic['span'] {
    return { start: node.getStart(), end: node.getEnd() };
}

/**
 * Validates a parsed module against the supported component dialect, returning located
 * diagnostics. The rules mirror the runtime contract: a component takes a single props object and
 * may not be async.
 * @param file - The parsed template.
 * @returns The diagnostics found (empty when the module is valid).
 */
export function validate(file: ts.SourceFile): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    for (const component of findComponents(file)) {
        validateComponent(component, diagnostics);
    }
    diagnostics.push(...validateClientImportSources(file));
    return diagnostics;
}

/**
 * Rejects a `?client` import of a file of the application. The build makes a vendor script of a package
 * the page loads, and a file of the application is none: the build would look for a package of that name,
 * and the browser for a script nobody wrote.
 * @param file - The parsed template.
 * @returns One diagnostic per such import.
 */
function validateClientImportSources(file: ts.SourceFile): Diagnostic[] {
    return readImports(file)
        .filter(item => item.client && isFileOfTheApplication(item.source))
        .map(item => ({
            code: ValidationCode.CLIENT_IMPORT_OF_A_FILE,
            message: `'${item.source}?client' imports a file of this application, and '?client' takes a package, whose browser `
                + 'script the build makes the page load. Client code cannot import a file of the application: pass what it '
                + 'needs in as a prop.',
            severity: DiagnosticSeverity.ERROR,
            span: item.span
        }));
}

/**
 * Whether an import names a file of the application rather than a package.
 * @param source - What the import names, without `?client`.
 * @returns True for a relative or an absolute path.
 */
function isFileOfTheApplication(source: string): boolean {
    return source.startsWith('.') || source.startsWith('/');
}

/**
 * Applies the component rules to a single component, pushing any diagnostics.
 * @param component - The component to validate.
 * @param diagnostics - The accumulator to push diagnostics into.
 */
function validateComponent(component: ComponentInfo, diagnostics: Diagnostic[]): void {
    const { fn, name } = component;

    if (hasModifier(fn, ts.SyntaxKind.AsyncKeyword)) {
        diagnostics.push({
            code: ValidationCode.ASYNC_COMPONENT,
            message: `Component '${name}' is async. Components must be synchronous — fetch async data before `
                + 'rendering and pass it in as props.',
            severity: DiagnosticSeverity.ERROR,
            span: spanOf(fn)
        });
    }

    if (fn.parameters.length > 1) {
        diagnostics.push({
            code: ValidationCode.MULTIPLE_PARAMS,
            message: `Component '${name}' has ${fn.parameters.length} parameters. Components must accept a single `
                + 'props object — change the signature to ({ ... }: Props) or (props: Props).',
            severity: DiagnosticSeverity.ERROR,
            span: spanOf(fn)
        });
    }
}

/**
 * Rejects what only a component can hold, written outside one. JSX and the server-inlined hooks
 * (`useContext`, `provideContext`, `$raw`) need the render runtime a component receives for each render,
 * and the hooks of client code (`onClient`) the setup each instance of a component has in the page. Code
 * outside a component has neither.
 * @param file - The parsed template.
 * @param components - The components of the template.
 * @param serverInlinedHooks - The names of the hooks lowered to the render runtime.
 * @returns One diagnostic per use outside a component (empty when there is none).
 */
export function validateRenderSyntaxOutsideComponents(
    file: ts.SourceFile,
    components: ComponentInfo[],
    serverInlinedHooks: readonly string[]
): Diagnostic[] {
    const insideComponents: Set<ts.Node> = new Set(components.map(component => component.fn));
    const renderHooks: Set<string> = new Set(serverInlinedHooks);
    const clientHooks: Set<string> = new Set(CLIENT_COMPONENT_HOOKS);
    const diagnostics: Diagnostic[] = [];
    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
        if (insideComponents.has(node)) {
            return;
        }
        const isJsx: boolean = ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node);
        const hook: string | undefined = ts.isCallExpression(node) && ts.isIdentifier(node.expression)
            && (renderHooks.has(node.expression.text) || clientHooks.has(node.expression.text))
            ? node.expression.text
            : undefined;
        if (isJsx || hook !== undefined) {
            const message: string = hook !== undefined && clientHooks.has(hook)
                ? `'${hook}' is written outside a component, where nothing runs it: client code runs in the setup of `
                + 'a component in the page. Move it into the component it belongs to.'
                // eslint-disable-next-line sonar/no-nested-template-literals
                : `${hook === undefined ? 'JSX' : `'${hook}'`} is written outside a component, where there is no render `
                    + 'to produce it in. Move it into a component - a function named in PascalCase that returns JSX.';
            diagnostics.push({
                code: ValidationCode.RENDER_SYNTAX_OUTSIDE_COMPONENT,
                message,
                severity: DiagnosticSeverity.ERROR,
                span: spanOf(node)
            });
            return;
        }
        ts.forEachChild(node, visit);
    };
    for (const statement of file.statements) {
        visit(statement);
    }
    return diagnostics;
}

/**
 * Rejects a name only the browser has, read by code that runs while the server renders: a global such as
 * `document` or `window`, or what a `?client` import binds, which the server module does not import. Such
 * a read compiles and then throws on every render.
 *
 * What runs during the render is the code at module level, the body and markup of each component, and a
 * function handed directly to a call there, such as the callback of `map` or of `onServer`. A function
 * handed to `onClient` or to an event handler runs in the browser, and so does a function a component
 * declares, as long as nothing calls it during the render: following such calls is left to the render,
 * which throws. A read is allowed under a `typeof` check of the same name, and a name the template
 * declares is not a global.
 * @param file - The parsed template.
 * @param components - The components of the template.
 * @returns One diagnostic per name, where it is first read.
 */
export function validateBrowserNamesDuringRender(file: ts.SourceFile, components: ComponentInfo[]): Diagnostic[] {
    const clientImports: Map<ts.Node, string> = clientImportDeclarations(file);
    const reported: Map<string, Diagnostic> = new Map();
    const check: (identifier: ts.Identifier) => void = identifier => {
        const name: string = identifier.text;
        if (reported.has(name) || isBindingIdentifier(identifier) || isUnderTypeofGuard(identifier, name)) {
            return;
        }
        const declarations: ts.Declaration[] = symbolOf(identifier)?.declarations ?? [];
        const clientSource: string | undefined = declarations
            .map(declaration => clientImports.get(declaration))
            .find(source => source !== undefined);
        if (clientSource !== undefined) {
            reported.set(name, browserNameDiagnostic(identifier, `'${name}' comes from '${clientSource}?client', which only the `
            + 'page loads, and this code runs while the server renders the page. Use it in onClient or in a handler.'));
        }
        else if (declarations.length === 0 && browserOnlyGlobals().has(name)) {
            reported.set(name, browserNameDiagnostic(identifier, `'${name}' exists in the browser and not on the server, and `
            + 'this code runs while the server renders the page. Read it in onClient or in a handler, or check '
            + `'typeof ${name} !== 'undefined'' before reading it.`));
        }
    };
    const visit: (node: ts.Node) => void = node => walk(node, current => {
        if (isFunctionNode(current) && !runsWhereItIsWritten(current)) {
            return false;
        }
        if (ts.isIdentifier(current)) {
            check(current);
        }
        return true;
    });

    for (const node of moduleLevelCode(file.statements)) {
        visit(node);
    }
    for (const { fn } of components) {
        for (const parameter of fn.parameters) {
            visit(parameter);
        }
        if (fn.body != undefined) {
            visit(fn.body);
        }
    }
    return [...reported.values()];
}

/**
 * The code that runs when the template's module loads: its statements, the expression of a default
 * export, and the statements of a namespace. Imports, re-exports and what is declared with `declare` run
 * nothing.
 * @param statements - The statements of the module, or of a namespace in it.
 * @returns The nodes to look at.
 */
function moduleLevelCode(statements: readonly ts.Statement[]): ts.Node[] {
    return statements.flatMap((statement): ts.Node[] => {
        if (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement) || isAmbient(statement)) {
            return [];
        }
        if (ts.isExportAssignment(statement)) {
            return [statement.expression];
        }
        if (ts.isModuleDeclaration(statement)) {
            return statement.body != undefined && ts.isModuleBlock(statement.body) ? moduleLevelCode(statement.body.statements) : [];
        }
        return [statement];
    });
}

/**
 * The declarations of the bindings of the template's `?client` imports, each with what it imports.
 * @param file - The parsed template.
 * @returns The package each binding declaration imports, by the declaration.
 */
function clientImportDeclarations(file: ts.SourceFile): Map<ts.Node, string> {
    const declarations: Map<ts.Node, string> = new Map();
    for (const statement of file.statements) {
        const specifier: ts.Expression | undefined = ts.isImportDeclaration(statement) ? statement.moduleSpecifier : undefined;
        const clause: ts.ImportClause | undefined = ts.isImportDeclaration(statement) ? statement.importClause : undefined;
        if (specifier === undefined || !ts.isStringLiteral(specifier) || !specifier.text.endsWith('?client') || clause === undefined) {
            continue;
        }
        const source: string = specifier.text.slice(0, -'?client'.length);
        for (const declaration of getBindingDeclarations(clause)) {
            declarations.set(declaration, source);
        }
    }
    return declarations;
}

/**
 * The declarations of the bindings an import clause declares: its default binding, and its namespace or each of its
 * named bindings.
 * @param clause - The import clause.
 * @returns The declarations.
 */
function getBindingDeclarations(clause: ts.ImportClause): ts.Node[] {
    const named: ts.NamedImportBindings | undefined = clause.namedBindings;
    return [
        ...clause.name === undefined ? [] : [clause],
        ...named === undefined ? [] : ts.isNamespaceImport(named) ? [named] : named.elements
    ];
}

/**
 * Whether a node is a function, whose body runs only when it is called.
 * @param node - The node.
 * @returns True for every kind of function.
 */
export function isFunctionNode(node: ts.Node): node is ts.FunctionLikeDeclaration {
    return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node)
        || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node) || ts.isConstructorDeclaration(node);
}

/**
 * Whether a function runs where it is written, during the render: called on the spot, or handed directly to
 * a call, as the callback of `map` is, unless that call is a hook of client code.
 * @param fn - The function.
 * @returns True when its body runs during the render.
 */
export function runsWhereItIsWritten(fn: ts.FunctionLikeDeclaration): boolean {
    if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) {
        return false;
    }
    let outer: ts.Node = fn;
    while (ts.isParenthesizedExpression(outer.parent)) {
        outer = outer.parent;
    }
    const call: ts.Node = outer.parent;
    if (!ts.isCallExpression(call) && !ts.isNewExpression(call)) {
        return false;
    }
    return ts.isCallExpression(call) && call.expression === outer
        ? true
        : call.arguments?.some(argument => argument === outer) === true
            && !CLIENT_COMPONENT_HOOKS.some(hook => isHookCall(call, hook));
}

/**
 * Whether a read sits where a `typeof` check of the same name decides it is reached: the operand of that
 * `typeof` itself, a branch of a condition, the right side of `&&`, `||` or `??`, or a branch of an `if`
 * whose condition checks it.
 * @param identifier - The read.
 * @param name - The name it reads.
 * @returns True when such a check guards it.
 */
function isUnderTypeofGuard(identifier: ts.Identifier, name: string): boolean {
    let child: ts.Node = identifier;
    for (let current: ts.Node = identifier.parent; !ts.isSourceFile(current); child = current, current = current.parent) {
        if (ts.isTypeOfExpression(current) && current.expression === child) {
            return true;
        }
        const condition: ts.Node | undefined = findDecidingCondition(current, child);
        if (condition !== undefined && checksTypeof(condition, name)) {
            return true;
        }
    }
    return false;
}

/**
 * The condition of a node that decides whether one of its children is reached: that of a conditional or an `if` for
 * a branch, or the left side of `&&`, `||` or `??` for its right side.
 * @param node - The node.
 * @param child - The child.
 * @returns The condition, or undefined when none decides it.
 */
function findDecidingCondition(node: ts.Node, child: ts.Node): ts.Node | undefined {
    if (ts.isConditionalExpression(node) && child !== node.condition) {
        return node.condition;
    }
    if (ts.isBinaryExpression(node) && child === node.right && isShortCircuit(node.operatorToken.kind)) {
        return node.left;
    }
    return ts.isIfStatement(node) && child !== node.expression ? node.expression : undefined;
}

/**
 * Whether an operator only evaluates its right side depending on its left one.
 * @param kind - The operator.
 * @returns True for `&&`, `||` and `??`.
 */
function isShortCircuit(kind: ts.SyntaxKind): boolean {
    return kind === ts.SyntaxKind.AmpersandAmpersandToken || kind === ts.SyntaxKind.BarBarToken
        || kind === ts.SyntaxKind.QuestionQuestionToken;
}

/**
 * Whether a condition holds `typeof` of a name.
 * @param condition - The condition.
 * @param name - The name.
 * @returns True when it does.
 */
function checksTypeof(condition: ts.Node, name: string): boolean {
    let found: boolean = false;
    walk(condition, current => {
        found ||= ts.isTypeOfExpression(current) && ts.isIdentifier(current.expression) && current.expression.text === name;
        return !found;
    });
    return found;
}

/**
 * A diagnostic for a name only the browser has, read during the render.
 * @param identifier - The read.
 * @param message - What to say.
 * @returns The diagnostic.
 */
function browserNameDiagnostic(identifier: ts.Identifier, message: string): Diagnostic {
    return { code: ValidationCode.BROWSER_NAME_DURING_RENDER, message, severity: DiagnosticSeverity.ERROR, span: spanOf(identifier) };
}

/**
 * Rejects `arguments` read at a component's own scope. The compiled render is a function taking the
 * render runtime first, so `arguments` there is that runtime rather than the component's props - and in
 * client code it would be the setup's arguments. A function the component declares has `arguments` of its
 * own, which is fine.
 * @param components - The components of the template.
 * @returns One diagnostic per read (empty when no component reads its own `arguments`).
 */
export function validateComponentArguments(components: ComponentInfo[]): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    for (const component of components) {
        walk(component.fn, node => {
            if (ts.isIdentifier(node) && node.text === 'arguments' && !isBindingIdentifier(node)
                && (symbolOf(node)?.declarations ?? []).length === 0 && readsOwnArguments(node, component.fn)) {
                diagnostics.push({
                    code: ValidationCode.ARGUMENTS_IN_COMPONENT,
                    message: `'arguments' is read at the scope of component '${component.name}', where it is not the component's props. `
                        + 'Name the props parameter and read that.',
                    severity: DiagnosticSeverity.ERROR,
                    span: spanOf(node)
                });
            }
        });
    }
    return diagnostics;
}

/**
 * Whether `arguments` read inside a component refers to the component's own arguments, as opposed to those
 * of a function nested in it. An arrow function has no `arguments` of its own, so the read falls through it.
 * @param identifier - The `arguments` identifier.
 * @param fn - The component function.
 * @returns True when no function with its own `arguments` lies between the read and the component.
 */
function readsOwnArguments(identifier: ts.Identifier, fn: ts.Node): boolean {
    for (let current: ts.Node = identifier.parent; current !== fn; current = current.parent) {
        if (ts.isFunctionDeclaration(current) || ts.isFunctionExpression(current) || ts.isMethodDeclaration(current)
            || ts.isGetAccessorDeclaration(current) || ts.isSetAccessorDeclaration(current) || ts.isConstructorDeclaration(current)) {
            return false;
        }
    }
    return true;
}

/**
 * Rejects client code that reads an ordinary import. Only two things cross into the browser: the
 * props a parent passes and the browser globals a `?client` import provides. An ordinary import
 * lives in the server module, which the client script — plain text in the page — cannot reach, so
 * the identifier would silently be undefined at runtime.
 * @param file - The parsed template.
 * @param outerNames - The names client code reads from outside the component, each where it is first read.
 * @param providedByFramework - Names the compiler inlines into the client script itself (the
 * framework hooks), which are imported from `zibri` but never read from the module at runtime.
 * @param renderHooks - The hooks that read the render on the server, such as `useContext`.
 * @param bindingSpans - Where the markup reads state, which is client code as well.
 * @returns The diagnostics found (empty when no client code reads an import).
 */
export function validateClientImports(
    file: ts.SourceFile,
    outerNames: OuterName[],
    providedByFramework: readonly string[],
    renderHooks: readonly string[],
    bindingSpans: SourceSpan[]
): Diagnostic[] {
    const provided: Set<string> = new Set(providedByFramework);
    const reads: Map<string, OuterName> = new Map(outerNames
        .filter(outer => outer.origin === 'import' && !provided.has(outer.name))
        .map(outer => [outer.name, outer]));
    const diagnostics: Diagnostic[] = [];

    for (const item of readImports(file)) {
        if (item.client || item.typeOnly) {
            continue;
        }
        const bindings: [imported: string, local: string][] = [
            // eslint-disable-next-line stylistic/max-len
            ...item.specifiers.filter(specifier => !specifier.typeOnly).map((specifier): [string, string] => [specifier.imported, specifier.local]),
            ...item.defaultImport === undefined ? [] : [['default', item.defaultImport] satisfies [string, string]],
            ...item.namespaceImport === undefined ? [] : [['*', item.namespaceImport] satisfies [string, string]]
        ];
        for (const [imported, local] of bindings) {
            const read: OuterName | undefined = reads.get(local);
            if (read === undefined) {
                continue;
            }
            const inBinding: boolean = bindingSpans.some(span => read.span.start >= span.start && read.span.end <= span.end);
            diagnostics.push({
                code: ValidationCode.SERVER_IMPORT_IN_CLIENT_CODE,
                message: inBinding
                    ? `'${local}' is read by markup that reads a state, which the browser computes again when the state changes, `
                    + `and '${local}' is imported from '${item.source}', which stays on the server. Read it outside that markup, `
                    + 'or compute the value with it into the state on the server, as `useState(...)`.'
                    : serverImportMessage(local, item.source, renderHooks.includes(imported)),
                severity: DiagnosticSeverity.ERROR,
                span: read.span
            });
        }
    }
    return diagnostics;
}

/**
 * The explanation for an import client code cannot read, by what it imports from.
 * @param binding - The name the template imports it under.
 * @param source - What it is imported from.
 * @param isRenderHook - Whether it is a hook reading the render on the server.
 * @returns The diagnostic message.
 */
function serverImportMessage(binding: string, source: string, isRenderHook: boolean): string {
    if (isRenderHook) {
        return `'${binding}' reads the render on the server, and client code runs in the browser after it. Read it while `
            + `rendering and hand client code the value as a state, such as \`const value = useState(${binding}(...));\`.`;
    }
    if (source === 'zibri' || source.startsWith('zibri/')) {
        return `'${binding}' is imported from '${source}', which runs on the server, and client code runs in the browser. `
            + 'Work out what client code needs while rendering, and pass it in as a prop.';
    }
    return isFileOfTheApplication(source)
        ? `'${binding}' is imported from '${source}', a file of this application, which stays on the server. `
        + 'Pass what client code needs in as a prop.'
        : `'${binding}' is imported from '${source}' and used in client code, where it does not exist. Pass what you need `
            + `in as a prop, or - if '${source}' is a browser package - import it as '${source}?client' so the vendor bundle `
            + 'provides it.';
}

/**
 * Rejects JSX in client code. Markup is rendered once, on the server, and client code runs in the browser
 * afterwards, where there is no render to produce it.
 * @param sites - Where the emitted client code holds JSX.
 * @returns One diagnostic per site.
 */
export function validateClientJsx(sites: SourceSpan[]): Diagnostic[] {
    return sites.map(span => ({
        code: ValidationCode.JSX_IN_CLIENT_CODE,
        message: 'JSX is written in client code, which runs in the browser after the server rendered the page, where '
            + 'there is no render to produce it. Render the markup on the server, and change the page from client code '
            + 'through the DOM. A declaration client code reads is client code as well.',
        severity: DiagnosticSeverity.ERROR,
        span
    }));
}

/**
 * Rejects client code that reads a name the browser does not have. Besides what the component declares
 * and receives, client code reads exactly these: the browser's globals, the globals a `?client` import
 * provides, globals the template declares with `declare`, and the framework hooks. A declaration of the
 * template outside the component stays on the server, and any other name exists nowhere the script runs.
 *
 * Ordinary imports are left to {@link validateClientImports}.
 * @param file - The parsed template.
 * @param outerNames - The names client code reads from outside the component.
 * @param providedByFramework - Names the compiler provides to the client script itself (the hooks).
 * @returns One diagnostic per unavailable name (empty when client code reads only what exists).
 */
export function validateClientNames(file: ts.SourceFile, outerNames: OuterName[], providedByFramework: readonly string[]): Diagnostic[] {
    const provided: Set<string> = new Set(providedByFramework);
    const clientBindings: Set<string> = new Set(readImports(file)
        .filter(item => item.client && !item.typeOnly)
        .flatMap(importedBindings));
    const available: (outer: OuterName) => boolean = outer => {
        switch (outer.origin) {
            case 'ambient': {
                return true;
            }
            case 'import': {
                return provided.has(outer.name) || clientBindings.has(outer.name);
            }
            case 'undeclared': {
                return provided.has(outer.name) || browserGlobals().has(outer.name);
            }
            case 'module': {
                return false;
            }
        }
    };
    return outerNames.filter(outer => !available(outer)).map(outer => ({
        code: ValidationCode.UNAVAILABLE_NAME_IN_CLIENT_CODE,
        message: unavailableNameMessage(outer),
        severity: DiagnosticSeverity.ERROR,
        span: outer.span
    }));
}

/**
 * The explanation for a name client code cannot read.
 * @param outer - The name.
 * @returns The diagnostic message.
 */
function unavailableNameMessage(outer: OuterName): string {
    switch (outer.origin) {
        case 'module': {
            return `'${outer.name}' is declared in this template outside the component, and client code reads only what `
                + 'the component itself declares or receives. Declare it inside the component, or pass what you need in '
                + 'as a prop.';
        }
        case 'import': {
            return `'${outer.name}' is imported as a type only, so it does not exist where client code runs.`;
        }
        case 'ambient':
        case 'undeclared': {
            return `'${outer.name}' is declared nowhere in this template and is not a browser global, so it does not exist `
                + 'where client code runs. Pass what you need in as a prop, import a browser package as '
                + `'<package>?client', or declare a global the page provides with 'declare const ${outer.name}: ...'.`;
        }
    }
}

/**
 * The names a finished client script of this template may read without declaring them: the browser's
 * globals, the globals its `?client` imports provide, the globals it declares with `declare`, and the
 * framework hooks.
 * @param file - The parsed template.
 * @param providedByFramework - Names the page provides to every client script (the hooks).
 * @returns The available names.
 */
export function namesAvailableInBrowser(file: ts.SourceFile, providedByFramework: readonly string[]): ReadonlySet<string> {
    return new Set([
        ...browserGlobals(),
        ...providedByFramework,
        ...readImports(file)
            .filter(item => item.client && !item.typeOnly)
            .flatMap(vendorGlobals),
        ...file.statements.filter(isAmbient).flatMap(ambientNames)
    ]);
}

/**
 * The bindings an import declares, apart from type-only ones.
 * @param item - The import.
 * @returns The local names.
 */
function importedBindings(item: TemplateImport): string[] {
    return [
        ...item.specifiers.filter(specifier => !specifier.typeOnly).map(specifier => specifier.local),
        ...item.defaultImport === undefined ? [] : [item.defaultImport],
        ...item.namespaceImport === undefined ? [] : [item.namespaceImport]
    ];
}

/**
 * The browser globals a `?client` import reads from the vendor bundle: each named export under its own
 * name, and a default or namespace import under its local name.
 * @param item - The `?client` import.
 * @returns The global names.
 */
function vendorGlobals(item: TemplateImport): string[] {
    return [
        ...item.specifiers.filter(specifier => !specifier.typeOnly).map(specifier => specifier.imported),
        ...item.defaultImport === undefined ? [] : [item.defaultImport],
        ...item.namespaceImport === undefined ? [] : [item.namespaceImport]
    ];
}

/**
 * The value names an ambient statement declares, including those inside `declare global { ... }`.
 * @param statement - The ambient statement.
 * @returns The names.
 */
function ambientNames(statement: ts.Statement): string[] {
    return ts.isModuleDeclaration(statement) && ts.isIdentifier(statement.name) && statement.name.text === 'global'
        && statement.body != undefined && ts.isModuleBlock(statement.body)
        ? statement.body.statements.flatMap(ambientNames)
        : declaredValueNames(statement);
}

/**
 * Rejects client code that loads a module. The client script is part of the page rather than a module,
 * so `import(...)` there resolves against the page URL instead of the server's module graph, and
 * `import.meta` is a syntax error that stops the script of every component on the page.
 * @param sites - Where the emitted client code uses `import(...)` or `import.meta`.
 * @returns One diagnostic per use (empty when client code loads no module).
 */
export function validateClientModuleLoading(sites: ModuleLoadingSite[]): Diagnostic[] {
    return sites.map(site => ({
        code: ValidationCode.MODULE_LOADING_IN_CLIENT_CODE,
        message: `'${site.construct}' is used in client code, which runs as part of the page rather than as a module. `
            + 'Pass what you need in as a prop, or import a browser package as \'<package>?client\' so the vendor bundle '
            + 'provides it.',
        severity: DiagnosticSeverity.ERROR,
        span: site.span
    }));
}