import { readFile, writeFile, stat } from 'fs/promises';
import { dirname, basename, join } from 'path';

import { sync as globSync } from 'glob';
import { parse } from 'handlebars';

import { pathExists } from '../utilities';
import { AstProgram } from './ast.model';
import { resolveAllArrayKeys } from './resolve-all-array-keys.function';
import { resolveTree } from './resolve-tree.function';

export type PathTree = {
    [key: string]: PathTree
};

export async function generateHandlebarTypes(): Promise<void> {
    const files: string[] = globSync('src/**/*.hbs');

    for (const file of files) {
        if (await canBeSkipped(file)) {
            continue;
        }

        try {
            const src: string = await readFile(file, 'utf8');
            const ast: AstProgram = parse(src, { srcName: file }) as AstProgram;
            await generateHandlebarType(ast, file);
        }
        catch (error) {
            // eslint-disable-next-line no-console
            console.error(`Error processing ${file}:`, error);
        }
    }
}

export async function generateHandlebarType(ast: AstProgram, file: string): Promise<string[]> {
    const arrayKeys: string[] = [...new Set(resolveAllArrayKeys(ast, undefined))];
    const tree: PathTree = resolveTree(ast, arrayKeys);
    const arrayKeysWithoutThis: string[] = arrayKeys.map(k => k.replaceAll('this.', ''));
    return await generateTypeFile(tree, arrayKeysWithoutThis, file);
}

async function generateTypeFile(tree: PathTree, arrayKeys: string[], file: string): Promise<string[]> {
    const lines: string[] = [
        '// auto-generated — do not edit',
        `import raw from './${basename(file)}';`,
        '',
        'interface Context {',
        ...generateInterfaceLines(tree, arrayKeys),
        '}',
        '',
        'const renderTemplate: (ctx: Context) => string = raw;',
        'export default renderTemplate;'
    ];

    const outFile: string = join(dirname(file), `${basename(file)}.ts`);
    await writeFile(outFile, lines.join('\n'), 'utf8');

    return lines;
}

function generateInterfaceLines(
    tree: PathTree,
    arrayKeys: string[],
    indent = '    ',
    currentPath = ''
): string[] {
    const lines: string[] = [];

    for (const key of Object.keys(tree)) {
        const subtree: PathTree = tree[key];
        const fullPath: string = currentPath ? `${currentPath}.${key}` : key;
        const isArray: boolean = arrayKeys.includes(fullPath);
        const childKeys: string[] = Object.keys(subtree);

        if (childKeys.length === 0) {
            lines.push(`${indent}${key}: ${isArray ? 'string[]' : 'string'},`);
        }
        else {
            const suffix: string = isArray ? '[]' : '';
            lines.push(`${indent}${key}: {`);
            lines.push(...generateInterfaceLines(subtree, arrayKeys, indent + '    ', fullPath));
            lines.push(`${indent}}${suffix},`);
        }
    }

    return lines;
}

async function canBeSkipped(hbsFile: string): Promise<boolean> {
    const tsFile: string = `${hbsFile}.ts`;

    if (!await pathExists(tsFile)) {
        return false;
    }

    const [hbsStats, tsStats] = await Promise.all([stat(hbsFile), stat(tsFile)]);
    return tsStats.mtimeMs >= hbsStats.mtimeMs;
}