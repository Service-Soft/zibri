import * as ts from 'typescript';

import { SourceSpan } from '../diagnostics/diagnostic.model';

/**
 * The result of splitting a module specifier into its path and client marker.
 */
type ClientQuerySplit = {
    /**
     * The module specifier without a trailing `?client` query.
     */
    source: string,
    /**
     * Whether the specifier carried the `?client` marker.
     */
    client: boolean
};

/**
 * Splits a module specifier into its bare path and whether it carried a `?client` query.
 * The `?client` marker requests a browser vendor bundle and must be stripped from the path.
 * @param raw - The module specifier, e.g. 'chart.js?client'.
 * @returns The bare source and whether the client marker was present.
 */
function stripClientQuery(raw: string): ClientQuerySplit {
    if (raw.endsWith('?client')) {
        return { source: raw.slice(0, -'?client'.length), client: true };
    }
    return { source: raw, client: false };
}

/**
 * One named binding of an import.
 */
export type TemplateImportSpecifier = {
    /**
     * The name the module exports.
     */
    imported: string,
    /**
     * The name the template binds it to.
     */
    local: string,
    /**
     * Whether the binding is type-only, by its own `type` keyword or by the whole import's.
     */
    typeOnly: boolean
};

/**
 * What a template's import declaration binds, with the `?client` marker split off its specifier.
 */
export type TemplateImport = {
    /**
     * The module specifier without a `?client` query.
     */
    source: string,
    /**
     * Whether the specifier carried the `?client` marker.
     */
    client: boolean,
    /**
     * Whether the whole import is `import type`.
     */
    typeOnly: boolean,
    /**
     * The default import binding, if any.
     */
    defaultImport: string | undefined,
    /**
     * The namespace import binding (`* as name`), if any.
     */
    namespaceImport: string | undefined,
    /**
     * The named bindings.
     */
    specifiers: TemplateImportSpecifier[],
    /**
     * Where the declaration is.
     */
    span: SourceSpan
};

/**
 * Reads the import declarations of a template, in source order.
 * @param file - The parsed template.
 * @returns What each import binds.
 */
export function readImports(file: ts.SourceFile): TemplateImport[] {
    return file.statements.filter(ts.isImportDeclaration).map(node => readImport(node, file));
}

/**
 * Reads one import declaration.
 * @param node - The import.
 * @param file - The file it belongs to.
 * @returns What the import binds.
 */
function readImport(node: ts.ImportDeclaration, file: ts.SourceFile): TemplateImport {
    const split: ClientQuerySplit = stripClientQuery(ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : '');
    const clause: ts.ImportClause | undefined = node.importClause;
    const named: ts.NamedImportBindings | undefined = clause?.namedBindings;
    const typeOnly: boolean = clause?.phaseModifier === ts.SyntaxKind.TypeKeyword;
    return {
        source: split.source,
        client: split.client,
        typeOnly,
        defaultImport: clause?.name?.text,
        namespaceImport: named != undefined && ts.isNamespaceImport(named) ? named.name.text : undefined,
        specifiers: named != undefined && ts.isNamedImports(named)
            ? named.elements.map(element => ({
                imported: (element.propertyName ?? element.name).text,
                local: element.name.text,
                typeOnly: element.isTypeOnly || typeOnly
            }))
            : [],
        span: { start: node.getStart(file), end: node.getEnd() }
    };
}