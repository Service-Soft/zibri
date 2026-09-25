import { Dirent, readdirSync } from 'node:fs';
import path from 'node:path';

import { Path } from '../utilities';

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

const EXPLICITLY_CREATED_FILES: string[] = [
    'package.json',
    'tsconfig.json',
    '.gitignore',
    '.dockerignore',
    'Dockerfile',
    '.env.example',
    // git records files rather than folders, so without these the first commit of a generated
    // project drops both directories and the clone after it neither builds nor starts
    'versions/.gitkeep',
    'translations/.gitkeep',
    'postcss.config.js',
    'tailwind.config.js',
    'webpack.config.js',
    'jest.config.mjs',
    'src/tsx.d.ts',
    'src/env.ts',
    'src/index.ts',
    'src/application-options.base.ts',
    'src/application-options.ts',
    'src/__testing__/test-application-options.ts',
    'src/__testing__/home-page.test.ts',
    'src/providers.ts',
    'src/create-default-data.function.ts',
    'src/data-sources/db/db.data-source.ts',
    'src/data-sources/db/entities.ts',
    'src/data-sources/db/migrations/index.ts',
    'src/data-sources/db/index.ts',
    'src/data-sources/index.ts',
    'src/repositories/index.ts',
    'src/repositories/user.repository.ts',
    'src/controllers/health.controller.ts',
    'src/controllers/page.controller.ts',
    'src/controllers/index.ts',
    'src/models/index.ts',
    'src/models/generated/providers.ts',
    'src/models/roles.enum.ts',
    'src/models/user.model.ts',
    'src/cron/index.ts',
    'src/services/index.ts'
];

// eslint-disable-next-line jsdoc/require-jsdoc
function listCopiedTemplateFiles(sourceDir: string, destinationPrefix: string): string[] {
    const entries: Dirent[] = readdirSync(sourceDir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
        const sourcePath: string = path.join(sourceDir, entry.name);
        const destName: string = entry.name.split('.tpl')[0];
        const destinationPath: string = `${destinationPrefix}/${destName}`;
        if (entry.isDirectory()) {
            files.push(...listCopiedTemplateFiles(sourcePath, destinationPath));
            continue;
        }
        files.push(destinationPath);
    }
    return files;
}

/**
 * Every file "zi new" writes that another copy of it can be compared against.
 *
 * All of them but `NOT_IN_VERSION_CONTROL`, which by construction has nothing to compare to.
 */
export const GENERATED_FILE_PATHS: string[] = [
    ...EXPLICITLY_CREATED_FILES,
    ...listCopiedTemplateFiles(path.join(CLI_ROOT, 'assets'), 'assets'),
    ...listCopiedTemplateFiles(path.join(CLI_ROOT, 'templates'), 'src/templates')
];

/**
 * Every file the generator assembles line by line, rather than copying.
 *
 * The distinction is what a syntax check is worth on each: the templates and assets are copied byte
 * for byte out of this package, where the repository's own build already compiles them, while these
 * exist only as string arrays in the command until a project is generated. Nothing reads them as
 * code before a consumer runs `npm run build`.
 */
export const AUTHORED_CODE_PATHS: string[] = EXPLICITLY_CREATED_FILES
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