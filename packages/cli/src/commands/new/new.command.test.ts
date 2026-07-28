import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { NewCommand } from './new.command';
import { version } from '../../../package.json';
import { testFileFolder } from '../../__testing__/constants';
import { mockExitGracefully, ProcessExitError } from '../../__testing__/mock-exit-gracefully.function';
import { CPUtilities, FsUtilities } from '../../encapsulation';
import { getPath, Path } from '../../utilities';

describe('NewCommand', () => {
    let workDir: Path;
    let execSpy: jest.SpiedFunction<typeof CPUtilities.exec>;

    beforeEach(async () => {
        workDir = getPath(testFileFolder, 'new-command');
        await FsUtilities.mkdir(workDir);
        CPUtilities['cwd'] = workDir;
        execSpy = jest.spyOn(CPUtilities, 'exec').mockResolvedValue(undefined);
    });

    afterEach(async () => {
        CPUtilities['cwd'] = undefined;
        jest.restoreAllMocks();
        await FsUtilities.rm(workDir);
    });

    it('scaffolds a new zibri application on disk', async () => {
        await new NewCommand().start(['n', 'api']);

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
        await new NewCommand().start(['n', 'api']);

        const appDir: Path = path.join(workDir, 'api') as Path;
        const packageJson: unknown = JSON.parse(await FsUtilities.readFile(path.join(appDir, 'package.json') as Path));
        expect(packageJson).toEqual({
            name: 'api',
            version: '1.0.0',
            main: './dist/index.js',
            scripts: {
                start: 'webpack --watch',
                build: 'webpack'
            }
        });
    });

    it('installs devDependencies and the real published zibri package, scoped to the new app directory', async () => {
        await new NewCommand().start(['n', 'api']);

        const appDir: Path = path.join(workDir, 'api') as Path;
        expect(execSpy).toHaveBeenNthCalledWith(1, expect.stringContaining(`cd ${appDir} && npm i -D `));
        expect(execSpy.mock.calls[0][0]).toContain('webpack');
        // zibri-tsx is intentionally absent: it is a peer dependency of zibri and must not be
        // installed into the app directly.
        expect(execSpy).toHaveBeenNthCalledWith(2, `cd ${appDir} && npm i zibri@${version} chart.js`);
    });

    it('refuses to overwrite an existing directory', async () => {
        await FsUtilities.mkdir(path.join(workDir, 'api') as Path);
        mockExitGracefully();

        await expect(new NewCommand().start(['n', 'api'])).rejects.toThrow(ProcessExitError);
    });
});