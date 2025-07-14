import { readFile, writeFile, stat } from 'fs/promises';
import { dirname, basename, join } from 'path';

import { sync as globSync } from 'glob';
import { parse } from 'handlebars';

import { pathExists } from '../utilities';
import { AstProgram } from './ast.model';
import { resolveAllArrayKeys } from './resolve-all-array-keys.function';
import { resolveTree } from './resolve-tree.function';

// eslint-disable-next-line jsdoc/require-jsdoc
export type PathTree = {
    [key: string]: PathTree
};

// // eslint-disable-next-line jsdoc/require-jsdoc
// type BaseEmailTemplateTree = Record<keyof BaseEmailTemplateData['base'], PathTree>;

// // eslint-disable-next-line jsdoc/require-jsdoc
// type BasePageTemplateTree = Record<keyof BasePageTemplateData['base'], PathTree>;

// const baseEmailTemplateTree: BaseEmailTemplateTree = {
//     title: {},
//     baseUrl: {},
//     mailingListRoute: {},
//     mailingList: {
//         id: {},
//         name: {},
//         unsubscribeLink: {}
//     },
//     subscriber: {
//         id: {},
//         name: {},
//         email: {}
//     }
// };
// const basePageTemplateTree: BasePageTemplateTree = { title: {} };

/**
 * Generate type files for handlebar files (.hbs), so that they expose a correctly typed "renderTemplate" function.
 */
export async function generateHandlebarTypeFiles(): Promise<void> {
    const templateFiles: string[] = globSync('src/templates/**/*.hbs');

    for (const file of templateFiles) {
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

// eslint-disable-next-line jsdoc/require-jsdoc
export async function generateHandlebarType(ast: AstProgram, file: string): Promise<string[]> {
    const arrayKeys: string[] = [...new Set(resolveAllArrayKeys(ast, undefined))];
    const tree: PathTree = resolveTree(ast, arrayKeys);
    const arrayKeysWithoutThis: string[] = arrayKeys.map(k => k.replaceAll('this.', ''));
    return await generateTypeFile(tree, arrayKeysWithoutThis, file);
}

// eslint-disable-next-line jsdoc/require-jsdoc
async function generateTypeFile(tree: PathTree, arrayKeys: string[], file: string): Promise<string[]> {
    const content: string = [
        '// auto-generated — do not edit',
        `import raw from './${basename(file)}';`,
        '',
        'interface Context {',
        ...generateInterfaceLines(tree, arrayKeys),
        '}',
        '',
        'const renderTemplate: (ctx: Context) => string = raw;',
        'export default renderTemplate;'
    ]
        .join('\n')
        .replace('mailingListData:', 'mailingListData?:');

    const outFile: string = join(dirname(file), `${basename(file)}.ts`);
    await writeFile(outFile, content, 'utf8');

    return content.split('\n');
}

// eslint-disable-next-line jsdoc/require-jsdoc
function generateInterfaceLines(
    tree: PathTree,
    arrayKeys: string[],
    indent = '    ',
    currentPath = ''
): string[] {
    const lines: string[] = [];
    const keys: string[] = Object.keys(tree);

    for (let i: number = 0; i < keys.length; i++) {
        const key: string = keys[i];
        const isLast: boolean = i === keys.length - 1;
        const subtree: PathTree = tree[key];
        const fullPath: string = currentPath ? `${currentPath}.${key}` : key;

        const suffix: string = arrayKeys.includes(fullPath) ? '[]' : '';
        const comma: string = isLast ? '' : ','; // no comma for last

        const childKeys: string[] = Object.keys(subtree);

        if (childKeys.length === 0) {
            lines.push(`${indent}${key}: string${suffix}${comma}`);
        }
        else {
            lines.push(`${indent}${key}: {`);
            lines.push(...generateInterfaceLines(subtree, arrayKeys, indent + '    ', fullPath));
            lines.push(`${indent}}${suffix}${comma}`);
        }
    }

    return lines;
}

// eslint-disable-next-line jsdoc/require-jsdoc
async function canBeSkipped(hbsFile: string): Promise<boolean> {
    const tsFile: string = `${hbsFile}.ts`;

    if (!await pathExists(tsFile)) {
        return false;
    }

    const [hbsStats, tsStats] = await Promise.all([stat(hbsFile), stat(tsFile)]);
    return tsStats.mtimeMs >= hbsStats.mtimeMs;
}