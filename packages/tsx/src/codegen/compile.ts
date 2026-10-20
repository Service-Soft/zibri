import * as ts from '@typescript/typescript6';

import { ClientScript, compileClientScript } from './client/client-codegen.ts';
import { CLIENT_HOOK_SOURCES } from './client/hooks.ts';
import { unavailableNamesIn } from './client/script-names.ts';
import { emitModuleCode, eraseTypes } from './erase-types.ts';
import { printNode, SERVER_INLINED_HOOKS } from './server/print.ts';
import { compileServerRender, ServerRenderCode } from './server/render-codegen.ts';
import { Diagnostic, DiagnosticSeverity } from '../diagnostics/diagnostic.model.ts';
import { collectClientGlobalAliases, collectClientPackages } from '../semantics/client-packages.ts';
import { ComponentInfo, findComponents } from '../semantics/component.ts';
import { readImports, TemplateImport, TemplateImportSpecifier } from '../semantics/imports.ts';
import { parseTemplate, syntaxErrorsOf } from '../semantics/symbols.ts';
import { namesAvailableInBrowser, validate, validateClientImports, validateClientModuleLoading, validateClientNames, validateRenderSyntaxOutsideComponents, ValidationCode } from '../semantics/validate.ts';
import { validateEmailNesting, validateNoClientInEmail } from '../semantics/validate-email.ts';
import { UnhandledSyntaxError } from '../semantics/walk.ts';

/**
 * The name an anonymous default-exported component is declared under in the emitted module.
 */
const DEFAULT_EXPORT_BINDING: string = '__Component';

/**
 * The module format of an emitted template.
 */
export type ModuleFormat = 'esm' | 'cjs';

/**
 * Options for compiling a template.
 */
export type CompileOptions = {
    /**
     * The module format to emit. Defaults to `esm`.
     *
     * Pick the format the surrounding app is built as. Mixing them inside one bundle makes a bundler
     * resolve dual packages through different conditions, which ends in two copies of the same
     * dependency - for zibri that would mean two `GlobalRegistry` and `TranslationRegistry` instances.
     */
    module?: ModuleFormat
};

/**
 * The result of compiling one `.tsx` template file.
 */
export type CompileResult = {
    /**
     * Parse and dialect diagnostics. A non-empty list with errors means `code` is undefined.
     */
    diagnostics: Diagnostic[],
    /**
     * The emitted JavaScript module, or undefined when compilation failed.
     */
    code: string | undefined,
    /**
     * The name of the template's first component (its export name).
     */
    componentName: string | undefined,
    /**
     * The compiled client behavior of the template's first component, for callers that need the
     * metadata directly.
     */
    client: ClientScript | undefined,
    /**
     * Packages imported with `?client`, which the browser needs as globals from a vendor bundle.
     */
    clientPackages: string[]
};

/**
 * Compiles a `.tsx` template into a JavaScript module exporting a compiled component
 * (`{ name, render, client }`) that `renderPage` and other compiled components can consume.
 *
 * The original value imports are preserved so nested components and framework hooks resolve
 * normally; type-only imports are dropped, and `?client` imports are dropped because those packages
 * are provided to the browser as globals by a vendor script rather than imported on the server.
 * @param source - The template source.
 * @param options - The compile options.
 * @returns The emitted module and any diagnostics.
 * @throws When the compiler itself fails; every problem with the template is a diagnostic instead.
 */
export function compile(source: string, options: CompileOptions = {}): CompileResult {
    const file: ts.SourceFile = parseTemplate(source);
    const syntaxErrors: Diagnostic[] = syntaxErrorsOf(file);
    if (syntaxErrors.length > 0) {
        return { diagnostics: syntaxErrors, code: undefined, componentName: undefined, client: undefined, clientPackages: [] };
    }
    try {
        return compileTemplate(file, options);
    }
    catch (error) {
        // Syntax the analysis has no case for would be hidden from it, so it refuses the template instead.
        if (error instanceof UnhandledSyntaxError) {
            const diagnostic: Diagnostic = {
                code: ValidationCode.UNSUPPORTED_SYNTAX,
                message: `${error.message} It is supported outside components; inside a component it cannot be compiled yet.`,
                severity: DiagnosticSeverity.ERROR,
                span: error.span
            };
            return { diagnostics: [diagnostic], code: undefined, componentName: undefined, client: undefined, clientPackages: [] };
        }
        throw error;
    }
}

/**
 * Compiles a template that parsed without syntax errors.
 * @param file - The parsed template.
 * @param options - The compile options.
 * @returns The emitted module and any diagnostics.
 * @throws {UnhandledSyntaxError} When a component holds syntax the analysis has no case for.
 */
function compileTemplate(file: ts.SourceFile, options: CompileOptions): CompileResult {
    const clientPackages: string[] = collectClientPackages(file);
    const diagnostics: Diagnostic[] = validate(file);
    if (diagnostics.length > 0) {
        return { diagnostics, code: undefined, componentName: undefined, client: undefined, clientPackages };
    }

    const components: ComponentInfo[] = findComponents(file);
    if (components.length === 0) {
        return { diagnostics, code: undefined, componentName: undefined, client: undefined, clientPackages };
    }
    const outsideComponents: Diagnostic[] = validateRenderSyntaxOutsideComponents(file, components, Object.keys(SERVER_INLINED_HOOKS));
    if (outsideComponents.length > 0) {
        return { diagnostics: outsideComponents, code: undefined, componentName: undefined, client: undefined, clientPackages };
    }

    const compiled: CompiledTemplateComponent[] = [];
    for (const component of components) {
        const compilation: CompiledTemplateComponent | Diagnostic[] = compileTemplateComponent(file, component);
        if (Array.isArray(compilation)) {
            return { diagnostics: compilation, code: undefined, componentName: undefined, client: undefined, clientPackages };
        }
        compiled.push(compilation);
    }

    // Email templates get their own gate: MJML nesting rules, and no client code (emails run none).
    const emailDiagnostics: Diagnostic[] = [
        ...validateEmailNesting(file),
        ...validateNoClientInEmail(file, compiled.some(component => component.client.code !== undefined), clientPackages)
    ];
    if (emailDiagnostics.length > 0) {
        return { diagnostics: emailDiagnostics, code: undefined, componentName: undefined, client: undefined, clientPackages };
    }

    const code: string = emitModule(file, compiled, clientPackages, options.module ?? 'esm');
    return { diagnostics, code, componentName: compiled[0].info.name, client: compiled[0].client, clientPackages };
}

/**
 * A component of a template, compiled.
 */
type CompiledTemplateComponent = {
    /**
     * The component as declared.
     */
    info: ComponentInfo,
    /**
     * Its server render.
     */
    server: ServerRenderCode,
    /**
     * Its client behavior, types erased.
     */
    client: ClientScript
};

/**
 * Compiles one component of a template and checks its client code.
 * @param file - The parsed template.
 * @param component - The component.
 * @returns The compiled component, or the diagnostics that refuse it.
 */
function compileTemplateComponent(file: ts.SourceFile, component: ComponentInfo): CompiledTemplateComponent | Diagnostic[] {
    const server: ServerRenderCode = compileServerRender(component);
    const compiledClient: ClientScript = compileClientScript(component.fn, component.name, collectClientGlobalAliases(file));
    const client: ClientScript = {
        ...compiledClient,
        code: compiledClient.code === undefined ? undefined : eraseTypes(compiledClient.code)
    };
    const hooks: string[] = Object.keys(CLIENT_HOOK_SOURCES);

    // Only checkable once the client code is known, because it depends on what the client reaches. Each
    // check refuses on its own, in this order.
    const checks: (() => Diagnostic[])[] = [
        () => validateClientImports(file, client.referencedIdentifiers, hooks),
        () => validateClientModuleLoading(client.moduleLoading),
        () => validateClientNames(file, client.outerNames, hooks),
        // The finished script is checked once more on its own, so what reaches the page never depends on
        // the analysis above being right.
        () => validateFinishedClientScript(file, client.code, component)
    ];
    for (const check of checks) {
        const diagnostics: Diagnostic[] = check();
        if (diagnostics.length > 0) {
            return diagnostics;
        }
    }
    return { info: component, server, client };
}

/**
 * Refuses a finished client script that reads a name the page does not provide, or loads a module.
 * @param file - The parsed template.
 * @param code - The finished client script, or undefined when there is none.
 * @param component - The compiled component.
 * @returns One diagnostic per unavailable name.
 */
function validateFinishedClientScript(file: ts.SourceFile, code: string | undefined, component: ComponentInfo): Diagnostic[] {
    if (code === undefined) {
        return [];
    }
    const available: ReadonlySet<string> = namesAvailableInBrowser(file, Object.keys(CLIENT_HOOK_SOURCES));
    return unavailableNamesIn(code, available).map(name => ({
        code: ValidationCode.UNAVAILABLE_NAME_IN_CLIENT_CODE,
        message: `The client script of '${component.name}' reads '${name}', which does not exist where it runs. `
            + 'Compilation stops rather than send it to the page. The checks before this one should have reported '
            + 'it, so this is a defect in the compiler.',
        severity: DiagnosticSeverity.ERROR,
        span: { start: component.fn.getStart(), end: component.fn.getEnd() }
    }));
}

/**
 * Emits the server module of a template: the template itself, statement by statement, with every
 * component declaration replaced by its compiled component. What the components read at module level -
 * constants, helpers, contexts - stays beside them, exactly as written.
 * @param file - The parsed template.
 * @param components - Its compiled components.
 * @param clientPackages - The `?client` packages the template needs in the browser.
 * @param format - The module format to emit.
 * @returns The module source.
 */
function emitModule(file: ts.SourceFile, components: CompiledTemplateComponent[], clientPackages: string[], format: ModuleFormat): string {
    const byStatement: Map<ts.Node, CompiledTemplateComponent[]> = new Map<ts.Node, CompiledTemplateComponent[]>();
    for (const component of components) {
        const statement: ts.Node = topLevelStatementOf(component.info.fn);
        byStatement.set(statement, [...byStatement.get(statement) ?? [], component]);
    }
    const body: string[] = file.statements
        .filter(statement => !ts.isImportDeclaration(statement))
        .flatMap(statement => {
            const declared: CompiledTemplateComponent[] | undefined = byStatement.get(statement);
            return declared === undefined ? [printNode(statement)] : emitComponentStatement(statement, declared, clientPackages);
        });
    // The module is written as an ES module; commonjs is converted from it by TypeScript.
    const module: string = [...emitImports(readImports(file)), ...body].join('\n');
    return emitModuleCode(module, format === 'cjs' ? ts.ModuleKind.CommonJS : ts.ModuleKind.ESNext);
}

/**
 * The statement of the template a node is written in.
 * @param node - The node.
 * @returns The top-level statement holding it.
 */
function topLevelStatementOf(node: ts.Node): ts.Node {
    let current: ts.Node = node;
    while (!ts.isSourceFile(current.parent)) {
        current = current.parent;
    }
    return current;
}

/**
 * Emits a statement that declares components: each component as its compiled component, and every
 * other declaration of the statement unchanged, in source order.
 * @param statement - The statement.
 * @param components - The components it declares.
 * @param clientPackages - The `?client` packages the template needs in the browser.
 * @returns The emitted statements.
 */
function emitComponentStatement(statement: ts.Node, components: CompiledTemplateComponent[], clientPackages: string[]): string[] {
    if (!ts.isVariableStatement(statement)) {
        return components.map(component => emitCompiledComponent(component, clientPackages));
    }
    const list: ts.VariableDeclarationList = statement.declarationList;
    return list.declarations.map(declaration => {
        const component: CompiledTemplateComponent | undefined = components.find(candidate => candidate.info.fn.parent === declaration
            || candidate.info.fn.parent.parent === declaration);
        return component === undefined
            ? printNode(ts.factory.updateVariableStatement(
                statement,
                statement.modifiers,
                ts.factory.updateVariableDeclarationList(list, [declaration])
            ))
            : emitCompiledComponent(component, clientPackages);
    });
}

/**
 * Emits a compiled component: its render function and the component object, exported the way the
 * template exported the component.
 * @param component - The compiled component.
 * @param clientPackages - The `?client` packages the template needs in the browser.
 * @returns The emitted statements.
 */
function emitCompiledComponent(component: CompiledTemplateComponent, clientPackages: string[]): string {
    const { info, server, client } = component;
    const renderName: string = `__render$${info.name}`;
    const serverCode: string = server.code.replace(`function ${server.componentName}(`, () => `function ${renderName}(`);
    // An anonymous default export has no name to declare, so it is bound under one.
    const binding: string = info.name === 'default' ? DEFAULT_EXPORT_BINDING : info.name;
    return [
        serverCode,
        `${info.exported && !info.isDefault ? 'export ' : ''}const ${binding} = {`,
        `    name: ${JSON.stringify(info.name)},`,
        `    render: (props, $ssr) => ${renderName}($ssr, props),`,
        `    clientPackages: ${JSON.stringify(clientPackages)},`,
        '    client: {',
        `        code: ${client.code === undefined ? 'undefined' : JSON.stringify(client.code)},`,
        `        setupName: ${client.setupName === undefined ? 'undefined' : JSON.stringify(client.setupName)},`,
        `        referencedProps: ${JSON.stringify(client.referencedProps)},`,
        `        propShapes: ${JSON.stringify(client.propShapes)},`,
        `        referencedHooks: ${JSON.stringify(client.referencedHooks)},`,
        `        referencedTranslations: ${JSON.stringify(client.referencedTranslations)}`,
        '    }',
        '};',
        ...info.isDefault ? [`export default ${binding};`] : []
    ].join('\n');
}

/**
 * Re-emits the template's runtime-relevant imports, dropping type-only and `?client` ones.
 * @param imports - The template's imports.
 * @returns The import statements to emit.
 */
function emitImports(imports: TemplateImport[]): string[] {
    return imports
        .filter(item => !item.typeOnly && !item.client)
        .flatMap(item => esmImport(item) ?? []);
}

/**
 * Whether an import declared any bindings, which tells a fully type-only import (dropped) apart from
 * a side-effect import (kept).
 * @param declaration - The import to check.
 * @returns True when the import declared bindings.
 */
function hasBindings(declaration: TemplateImport): boolean {
    return declaration.specifiers.length > 0
        || declaration.defaultImport !== undefined
        || declaration.namespaceImport !== undefined;
}

/**
 * The import's runtime specifiers: neither type-only, nor a server-inlined hook. A server-inlined
 * hook (`useContext`, `provideContext`) is lowered to a `$ssr` method, so its import binding is dead
 * in the emitted module - and keeping it would demand a matching runtime export that does not exist.
 * @param declaration - The import to read.
 * @returns The value specifiers.
 */
function valueSpecifiers(declaration: TemplateImport): TemplateImportSpecifier[] {
    return declaration.specifiers.filter(
        specifier => !specifier.typeOnly && !(specifier.local in SERVER_INLINED_HOOKS)
    );
}

/**
 * Emits a single import declaration as esm, or undefined when nothing runtime-relevant remains.
 * @param declaration - The import to emit.
 * @returns The import statement, or undefined.
 */
function esmImport(declaration: TemplateImport): string | undefined {
    const source: string = JSON.stringify(declaration.source);
    const named: TemplateImportSpecifier[] = valueSpecifiers(declaration);
    const clauses: string[] = [];

    if (declaration.defaultImport) {
        clauses.push(declaration.defaultImport);
    }
    if (declaration.namespaceImport) {
        clauses.push(`* as ${declaration.namespaceImport}`);
    }
    if (named.length > 0) {
        const entries: string[] = named.map(specifier => specifier.imported === specifier.local
            ? specifier.imported
            : `${specifier.imported} as ${specifier.local}`);
        clauses.push(`{ ${entries.join(', ')} }`);
    }

    if (clauses.length === 0) {
        // A side-effect import stays; an import whose bindings were all type-only is dropped.
        return hasBindings(declaration) ? undefined : `import ${source};`;
    }
    return `import ${clauses.join(', ')} from ${source};`;
}