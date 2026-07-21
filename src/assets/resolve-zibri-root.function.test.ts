
import os from 'node:os';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

import { resolveZibriRoot } from './resolve-zibri-root.function';
import { testFileFolder } from '../__testing__/constants';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';
import { JsonUtilities } from '../utilities/json.utilities';

describe('resolveZibriRoot', () => {
    const workDir: FsPath = FsUtilities.getPath(testFileFolder, 'resolve-zibri-root');
    let originalCwd: FsPath;

    beforeAll(async () => {
        await FsUtilities.mkdir(workDir);
    });

    afterAll(async () => {
        await FsUtilities.rm(workDir);
    });

    beforeEach(() => {
        originalCwd = process.cwd() as FsPath;
    });

    afterEach(() => {
        process.chdir(originalCwd);
    });

    it('resolves the package root via node_modules/zibri when running inside a nested project', async () => {
        const projectDir: FsPath = FsUtilities.getPath(workDir, 'node-modules-project');
        const zibriDir: FsPath = FsUtilities.getPath(projectDir, 'node_modules', 'zibri');
        const cwdDir: FsPath = FsUtilities.getPath(projectDir, 'src', 'nested', 'deep');
        await FsUtilities.createFile(FsUtilities.getPath(projectDir, 'package.json'), JsonUtilities.stringify({ name: 'consuming-app' }));
        await FsUtilities.createFile(FsUtilities.getPath(zibriDir, 'package.json'), JsonUtilities.stringify({ name: 'zibri', version: '1.0.0' }));
        await FsUtilities.mkdir(cwdDir);

        process.chdir(cwdDir);

        expect(resolveZibriRoot()).toBe(zibriDir);
    });

    it('resolves the package root by walking up to a package.json named "zibri"', async () => {
        const projectDir: FsPath = FsUtilities.getPath(workDir, 'direct-project');
        const cwdDir: FsPath = FsUtilities.getPath(projectDir, 'apps', 'web');
        await FsUtilities.createFile(FsUtilities.getPath(projectDir, 'package.json'), JsonUtilities.stringify({ name: 'zibri' }));
        await FsUtilities.mkdir(cwdDir);

        process.chdir(cwdDir);

        expect(resolveZibriRoot()).toBe(projectDir);
    });

    it('prefers node_modules/zibri over a same-directory package.json named "zibri"', async () => {
        const projectDir: FsPath = FsUtilities.getPath(workDir, 'priority-project');
        const zibriDir: FsPath = FsUtilities.getPath(projectDir, 'node_modules', 'zibri');
        await FsUtilities.createFile(FsUtilities.getPath(projectDir, 'package.json'), JsonUtilities.stringify({ name: 'zibri' }));
        await FsUtilities.createFile(FsUtilities.getPath(zibriDir, 'package.json'), JsonUtilities.stringify({ name: 'zibri' }));

        process.chdir(projectDir);

        expect(resolveZibriRoot()).toBe(zibriDir);
    });

    it('skips a package.json whose name is not "zibri" and continues walking up', async () => {
        const projectDir: FsPath = FsUtilities.getPath(workDir, 'skip-project');
        const nestedAppDir: FsPath = FsUtilities.getPath(projectDir, 'apps');
        const cwdDir: FsPath = FsUtilities.getPath(nestedAppDir, 'src');
        await FsUtilities.createFile(FsUtilities.getPath(projectDir, 'package.json'), JsonUtilities.stringify({ name: 'zibri' }));
        await FsUtilities.createFile(FsUtilities.getPath(nestedAppDir, 'package.json'), JsonUtilities.stringify({ name: 'apps-package' }));
        await FsUtilities.mkdir(cwdDir);

        process.chdir(cwdDir);

        expect(resolveZibriRoot()).toBe(projectDir);
    });

    it('throws when no zibri package can be found up to the filesystem root', async () => {
        const isolatedDir: FsPath = FsUtilities.getPath(os.tmpdir(), `zibri-root-test-${Date.now()}`);
        await FsUtilities.mkdir(isolatedDir);

        try {
            process.chdir(isolatedDir);
            expect(() => resolveZibriRoot()).toThrow('Zibri runtime root could not be resolved');
        }
        finally {
            await FsUtilities.rm(isolatedDir);
        }
    });
});