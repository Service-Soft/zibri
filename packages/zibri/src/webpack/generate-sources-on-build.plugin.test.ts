import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';

import { GenerateSourcesOnBuildPlugin, WebpackCompileCompiler } from './generate-sources-on-build.plugin';
import { testFileFolder } from '../__testing__/constants';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';
import { resolveZibriRoot } from '../utilities/resolve-zibri-root.function';

const root: FsPath = FsUtilities.getPath(testFileFolder, 'generate-sources-on-build');

let originalCwd: FsPath;
let runBeforeCompile: () => Promise<void> = async () => {};

const compiler: WebpackCompileCompiler = {
    hooks: {
        beforeCompile: {
            tapPromise: (_name: string, run: () => Promise<void>): void => {
                runBeforeCompile = run;
            }
        }
    }
};

describe('GenerateSourcesOnBuildPlugin', () => {
    beforeAll(async () => {
        await FsUtilities.createFile(FsUtilities.getPath(root, 'src', 'models', 'generated', 'providers.ts'), 'export const providers = [];');
        await FsUtilities.createFile(FsUtilities.getPath(root, 'src', 'app.ts'), 'const own = $t`A string of the project ${name}`;');
        originalCwd = process.cwd() as FsPath;
        // the entity generation reads the providers file from the working directory, as a build runs there
        process.chdir(root);
    });

    afterAll(async () => {
        process.chdir(originalCwd);
        await FsUtilities.rm(root);
    });

    // 07 §T8: the framework's strings come from the source.xlf it ships, so a build scans the project
    // and nothing else
    it('writes the translation source of the project from its own files and the shipped source.xlf of the framework', async () => {
        const globSpy: jest.SpiedFunction<typeof FsUtilities.glob> = jest.spyOn(FsUtilities, 'glob');
        new GenerateSourcesOnBuildPlugin(root).apply(compiler);

        await runBeforeCompile();

        const content: string = await FsUtilities.readFile(FsUtilities.getPath(root, 'translations', 'source.xlf'));
        expect(content).toContain('original="project"');
        expect(content).toContain('<trans-unit id="A string of the project {$1}"');
        expect(content).toContain('<note>src/app.ts:1</note>');
        expect(content).toContain('original="zibri"');
        expect(content).toContain('<trans-unit id="Monday"');
        const frameworkSources: string = `${FsUtilities.getPath(resolveZibriRoot(), 'src')}/**`;
        const scanned: string[] = globSpy.mock.calls.map(([pattern]) => JSON.stringify(pattern));
        expect(scanned.some(pattern => pattern.includes(frameworkSources))).toBe(false);
        globSpy.mockRestore();
    });
});