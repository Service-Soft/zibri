import ts from 'typescript';

import { readImports } from './imports';
import { symbolOf } from './symbols';

/**
 * The packages a template imports the framework hooks from.
 */
const HOOK_MODULES: readonly string[] = ['zibri', 'zibri-tsx'];

/**
 * A hook of the framework the template imports under another name.
 */
export type HookAlias = {
    /**
     * The name the template's code calls it by.
     */
    local: string,
    /**
     * The name the framework exports it under, which the page defines.
     */
    hook: string
};

/**
 * Whether a template imports the framework hooks from a module.
 * @param source - The module specifier, without a `?client` query.
 * @returns True for a package the hooks are imported from.
 */
export function isHookModule(source: string): boolean {
    return HOOK_MODULES.includes(source);
}

/**
 * The name the framework knows a name of the template by: what a package of the framework exports it under, whatever
 * the template imports it as, or the name itself when the template declares it nowhere, as a template compiled on its
 * own calls the hooks. A name the template declares, or imports from another module, is none of the framework's.
 * @param identifier - The name.
 * @returns The name the framework exports it under, or undefined for a name of the template's own.
 */
export function resolveFrameworkName(identifier: ts.Identifier): string | undefined {
    // a name in a tree the compiler rewrote is resolved where it was parsed. One the compiler wrote itself, such as
    // the hook it lowers a call to, has no such place, and is the framework's
    const parsed: ts.Node | undefined = ts.getParseTreeNode(identifier);
    if (parsed === undefined || !ts.isIdentifier(parsed)) {
        return identifier.text;
    }
    const declarations: ts.Declaration[] = symbolOf(parsed)?.declarations ?? [];
    if (declarations.length === 0) {
        return parsed.text;
    }
    for (const declaration of declarations) {
        if (ts.isImportSpecifier(declaration)
            && !declaration.isTypeOnly
            && ts.isStringLiteral(declaration.parent.parent.parent.moduleSpecifier)
            && isHookModule(declaration.parent.parent.parent.moduleSpecifier.text)) {
            return (declaration.propertyName ?? declaration.name).text;
        }
    }
    return undefined;
}

/**
 * Whether a name is the named framework hook, under whichever name the template imports it.
 * @param identifier - The name.
 * @param hook - The name the framework exports the hook under.
 * @returns True when the name is that hook.
 */
export function isHookReference(identifier: ts.Identifier, hook: string): boolean {
    return resolveFrameworkName(identifier) === hook;
}

/**
 * Collects the hooks a template imports from the framework under another name.
 * @param file - The parsed template.
 * @param hooks - The names of the hooks.
 * @returns The name the template uses and the hook it is, for every renamed one.
 */
export function collectHookAliases(file: ts.SourceFile, hooks: readonly string[]): HookAlias[] {
    return readImports(file)
        .filter(item => !item.client && !item.typeOnly && isHookModule(item.source))
        .flatMap(item => item.specifiers)
        .filter(specifier => !specifier.typeOnly && specifier.local !== specifier.imported && hooks.includes(specifier.imported))
        .map(specifier => ({ local: specifier.local, hook: specifier.imported }));
}