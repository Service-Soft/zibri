import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { runInNewContext } from 'node:vm';

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import ts from 'typescript';

import { NewCommand } from './new.command';
import { version } from '../../../package.json';
import { emptyWorkDirectory } from '../../__testing__/empty-work-directory.function';
import { findWorkflowCommands } from '../../__testing__/find-workflow-commands.function';
import { EVERY_FEATURE, GENERATED_FILE_PATHS, NEEDS_A_REAL_INSTALL, NOT_IN_VERSION_CONTROL } from '../../__testing__/generated-file-paths';
import { mockExitGracefully, ProcessExitError } from '../../__testing__/mock-exit-gracefully.function';
import { quietly } from '../../__testing__/quietly.function';
import { CPUtilities, FsUtilities, InquirerUtilities } from '../../encapsulation';
import { SCAFFOLD_FEATURE_FILES,
    SCAFFOLD_FEATURE_REQUIREMENTS,
    SCAFFOLD_FEATURES,
    SCAFFOLD_MANIFEST_FILE,
    ScaffoldFeature,
    ScaffoldManifest,
    ScaffoldUtilities } from '../../scaffold';
import { Path } from '../../utilities';

/**
 * Every set of features a project can be generated with.
 * @returns Each set, leaving out those with a feature but not one it is built on.
 */
function resolveFeatureCombinations(): ScaffoldFeature[][] {
    return SCAFFOLD_FEATURES
        .reduce<ScaffoldFeature[][]>((sets, feature) => [...sets, ...sets.map(set => [...set, feature])], [[]])
        .filter(set => set.every(feature => SCAFFOLD_FEATURE_REQUIREMENTS[feature].every(required => set.includes(required))));
}

/**
 * The variables of a generated dotenv file, without its comments.
 * @param content - The file's contents.
 * @returns Each value, by its key.
 */
function parseDotenv(content: string): Record<string, string> {
    return Object.fromEntries(content.split('\n')
        .filter(line => /^[A-Z_]+=/.test(line))
        .map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
}

describe('NewCommand', () => {
    let workDir: Path;
    let execSpy: jest.SpiedFunction<typeof CPUtilities.exec>;

    beforeEach(async () => {
        workDir = await emptyWorkDirectory('new-command');
        CPUtilities['cwd'] = workDir;
        execSpy = jest.spyOn(CPUtilities, 'exec').mockResolvedValue(undefined);
    });

    afterEach(async () => {
        CPUtilities['cwd'] = undefined;
        jest.restoreAllMocks();
        await FsUtilities.rm(workDir);
    });

    it('scaffolds a new zibri application on disk', async () => {
        await quietly(async () => new NewCommand().start(['n', 'api', 'none', 'isLoggedIn', EVERY_FEATURE]));

        const appDir: Path = path.join(workDir, 'api') as Path;
        expect(await FsUtilities.exists(path.join(appDir, 'package.json') as Path)).toBe(true);
        expect(await FsUtilities.exists(path.join(appDir, 'tsconfig.json') as Path)).toBe(true);
        expect(await FsUtilities.exists(path.join(appDir, 'webpack.config.js') as Path)).toBe(true);
        expect(await FsUtilities.exists(path.join(appDir, 'postcss.config.js') as Path)).toBe(true);
        expect(await FsUtilities.exists(path.join(appDir, 'tailwind.config.js') as Path)).toBe(true);
        expect(await FsUtilities.exists(path.join(appDir, 'src', 'index.ts') as Path)).toBe(true);
        expect(await FsUtilities.exists(path.join(appDir, 'src', 'controllers', 'page.controller.ts') as Path)).toBe(true);
        expect(await FsUtilities.exists(path.join(appDir, 'src', 'models', 'user.model.ts') as Path)).toBe(true);
        expect(await FsUtilities.exists(path.join(appDir, 'assets') as Path)).toBe(true);
        expect(await FsUtilities.exists(path.join(appDir, 'src', 'templates') as Path)).toBe(true);
    });

    it('gives the user running the image only the paths the application writes', async () => {
        await quietly(async () => new NewCommand().start(['n', 'api', 'none', 'isLoggedIn', EVERY_FEATURE]));

        const dockerfile: string = await FsUtilities.readFile(path.join(workDir, 'api', 'Dockerfile') as Path);
        // the target of every line handing something to the run user. The bundle and its dependencies
        // stay the build's, so the process cannot change the code it runs. "versions" is only read in
        // production (03 §H14), so it stays the build's too
        const owned: string[] = dockerfile.split('\n')
            .filter(line => line.includes('chown'))
            .map(line => line.trim().split(/\s+/)
                .at(-1) ?? '');
        expect(owned).toStrictEqual(['/app/.zibri']);
    });

    it('writes a package.json with the app name, without going through "npm init"', async () => {
        await quietly(async () => new NewCommand().start(['n', 'api', 'none', 'isLoggedIn', EVERY_FEATURE]));

        const appDir: Path = path.join(workDir, 'api') as Path;
        const packageJson: unknown = JSON.parse(await FsUtilities.readFile(path.join(appDir, 'package.json') as Path));
        expect(packageJson).toEqual({
            name: 'api',
            version: '1.0.0',
            main: './dist/index.js',
            scripts: {
                start: 'webpack --watch',
                build: 'webpack',
                test: 'jest',
                // run by the build, which carries the migrations to revert: a deployment has no cli
                'migrate:list': 'node dist/index.js migrate list',
                'migrate:down': 'node dist/index.js migrate down'
            },
            keywords: ['zibri'],
            // the author is read off the machine this runs on, the way npm reads it, so the only
            // thing that can be asserted here is that it says something. An empty author is exactly
            // what a scaffold that skips this leaves behind for its author to find later.
            author: expect.stringMatching(/\S/),
            license: 'MIT',
            description: ''
        });
    });

    it('installs devDependencies and the real published zibri package, scoped to the new app directory', async () => {
        await quietly(async () => new NewCommand().start(['n', 'api', 'none', 'isLoggedIn', EVERY_FEATURE]));

        const appDir: Path = path.join(workDir, 'api') as Path;
        expect(execSpy).toHaveBeenNthCalledWith(1, expect.stringContaining(`cd "${appDir}" && npm i -D `));
        expect(execSpy.mock.calls[0][0]).toContain('webpack');
        // the build generates the entities by loading src/models/generated/providers.ts, which takes
        // ts-node. A project without it failed its first build wherever nothing else had hoisted it
        expect(execSpy.mock.calls[0][0]).toContain(' ts-node@^10.9.2');
        // zibri-tsx is intentionally absent: it is a peer dependency of zibri and must not be
        // installed into the app directly.
        // the peers the app has to ask for: every one is an *optional* peer of zibri, so npm installs
        // none of them, and every one is reached for by a project that takes the defaults. Its data
        // source refuses to start without the driver it opens a cursor through, its build extracts
        // translations into XLIFF, its default body parsers read
        // xml, and it is given the otp two factor method because it names none of its own. Two of those
        // were missing once: one made a new project's first build fail, the other its first boot.
        // The two OpenTelemetry packages are the same story - the tracer registered by default
        // records through them and asks for them by name while the application starts. Its exporter
        // package is deliberately not here: spans are kept in memory until a project says where to
        // send them, so a project that never says is a project that never needs it.
        expect(execSpy).toHaveBeenNthCalledWith(
            2,
            `cd "${appDir}" && npm i zibri@${version} pg-query-stream@^4.10.3`
            + ' saxes@^6.0.0 otpauth@^9.5.1 jose@^6.2.12 @opentelemetry/api@^1.9.1'
            + ' @opentelemetry/sdk-trace-node@^2.11.0 re2@^1.27.0 nodemailer@^10.1.0'
            + ' @prometheus-io/client@^0.16.1 @fastify/busboy@^3.2.3 systeminformation@^5.33.15 chart.js'
        );
    });

    // round-2 08 §X14: a JSON API behind a gateway has no pages, and paid for them in every project
    describe('without features', () => {
        let appDir: Path;

        beforeEach(async () => {
            await quietly(async () => new NewCommand().start(['n', 'api', 'none', 'isLoggedIn', 'none']));
            appDir = path.join(workDir, 'api') as Path;
        });

        it('writes a JSON API: no pages, no stylesheet, no examples and no mailing list', async () => {
            const absent: string[] = [
                'postcss.config.js',
                'tailwind.config.js',
                'assets/public/style.css',
                'src/tsx.d.ts',
                'src/controllers/page.controller.ts',
                'src/__testing__/home-page.test.ts',
                'src/templates/components',
                'src/templates/pages',
                'src/templates/emails/log.tsx',
                'src/templates/emails/mailing-list-subscribe-confirmation.tsx'
            ];
            const present: string[] = [
                'webpack.config.js',
                'src/__testing__/health.test.ts',
                'src/templates/emails/password-reset.tsx',
                'assets/public/open-api/swagger-ui-bundle.js'
            ];

            const exists: (relativePath: string) => Promise<boolean> = async relativePath => FsUtilities.exists(path.join(appDir, relativePath) as Path);
            expect(await Promise.all(absent.map(exists))).toEqual(absent.map(() => false));
            expect(await Promise.all(present.map(exists))).toEqual(present.map(() => true));
        });

        it('names only the controllers, plugins, providers and entities it wrote', async () => {
            const read: (relativePath: string) => Promise<string> = async relativePath => FsUtilities.readFile(path.join(appDir, relativePath) as Path);

            const options: string = await read('src/application-options.base.ts');
            expect(options).toContain('    plugins: [],');
            expect(options).toContain('    controllers: [HealthController, AppAuthController],');
            expect(await read('src/controllers/index.ts')).not.toContain('page.controller');
            const providers: string = await read('src/providers.ts');
            expect(providers).not.toContain('ErrorPage');
            expect(providers).not.toContain('MAILING_LIST');
            expect(await read('src/data-sources/db/entities.ts')).not.toContain('MailingList');
        });

        it('installs nothing that builds a stylesheet or draws a chart', () => {
            const installs: string = execSpy.mock.calls.map(([command]) => command).join(' ');

            for (const name of ['tailwindcss', 'postcss', 'autoprefixer', 'css-loader', 'mini-css-extract-plugin', 'chart.js']) {
                expect(installs).not.toContain(` ${name}`);
            }
            expect(installs).toContain(' webpack@');
        });

        it('records that it has no features', async () => {
            const manifest: ScaffoldManifest | undefined = await ScaffoldUtilities.findManifest(appDir);

            expect(manifest?.answers.features).toEqual([]);
        });
    });

    it('writes for each feature the files that feature names, and only with it', async () => {
        await quietly(async () => new NewCommand().start(['n', 'api', 'none', 'isLoggedIn', EVERY_FEATURE]));
        const everything: string[] = await FsUtilities.findFiles(path.join(workDir, 'api') as Path, [NOT_IN_VERSION_CONTROL]);

        // a path a feature names and no project has is a typo, and leaves the file it meant in every project
        const unmatched: string[] = SCAFFOLD_FEATURES.flatMap(feature => SCAFFOLD_FEATURE_FILES[feature]
            .filter(named => !everything.some(file => file === named || (named.endsWith('/') && file.startsWith(named))))
            .map(named => `${feature}: ${named}`));
        expect(unmatched).toEqual([]);

        await FsUtilities.rm(path.join(workDir, 'api') as Path);
        await quietly(async () => new NewCommand().start(['n', 'api', 'none', 'isLoggedIn', 'pages,logEmail']));
        const written: string[] = await FsUtilities.findFiles(path.join(workDir, 'api') as Path, [NOT_IN_VERSION_CONTROL]);
        expect(written.sort()).toEqual(everything.filter(file => ScaffoldUtilities.isWrittenFor(file, ['pages', 'logEmail'])).sort());
    });

    it('writes a project whose imports all resolve, whatever the features', async () => {
        const unresolved: string[] = [];
        for (const features of resolveFeatureCombinations()) {
            await FsUtilities.rm(path.join(workDir, 'api') as Path);
            await quietly(async () => new NewCommand().start(['n', 'api', 'none', 'isLoggedIn', features.length ? features.join(',') : 'none']));
            const appDir: Path = path.join(workDir, 'api') as Path;
            const files: string[] = await FsUtilities.findFiles(appDir, [NOT_IN_VERSION_CONTROL]);
            for (const file of files.filter(file => /\.tsx?$/.test(file))) {
                const content: string = await FsUtilities.readFile(path.join(appDir, file) as Path);
                for (const [, specifier] of content.matchAll(/(?:from|import) '(\.[^']*)'/g)) {
                    const base: string = path.posix.join(path.posix.dirname(file), specifier);
                    // package.json is the one file a project has that is not generated
                    if (![base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`].some(candidate => files.includes(candidate) || candidate === 'package.json')) {
                        unresolved.push(`${features.join(',') || 'none'}: ${file} imports ${specifier}`);
                    }
                }
            }
        }

        expect(unresolved).toEqual([]);
    });

    it('asks for the features, offering every one checked but the mailing list', async () => {
        const promptSpy: jest.SpiedFunction<typeof InquirerUtilities.prompt> = jest.spyOn(InquirerUtilities, 'prompt')
            .mockResolvedValue({ features: ['pages'] });

        await quietly(async () => new NewCommand().start(['n', 'api', 'none', 'isLoggedIn']));

        const [question]: unknown[] = Object.values(promptSpy.mock.calls[0]?.[0] ?? {});
        expect(question).toMatchObject({
            type: 'checkbox',
            choices: [
                { value: 'pages', checked: true },
                { value: 'mailingList', checked: false },
                { value: 'metricsDashboard', checked: true },
                { value: 'logEmail', checked: true }
            ]
        });
        expect((await ScaffoldUtilities.findManifest(path.join(workDir, 'api') as Path))?.answers.features).toEqual(['pages']);
    });

    it('refuses a feature it does not know, before writing anything', async () => {
        mockExitGracefully();

        await expect(quietly(async () => new NewCommand().start(['n', 'api', 'none', 'isLoggedIn', 'pages,blog'])))
            .rejects.toThrow(ProcessExitError);
        expect(await FsUtilities.exists(path.join(workDir, 'api') as Path)).toBe(false);
    });

    it('refuses a feature without the one it is built on, before writing anything', async () => {
        mockExitGracefully();

        await expect(quietly(async () => new NewCommand().start(['n', 'api', 'none', 'isLoggedIn', 'mailingList'])))
            .rejects.toThrow(ProcessExitError);
        expect(await FsUtilities.exists(path.join(workDir, 'api') as Path)).toBe(false);
    });

    // round-2 07 §T5: what the build, the tests and the compiler need from the framework is the
    // framework's to ship. Written into the project, a fix to any of it reached only the projects
    // generated after it, and an existing one learned of it by diffing a fresh scaffold by hand.
    it('takes its build from zibri, so upgrading the package upgrades the build', async () => {
        await quietly(async () => new NewCommand().start(['n', 'api', 'none', 'isLoggedIn', EVERY_FEATURE]));

        const appDir: Path = path.join(workDir, 'api') as Path;
        const config: string = await FsUtilities.readFile(path.join(appDir, 'webpack.config.js') as Path);
        // the file as webpack loads it, with the factory replaced by one that says what it was asked.
        // Anything else it requires is build knowledge of its own, which is what this is about
        const loaded: { exports: unknown } = { exports: undefined };
        runInNewContext(config, {
            module: loaded,
            __dirname: appDir,
            require: (name: string) => {
                if (name !== 'zibri/webpack') {
                    throw new Error(`webpack.config.js requires "${name}"`);
                }
                return { resolveWebpackConfiguration: (options: unknown) => ({ resolvedFor: options }) };
            }
        });

        expect(loaded.exports).toEqual({ resolvedFor: { root: appDir } });
    });

    it('takes its test configuration from zibri-testing', async () => {
        await quietly(async () => new NewCommand().start(['n', 'api', 'none', 'isLoggedIn', EVERY_FEATURE]));

        const source: string = await FsUtilities.readFile(path.join(workDir, 'api', 'jest.config.mjs') as Path);
        // an es module, which a script cannot evaluate - its import is handed in and its one export
        // handed out instead
        const exported: { config?: unknown } = {};
        const createJestConfig: (options: unknown) => unknown = options => ({ createdWith: options });
        runInNewContext(
            source
                .replace('import { createJestConfig } from \'zibri-testing/jest-config\';', '')
                .replace('export default ', 'exported.config = '),
            { exported, createJestConfig }
        );

        expect(exported.config).toEqual({ createdWith: { rootDir: 'src' } });
    });

    it('takes its compiler options from zibri, and keeps only where its own files are', async () => {
        await quietly(async () => new NewCommand().start(['n', 'api', 'none', 'isLoggedIn', EVERY_FEATURE]));

        const tsconfig: unknown = JSON.parse(await FsUtilities.readFile(path.join(workDir, 'api', 'tsconfig.json') as Path));

        // the paths stay, because an extended config resolves them against itself rather than the project
        expect(tsconfig).toEqual({
            extends: 'zibri/tsconfig.application.json',
            compilerOptions: { outDir: 'dist' },
            include: ['src']
        });
    });

    it('records what it generated, so "zi upgrade" can tell a file the project changed from one it did not', async () => {
        await quietly(async () => new NewCommand().start(['n', 'api', 'none', 'isLoggedIn', EVERY_FEATURE]));

        const appDir: Path = path.join(workDir, 'api') as Path;
        const manifest: ScaffoldManifest | undefined = await ScaffoldUtilities.findManifest(appDir);
        assert(manifest, `"zi new" wrote no ${SCAFFOLD_MANIFEST_FILE}`);
        expect(manifest.version).toBe(version);
        expect(manifest.answers).toEqual({ name: 'api', ci: 'none', defaultAuth: 'isLoggedIn', features: SCAFFOLD_FEATURES });

        // every file but the two the generator does not own alone: npm writes half of package.json,
        // and ".env" holds this project's secrets, which are never committed
        const recorded: string[] = Object.keys(manifest.files);
        expect([...recorded].sort()).toEqual(GENERATED_FILE_PATHS.filter(p => p !== NEEDS_A_REAL_INSTALL).sort());

        // the ids git stores those files under, so the version "zi new" wrote can be read back out of
        // the project's history as the base of a three-way merge
        const gitIds: string[] = execFileSync('git', ['hash-object', ...recorded], { cwd: appDir, encoding: 'utf8' })
            .trim()
            .split('\n');
        expect(recorded.map(p => manifest.files[p])).toEqual(gitIds);
    });

    it('writes a GitHub workflow that runs the project\'s own scripts on a checkout without ".env"', async () => {
        await quietly(async () => new NewCommand().start(['n', 'api', 'github', 'isLoggedIn', EVERY_FEATURE]));

        const appDir: Path = path.join(workDir, 'api') as Path;
        const workflow: string = await FsUtilities.readFile(path.join(appDir, '.github', 'workflows', 'ci.yml') as Path);
        const commands: string[] = findWorkflowCommands(workflow);
        const packageJson: unknown = JSON.parse(await FsUtilities.readFile(path.join(appDir, 'package.json') as Path));

        // the order a checkout needs: dependencies, the environment the tests read, then the scripts
        expect(commands[0]).toBe('npm ci');
        expect(commands.slice(2)).toStrictEqual(['npm run build', 'npm test']);
        expect(packageJson).toMatchObject({ scripts: { build: expect.any(String), test: expect.any(String) } });

        // every secret ".env" was generated with, and nothing else: a blank the loop misses stops the
        // tests at `requireEnv`, and a key it fills that is blank on purpose stops being optional. The
        // environment is blank in the example for a deployment to choose, and the tests run in development
        const example: Record<string, string> = parseDotenv(await FsUtilities.readFile(path.join(appDir, '.env.example') as Path));
        const actual: Record<string, string> = parseDotenv(await FsUtilities.readFile(path.join(appDir, '.env') as Path));
        const generatedSecrets: string[] = Object.keys(example)
            .filter(key => key !== 'ENVIRONMENT' && example[key] === '' && actual[key] !== '');
        const filled: string[] = /for key in (.+); do/.exec(commands[1] ?? '')?.[1]?.split(' ') ?? [];
        expect(commands[1]).toContain('cp .env.example .env');
        expect(filled.sort()).toStrictEqual(generatedSecrets.sort());
        expect(commands[1]).toContain('s/^ENVIRONMENT=$/ENVIRONMENT=development/');

        // tested on the runtime the image ships
        const dockerfile: string = await FsUtilities.readFile(path.join(appDir, 'Dockerfile') as Path);
        expect(/node-version: '(\d+)'/.exec(workflow)?.[1]).toBe(/FROM node:(\d+)/.exec(dockerfile)?.[1]);
    });

    // 08 §X25: in development every mail is logged, so a new project runs before it has a mail
    // server; a deployment names its environment rather than inheriting one that logs its mails
    it('runs in development where it was generated, and leaves a deployment to name its environment', async () => {
        await quietly(async () => new NewCommand().start(['n', 'api', 'none', 'isLoggedIn', EVERY_FEATURE]));

        const appDir: Path = path.join(workDir, 'api') as Path;
        const read: (relativePath: string) => Promise<string> = async relativePath => FsUtilities.readFile(path.join(appDir, relativePath) as Path);
        expect(parseDotenv(await read('.env.example'))['ENVIRONMENT']).toBe('');
        expect(parseDotenv(await read('.env'))['ENVIRONMENT']).toBe('development');
        expect(await read('src/application-options.base.ts')).toContain('    environment: requireOneOfEnv(\'ENVIRONMENT\', ZIBRI_ENVIRONMENTS),');
        const providers: string = await read('src/providers.ts');
        expect(providers).toContain('GlobalRegistry.getAppData(\'environment\') === \'development\'');
        expect(providers).toContain('new LoggingEmailTransport()');
    });

    // part of evaluation round 2, 03 §H16: the explorer follows defaultAuth, which for a project
    // requiring a login left it closed to the browser that opens it, in every environment
    it('opens the OpenAPI explorer to everyone, whatever defaultAuth and the environment are', async () => {
        await quietly(async () => new NewCommand().start(['n', 'api', 'none', 'isLoggedIn', EVERY_FEATURE]));

        const providers: string = await FsUtilities.readFile(path.join(workDir, 'api', 'src', 'providers.ts') as Path);
        expect(providers).toContain('        token: ZIBRI_DI_TOKENS.OPEN_API_AUTH,\n        useValue: { skip: true }');
    });

    it('reads a variable of a few values only when it holds one of them', async () => {
        await quietly(async () => new NewCommand().start(['n', 'api', 'none', 'isLoggedIn', EVERY_FEATURE]));

        const source: string = await FsUtilities.readFile(path.join(workDir, 'api', 'src', 'env.ts') as Path);
        const compiled: string = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
        const env: Record<string, string | undefined> = {};
        const exported: { requireOneOfEnv?: (key: string, values: readonly string[]) => string } = {};
        runInNewContext(compiled, {
            exports: exported,
            process: { env },
            require: (name: string) => name === 'node:fs' ? { existsSync: () => false } : {}
        });
        const requireOneOfEnv: (key: string, values: readonly string[]) => string = exported.requireOneOfEnv
            ?? ((): string => {
                throw new Error('env.ts exports no requireOneOfEnv');
            });

        env['ENVIRONMENT'] = 'production';
        expect(requireOneOfEnv('ENVIRONMENT', ['development', 'production'])).toBe('production');
        env['ENVIRONMENT'] = 'staging';
        expect(() => requireOneOfEnv('ENVIRONMENT', ['development', 'production'])).toThrow(/ENVIRONMENT.*development, production/);
        env['ENVIRONMENT'] = '';
        expect(() => requireOneOfEnv('ENVIRONMENT', ['development', 'production'])).toThrow(/ENVIRONMENT/);
    });

    // round 1, 07 Part 2 "Configuration schema": a port that is no number read as NaN and failed
    // where it was first used, and a url that is none was handed out in links
    it('reads a port only when it is one, and a url only when it is one', async () => {
        await quietly(async () => new NewCommand().start(['n', 'api', 'none', 'isLoggedIn', EVERY_FEATURE]));

        const source: string = await FsUtilities.readFile(path.join(workDir, 'api', 'src', 'env.ts') as Path);
        const compiled: string = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
        const env: Record<string, string | undefined> = {};
        const exported: { requirePortEnv?: (key: string) => number, requireUrlEnv?: (key: string) => string } = {};
        runInNewContext(compiled, {
            exports: exported,
            process: { env },
            // a global of node rather than of the language, so a context of its own has none
            URL,
            require: (name: string) => name === 'node:fs' ? { existsSync: () => false } : {}
        });
        const { requirePortEnv, requireUrlEnv } = exported;
        assert(requirePortEnv != undefined && requireUrlEnv != undefined, 'env.ts exports no requirePortEnv or requireUrlEnv');

        env['PORT'] = '3000';
        expect(requirePortEnv('PORT')).toBe(3000);
        for (const port of ['', 'abc', '0', '65536', '3000.5', '-1', ' 3000']) {
            env['PORT'] = port;
            expect(() => requirePortEnv('PORT')).toThrow(/PORT/);
        }
        env['BASE_URL'] = 'https://api.example.com';
        expect(requireUrlEnv('BASE_URL')).toBe('https://api.example.com');
        for (const url of ['', 'api.example.com', 'ftp://api.example.com', 'http//api.example.com']) {
            env['BASE_URL'] = url;
            expect(() => requireUrlEnv('BASE_URL')).toThrow(/BASE_URL/);
        }
    });

    it('checks every port and url it reads, and requires the mail server where mail is sent', async () => {
        await quietly(async () => new NewCommand().start(['n', 'api', 'none', 'isLoggedIn', EVERY_FEATURE]));

        const read: (relativePath: string) => Promise<string> = async relativePath => FsUtilities.readFile(path.join(workDir, 'api', relativePath) as Path);
        const sources: string = (await Promise.all([
            'src/index.ts',
            'src/application-options.base.ts',
            'src/providers.ts',
            'src/data-sources/db/db.data-source.ts'
        ].map(read))).join('\n');
        expect(sources).not.toMatch(/Number\(\w+Env\(/);
        for (const read of [
            'requirePortEnv(\'PORT\')',
            'requirePortEnv(\'DB_PORT\')',
            'requireUrlEnv(\'BASE_URL\')',
            'requireUrlEnv(\'CONFIRM_PASSWORD_RESET_URL\')',
            // .env.example says production does not start without one
            'requireEnv(\'SMTP_HOST\')',
            'requirePortEnv(\'SMTP_PORT\')'
        ]) {
            expect(sources).toContain(read);
        }
    });

    it('writes no workflow when the project is to have none', async () => {
        await quietly(async () => new NewCommand().start(['n', 'api', 'none', 'isLoggedIn', EVERY_FEATURE]));

        expect(await FsUtilities.exists(path.join(workDir, 'api', '.github') as Path)).toBe(false);
    });

    it('asks for the ci when the command line does not name one', async () => {
        const promptSpy: jest.SpiedFunction<typeof InquirerUtilities.prompt> = jest.spyOn(InquirerUtilities, 'prompt')
            .mockResolvedValueOnce({ ci: 'github' })
            .mockResolvedValueOnce({ defaultAuth: 'isLoggedIn' })
            .mockResolvedValueOnce({ features: [] });

        await quietly(async () => new NewCommand().start(['n', 'api']));

        // the name was given, so only the ci is asked for - and what follows it on the command line
        expect(promptSpy.mock.calls.map(([questions]) => Object.keys(questions))).toStrictEqual([['ci'], ['defaultAuth'], ['features']]);
        expect(await FsUtilities.exists(path.join(workDir, 'api', '.github', 'workflows', 'ci.yml') as Path)).toBe(true);
    });

    it('refuses a ci it does not know, before writing anything', async () => {
        mockExitGracefully();

        await expect(quietly(async () => new NewCommand().start(['n', 'api', 'elsewhere', 'isLoggedIn']))).rejects.toThrow(ProcessExitError);
        expect(await FsUtilities.exists(path.join(workDir, 'api') as Path)).toBe(false);
    });

    it('asks what an endpoint without @Auth requires, offering a login first, and answers nothing itself', async () => {
        const promptSpy: jest.SpiedFunction<typeof InquirerUtilities.prompt> = jest.spyOn(InquirerUtilities, 'prompt')
            .mockResolvedValueOnce({ defaultAuth: 'isLoggedIn' })
            .mockResolvedValueOnce({ features: [] });

        await quietly(async () => new NewCommand().start(['n', 'api', 'none']));

        const [question]: unknown[] = Object.values(promptSpy.mock.calls[0]?.[0] ?? {});
        expect(question).toMatchObject({ type: 'select', choices: [{ value: 'isLoggedIn' }, { value: 'public' }] });
        expect(question).not.toHaveProperty('default');
        const options: string = await FsUtilities.readFile(path.join(workDir, 'api', 'src', 'application-options.base.ts') as Path);
        expect(options).toContain('    defaultAuth: \'isLoggedIn\',');
    });

    it('writes the defaultAuth the command line names', async () => {
        await quietly(async () => new NewCommand().start(['n', 'api', 'none', 'public', EVERY_FEATURE]));

        const options: string = await FsUtilities.readFile(path.join(workDir, 'api', 'src', 'application-options.base.ts') as Path);
        expect(options).toContain('    defaultAuth: \'public\',');
    });

    it('keeps the pages it generates public, whichever defaultAuth was chosen', async () => {
        await quietly(async () => new NewCommand().start(['n', 'api', 'none', 'isLoggedIn', EVERY_FEATURE]));

        const pages: string = await FsUtilities.readFile(path.join(workDir, 'api', 'src', 'controllers', 'page.controller.ts') as Path);
        expect(pages).toMatch(/@Auth\.skip\({ allowRedundant: true }\)\n@Controller\('\/'/);
    });

    it('refuses a defaultAuth it does not know, before writing anything', async () => {
        mockExitGracefully();

        await expect(quietly(async () => new NewCommand().start(['n', 'api', 'none', 'open']))).rejects.toThrow(ProcessExitError);
        expect(await FsUtilities.exists(path.join(workDir, 'api') as Path)).toBe(false);
    });

    it('refuses to overwrite an existing directory', async () => {
        await FsUtilities.mkdir(path.join(workDir, 'api') as Path);
        mockExitGracefully();

        await expect(quietly(async () => new NewCommand().start(['n', 'api', 'none', 'isLoggedIn', EVERY_FEATURE]))).rejects.toThrow(ProcessExitError);
    });
});