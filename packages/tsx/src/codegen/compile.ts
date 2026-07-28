import { ClientScript, compileClientScript } from './client/client-codegen';
import { CLIENT_HOOK_SOURCES } from './client/hooks';
import { SERVER_INLINED_HOOKS } from './server/print';
import { compileServerRender, ServerRenderCode } from './server/render-codegen';
import { Diagnostic } from '../diagnostics/diagnostic.model';
import { ImportDeclaration, ImportSpecifier, Program } from '../parser/ast';
import { parse, ParseResult } from '../parser/parser';
import { collectClientGlobalAliases, collectClientPackages } from '../semantics/client-packages';
import { ComponentInfo, findComponents } from '../semantics/component';
import { validate, validateClientImports } from '../semantics/validate';
import { validateEmailNesting, validateNoClientInEmail } from '../semantics/validate-email';

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
     * The name of the compiled component (its export name).
     */
    componentName: string | undefined,
    /**
     * The compiled client behavior, for callers that need the metadata directly.
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
 */
export function compile(source: string, options: CompileOptions = {}): CompileResult {
    const parsed: ParseResult = parse(source);
    if (!parsed.program) {
        return {
            diagnostics: parsed.diagnostics, code: undefined, componentName: undefined, client: undefined, clientPackages: []
        };
    }

    const clientPackages: string[] = collectClientPackages(parsed.program);
    const diagnostics: Diagnostic[] = [...parsed.diagnostics, ...validate(parsed.program)];
    if (diagnostics.length > 0) {
        return { diagnostics, code: undefined, componentName: undefined, client: undefined, clientPackages };
    }

    const components: ComponentInfo[] = findComponents(parsed.program);
    if (components.length === 0) {
        return { diagnostics, code: undefined, componentName: undefined, client: undefined, clientPackages };
    }

    const component: ComponentInfo = components[0];
    const server: ServerRenderCode = compileServerRender(component);
    const client: ClientScript = compileClientScript(component.fn, component.name, collectClientGlobalAliases(parsed.program));

    // Only checkable once the client code is known, because it depends on what the client reaches.
    const leaks: Diagnostic[] = validateClientImports(
        parsed.program,
        client.referencedIdentifiers,
        Object.keys(CLIENT_HOOK_SOURCES)
    );
    if (leaks.length > 0) {
        return { diagnostics: leaks, code: undefined, componentName: undefined, client: undefined, clientPackages };
    }

    // Email templates get their own gate: MJML nesting rules, and no client code (emails run none).
    const emailDiagnostics: Diagnostic[] = [
        ...validateEmailNesting(parsed.program),
        ...validateNoClientInEmail(parsed.program, client.code !== undefined, clientPackages)
    ];
    if (emailDiagnostics.length > 0) {
        return { diagnostics: emailDiagnostics, code: undefined, componentName: undefined, client: undefined, clientPackages };
    }

    const code: string = emitModule(
        parsed.program,
        component.name,
        server,
        client,
        clientPackages,
        options.module ?? 'esm'
    );

    return { diagnostics, code, componentName: component.name, client, clientPackages };
}

/**
 * Emits the module source for a compiled component.
 * @param program - The parsed template.
 * @param name - The component (export) name.
 * @param server - The generated server render.
 * @param client - The generated client behavior.
 * @param clientPackages - The `?client` packages the component needs in the browser.
 * @param format - The module format to emit.
 * @returns The module source.
 */
function emitModule(
    program: Program,
    name: string,
    server: ServerRenderCode,
    client: ClientScript,
    clientPackages: string[],
    format: ModuleFormat
): string {
    const renderName: string = `__render$${name}`;
    const serverCode: string = server.code.replace(
        `function ${server.componentName}(`,
        () => `function ${renderName}(`
    );
    // Both formats declare a local const: a recursive component (a file tree entry rendering itself)
    // resolves its own name from the module scope, which `exports.X = ...` alone would not provide.
    const declaration: string = format === 'cjs' ? `const ${name} = {` : `export const ${name} = {`;
    const trailer: string[] = format === 'cjs' ? [`exports.${name} = ${name};`] : [];

    const parts: string[] = [
        ...emitImports(program, format),
        '',
        serverCode,
        '',
        declaration,
        `    name: ${JSON.stringify(name)},`,
        `    render: (props, $ssr) => ${renderName}($ssr, props),`,
        `    clientPackages: ${JSON.stringify(clientPackages)},`,
        '    client: {',
        `        code: ${client.code === undefined ? 'undefined' : JSON.stringify(client.code)},`,
        `        setupName: ${client.setupName === undefined ? 'undefined' : JSON.stringify(client.setupName)},`,
        `        referencedProps: ${JSON.stringify(client.referencedProps)},`,
        `        referencedHooks: ${JSON.stringify(client.referencedHooks)},`,
        `        referencedTranslations: ${JSON.stringify(client.referencedTranslations)}`,
        '    }',
        '};',
        ...trailer
    ];
    return parts.filter((part, index) => !(part === '' && index === 0)).join('\n');
}

/**
 * Re-emits the template's runtime-relevant imports, dropping type-only and `?client` ones.
 * @param program - The parsed template.
 * @param format - The module format to emit.
 * @returns The import statements to emit.
 */
function emitImports(program: Program, format: ModuleFormat): string[] {
    const out: string[] = [];
    let index: number = 0;
    for (const item of program.body) {
        if (item.kind !== 'ImportDeclaration' || item.typeOnly || item.client) {
            continue;
        }
        const statement: string | undefined = format === 'cjs' ? requireImport(item, index) : esmImport(item);
        if (statement) {
            out.push(statement);
            index++;
        }
    }
    return out;
}

/**
 * Whether an import declared any bindings, which tells a fully type-only import (dropped) apart from
 * a side-effect import (kept).
 * @param declaration - The import to check.
 * @returns True when the import declared bindings.
 */
function hasBindings(declaration: ImportDeclaration): boolean {
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
function valueSpecifiers(declaration: ImportDeclaration): ImportSpecifier[] {
    return declaration.specifiers.filter(
        specifier => !specifier.typeOnly && !(specifier.local in SERVER_INLINED_HOOKS)
    );
}

/**
 * Emits a single import declaration as esm, or undefined when nothing runtime-relevant remains.
 * @param declaration - The import to emit.
 * @returns The import statement, or undefined.
 */
function esmImport(declaration: ImportDeclaration): string | undefined {
    const source: string = JSON.stringify(declaration.source);
    const named: ImportSpecifier[] = valueSpecifiers(declaration);
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

/**
 * Emits a single import declaration as a `require` call, or undefined when nothing runtime-relevant
 * remains.
 * @param declaration - The import to emit.
 * @param index - The import's position, used to name the intermediate binding when one is needed.
 * @returns The require statement(s), or undefined.
 */
function requireImport(declaration: ImportDeclaration, index: number = 0): string | undefined {
    const source: string = JSON.stringify(declaration.source);
    const named: ImportSpecifier[] = valueSpecifiers(declaration);
    const { defaultImport, namespaceImport } = declaration;

    if (!defaultImport && !namespaceImport && named.length === 0) {
        return hasBindings(declaration) ? undefined : `require(${source});`;
    }

    const entries: string[] = named.map(specifier => specifier.imported === specifier.local
        ? specifier.imported
        : `${specifier.imported}: ${specifier.local}`);

    // A namespace import is the module object itself, so it can bind the require directly.
    if (namespaceImport && named.length === 0 && !defaultImport) {
        return `const ${namespaceImport} = require(${source});`;
    }
    // Named bindings alone destructure straight from the module object.
    if (!defaultImport && !namespaceImport) {
        return `const { ${entries.join(', ')} } = require(${source});`;
    }

    // A default import needs the interop dance, so the module object gets an intermediate binding.
    const moduleBinding: string = `__zibriModule${index}`;
    const lines: string[] = [`const ${moduleBinding} = require(${source});`];
    if (namespaceImport) {
        lines.push(`const ${namespaceImport} = ${moduleBinding};`);
    }
    if (defaultImport) {
        lines.push(
            `const ${defaultImport} = ${moduleBinding} && ${moduleBinding}.__esModule `
            + `? ${moduleBinding}.default : ${moduleBinding};`
        );
    }
    if (entries.length > 0) {
        lines.push(`const { ${entries.join(', ')} } = ${moduleBinding};`);
    }
    return lines.join('\n');
}