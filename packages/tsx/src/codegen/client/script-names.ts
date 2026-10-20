import * as ts from '@typescript/typescript6';

import { parseTemplate, symbolOf } from '../../semantics/symbols.ts';

/**
 * Finds the names a finished client script reads that are not available where it runs.
 *
 * The script is parsed and resolved on its own, independently of the analysis that produced it, and
 * every syntax TypeScript knows is traversed. A name it reads without declaring must be one of the
 * available names; `import(...)` and `import.meta` are never available, because the script is part of the
 * page rather than a module.
 * @param code - The finished client script, types already erased.
 * @param available - The names the page provides.
 * @returns The unavailable names, in the order they are first read.
 */
export function unavailableNamesIn(code: string, available: ReadonlySet<string>): string[] {
    const unavailable: Set<string> = new Set<string>();
    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
        const name: string | undefined = freeNameOf(node);
        if (name !== undefined && !available.has(name)) {
            unavailable.add(name);
        }
        ts.forEachChild(node, visit);
    };
    visit(parseTemplate(code));
    return [...unavailable];
}

/**
 * The name a node reads without the script declaring it, if it reads one.
 * @param node - The node.
 * @returns `import` for a module load, the identifier's name for an undeclared read, or undefined.
 */
function freeNameOf(node: ts.Node): string | undefined {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        return 'import';
    }
    if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) {
        return 'import.meta';
    }
    if (!ts.isIdentifier(node) || !isReadPosition(node)) {
        return undefined;
    }
    return (symbolOf(node)?.declarations ?? []).length === 0 ? node.text : undefined;
}

/**
 * Whether an identifier stands where a variable is read, as opposed to naming a property, a member, a
 * label or an attribute.
 * @param identifier - The identifier.
 * @returns True for a read (or a declaration, which always resolves).
 */
function isReadPosition(identifier: ts.Identifier): boolean {
    const parent: ts.Node = identifier.parent;
    const namesSomethingElse: boolean = (ts.isPropertyAccessExpression(parent) && parent.name === identifier)
        || ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent) || ts.isPropertyDeclaration(parent)
            || ts.isGetAccessorDeclaration(parent) || ts.isSetAccessorDeclaration(parent)) && parent.name === identifier)
        || (ts.isBindingElement(parent) && parent.propertyName === identifier)
        || (ts.isLabeledStatement(parent) && parent.label === identifier)
        || ((ts.isBreakStatement(parent) || ts.isContinueStatement(parent)) && parent.label === identifier)
        || (ts.isMetaProperty(parent) && parent.name === identifier)
        || ts.isJsxAttribute(parent);
    return !namesSomethingElse;
}