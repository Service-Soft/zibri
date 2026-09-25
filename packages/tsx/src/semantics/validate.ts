import * as ts from 'typescript';

import { browserGlobals, declaredValueNames } from './browser-globals';
import { ComponentInfo, findComponents, hasModifier } from './component';
import { readImports, TemplateImport } from './imports';
import { isAmbient } from './symbols';
import { ModuleLoadingSite, OuterName } from '../codegen/client/client-codegen';
import { Diagnostic, DiagnosticSeverity } from '../diagnostics/diagnostic.model';

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
     * JSX or a server-inlined hook was written outside a component.
     */
    RENDER_SYNTAX_OUTSIDE_COMPONENT = 'ZTSX010'
}

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
    return diagnostics;
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
 * Rejects render syntax outside a component. JSX and the server-inlined hooks (`useContext`,
 * `provideContext`, `$raw`) need the render runtime a component receives for each render, which code
 * outside a component does not have.
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
    const hooks: Set<string> = new Set(serverInlinedHooks);
    const diagnostics: Diagnostic[] = [];
    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
        if (insideComponents.has(node)) {
            return;
        }
        const isJsx: boolean = ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node);
        const hook: string | undefined = ts.isCallExpression(node) && ts.isIdentifier(node.expression) && hooks.has(node.expression.text)
            ? node.expression.text
            : undefined;
        if (isJsx || hook !== undefined) {
            const written: string = hook === undefined ? 'JSX' : `'${hook}'`;
            diagnostics.push({
                code: ValidationCode.RENDER_SYNTAX_OUTSIDE_COMPONENT,
                message: `${written} is written outside a component, where there is no `
                    + 'render to produce it in. Move it into a component - a function named in PascalCase that returns JSX.',
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
 * Rejects client code that reads an ordinary import. Only two things cross into the browser: the
 * props a parent passes and the browser globals a `?client` import provides. An ordinary import
 * lives in the server module, which the client script — plain text in the page — cannot reach, so
 * the identifier would silently be undefined at runtime.
 * @param file - The parsed template.
 * @param referencedIdentifiers - Every name the emitted client code reads from outside the component.
 * @param providedByFramework - Names the compiler inlines into the client script itself (the
 * framework hooks), which are imported from `zibri` but never read from the module at runtime.
 * @returns The diagnostics found (empty when no client code reads an import).
 */
export function validateClientImports(
    file: ts.SourceFile,
    referencedIdentifiers: string[],
    providedByFramework: readonly string[]
): Diagnostic[] {
    const provided: Set<string> = new Set(providedByFramework);
    const referenced: Set<string> = new Set(referencedIdentifiers.filter(name => !provided.has(name)));
    const diagnostics: Diagnostic[] = [];

    for (const item of readImports(file)) {
        if (item.client || item.typeOnly) {
            continue;
        }
        const bindings: string[] = [
            ...item.specifiers.filter(specifier => !specifier.typeOnly).map(specifier => specifier.local),
            ...item.defaultImport ? [item.defaultImport] : [],
            ...item.namespaceImport ? [item.namespaceImport] : []
        ];
        for (const binding of bindings.filter(name => referenced.has(name))) {
            diagnostics.push({
                code: ValidationCode.SERVER_IMPORT_IN_CLIENT_CODE,
                message: `'${binding}' is imported from '${item.source}' and used in client code, where it does not `
                    + `exist. Pass what you need in as a prop, or - if '${item.source}' is a browser package - import `
                    + `it as '${item.source}?client' so the vendor bundle provides it.`,
                severity: DiagnosticSeverity.ERROR,
                span: item.span
            });
        }
    }
    return diagnostics;
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
    if (ts.isModuleDeclaration(statement) && ts.isIdentifier(statement.name) && statement.name.text === 'global'
        && statement.body != undefined && ts.isModuleBlock(statement.body)) {
        return statement.body.statements.flatMap(ambientNames);
    }
    return declaredValueNames(statement);
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