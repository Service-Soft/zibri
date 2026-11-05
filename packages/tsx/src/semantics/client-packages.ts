import * as ts from 'typescript';

import { readImports } from './imports';
import { parseTemplate, syntaxErrorsOf } from './symbols';

/**
 * Parses a template source, or gives up when it has a syntax error.
 * @param source - The template source.
 * @returns The parsed file, or undefined.
 */
export function parseCompilableTemplate(source: string): ts.SourceFile | undefined {
    const file: ts.SourceFile = parseTemplate(source);
    return syntaxErrorsOf(file).length === 0 ? file : undefined;
}

/**
 * Collects the packages a template imports with the `?client` marker, in source order and without
 * duplicates. These are not imported on the server: the browser receives them as globals from a
 * vendor bundle instead.
 * @param file - The parsed template.
 * @returns The bare package names (the `?client` query already stripped).
 */
export function collectClientPackages(file: ts.SourceFile): string[] {
    const packages: string[] = [];
    for (const item of readImports(file)) {
        if (item.client && !packages.includes(item.source)) {
            packages.push(item.source);
        }
    }
    return packages;
}

/**
 * Collects the `?client` packages of a template source. Returns an empty list when the source does
 * not compile — callers that need diagnostics should use `compile` instead.
 * @param source - The template source.
 * @returns The bare package names.
 */
export function collectClientPackagesFromSource(source: string): string[] {
    const file: ts.SourceFile | undefined = parseCompilableTemplate(source);
    return file === undefined ? [] : collectClientPackages(file);
}

/**
 * A `?client` binding whose local name differs from the browser global backing it.
 */
export type ClientGlobalAlias = {
    /**
     * The name the template's code uses.
     */
    local: string,
    /**
     * The name of the browser global the vendor bundle provides.
     */
    global: string
};

/**
 * Collects the renamed `?client` import bindings. A vendor bundle exposes a package's exports as
 * browser globals named after the export, so `{ Chart }` resolves by itself while
 * `{ Chart as ChartJsChart }` has no matching global and needs an alias in the client script.
 * @param file - The parsed template.
 * @returns The local name and the global backing it, for every renamed binding.
 */
export function collectClientGlobalAliases(file: ts.SourceFile): ClientGlobalAlias[] {
    const aliases: ClientGlobalAlias[] = [];
    for (const item of readImports(file)) {
        if (!item.client || item.typeOnly) {
            continue;
        }
        for (const specifier of item.specifiers) {
            if (specifier.typeOnly || specifier.local === specifier.imported) {
                continue;
            }
            aliases.push({ local: specifier.local, global: specifier.imported });
        }
    }
    return aliases;
}

/**
 * Collects the renamed `?client` import bindings of a template source. Returns an empty list when the
 * source does not compile — callers that need diagnostics should use `compile` instead.
 * @param source - The template source.
 * @returns The local name and the global backing it, for every renamed binding.
 */
export function collectClientGlobalAliasesFromSource(source: string): ClientGlobalAlias[] {
    const file: ts.SourceFile | undefined = parseCompilableTemplate(source);
    return file === undefined ? [] : collectClientGlobalAliases(file);
}