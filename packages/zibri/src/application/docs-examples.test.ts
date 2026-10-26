import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import ts from 'typescript';

/**
 * Whether every example in `docs/` is code a reader can actually use.
 *
 * Documentation examples are the one kind of code in a repository that nothing ever runs, so they
 * rot silently: the framework moves, the snippet stays, and the first person to find out is whoever
 * copied it. `docs/events.md` carried an example that produced TS2322 on its first line for long
 * enough to be written up as a finding rather than fixed, and `docs/caching.md` an import with no
 * `from` in it - see [07](../../../evaluation/07-documentation-vs-code.md).
 *
 * **A page is the unit the compiler sees, a block is the unit for imports.** Many blocks build on
 * what came before them - an entity declared above, a provider added to a list the page already
 * showed - so a page compiles as one module, blocks in the order they appear, imports merged. But a
 * reader copies a block, not a page: each block imports exactly the names it uses. Checked per
 * block, because the merge alone lets a block that forgot an import pass on another block's.
 */

const DOCS_DIR: string = path.join(__dirname, '..', '..', 'docs');

const COMPILED_LANGUAGES: string[] = ['ts', 'tsx', 'typescript'];

/**
 * A single line named import, which is the form every page uses.
 *
 * Anything else - a default import, one broken across lines, one missing its `from` - is left where
 * it stands, so that a page writing something unusual is checked rather than quietly rewritten.
 */
const NAMED_IMPORT: RegExp = /^import\s+(type\s+)?{([^}]*)}\s+from\s+'([^']+)';$/;

/**
 * One page, assembled into something a compiler can read.
 */
type CompiledPage = {
    /**
     * The page's file name, for reporting.
     */
    documentation: string,
    /**
     * The path the assembled module was written to.
     */
    filePath: string,
    /**
     * The documentation line each emitted line came from, so a diagnostic points into the page.
     */
    lineOrigins: number[],
    /**
     * The index into `blocks` of the block each emitted line came from, -1 for the merged imports.
     */
    lineBlocks: number[],
    /**
     * The page's blocks, with what each of them imports itself.
     */
    blocks: ImportingBlock[],
    /**
     * The names the page declares at the top level without exporting them.
     */
    unexported: Set<string>
};

/**
 * One block of a page, by what it imports.
 */
type ImportingBlock = {
    /**
     * The documentation line the block opens on.
     */
    line: number,
    /**
     * The file the block's first-line comment names, if it names one.
     */
    file: string | undefined,
    /**
     * The local names the block's own import lines bring in.
     */
    imported: Set<string>
};

/**
 * What the code of each block of a page refers to, by block index.
 */
type BlockReferences = {
    /**
     * The names that resolve to the page's merged imports, which the block has to import itself.
     */
    imports: Map<number, Set<string>>,
    /**
     * Every name that resolves to an import or to something the page declares at the top level,
     * which is what makes a name the block imports used.
     */
    referenced: Map<number, Set<string>>,
    /**
     * The names that come from another block's file, by an import the other block holds or a
     * declaration in a block naming a different file.
     */
    fromOtherFiles: { block: number, name: string }[]
};

/**
 * One page, assembled into a module.
 */
type AssembledPage = {
    /**
     * The module's lines: the merged imports, then every block's code.
     */
    lines: string[],
    /**
     * The documentation line each of the lines came from.
     */
    lineOrigins: number[],
    /**
     * The index into `blocks` of the block each of the lines came from, -1 for the merged imports.
     */
    lineBlocks: number[],
    /**
     * The page's blocks, with what each of them imports itself.
     */
    blocks: ImportingBlock[],
    /**
     * The names the page declares at the top level without exporting them.
     */
    unexported: Set<string>
};

/**
 * Reads every compiled fenced block out of one page, with the line each one opens on.
 * @param content - The page's content.
 * @returns The code of each block and where it starts, in the order they appear.
 */
function blocksIn(content: string): { line: number, code: string[] }[] {
    const blocks: { line: number, code: string[] }[] = [];
    const lines: string[] = content.split('\n');

    let openedAt: number | undefined = undefined;
    let language: string = '';
    let code: string[] = [];

    for (const [index, line] of lines.entries()) {
        if (openedAt == undefined) {
            const opening: RegExpExecArray | null = /^```([a-z]*)$/.exec(line);
            if (opening) {
                openedAt = index + 1;
                language = opening[1] ?? '';
                code = [];
            }
            continue;
        }
        if (line === '```') {
            if (COMPILED_LANGUAGES.includes(language)) {
                blocks.push({ line: openedAt, code });
            }
            openedAt = undefined;
            continue;
        }
        code.push(line);
    }

    return blocks;
}

/**
 * Assembles one page into a module: its imports merged at the top, then its blocks in order.
 *
 * Merging rather than repeating, because the same name imported by two blocks of one page would
 * otherwise collide with itself - which says nothing about whether either block is right.
 * @param content - The page's content.
 * @returns The module's lines, where each of them came from, and what each block imports itself.
 */
// eslint-disable-next-line sonar/cognitive-complexity
function assemblePage(content: string): AssembledPage {
    const importedFrom: Map<string, Set<string>> = new Map<string, Set<string>>();
    // a reader's file is imported by a path relative to the block's own file, so `src/index.ts` and a
    // controller name the same `User` as './models' and '../models'. Neither resolves here, and the
    // second import would only collide with the first.
    const importedFromReaderFiles: Set<string> = new Set<string>();
    const body: string[] = [];
    const bodyOrigins: number[] = [];
    const bodyBlocks: number[] = [];
    const blocks: ImportingBlock[] = [];

    for (const [blockIndex, block] of blocksIn(content).entries()) {
        const imported: Set<string> = new Set<string>();
        // `// src/providers.ts - one more entry`, `// src/login.ts, in the browser`
        const file: string | undefined = /^\/\/\s+(\S+?\.tsx?)(?=[\s,]|$)/.exec(block.code[0] ?? '')?.[1];
        blocks.push({ line: block.line, file, imported });
        for (const [offset, line] of block.code.entries()) {
            const match: RegExpExecArray | null = NAMED_IMPORT.exec(line.trim());
            const module: string | undefined = match?.[3];
            if (match != undefined && module != undefined) {
                const names: Set<string> = importedFrom.get(module) ?? new Set<string>();
                const named: string[] = (match[2] ?? '').split(',')
                    .map(entry => entry.trim())
                    .filter(entry => entry !== '');
                for (const name of named) {
                    const local: string = getLocalName(name);
                    imported.add(local);
                    if (module.startsWith('.')) {
                        if (importedFromReaderFiles.has(local)) {
                            continue;
                        }
                        importedFromReaderFiles.add(local);
                    }
                    names.add(name);
                }
                importedFrom.set(module, names);
                continue;
            }
            body.push(line);
            // +2: the fence line itself, and markdown lines counting from one
            bodyOrigins.push(block.line + offset + 1);
            bodyBlocks.push(blockIndex);
        }
    }

    // a reader's file the page itself shows, such as a service imported by the controller block
    // below it, is that block's declaration here rather than an import
    const declared: Map<string, boolean> = findTopLevelNames(body);
    const header: string[] = [...importedFrom.entries()]
        .map(([module, names]) => ({
            module,
            names: [...names].filter(name => !module.startsWith('.') || !declared.has(getLocalName(name)))
        }))
        .filter(({ names }) => names.length > 0)
        .map(({ module, names }) => `import { ${names.join(', ')} } from '${module}';`);

    return {
        lines: [...header, ...body],
        // an import's own diagnostics belong to the page rather than to a line, since the statement
        // the compiler sees was assembled out of several
        lineOrigins: [...header.map(() => 0), ...bodyOrigins],
        lineBlocks: [...header.map(() => -1), ...bodyBlocks],
        blocks,
        unexported: new Set([...declared.entries()].filter(([, exported]) => !exported).map(([name]) => name))
    };
}

/**
 * Gets the name an entry of an import's braces brings into scope.
 * @param entry - The entry, such as `Controller`, `type Ms` or `workerData as nodeWorkerData`.
 * @returns Its last word.
 */
function getLocalName(entry: string): string {
    return entry.split(/\s+/).at(-1) ?? entry;
}

/**
 * Finds the names the code of a page declares at the top level.
 * @param body - The page's code, without the import lines the assembly merges.
 * @returns The names of its classes, functions, types, enums and variables, each with whether it is
 * exported.
 */
function findTopLevelNames(body: string[]): Map<string, boolean> {
    const names: Map<string, boolean> = new Map<string, boolean>();
    const sourceFile: ts.SourceFile = ts.createSourceFile('page.tsx', body.join('\n'), ts.ScriptTarget.ES2022, false, ts.ScriptKind.TSX);
    for (const statement of sourceFile.statements) {
        const exported: boolean = ts.canHaveModifiers(statement)
            && (ts.getModifiers(statement) ?? []).some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);
        if (ts.isVariableStatement(statement)) {
            for (const declaration of statement.declarationList.declarations) {
                if (ts.isIdentifier(declaration.name)) {
                    names.set(declaration.name.text, exported);
                }
            }
            continue;
        }
        if ((ts.isClassDeclaration(statement) || ts.isFunctionDeclaration(statement) || ts.isInterfaceDeclaration(statement)
            || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name != undefined) {
            names.set(statement.name.text, exported);
        }
    }
    return names;
}

/**
 * Resolves what the code of each block of a page refers to.
 *
 * A name counts when the compiler resolves it to an import or a top-level declaration of the page,
 * so a property that happens to share an export's name does not.
 * @param page - The page.
 * @param sourceFile - The module the page was assembled into.
 * @param checker - The checker of the program holding it.
 * @returns The names each block refers to, and the ones it takes from another block's file.
 */
function resolveBlockReferences(page: CompiledPage, sourceFile: ts.SourceFile, checker: ts.TypeChecker): BlockReferences {
    const references: BlockReferences = { imports: new Map(), referenced: new Map(), fromOtherFiles: [] };

    // eslint-disable-next-line typescript/typedef
    const blockOf = (node: ts.Node): number => {
        const line: number = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line;
        return page.lineBlocks[line] ?? -1;
    };
    // eslint-disable-next-line typescript/typedef
    const add = (map: Map<number, Set<string>>, block: number, name: string): void => {
        map.set(block, (map.get(block) ?? new Set<string>()).add(name));
    };

    // eslint-disable-next-line typescript/typedef, sonar/cognitive-complexity
    const visit = (node: ts.Node): void => {
        if (ts.isImportDeclaration(node)) {
            return;
        }
        if (ts.isIdentifier(node)) {
            const symbol: ts.Symbol | undefined = ts.isShorthandPropertyAssignment(node.parent) && node.parent.name === node
                ? checker.getShorthandAssignmentValueSymbol(node.parent)
                : checker.getSymbolAtLocation(node);
            const declaration: ts.Declaration | undefined = symbol?.declarations?.[0];
            if (symbol != undefined && declaration?.getSourceFile() === sourceFile) {
                const block: number = blockOf(node);
                const declaredIn: number = blockOf(declaration);
                const isImport: boolean = ts.isImportSpecifier(declaration) || ts.isImportClause(declaration)
                    || ts.isNamespaceImport(declaration);
                const isTopLevel: boolean = ts.isSourceFile(declaration.parent)
                    || (ts.isVariableDeclaration(declaration) && ts.isSourceFile(declaration.parent.parent.parent));
                if (isImport && declaredIn === -1) {
                    add(references.imports, block, symbol.name);
                    add(references.referenced, block, symbol.name);
                }
                else if (isImport && declaredIn !== block) {
                    // an import the assembly left in place, such as a default import, held by another block
                    references.fromOtherFiles.push({ block, name: symbol.name });
                }
                else if (isTopLevel && declaredIn !== block) {
                    add(references.referenced, block, symbol.name);
                    const usingFile: string | undefined = page.blocks[block]?.file;
                    const declaringFile: string | undefined = page.blocks[declaredIn]?.file;
                    // a block without a path comment may well continue the file above it, so only
                    // two blocks that both say which file they are can be told apart
                    if (usingFile != undefined && declaringFile != undefined && usingFile !== declaringFile) {
                        references.fromOtherFiles.push({ block, name: symbol.name });
                    }
                }
            }
        }
        ts.forEachChild(node, visit);
    };
    ts.forEachChild(sourceFile, visit);

    return references;
}

/**
 * Whether a diagnostic is about one of the reader's own files rather than about the example.
 *
 * A page importing `../models` is telling the reader where the class they wrote goes. There is no
 * such file here and there is not meant to be, so the unresolved import is context rather than a
 * finding - the names it brings in stay usable and everything done with them is still checked.
 * @param diagnostic - The diagnostic to judge.
 * @returns Whether to leave it out of the report.
 */
function isAboutTheReadersOwnFiles(diagnostic: ts.Diagnostic): boolean {
    if (diagnostic.code !== 2307) {
        return false;
    }
    const message: string = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
    // `?client` too: that suffix is how a template says a package has to reach the browser, and what
    // declares it is the `tsx.d.ts` `zi new` writes into the reader's own project.
    return message.includes('\'.') || message.includes('\'..') || message.includes('?client\'');
}

const pages: CompiledPage[] = [];

let workDir: string;

let program: ts.Program;

describe('the examples in docs/', () => {

    beforeAll(() => {
        const root: string = path.join(__dirname, '__testing__', 'file-output');
        mkdirSync(root, { recursive: true });
        workDir = mkdtempSync(path.join(root, 'docs-examples-'));

        for (const name of readdirSync(DOCS_DIR).filter(entry => entry.endsWith('.md'))) {
            const assembled: AssembledPage = assemblePage(readFileSync(path.join(DOCS_DIR, name), 'utf8'));
            if (assembled.lines.length === 0) {
                continue;
            }
            // .tsx throughout: the templating pages hold jsx, and a page without any is unaffected
            const filePath: string = path.join(workDir, `${name.replace('.md', '')}.tsx`);
            writeFileSync(filePath, assembled.lines.join('\n'));
            pages.push({
                documentation: name,
                filePath,
                lineOrigins: assembled.lineOrigins,
                lineBlocks: assembled.lineBlocks,
                blocks: assembled.blocks,
                unexported: assembled.unexported
            });
        }

        program = ts.createProgram(pages.map(page => page.filePath), {
            // what `zi new` scaffolds, because that is the project a reader pastes into
            strict: true,
            experimentalDecorators: true,
            emitDecoratorMetadata: true,
            esModuleInterop: true,
            module: ts.ModuleKind.NodeNext,
            moduleResolution: ts.ModuleResolutionKind.NodeNext,
            target: ts.ScriptTarget.ES2022,
            jsx: ts.JsxEmit.ReactJSX,
            jsxImportSource: 'zibri-tsx',
            resolveJsonModule: true,
            skipLibCheck: true,
            noEmit: true,
            baseUrl: __dirname,
            paths: {
                zibri: [path.join(__dirname, '..', 'index.ts')],
                // source rather than the built package, so that a page describing today's harness
                // is not judged against whenever `zibri-testing` was last built
                'zibri-testing': [path.join(__dirname, '..', '..', '..', 'testing', 'src', 'index.ts')],
                'zibri-tsx': [path.join(__dirname, '..', '..', '..', 'tsx', 'src', 'index.ts')],
                'zibri-tsx/jsx-runtime': [path.join(__dirname, '..', '..', '..', 'tsx', 'src', 'jsx-runtime.ts')]
            }
        });
    }, 120_000);

    afterAll(() => {
        rmSync(workDir, { recursive: true, force: true });
    });

    it('finds examples to check', () => {
        // a guard on the extraction rather than on the docs: a fence format this stops recognizing
        // would make the assertions below pass by having nothing left to say.
        expect(pages.length).toBeGreaterThan(20);
    });

    // eslint-disable-next-line sonar/cognitive-complexity
    it('imports in every block exactly what that block uses', () => {
        const checker: ts.TypeChecker = program.getTypeChecker();

        const failures: string[] = [];
        for (const page of pages) {
            const sourceFile: ts.SourceFile | undefined = program.getSourceFile(page.filePath);
            if (sourceFile == undefined) {
                continue;
            }
            const references: BlockReferences = resolveBlockReferences(page, sourceFile, checker);
            for (const [index, block] of page.blocks.entries()) {
                for (const name of references.imports.get(index) ?? []) {
                    if (!block.imported.has(name)) {
                        failures.push(`docs/${page.documentation}:${block.line} - uses ${name} without importing it`);
                    }
                }
                const referenced: Set<string> = references.referenced.get(index) ?? new Set<string>();
                for (const name of block.imported) {
                    if (!referenced.has(name)) {
                        failures.push(`docs/${page.documentation}:${block.line} - imports ${name} without using it`);
                    }
                    // the relative import is left out of the compiled module, so nothing else sees this
                    if (page.unexported.has(name)) {
                        failures.push(`docs/${page.documentation}:${block.line} - imports ${name}, which the page declares without exporting it`);
                    }
                }
            }
            for (const { block, name } of references.fromOtherFiles) {
                if (page.blocks[block]?.imported.has(name) !== true) {
                    const line: number = page.blocks[block]?.line ?? 0;
                    failures.push(`docs/${page.documentation}:${line} - uses ${name} without importing it`);
                }
            }
        }

        expect([...new Set(failures)]).toEqual([]);
    }, 120_000);

    it('compiles, every page of them', () => {
        const byPath: Map<string, CompiledPage> = new Map(pages.map(page => [page.filePath, page]));

        const failures: string[] = [];
        for (const diagnostic of [...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics()]) {
            const file: ts.SourceFile | undefined = diagnostic.file;
            const page: CompiledPage | undefined = file == undefined ? undefined : byPath.get(file.fileName);
            if (file == undefined || page == undefined || isAboutTheReadersOwnFiles(diagnostic)) {
                // a diagnostic about the framework's own source rather than about an example. The
                // framework is type checked by its own build; this run is about the docs.
                continue;
            }
            const emitted: number = diagnostic.start == undefined
                ? 0
                : file.getLineAndCharacterOfPosition(diagnostic.start).line;
            const line: number = page.lineOrigins[emitted] ?? 0;
            const message: string = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
            failures.push(`docs/${page.documentation}:${line} - TS${diagnostic.code}: ${message}`);
        }

        expect(failures).toEqual([]);
    }, 120_000);
});