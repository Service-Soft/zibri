import assert from 'node:assert';
import { execFileSync, execSync } from 'node:child_process';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { UpgradeCommand } from './upgrade.command';
import { emptyWorkDirectory } from '../../__testing__/empty-work-directory.function';
import { EVERY_FEATURE } from '../../__testing__/generated-file-paths';
import { quietly } from '../../__testing__/quietly.function';
import { CPUtilities, FsUtilities, GitUtilities } from '../../encapsulation';
import { SCAFFOLD_MANIFEST_FILE, ScaffoldManifest, ScaffoldUtilities } from '../../scaffold';
import { Path } from '../../utilities';
import { NewCommand } from '../new/new.command';

// installs of a whole project, Tailwind's own tool, the installs of the upgrade and a build
const TEST_TIMEOUT_MS: number = 600_000;

/**
 * What 3.0 generated for Tailwind 3 where this release generates for Tailwind 4: each file, and what changes it back,
 * as `[what is generated now, what was generated then]`. These are what Tailwind's tool changes, the other way round.
 */
const TAILWIND_3_CHANGES: Record<string, [string, string][]> = {
    'postcss.config.js': [['\'@tailwindcss/postcss\': {},', 'tailwindcss: {},\n        autoprefixer: {}']],
    'src/templates/components/card.tsx': [['p-4 rounded-sm bg-dark-gray', 'p-4 rounded bg-dark-gray']],
    'src/templates/components/chart.tsx': [['className=\'text-xl!\'', 'className=\'!text-xl\'']],
    'src/templates/components/stat-card.tsx': [['className=\'text-xl!\'', 'className=\'!text-xl\'']],
    'src/templates/components/file-entry.tsx': [['p-3 rounded-sm leading-none', 'p-3 rounded leading-none']],
    'src/templates/components/textarea.tsx': [['border-none rounded-sm resize-none', 'border-none rounded resize-none']],
    'src/templates/pages/error.tsx': [
        ['\'pt-0! max-w-64\'', '\'!pt-0 max-w-64\''],
        ['\'text-center text-2xl!\'', '\'text-center !text-2xl\'']
    ],
    'src/templates/pages/mailing-list-preferences.tsx': [['mt-[-9px] m-[-15px]', '-mt-[9px] -m-[15px]']],
    'src/templates/pages/metrics/metrics-status.tsx': [['className=\'text-xl!\'', 'className=\'!text-xl\'']]
};

/**
 * The configuration of Tailwind 3 that 3.0 generated, whose theme this release generates into the stylesheet.
 */
const TAILWIND_3_CONFIG: string = [
    '/** @type {import(\'tailwindcss\').Config} */',
    'module.exports = {',
    '    content: [\'./src/templates/**/*.{tsx,hbs}\'],',
    '    theme: {',
    '        colors: {',
    '            primary: \'#0e456f\',',
    '            white: \'whitesmoke\',',
    '            secondary: \'#00b4d8\',',
    '            gray: \'#2a2a35\',',
    '            \'dark-gray\': \'#1a1a26\',',
    '            disabled: \'lightgrey\',',
    '            \'disabled-dark\': \'grey\'',
    '        },',
    '        boxShadow: {',
    '            elevation: \'0px 5px 5px -3px rgba(0,0,0,0.2), 0px 8px 10px 1px rgba(0,0,0,0.14), 0px 3px 14px 2px rgba(0,0,0,0.12)\'',
    '        }',
    '    },',
    '    plugins: []',
    '};',
    ''
].join('\n');

/**
 * Where the stylesheet of 3.0 started: the directives of Tailwind 3, where this release imports Tailwind 4 with its theme.
 */
const TAILWIND_3_DIRECTIVES: string = '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n\n';

/**
 * The files of swagger-ui 3.0 wrote, which this release generates an explorer of its own in place of. What they hold
 * does not decide the merge, only that the project left them as they were written.
 */
const SWAGGER_FILES: string[] = [
    'assets/public/open-api/custom.css',
    'assets/public/open-api/custom.js',
    'assets/public/open-api/swagger.png',
    'assets/public/open-api/swagger-ui-bundle.js',
    'assets/public/open-api/swagger-ui.css',
    'assets/public/open-api/swagger-ui-init.js',
    'assets/public/open-api/swagger-ui-standalone-preset.js'
];

/**
 * The files of the explorer this release generates, which 3.0 did not.
 */
const EXPLORER_FILES: string[] = [
    'assets/public/explorer.svg',
    'assets/public/lock.svg',
    'assets/public/lock-open.svg',
    'src/templates/explorer/explorer.tsx',
    'src/templates/explorer/explorer-async-api.tsx',
    'src/templates/explorer/explorer-authorize.tsx',
    'src/templates/explorer/explorer-bar.tsx',
    'src/templates/explorer/explorer-content.tsx',
    'src/templates/explorer/explorer-context.ts',
    'src/templates/explorer/explorer-lock.tsx',
    'src/templates/explorer/explorer-methods.ts',
    'src/templates/explorer/explorer-open-api.tsx',
    'src/templates/explorer/explorer-operation.tsx',
    'src/templates/explorer/explorer-schema.tsx',
    'src/templates/explorer/explorer-try-it-out.tsx'
];

/**
 * The files of the pages written in markdown this release generates, which 3.0 did not.
 */
const MARKDOWN_FILES: string[] = [
    'src/markdown.d.ts',
    'src/templates/components/blockquote.tsx',
    'src/templates/components/code-block.tsx',
    'src/templates/components/divider.tsx',
    'src/templates/components/emphasis.tsx',
    'src/templates/components/image.tsx',
    'src/templates/components/inline-code.tsx',
    'src/templates/components/list.tsx',
    'src/templates/components/list-item.tsx',
    'src/templates/components/markdown-components.ts',
    'src/templates/components/paragraph.tsx',
    'src/templates/components/strikethrough.tsx',
    'src/templates/components/strong.tsx',
    'src/templates/components/table.tsx',
    'src/templates/components/table-body.tsx',
    'src/templates/components/table-cell.tsx',
    'src/templates/components/table-head.tsx',
    'src/templates/components/table-row.tsx'
];

/**
 * The package that builds the pages written in markdown, which 3.0 did not install.
 */
const MARKDOWN_PACKAGE: string = 'zibri-mdx';

/**
 * What 3.0 generated of `src/providers.ts` where this release changed it, as `[now, then]`: the explorer it
 * provides, the components of the pages written in markdown, and the master key it decodes.
 */
const PROVIDER_CHANGES: [string, string][] = [
    ['import { ExplorerPage } from \'./templates/explorer/explorer\';\n', ''],
    ['    defineProvider({\n        token: ZIBRI_DI_TOKENS.OPEN_API_EXPLORER_TEMPLATE,\n        useFactory: () => ExplorerPage\n    }),\n', ''],
    ['import { markdownComponents } from \'./templates/components/markdown-components\';\n', ''],
    [
        '    defineProvider({\n'
        + '        // what the pages written in markdown render, see the templating docs\n'
        + '        token: ZIBRI_DI_TOKENS.MDX_COMPONENTS,\n'
        + '        useValue: markdownComponents\n'
        + '    }),\n',
        ''
    ],
    // 3.0 handed the master key over as the string it was read as, which aes-256-gcm cannot use
    ['value: Buffer.from(requireEnv(\'MASTER_KEY\'), \'base64url\')', 'value: requireEnv(\'MASTER_KEY\')']
];

/**
 * What 3.0 linked the explorer with on the home and the error page, as `[now, then]`.
 */
const EXPLORER_ICON_CHANGES: [string, string][] = [['/assets/explorer.svg', '/assets/open-api/swagger.png']];

/**
 * What 3.0 named the explorer on the home page, the error page and the navbar, as `[now, then]`.
 */
const EXPLORER_LABEL_CHANGES: [string, string][] = [['$ts`API Explorer`', '$ts`OpenAPI Explorer`']];

describe('UpgradeCommand (real npm install)', () => {
    let workDir: Path;
    let appDir: Path;

    function git(...args: string[]): string {
        return execFileSync('git', ['-c', 'user.name=zi', '-c', 'user.email=zi@example.com', ...args], { cwd: appDir, encoding: 'utf8' });
    }

    async function read(relativePath: string): Promise<string> {
        return await FsUtilities.readFile(path.join(appDir, relativePath) as Path);
    }

    /**
     * Makes a file of the project what an older generator wrote: its content, and its id in the manifest.
     * @param relativePath - The file, relative to the project.
     * @param content - What the older generator wrote.
     */
    async function writeAsGenerated(relativePath: string, content: string): Promise<void> {
        const manifest: ScaffoldManifest | undefined = await ScaffoldUtilities.findManifest(appDir);
        assert(manifest, `the project has no ${SCAFFOLD_MANIFEST_FILE}`);
        await FsUtilities.writeFileBuffer(path.join(appDir, relativePath) as Path, Buffer.from(content));
        await ScaffoldUtilities.writeManifest(appDir, {
            ...manifest,
            files: { ...manifest.files, [relativePath]: GitUtilities.resolveBlobHash(Buffer.from(content)) }
        });
    }

    beforeEach(async () => {
        // the machine's own git configuration stays out of it, as a conflict style set there changes what a merge writes
        process.env['GIT_CONFIG_GLOBAL'] = '/dev/null';
        process.env['GIT_CONFIG_NOSYSTEM'] = '1';
        // the generated project depends on the local workspace build of the framework
        process.env['ZIBRI_CLI_LOCAL_DEV'] = '1';
        workDir = await emptyWorkDirectory('upgrade-command-heavy');
        CPUtilities['cwd'] = workDir;
    });

    // the project is left where it is, and cleared by emptyWorkDirectory at the start of the next run, as the new
    // command's heavy suite does: removing it raced an install still writing into it after a timeout
    afterEach(() => {
        CPUtilities['cwd'] = undefined;
        delete process.env['GIT_CONFIG_GLOBAL'];
        delete process.env['GIT_CONFIG_NOSYSTEM'];
        delete process.env['ZIBRI_CLI_LOCAL_DEV'];
    });

    /**
     * Removes a file of the project, as an older generator did not write it.
     * @param relativePath - The file, relative to the project.
     */
    async function removeAsNotGenerated(relativePath: string): Promise<void> {
        const manifest: ScaffoldManifest | undefined = await ScaffoldUtilities.findManifest(appDir);
        assert(manifest, `the project has no ${SCAFFOLD_MANIFEST_FILE}`);
        await FsUtilities.rm(path.join(appDir, relativePath) as Path);
        const files: Record<string, string> = { ...manifest.files };
        // eslint-disable-next-line typescript/no-dynamic-delete
        delete files[relativePath];
        await ScaffoldUtilities.writeManifest(appDir, { ...manifest, files });
    }

    it('moves a project of 3.0 to Tailwind 4 with Tailwind\'s own tool and to the explorer of its own, and merges what this release generates without a conflict', async () => {
        await quietly(async () => new NewCommand().start(['n', 'api', 'none', 'isLoggedIn', EVERY_FEATURE]));
        appDir = path.join(workDir, 'api') as Path;
        CPUtilities['cwd'] = appDir;
        // what this release generates, and what changes it back to what 3.0 generated
        const olderChanges: Record<string, [string, string][]> = {
            ...TAILWIND_3_CHANGES,
            'src/providers.ts': PROVIDER_CHANGES,
            'src/templates/pages/home.tsx': [
                ...EXPLORER_ICON_CHANGES,
                ...EXPLORER_LABEL_CHANGES,
                ['The OpenAPI and AsyncAPI documentation of every version, to try each route out.', 'The official OpenAPI/Swagger documentation.']
            ],
            'src/templates/pages/error.tsx': [...TAILWIND_3_CHANGES['src/templates/pages/error.tsx'] ?? [], ...EXPLORER_ICON_CHANGES, ...EXPLORER_LABEL_CHANGES],
            'src/templates/components/navbar.tsx': EXPLORER_LABEL_CHANGES
        };
        const generated: Record<string, string> = Object.fromEntries(await Promise.all(
            [...Object.keys(olderChanges), ...EXPLORER_FILES, ...MARKDOWN_FILES, 'assets/public/style.css'].map(async file => [file, await read(file)] as const)
        ));
        git('init', '--quiet');
        git('add', '--all');
        git('commit', '--quiet', '--message', 'zi new');

        // the project as 3.0 generated it
        for (const [file, changes] of Object.entries(olderChanges)) {
            const older: string = changes.reduce((content, [now, then]) => content.replaceAll(now, then), generated[file]);
            expect(older).not.toBe(generated[file]);
            await writeAsGenerated(file, older);
        }
        const stylesheet: string = generated['assets/public/style.css'];
        await writeAsGenerated('assets/public/style.css', `${TAILWIND_3_DIRECTIVES}${stylesheet.slice(stylesheet.indexOf('html, body'))}`);
        await writeAsGenerated('tailwind.config.js', TAILWIND_3_CONFIG);
        for (const file of [...EXPLORER_FILES, ...MARKDOWN_FILES]) {
            await removeAsNotGenerated(file);
        }
        for (const file of SWAGGER_FILES) {
            await writeAsGenerated(file, `/* ${file} of swagger-ui */\n`);
        }
        execSync(`npm uninstall @tailwindcss/postcss ${MARKDOWN_PACKAGE} && npm i -D tailwindcss@3 autoprefixer@^10.4.27`, { cwd: appDir, stdio: 'ignore' });
        git('add', '--all');
        git('commit', '--quiet', '--message', 'zi new, of 3.0');

        await quietly(async () => new UpgradeCommand().start(['u']));

        for (const [file, content] of Object.entries(generated)) {
            expect({ file, content: await read(file) }).toEqual({ file, content });
        }
        expect(await FsUtilities.exists(path.join(appDir, 'tailwind.config.js') as Path)).toBe(false);
        for (const file of SWAGGER_FILES) {
            expect({ file, exists: await FsUtilities.exists(path.join(appDir, file) as Path) }).toEqual({ file, exists: false });
        }
        expect(git('status', '--porcelain', '--untracked-files=all')).not.toContain('.zibri-upgrade');
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const packageJson: { devDependencies: Record<string, string> } = JSON.parse(await read('package.json'));
        expect(packageJson.devDependencies['tailwindcss']).toMatch(/^\^4\./);
        expect(packageJson.devDependencies['autoprefixer']).toBeUndefined();
        expect(packageJson.devDependencies[MARKDOWN_PACKAGE]).toBeDefined();
        execSync('npm run build', { cwd: appDir, stdio: 'ignore' });
    }, TEST_TIMEOUT_MS);
});