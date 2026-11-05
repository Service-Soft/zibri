import { Dirent, readdirSync } from 'node:fs';
import path from 'node:path';

import { SCAFFOLD_FEATURES } from '../scaffold';
import { Path } from '../utilities';

/**
 * Every feature, as the command line names them: what `GENERATED_FILE_PATHS` is generated with.
 */
export const EVERY_FEATURE: string = SCAFFOLD_FEATURES.join(',');

/**
 * The root of this package, which is what the generator's own assets are found relative to.
 *
 * Shared by both parity suites, which cover the same tree at different costs: the fast one runs the
 * generator with "npm install" stubbed out, the heavy one runs it for real.
 */
export const CLI_ROOT: string = path.join(__dirname, '..', '..');

/**
 * The reference copy of a generated app, which both parity suites compare against.
 */
export const SANDBOX_DIR: Path = path.join(CLI_ROOT, '..', 'sandbox') as Path;

// eslint-disable-next-line jsdoc/require-jsdoc
function listCopiedTemplateFiles(sourceDir: string, destinationPrefix: string): string[] {
    const entries: Dirent[] = readdirSync(sourceDir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
        const sourcePath: string = path.join(sourceDir, entry.name);
        const destName: string = entry.name.split('.tpl')[0];
        const destinationPath: string = path.posix.join(destinationPrefix, destName);
        if (entry.isDirectory()) {
            files.push(...listCopiedTemplateFiles(sourcePath, destinationPath));
            continue;
        }
        files.push(destinationPath);
    }
    return files;
}

/**
 * Every file "zi new" renders from a template of `project`, as a project without a workflow of its
 * own has them: the sandbox lives inside this repository, whose own workflows are the ones GitHub runs.
 */
const RENDERED_FILES: string[] = listCopiedTemplateFiles(path.join(CLI_ROOT, 'project'), '')
    .filter(filePath => !filePath.startsWith('.github/'));

/**
 * Every file "zi new" writes with every feature that another copy of it can be compared against.
 *
 * All of them but `NOT_IN_VERSION_CONTROL`, which by construction has nothing to compare to.
 */
export const GENERATED_FILE_PATHS: string[] = [
    ...RENDERED_FILES,
    ...listCopiedTemplateFiles(path.join(CLI_ROOT, 'assets'), 'assets'),
    ...listCopiedTemplateFiles(path.join(CLI_ROOT, 'templates'), 'src/templates')
];

/**
 * Every file the generator renders, rather than copying.
 *
 * The distinction is what a syntax check is worth on each: the templates and assets are copied byte
 * for byte out of this package, where the repository's own build already compiles them, while these
 * are templates whose `.tpl` keeps that build away from them, and whose sections only a rendering
 * puts together. Nothing reads them as code before a consumer runs `npm run build`.
 */
export const AUTHORED_CODE_PATHS: string[] = RENDERED_FILES
    .filter(filePath => /\.(?:ts|tsx|js|mjs)$/.test(filePath));

/**
 * The one file "zi new" writes that no comparison can judge.
 *
 * It holds the secrets a project runs on, generated fresh for every project, so two of them never
 * agree - and it is git ignored, which means `packages/sandbox` has none to compare against either.
 * What is asserted about it instead is that it answers every variable `.env.example` declares.
 */
export const NOT_IN_VERSION_CONTROL: string = '.env';

/**
 * The one file only the heavy suite can judge.
 *
 * Half of a generated package.json is written by "npm install" rather than by the generator, so
 * with the install stubbed out there are no dependencies in it at all - which is a difference from
 * the sandbox that says nothing about whether the generator and the sandbox agree.
 */
export const NEEDS_A_REAL_INSTALL: string = 'package.json';