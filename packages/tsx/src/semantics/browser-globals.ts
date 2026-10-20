import { dirname, join } from 'node:path';

import * as ts from '@typescript/typescript6';

/**
 * The TypeScript lib files describing what a page's script can read: the language itself and the DOM.
 * Their `/// <reference lib>` directives are followed, so the newest language version pulls in every
 * older one.
 */
const BROWSER_LIBS: readonly string[] = ['esnext', 'dom'];

/**
 * Names every script can read that no lib file declares, because the language itself provides them.
 */
const LANGUAGE_GLOBALS: readonly string[] = ['undefined', 'globalThis', 'arguments'];

/**
 * The browser globals, read once from the installed TypeScript.
 */
let globals: ReadonlySet<string> | undefined;

/**
 * The names a script running in a page can read without declaring them: every value the language and
 * the DOM define globally, as TypeScript's own lib files describe them. Type-only names (an interface
 * with no value of the same name) are not included.
 * @returns The global names.
 */
export function browserGlobals(): ReadonlySet<string> {
    globals ??= readBrowserGlobals();
    return globals;
}

/**
 * Reads the browser globals from the lib files of the installed TypeScript.
 * @returns The global names.
 * @throws When a lib file is missing from the TypeScript installation.
 */
function readBrowserGlobals(): ReadonlySet<string> {
    const directory: string = dirname(ts.getDefaultLibFilePath({}));
    const names: Set<string> = new Set<string>(LANGUAGE_GLOBALS);
    const pending: string[] = [...BROWSER_LIBS];
    const read: Set<string> = new Set<string>();
    while (pending.length > 0) {
        const lib: string = pending.pop() ?? '';
        if (read.has(lib)) {
            continue;
        }
        read.add(lib);
        const fileName: string = join(directory, `lib.${lib}.d.ts`);
        const text: string | undefined = ts.sys.readFile(fileName);
        if (text === undefined) {
            throw new Error(`The TypeScript lib file '${fileName}' is missing.`);
        }
        const file: ts.SourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.ESNext, false);
        pending.push(...file.libReferenceDirectives.map(reference => reference.fileName.toLowerCase()));
        for (const name of file.statements.flatMap(declaredValueNames)) {
            names.add(name);
        }
    }
    return names;
}

/**
 * The value names a declaration statement introduces: variables, functions, classes and namespaces that
 * hold values.
 * @param statement - The statement.
 * @returns The names it declares as values.
 */
export function declaredValueNames(statement: ts.Statement): string[] {
    if (ts.isVariableStatement(statement)) {
        return statement.declarationList.declarations
            .flatMap(declaration => ts.isIdentifier(declaration.name) ? [declaration.name.text] : []);
    }
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name != undefined) {
        return [statement.name.text];
    }
    if (ts.isModuleDeclaration(statement) && ts.isIdentifier(statement.name) && holdsValues(statement)) {
        return [statement.name.text];
    }
    return [];
}

/**
 * Whether a namespace holds values, as opposed to only types.
 * @param declaration - The namespace declaration.
 * @returns True when anything inside it is a value.
 */
function holdsValues(declaration: ts.ModuleDeclaration): boolean {
    const body: ts.ModuleBody | undefined = declaration.body;
    if (body == undefined) {
        return false;
    }
    if (ts.isModuleDeclaration(body)) {
        return holdsValues(body);
    }
    return ts.isModuleBlock(body) && body.statements.some(statement => declaredValueNames(statement).length > 0);
}