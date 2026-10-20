import path from 'node:path';
import { runInNewContext } from 'node:vm';

import { afterEach, beforeEach, describe, expect, it, vi, MockInstance } from 'vitest';

import { NewCommand } from './new.command.ts';
import packageJson from '../../../package.json' with { type: 'json' };
import { emptyWorkDirectory } from '../../__testing__/empty-work-directory.function.ts';
import { findWorkflowCommands } from '../../__testing__/find-workflow-commands.function.ts';
import { mockExitGracefully, ProcessExitError } from '../../__testing__/mock-exit-gracefully.function.ts';
import { quietly } from '../../__testing__/quietly.function.ts';
import { CPUtilities, FsUtilities, InquirerUtilities } from '../../encapsulation/index.ts';
import { Path } from '../../utilities/index.ts';

/**
 * A process the generated watch mode started, as a fake `spawn` records it.
 */
type StartedProcess = {
    /**
     * The command and its arguments.
     */
    args: string[],
    /**
     * Whether it was stopped since.
     */
    killed: boolean
};

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
    let execSpy: MockInstance<typeof CPUtilities.exec>;

    beforeEach(async () => {
        workDir = await emptyWorkDirectory('new-command');
        CPUtilities['cwd'] = workDir;
        execSpy = vi.spyOn(CPUtilities, 'exec').mockResolvedValue(undefined);
    });

    afterEach(async () => {
        CPUtilities['cwd'] = undefined;
        vi.restoreAllMocks();
        await FsUtilities.rm(workDir);
    });

    it('scaffolds a new zibri application on disk', async () => {
        await quietly(async () => new NewCommand().start(['n', 'api', 'none', 'requireLogin']));

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

    it('writes a package.json with the app name, without going through "npm init"', async () => {
        await quietly(async () => new NewCommand().start(['n', 'api', 'none', 'requireLogin']));

        const appDir: Path = path.join(workDir, 'api') as Path;
        const packageJson: unknown = JSON.parse(await FsUtilities.readFile(path.join(appDir, 'package.json') as Path));
        expect(packageJson).toEqual({
            name: 'api',
            version: '1.0.0',
            main: './dist/index.js',
            scripts: {
                start: 'webpack --watch',
                build: 'webpack',
                test: 'jest'
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
        await quietly(async () => new NewCommand().start(['n', 'api', 'none', 'requireLogin']));

        const appDir: Path = path.join(workDir, 'api') as Path;
        expect(execSpy).toHaveBeenNthCalledWith(1, expect.stringContaining(`cd ${appDir} && npm i -D `));
        expect(execSpy.mock.calls[0][0]).toContain('webpack');
        // zibri-tsx is intentionally absent: it is a peer dependency of zibri and must not be
        // installed into the app directly.
        // the peers the app has to ask for: every one is an *optional* peer of zibri, so npm installs
        // none of them, and every one is reached for by a project that takes the defaults. It runs
        // TypeScript worker files, its data source refuses to start without the driver it opens a
        // cursor through, its build extracts translations into XLIFF, its default body parsers read
        // xml, and it is given the otp two factor method because it names none of its own. Two of those
        // were missing once: one made a new project's first build fail, the other its first boot.
        // The two OpenTelemetry packages are the same story - the tracer registered by default
        // records through them and asks for them by name while the application starts. Its exporter
        // package is deliberately not here: spans are kept in memory until a project says where to
        // send them, so a project that never says is a project that never needs it.
        expect(execSpy).toHaveBeenNthCalledWith(
            2,
            `cd ${appDir} && npm i zibri@${packageJson.version} chart.js ts-node@^10.9.2 pg-query-stream@^4.10.3`
            + ' saxes@^6.0.0 otpauth@^9.5.1 jose@^6.2.12 @opentelemetry/api@^1.9.1'
            + ' @opentelemetry/sdk-trace-node@^2.11.0 re2@^1.27.0 nodemailer@^10.1.0'
            + ' prom-client@^15.1.3 @fastify/busboy@^3.2.3 systeminformation@^5.33.15'
        );
    });

    it('restarts the server in watch mode as a new process, never in the old one', async () => {
        await quietly(async () => new NewCommand().start(['n', 'api', 'none', 'requireLogin']));

        const config: string = await FsUtilities.readFile(path.join(workDir, 'api', 'webpack.config.js') as Path);
        const pluginSource: string | undefined = /^class OnBuildSuccessPlugin {[\S\s]*?^}$/m.exec(config)?.[0];
        expect(pluginSource).toBeDefined();
        // the plugin as the project runs it, with the process it starts and the compiler it hooks
        // into replaced by ones that record what happens. The compiler finishes two builds in a row
        const started: StartedProcess[] = [];
        runInNewContext(`${pluginSource}\nnew OnBuildSuccessPlugin().apply(compiler);`, {
            spawn: (command: string, args: string[]) => {
                const child: StartedProcess = { args: [command, ...args], killed: false };
                started.push(child);
                return { kill: () => child.killed = true };
            },
            compiler: {
                watchMode: true,
                hooks: {
                    done: {
                        tap: (_: string, onDone: (stats: { hasErrors: () => boolean }) => void) => {
                            onDone({ hasErrors: () => false });
                            onDone({ hasErrors: () => false });
                        }
                    }
                }
            }
        });

        // what makes a restart start from empty registries: the rebuilt bundle is imported by a process
        // of its own, and the one holding the previous generation is stopped, so nothing is ever
        // imported a second time into the arrays a first import filled
        expect(started.map(s => s.args)).toEqual([
            ['node', '--enable-source-maps', 'dist/bundle.js'],
            ['node', '--enable-source-maps', 'dist/bundle.js']
        ]);
        expect(started.map(s => s.killed)).toEqual([true, false]);
    });

    it('writes a GitHub workflow that runs the project\'s own scripts on a checkout without ".env"', async () => {
        await quietly(async () => new NewCommand().start(['n', 'api', 'github', 'requireLogin']));

        const appDir: Path = path.join(workDir, 'api') as Path;
        const workflow: string = await FsUtilities.readFile(path.join(appDir, '.github', 'workflows', 'ci.yml') as Path);
        const commands: string[] = findWorkflowCommands(workflow);
        const packageJson: unknown = JSON.parse(await FsUtilities.readFile(path.join(appDir, 'package.json') as Path));

        // the order a checkout needs: dependencies, the environment the tests read, then the scripts
        expect(commands[0]).toBe('npm ci');
        expect(commands.slice(2)).toStrictEqual(['npm run build', 'npm test']);
        expect(packageJson).toMatchObject({ scripts: { build: expect.any(String), test: expect.any(String) } });

        // every secret ".env" was generated with, and nothing else: a blank the loop misses stops the
        // tests at `requireEnv`, and a key it fills that is blank on purpose stops being optional
        const example: Record<string, string> = parseDotenv(await FsUtilities.readFile(path.join(appDir, '.env.example') as Path));
        const actual: Record<string, string> = parseDotenv(await FsUtilities.readFile(path.join(appDir, '.env') as Path));
        const generatedSecrets: string[] = Object.keys(example).filter(key => example[key] === '' && actual[key] !== '');
        const filled: string[] = /for key in (.+); do/.exec(commands[1] ?? '')?.[1]?.split(' ') ?? [];
        expect(commands[1]).toContain('cp .env.example .env');
        expect(filled.sort()).toStrictEqual(generatedSecrets.sort());

        // tested on the runtime the image ships
        const dockerfile: string = await FsUtilities.readFile(path.join(appDir, 'Dockerfile') as Path);
        expect(/node-version: '(\d+)'/.exec(workflow)?.[1]).toBe(/FROM node:(\d+)/.exec(dockerfile)?.[1]);
    });

    it('writes no workflow when the project is to have none', async () => {
        await quietly(async () => new NewCommand().start(['n', 'api', 'none', 'requireLogin']));

        expect(await FsUtilities.exists(path.join(workDir, 'api', '.github') as Path)).toBe(false);
    });

    it('asks for the ci when the command line does not name one', async () => {
        const promptSpy: MockInstance<typeof InquirerUtilities.prompt> = vi.spyOn(InquirerUtilities, 'prompt')
            .mockResolvedValueOnce({ ci: 'github' })
            .mockResolvedValueOnce({ defaultAuth: 'requireLogin' });

        await quietly(async () => new NewCommand().start(['n', 'api']));

        // the name was given, so only the ci is asked for - and what follows it on the command line
        expect(promptSpy.mock.calls.map(([questions]) => Object.keys(questions))).toStrictEqual([['ci'], ['defaultAuth']]);
        expect(await FsUtilities.exists(path.join(workDir, 'api', '.github', 'workflows', 'ci.yml') as Path)).toBe(true);
    });

    it('refuses a ci it does not know, before writing anything', async () => {
        mockExitGracefully();

        await expect(quietly(async () => new NewCommand().start(['n', 'api', 'elsewhere', 'requireLogin']))).rejects.toThrow(ProcessExitError);
        expect(await FsUtilities.exists(path.join(workDir, 'api') as Path)).toBe(false);
    });

    it('asks what an endpoint without @Auth requires, offering a login first, and answers nothing itself', async () => {
        const promptSpy: MockInstance<typeof InquirerUtilities.prompt> = vi.spyOn(InquirerUtilities, 'prompt')
            .mockResolvedValue({ defaultAuth: 'requireLogin' });

        await quietly(async () => new NewCommand().start(['n', 'api', 'none']));

        const [question]: unknown[] = Object.values(promptSpy.mock.calls[0]?.[0] ?? {});
        expect(question).toMatchObject({ type: 'select', choices: [{ value: 'requireLogin' }, { value: 'public' }] });
        expect(question).not.toHaveProperty('default');
        const options: string = await FsUtilities.readFile(path.join(workDir, 'api', 'src', 'application-options.base.ts') as Path);
        expect(options).toContain('    defaultAuth: \'requireLogin\',');
    });

    it('writes the defaultAuth the command line names', async () => {
        await quietly(async () => new NewCommand().start(['n', 'api', 'none', 'public']));

        const options: string = await FsUtilities.readFile(path.join(workDir, 'api', 'src', 'application-options.base.ts') as Path);
        expect(options).toContain('    defaultAuth: \'public\',');
    });

    it('keeps the pages it generates public, whichever defaultAuth was chosen', async () => {
        await quietly(async () => new NewCommand().start(['n', 'api', 'none', 'requireLogin']));

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

        await expect(quietly(async () => new NewCommand().start(['n', 'api', 'none', 'requireLogin']))).rejects.toThrow(ProcessExitError);
    });
});