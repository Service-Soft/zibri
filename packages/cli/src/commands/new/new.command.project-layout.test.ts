import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';

import { NewCommand } from './new.command';
import { emptyWorkDirectory } from '../../__testing__/empty-work-directory.function';
import { CLI_ROOT, EVERY_FEATURE } from '../../__testing__/generated-file-paths';
import { quietly } from '../../__testing__/quietly.function';
import { CPUtilities, FsUtilities } from '../../encapsulation';
import { SCAFFOLD_FEATURE_REQUIREMENTS, SCAFFOLD_FEATURES } from '../../scaffold';
import { Path } from '../../utilities';

/**
 * The page that goes through what "zi new" writes. A reader takes it as the list of every file, and
 * its features table as the list of what a project can be generated with or without.
 */
const PAGE: string = readFileSync(path.join(CLI_ROOT, '..', 'zibri', 'docs', 'application', 'project-layout.md'), 'utf8');

/**
 * The rows of the tables of one section of the page.
 * @param heading - The heading of the section, without its "## ".
 * @returns The cells of each row, the header and the separator left out.
 */
function findRows(heading: string): string[][] {
    const section: string = PAGE.split('\n## ').find(part => part.startsWith(`${heading}\n`)) ?? '';
    return section.split('\n')
        .filter(line => line.startsWith('| ') && !line.startsWith('| Feature |') && !line.startsWith('| File |'))
        .map(line => line.split('|').slice(1, -1)
            .map(cell => cell.trim()));
}

/**
 * Every path the file tables of the page name, from their first column.
 * @returns The paths, a folder ending in "/".
 */
function findTablePaths(): string[] {
    return PAGE.split('\n')
        .filter(line => line.startsWith('| `'))
        .flatMap(line => [...(line.split('|')[1] ?? '').matchAll(/`([^`]+)`/g)].map(match => match[1]))
        .filter(named => !SCAFFOLD_FEATURES.some(feature => feature === named));
}

/**
 * Whether a path the page names is the file, or a folder holding it.
 * @param named - The path as the page names it.
 * @param file - A file of the generated project.
 * @returns Whether the page means that file.
 */
function isNamedBy(named: string, file: string): boolean {
    return named === file || (named.endsWith('/') && file.startsWith(named));
}

describe('NewCommand, as the page on the generated project describes it', () => {
    let workDir: Path;
    let files: string[];

    beforeAll(async () => {
        workDir = await emptyWorkDirectory('new-command-project-layout');
        CPUtilities['cwd'] = workDir;
        jest.spyOn(CPUtilities, 'exec').mockResolvedValue(undefined);
        // with the workflow and every feature, so that every file the generator can write is there to be named
        await quietly(async () => new NewCommand().start(['n', 'api', 'github', 'isLoggedIn', EVERY_FEATURE]));
        const appDir: Path = path.join(workDir, 'api') as Path;
        files = readdirSync(appDir, { recursive: true, withFileTypes: true })
            .filter(entry => entry.isFile())
            .map(entry => path.relative(appDir, path.join(entry.parentPath, entry.name)).split(path.sep)
                .join('/'));
    });

    afterAll(async () => {
        CPUtilities['cwd'] = undefined;
        jest.restoreAllMocks();
        await FsUtilities.rm(workDir);
    });

    it('names every file it writes', () => {
        const named: string[] = findTablePaths();

        expect(files.filter(file => !named.some(path => isNamedBy(path, file)))).toEqual([]);
    });

    it('names only files it writes', () => {
        const named: string[] = findTablePaths();

        expect(named.filter(path => !files.some(file => isNamedBy(path, file)))).toEqual([]);
    });

    it('lists every feature, with the features it needs', () => {
        const listed: [string, string[]][] = findRows('Choosing the features').map(([feature = '', , needs = '']) => [
            feature.replaceAll('`', ''),
            [...needs.matchAll(/`([^`]+)`/g)].map(match => match[1])
        ]);

        expect(listed).toEqual(SCAFFOLD_FEATURES.map(feature => [feature, SCAFFOLD_FEATURE_REQUIREMENTS[feature]]));
    });
});