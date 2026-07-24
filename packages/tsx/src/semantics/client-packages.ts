import { Program } from '../parser/ast';
import { parse } from '../parser/parser';

/**
 * Collects the packages a template imports with the `?client` marker, in source order and without
 * duplicates. These are not imported on the server: the browser receives them as globals from a
 * vendor bundle instead.
 * @param program - The parsed template.
 * @returns The bare package names (the `?client` query already stripped).
 */
export function collectClientPackages(program: Program): string[] {
    const packages: string[] = [];
    for (const item of program.body) {
        if (item.kind === 'ImportDeclaration' && item.client && !packages.includes(item.source)) {
            packages.push(item.source);
        }
    }
    return packages;
}

/**
 * Collects the `?client` packages of a template source. Returns an empty list when the source
 * cannot be parsed — callers that need diagnostics should use `compile` instead.
 * @param source - The template source.
 * @returns The bare package names.
 */
export function collectClientPackagesFromSource(source: string): string[] {
    const program: Program | undefined = parse(source).program;
    return program ? collectClientPackages(program) : [];
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
 * @param program - The parsed template.
 * @returns The local name and the global backing it, for every renamed binding.
 */
export function collectClientGlobalAliases(program: Program): ClientGlobalAlias[] {
    const aliases: ClientGlobalAlias[] = [];
    for (const item of program.body) {
        if (item.kind !== 'ImportDeclaration' || !item.client || item.typeOnly) {
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
 * Collects the renamed `?client` import bindings of a template source. Returns an empty list when
 * the source cannot be parsed — callers that need diagnostics should use `compile` instead.
 * @param source - The template source.
 * @returns The local name and the global backing it, for every renamed binding.
 */
export function collectClientGlobalAliasesFromSource(source: string): ClientGlobalAlias[] {
    const program: Program | undefined = parse(source).program;
    return program ? collectClientGlobalAliases(program) : [];
}

/**
 * Maps a package name to the file name its vendor bundle is written to (and served under).
 * @param packageName - The package name, e.g. `chart.js` or `@scope/pkg`.
 * @returns The bundle file name, e.g. `chart-js.js`.
 */
export function vendorFileName(packageName: string): string {
    const kebab: string = packageName
        .replaceAll(/[^\da-z]+/gi, '-')
        .replaceAll(/([\da-z])([A-Z])/g, '$1-$2')
        .toLowerCase()
        .replaceAll(/^-+|-+$/g, '');
    return `${kebab}.js`;
}