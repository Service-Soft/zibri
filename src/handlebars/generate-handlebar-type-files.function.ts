import { AstProgram } from './ast.model';
import { HandlebarUtilities } from './handlebar.utilities';
import { resolveAllArrayKeys } from './resolve-all-array-keys.function';
import { resolveTree } from './resolve-tree.function';
import { FsUtilities, Path } from '../utilities/fs.utilities';
import { ObjectUtilities } from '../utilities/object.utilities';

// eslint-disable-next-line jsdoc/require-jsdoc
export type PathTree = {
    [key: string]: PathTree
};

/**
 * Generate type files for handlebar files (.hbs), so that they expose a correctly typed "renderTemplate" function.
 */
export async function generateHandlebarTypeFiles(): Promise<void> {
    const templateFiles: Path[] = await FsUtilities.glob('src/templates/**/*.hbs');

    for (const file of templateFiles) {
        if (await canBeSkipped(file)) {
            continue;
        }

        try {
            const src: string = await FsUtilities.readFile(file);
            const ast: AstProgram = HandlebarUtilities.parse(src, { srcName: file });
            await generateHandlebarType(ast, file);
        }
        catch (error) {
            // eslint-disable-next-line no-console
            console.error(`Error processing ${file}:`, error);
        }
    }
}

// eslint-disable-next-line jsdoc/require-jsdoc
export async function generateHandlebarType(ast: AstProgram, file: Path): Promise<string[]> {
    const arrayKeys: string[] = [...new Set(resolveAllArrayKeys(ast, undefined))];
    const tree: PathTree = resolveTree(ast, arrayKeys);
    const arrayKeysWithoutThis: string[] = arrayKeys.map(k => k.replaceAll('this.', ''));
    return await generateTypeFile(tree, arrayKeysWithoutThis, file);
}

// eslint-disable-next-line jsdoc/require-jsdoc
async function generateTypeFile(tree: PathTree, arrayKeys: string[], file: Path): Promise<string[]> {
    const typeLines: string[] = generateInterfaceLines(tree, arrayKeys);
    const type: string[] = typeLines.length
        ? [
            'type Context = {',
            ...typeLines,
            '};'
        ]
        : ['type Context = Record<string, never>;'];

    const content: string = [
        '// auto-generated — do not edit',
        `import raw from './${FsUtilities.baseName(file)}';`,
        '',
        ...type,
        '',
        'const renderTemplate: (ctx: Context) => string = raw;',
        'export default renderTemplate;'
    ]
        .join('\n')
        .replace('mailingListData:', 'mailingListData?:');

    const outFile: Path = FsUtilities.getPath(FsUtilities.dirName(file), `${FsUtilities.baseName(file)}.ts`);
    await FsUtilities.upsertFile(outFile, content);

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
    const keys: string[] = ObjectUtilities.keys(tree);

    for (let i: number = 0; i < keys.length; i++) {
        const key: string = keys[i];
        const isLast: boolean = i === keys.length - 1;
        const subtree: PathTree = tree[key];
        const fullPath: string = currentPath ? `${currentPath}.${key}` : key;

        const suffix: string = arrayKeys.includes(fullPath) ? '[]' : '';
        const comma: string = isLast ? '' : ','; // no comma for last

        const childKeys: string[] = ObjectUtilities.keys(subtree);

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
async function canBeSkipped(hbsFile: Path): Promise<boolean> {
    const tsFile: Path = FsUtilities.getPath(`${hbsFile}.ts`);

    if (!await FsUtilities.exists(tsFile)) {
        return false;
    }

    const [hbsStats, tsStats] = await Promise.all([FsUtilities.stat(hbsFile), FsUtilities.stat(tsFile)]);
    return tsStats.mtimeMs >= hbsStats.mtimeMs;
}