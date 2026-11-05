import path from 'node:path';

import ts from 'typescript';

/**
 * One name an entry point exports.
 */
export type ExportedName = {
    /**
     * The name, as an import names it.
     */
    name: string,
    /**
     * The file that declares it, relative to `src`.
     */
    file: string
};

/**
 * One JSDoc block of what an entry point exports.
 */
export type PublishedComment = {
    /**
     * The file holding it, relative to `src`.
     */
    file: string,
    /**
     * The line it starts on, counted from 1.
     */
    line: number,
    /**
     * The block, as it is written.
     */
    text: string
};

/**
 * The entry point of zibri-testing, relative to zibri's `src`. Its names are documented in zibri's
 * docs as well.
 */
export const TESTING_ENTRY_POINT: string = '../../testing/src/index.ts';

/**
 * The entry points of zibri and zibri-testing, as the compiler reads them.
 */
export abstract class EntryPointUtilities {
    private static readonly srcDir: string = path.join(__dirname, '..');

    private static program: ts.Program | undefined;

    /**
     * Every name an entry point exports, types included.
     * @param entryPoint - The entry point's file, relative to `src`.
     * @returns The exported names.
     */
    static resolveNames(entryPoint: string): ExportedName[] {
        const checker: ts.TypeChecker = this.resolveProgram().getTypeChecker();
        return checker.getExportsOfModule(this.resolveModule(entryPoint)).map(symbol => this.toExportedName(checker, symbol, entryPoint));
    }

    /**
     * Every name the files an entry point re-exports from declare as exported, whether the entry
     * point passes it on or not.
     * @param entryPoint - The entry point's file, relative to `src`.
     * @returns The names, each with the file declaring it.
     */
    static resolveReexportedFileNames(entryPoint: string): ExportedName[] {
        const program: ts.Program = this.resolveProgram();
        const checker: ts.TypeChecker = program.getTypeChecker();
        const source: ts.SourceFile = this.resolveSource(entryPoint);
        const names: ExportedName[] = [];
        for (const statement of source.statements) {
            // a name an entry point took from another package directly would be that package's
            if (!ts.isExportDeclaration(statement)
                || statement.moduleSpecifier == undefined
                || !ts.isStringLiteral(statement.moduleSpecifier)
                || !statement.moduleSpecifier.text.startsWith('.')) {
                continue;
            }
            const file: string = path.relative(this.srcDir, path.resolve(this.srcDir, `${statement.moduleSpecifier.text}.ts`));
            names.push(...checker.getExportsOfModule(this.resolveModule(file)).map(symbol => this.toExportedName(checker, symbol, file)));
        }
        return names;
    }

    /**
     * Every name declared inside what an entry point exports: the properties, parameters and object
     * keys a caller writes. Function bodies are left out, since nothing in them is part of the
     * signature.
     * @param entryPoint - The entry point's file, relative to `src`.
     * @returns The names, each with the file declaring it.
     */
    static resolveMemberNames(entryPoint: string): ExportedName[] {
        const checker: ts.TypeChecker = this.resolveProgram().getTypeChecker();
        const names: ExportedName[] = [];
        for (const symbol of checker.getExportsOfModule(this.resolveModule(entryPoint))) {
            const declared: ts.Symbol = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
            for (const declaration of declared.declarations ?? []) {
                // a name another package declares is that package's to choose
                if (!declaration.getSourceFile().fileName.startsWith(this.srcDir)) {
                    continue;
                }
                this.collectMemberNames(checker, declaration, names);
            }
        }
        return names;
    }

    /**
     * Every JSDoc block typedoc publishes for an entry point: on what it exports, and on the public
     * members, properties and enum members declared inside. Function bodies, private and protected
     * members, and what a namespace does not export are left out, as typedoc leaves them out.
     * @param entryPoint - The entry point's file, relative to `src`.
     * @returns The blocks, each once.
     */
    static resolvePublishedComments(entryPoint: string): PublishedComment[] {
        const checker: ts.TypeChecker = this.resolveProgram().getTypeChecker();
        const found: Set<ts.JSDoc> = new Set();
        for (const symbol of checker.getExportsOfModule(this.resolveModule(entryPoint))) {
            const declared: ts.Symbol = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
            for (const declaration of declared.declarations ?? []) {
                if (declaration.getSourceFile().fileName.startsWith(this.srcDir)
                    || declaration.getSourceFile().fileName.startsWith(path.resolve(this.srcDir, TESTING_ENTRY_POINT, '..'))) {
                    this.collectComments(declaration, found);
                }
            }
        }
        return [...found].map(comment => ({
            file: path.relative(this.srcDir, comment.getSourceFile().fileName),
            line: comment.getSourceFile().getLineAndCharacterOfPosition(comment.getStart()).line + 1,
            text: comment.getText()
        }));
    }

    /**
     * Adds the JSDoc blocks of a node and below it that typedoc publishes.
     * @param node - The node to start at.
     * @param found - The blocks found so far, added to.
     */
    private static collectComments(node: ts.Node, found: Set<ts.JSDoc>): void {
        if (ts.isBlock(node)
            || (ts.isClassElement(node) && ts.getCombinedModifierFlags(node) & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected))
            || (ts.isClassElement(node) && node.name != undefined && ts.isPrivateIdentifier(node.name))
            || (ts.isModuleBlock(node.parent)
                && !(ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) === true))) {
            return;
        }
        for (const comment of ts.getJSDocCommentsAndTags(node)) {
            if (ts.isJSDoc(comment)) {
                found.add(comment);
            }
        }
        ts.forEachChild(node, child => this.collectComments(child, found));
    }

    /**
     * Adds the names declared in a node and below it, leaving out function bodies, private members,
     * and the keys of an object handed to another package, which that package names.
     * @param checker - The type checker.
     * @param node - The node to start at.
     * @param names - The names found so far, added to.
     */
    private static collectMemberNames(checker: ts.TypeChecker, node: ts.Node, names: ExportedName[]): void {
        if (ts.isBlock(node)
            || (ts.isClassElement(node) && ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Private)
            || (ts.isClassElement(node) && node.name != undefined && ts.isPrivateIdentifier(node.name))) {
            return;
        }
        if ((ts.isPropertySignature(node) || ts.isPropertyDeclaration(node) || ts.isParameter(node) || ts.isPropertyAssignment(node))
            && ts.isIdentifier(node.name)
            && !(ts.isPropertyAssignment(node) && this.isDeclaredElsewhere(checker, node))) {
            names.push({ name: node.name.text, file: path.relative(this.srcDir, node.getSourceFile().fileName) });
        }
        ts.forEachChild(node, child => this.collectMemberNames(checker, child, names));
    }

    /**
     * Whether the key of an object literal is a property only other packages declare.
     * @param checker - The type checker.
     * @param assignment - The key and its value.
     * @returns True if every declaration of the property the key sets lies outside `src`.
     */
    private static isDeclaredElsewhere(checker: ts.TypeChecker, assignment: ts.PropertyAssignment): boolean {
        const declarations: ts.Declaration[] = checker.getSymbolAtLocation(assignment.name)?.declarations ?? [];
        const target: ts.Symbol | undefined = assignment.parent.parent == undefined
            ? undefined
            : checker.getContextualType(assignment.parent)?.getProperty(assignment.name.getText());
        const declaredBy: ts.Declaration[] = target?.declarations ?? declarations;
        return declaredBy.length > 0 && declaredBy.every(declaration => !declaration.getSourceFile().fileName.startsWith(this.srcDir));
    }

    /**
     * The program every entry point is read with, built once.
     * @returns The program.
     */
    private static resolveProgram(): ts.Program {
        this.program ??= ts.createProgram(['index.ts', 'internal.ts', TESTING_ENTRY_POINT].map(file => path.join(this.srcDir, file)), {
            experimentalDecorators: true,
            module: ts.ModuleKind.NodeNext,
            moduleResolution: ts.ModuleResolutionKind.NodeNext,
            target: ts.ScriptTarget.ES2022,
            skipLibCheck: true,
            noEmit: true
        });
        return this.program;
    }

    /**
     * The source file of a file under `src`.
     * @param file - The file, relative to `src`.
     * @returns The source file.
     * @throws When the program does not hold the file.
     */
    private static resolveSource(file: string): ts.SourceFile {
        const source: ts.SourceFile | undefined = this.resolveProgram().getSourceFile(path.join(this.srcDir, file));
        if (source == undefined) {
            throw new Error(`The compiler found no file at ${file}`);
        }
        return source;
    }

    /**
     * The module symbol of a file under `src`.
     * @param file - The file, relative to `src`.
     * @returns The module symbol.
     * @throws When the file is no module.
     */
    private static resolveModule(file: string): ts.Symbol {
        const module: ts.Symbol | undefined = this.resolveProgram()
            .getTypeChecker()
            .getSymbolAtLocation(this.resolveSource(file));
        if (module == undefined) {
            throw new Error(`The compiler found no module at ${file}`);
        }
        return module;
    }

    /**
     * An exported symbol, with the file declaring it.
     * @param checker - The type checker.
     * @param symbol - The exported symbol.
     * @param fallbackFile - The file to name when the symbol has no declaration.
     * @returns The exported name.
     */
    private static toExportedName(checker: ts.TypeChecker, symbol: ts.Symbol, fallbackFile: string): ExportedName {
        const declared: ts.Symbol = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
        const declaration: ts.Declaration | undefined = declared.declarations?.[0];
        const file: string = declaration == undefined
            ? fallbackFile
            : path.relative(this.srcDir, declaration.getSourceFile().fileName);
        return { name: symbol.name, file };
    }
}