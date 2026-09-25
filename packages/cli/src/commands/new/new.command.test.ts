import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { NewCommand } from './new.command';
import { version } from '../../../package.json';
import { emptyWorkDirectory } from '../../__testing__/empty-work-directory.function';
import { mockExitGracefully, ProcessExitError } from '../../__testing__/mock-exit-gracefully.function';
import { quietly } from '../../__testing__/quietly.function';
import { CPUtilities, FsUtilities } from '../../encapsulation';
import { Path } from '../../utilities';

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
        await quietly(async () => new NewCommand().start(['n', 'api']));

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
        await quietly(async () => new NewCommand().start(['n', 'api']));

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
        await quietly(async () => new NewCommand().start(['n', 'api']));

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
            `cd ${appDir} && npm i zibri@${version} chart.js ts-node@^10.9.2 pg-query-stream@^4.10.3`
            + ' saxes@^6.0.0 otpauth@^9.5.1 @opentelemetry/api@^1.9.1'
            + ' @opentelemetry/sdk-trace-node@^2.11.0'
        );
    });

    it('refuses to overwrite an existing directory', async () => {
        await FsUtilities.mkdir(path.join(workDir, 'api') as Path);
        mockExitGracefully();

        await expect(quietly(async () => new NewCommand().start(['n', 'api']))).rejects.toThrow(ProcessExitError);
    });
});