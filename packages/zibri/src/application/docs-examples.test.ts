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
 * **A page is the unit, not a block.** Roughly three in five blocks are excerpts of what came
 * before them - a couple of lines of an options object, one decorated method, a provider added to a
 * list the page already showed - and they leave out the imports the page has already given. That is
 * how the pages are meant to be read, so it is how they are compiled: one module per page, blocks
 * in the order they appear, imports merged. What that still catches is everything about the code
 * itself, which is what rots.
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
    lineOrigins: number[]
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
 * @returns The module's lines, and the documentation line each of them came from.
 */
function assemblePage(content: string): { lines: string[], lineOrigins: number[] } {
    const importedFrom: Map<string, Set<string>> = new Map<string, Set<string>>();
    const body: string[] = [];
    const bodyOrigins: number[] = [];

    for (const block of blocksIn(content)) {
        for (const [offset, line] of block.code.entries()) {
            const match: RegExpExecArray | null = NAMED_IMPORT.exec(line.trim());
            const module: string | undefined = match?.[3];
            if (match != undefined && module != undefined) {
                const names: Set<string> = importedFrom.get(module) ?? new Set<string>();
                const named: string[] = (match[2] ?? '').split(',')
                    .map(entry => entry.trim())
                    .filter(entry => entry !== '');
                for (const name of named) {
                    names.add(name);
                }
                importedFrom.set(module, names);
                continue;
            }
            body.push(line);
            // +2: the fence line itself, and markdown lines counting from one
            bodyOrigins.push(block.line + offset + 1);
        }
    }

    const header: string[] = [...importedFrom.entries()]
        .map(([module, names]) => `import { ${[...names].join(', ')} } from '${module}';`);

    return {
        lines: [...header, ...body],
        // an import's own diagnostics belong to the page rather than to a line, since the statement
        // the compiler sees was assembled out of several
        lineOrigins: [...header.map(() => 0), ...bodyOrigins]
    };
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

describe('the examples in docs/', () => {

    beforeAll(() => {
        const root: string = path.join(__dirname, '__testing__', 'file-output');
        mkdirSync(root, { recursive: true });
        workDir = mkdtempSync(path.join(root, 'docs-examples-'));

        for (const name of readdirSync(DOCS_DIR).filter(entry => entry.endsWith('.md'))) {
            const assembled: { lines: string[], lineOrigins: number[] } = assemblePage(
                readFileSync(path.join(DOCS_DIR, name), 'utf8')
            );
            if (assembled.lines.length === 0) {
                continue;
            }
            // .tsx throughout: the templating pages hold jsx, and a page without any is unaffected
            const filePath: string = path.join(workDir, `${name.replace('.md', '')}.tsx`);
            writeFileSync(filePath, assembled.lines.join('\n'));
            pages.push({ documentation: name, filePath, lineOrigins: assembled.lineOrigins });
        }
    });

    afterAll(() => {
        rmSync(workDir, { recursive: true, force: true });
    });

    it('finds examples to check', () => {
        // a guard on the extraction rather than on the docs: a fence format this stops recognizing
        // would make the assertion below pass by having nothing left to say.
        expect(pages.length).toBeGreaterThan(20);
    });

    it('compiles, every page of them', () => {
        const program: ts.Program = ts.createProgram(pages.map(page => page.filePath), {
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