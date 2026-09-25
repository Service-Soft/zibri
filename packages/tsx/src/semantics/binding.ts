import * as ts from 'typescript';

import { isAmbient, isDeclaredWithin, symbolOf } from './symbols';
import { walk } from './walk';

/**
 * Whether an identifier is the name a declaration binds rather than a reference to one: a variable,
 * parameter or destructured name, or the target of a `for (x of ...)` loop.
 * @param node - The identifier.
 * @returns True when the identifier binds a name.
 */
export function isBindingIdentifier(node: ts.Identifier): boolean {
    const parent: ts.Node = node.parent;
    if (ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isBindingElement(parent)) {
        return parent.name === node;
    }
    return ts.isForOfStatement(parent) && parent.initializer === node;
}

/**
 * The identifier the rest element of an object destructuring binds, which is a name rather than a
 * pattern.
 * @param pattern - The object binding pattern.
 * @returns The rest identifier, or undefined when there is none.
 */
function objectRestBinding(pattern: ts.ObjectBindingPattern): ts.Identifier | undefined {
    const rest: ts.BindingElement | undefined = pattern.elements.find(element => element.dotDotDotToken != undefined);
    return rest != undefined && ts.isIdentifier(rest.name) ? rest.name : undefined;
}

/**
 * Collects the identifiers bound by a single binding pattern (including nested destructuring,
 * defaults, and rest elements).
 * @param pattern - The pattern to inspect: a binding name or a parameter.
 * @returns The binding identifiers in source order, an object pattern's rest ahead of its properties.
 */
export function collectPatternBindings(pattern: ts.Node): ts.Identifier[] {
    const bindings: ts.Identifier[] = [];
    walk(pattern, node => {
        if (ts.isIdentifier(node) && isBindingIdentifier(node)) {
            bindings.push(node);
        }
        else if (ts.isObjectBindingPattern(node)) {
            const rest: ts.Identifier | undefined = objectRestBinding(node);
            if (rest !== undefined) {
                bindings.push(rest);
            }
        }
    });
    return bindings;
}

/**
 * Collects the identifier names bound by a single binding pattern (including nested destructuring,
 * defaults, and rest elements).
 * @param pattern - The pattern to inspect: a binding name or a parameter.
 * @returns The bound names in source order, an object pattern's rest name ahead of its properties.
 */
export function collectPatternNames(pattern: ts.Node): string[] {
    return collectPatternBindings(pattern).map(binding => binding.text);
}

/**
 * The name a reference-position node reads, or undefined when it reads none.
 *
 * A dynamic `import(...)`, `import.meta` and `new.target` read the keyword they start with. No binding
 * can be called either, so the name can never match a declaration or an import.
 * @param node - The node to inspect.
 * @returns The referenced name, or undefined.
 */
export function referencedNameOf(node: ts.Node): string | undefined {
    if (ts.isIdentifier(node)) {
        return isBindingIdentifier(node) ? undefined : node.text;
    }
    if (node.kind === ts.SyntaxKind.ImportKeyword) {
        return 'import';
    }
    if (ts.isMetaProperty(node)) {
        return node.keywordToken === ts.SyntaxKind.ImportKeyword ? 'import' : 'new';
    }
    return undefined;
}

/**
 * Collects the names of every identifier referenced (in value/reference position) within a node.
 * Property names of non-computed member accesses and object keys are not included.
 * @param node - The node to analyze.
 * @param skip - Nodes to leave out, together with everything below them.
 * @returns The set of referenced identifier names.
 */
export function collectReferencedIdentifiers(node: ts.Node, skip?: ReadonlySet<ts.Node>): Set<string> {
    const referenced: Set<string> = new Set<string>();
    walk(node, current => {
        const name: string | undefined = referencedNameOf(current);
        if (name !== undefined) {
            referenced.add(name);
        }
    }, skip);
    return referenced;
}

/**
 * Collects the symbols of every identifier referenced (in value/reference position) within a node, in
 * the order they are first read. A name the template declares nowhere has no symbol and is left out.
 * @param node - The node to analyze.
 * @param skip - Nodes to leave out, together with everything below them.
 * @returns The referenced symbols.
 */
export function collectReferencedSymbols(node: ts.Node, skip?: ReadonlySet<ts.Node>): Set<ts.Symbol> {
    const referenced: Set<ts.Symbol> = new Set<ts.Symbol>();
    walk(node, current => {
        const symbol: ts.Symbol | undefined = ts.isIdentifier(current) && !isBindingIdentifier(current)
            ? symbolOf(current)
            : undefined;
        if (symbol !== undefined) {
            referenced.add(symbol);
        }
    }, skip);
    return referenced;
}

/**
 * Collects the names a node reads from outside a scope: every referenced name that is not declared
 * within the scope - a module-level declaration, an import, or a name the template declares nowhere.
 * @param node - The node to analyze.
 * @param scope - The scope whose own declarations are not outside.
 * @param skip - Nodes to leave out, together with everything below them.
 * @returns The names read from outside the scope.
 */
export function collectOuterNames(node: ts.Node, scope: ts.Node, skip?: ReadonlySet<ts.Node>): Set<string> {
    const names: Set<string> = new Set<string>();
    walk(node, current => {
        const name: string | undefined = referencedNameOf(current);
        if (name !== undefined && !(ts.isIdentifier(current) && isDeclaredWithin(symbolOf(current), scope))) {
            names.add(name);
        }
    }, skip);
    return names;
}

/**
 * Where a name read from outside a scope is declared.
 * - `import`: an import binding of the template.
 * - `ambient`: a `declare` of the template, which states that the name exists at runtime.
 * - `module`: any other declaration of the template outside the scope.
 * - `undeclared`: nowhere in the template.
 */
export type OuterOrigin = 'import' | 'ambient' | 'module' | 'undeclared';

/**
 * A name a scope reads from outside itself, located at its first read.
 */
export type OuterReference = {
    /**
     * The name.
     */
    name: string,
    /**
     * Where it is declared.
     */
    origin: OuterOrigin,
    /**
     * The first identifier that reads it.
     */
    identifier: ts.Identifier
};

/**
 * Collects the identifiers a node reads from outside a scope, one per name, in the order they are first
 * read, with where each is declared.
 * @param node - The node to analyze.
 * @param scope - The scope whose own declarations are not outside.
 * @param skip - Nodes to leave out, together with everything below them.
 * @returns The names read from outside the scope.
 */
export function collectOuterReferences(node: ts.Node, scope: ts.Node, skip?: ReadonlySet<ts.Node>): OuterReference[] {
    const references: Map<string, OuterReference> = new Map<string, OuterReference>();
    walk(node, current => {
        if (!ts.isIdentifier(current) || isBindingIdentifier(current) || references.has(current.text)) {
            return;
        }
        const symbol: ts.Symbol | undefined = symbolOf(current);
        if (!isDeclaredWithin(symbol, scope)) {
            references.set(current.text, { name: current.text, origin: originOf(symbol), identifier: current });
        }
    }, skip);
    return [...references.values()];
}

/**
 * Where a symbol read from outside a scope is declared.
 * @param symbol - The symbol, or undefined for a name the template does not declare.
 * @returns Its origin.
 */
function originOf(symbol: ts.Symbol | undefined): OuterOrigin {
    const declarations: ts.Declaration[] = symbol?.declarations ?? [];
    if (declarations.length === 0) {
        return 'undeclared';
    }
    if (declarations.some(declaration => ts.isImportSpecifier(declaration) || ts.isImportClause(declaration)
        || ts.isNamespaceImport(declaration))) {
        return 'import';
    }
    return declarations.every(isAmbient) ? 'ambient' : 'module';
}

/**
 * The symbols a statement declares in the scope it is written in, as opposed to inside anything it
 * contains.
 * @param statement - The statement.
 * @returns The declared symbols.
 */
export function declaredSymbols(statement: ts.Statement | ts.VariableDeclaration): ts.Symbol[] {
    if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) {
        return statement.name == undefined ? [] : symbolsOf([statement.name]);
    }
    if (ts.isVariableStatement(statement)) {
        return statement.declarationList.declarations.flatMap(declaredSymbols);
    }
    if (ts.isVariableDeclaration(statement)) {
        return symbolsOf(collectPatternBindings(statement.name));
    }
    return [];
}

/**
 * The symbols of the given identifiers.
 * @param identifiers - The identifiers.
 * @returns Their symbols, where they have one.
 */
export function symbolsOf(identifiers: ts.Identifier[]): ts.Symbol[] {
    return identifiers.flatMap(identifier => symbolOf(identifier) ?? []);
}