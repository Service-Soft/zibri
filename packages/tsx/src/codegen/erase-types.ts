import * as ts from '@typescript/typescript6';

/**
 * The options every emitted piece of code is transpiled with: ES2022, which Node and every current
 * browser run, with newer syntax such as decorators and `using` lowered by TypeScript; nothing about
 * modules is rewritten, and no comment survives - the code can end up in the page.
 */
const TRANSPILE_OPTIONS: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    verbatimModuleSyntax: true,
    removeComments: true,
    newLine: ts.NewLineKind.LineFeed
};

/**
 * Turns generated TypeScript into JavaScript with TypeScript's own transpiler, so type syntax is
 * erased by the compiler that defines it rather than by rules kept here.
 * @param code - The generated TypeScript: a function, never a module of its own.
 * @returns The JavaScript.
 */
export function eraseTypes(code: string): string {
    return ts.transpileModule(code, {
        compilerOptions: TRANSPILE_OPTIONS,
        transformers: { after: [withoutModuleMarker] }
    }).outputText.trimEnd();
}

/**
 * Turns a generated TypeScript module into a JavaScript module of the given kind with TypeScript's own
 * transpiler: types are erased, and for commonjs every import and export is converted by the compiler
 * that defines both module systems, and a default import of a commonjs dependency receives its exports.
 * @param code - The generated TypeScript module, written with `import` and `export`.
 * @param module - The module system to emit.
 * @returns The JavaScript module.
 */
export function emitModuleCode(code: string, module: ts.ModuleKind.ESNext | ts.ModuleKind.CommonJS): string {
    return ts.transpileModule(code, {
        compilerOptions: { ...TRANSPILE_OPTIONS, module, esModuleInterop: true }
    }).outputText.trimEnd();
}

/**
 * Removes the `export {};` TypeScript appends to code that reads `import.meta`, which it takes for a
 * module. The code transpiled here is a function that the compiler places into a module itself, so the
 * marker would be a statement in the wrong place.
 * @param context - The transformation context.
 * @returns The transformer.
 */
function withoutModuleMarker(context: ts.TransformationContext): ts.Transformer<ts.SourceFile> {
    return file => context.factory.updateSourceFile(file, file.statements.filter(statement => !isEmptyExport(statement)));
}

/**
 * Whether a statement is `export {};`.
 * @param statement - The statement.
 * @returns True for an export of nothing from nowhere.
 */
function isEmptyExport(statement: ts.Statement): boolean {
    return ts.isExportDeclaration(statement)
        && statement.moduleSpecifier == undefined
        && statement.exportClause != undefined
        && ts.isNamedExports(statement.exportClause)
        && statement.exportClause.elements.length === 0;
}