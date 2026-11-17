import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';

import { GenerateSourcesOnBuildPlugin, WebpackCompileCompiler } from './generate-sources-on-build.plugin';
import { testFileFolder } from '../__testing__/constants';
import { ConsoleUtilities } from '../logging/console.utilities';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';
import { resolveZibriRoot } from '../utilities/resolve-zibri-root.function';

const root: FsPath = FsUtilities.getPath(testFileFolder, 'generate-sources-on-build');

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
        await FsUtilities.createFile(FsUtilities.getPath(root, 'src', 'templates', 'emails', 'greeting.hbs'), '<p>Hello {{name}}</p>');
    });

    afterAll(async () => {
        await FsUtilities.rm(root);
    });

    // `webpack -c api/webpack.config.js` started in the root of a monorepo builds the project the configuration names
    it('generates the types of the handlebars templates and the entities of the project it is given, wherever the build starts', async () => {
        const infoSpy: jest.SpiedFunction<typeof ConsoleUtilities.info> = jest.spyOn(ConsoleUtilities, 'info');
        new GenerateSourcesOnBuildPlugin(root).apply(compiler);

        await runBeforeCompile();

        expect(process.cwd()).not.toBe(root);
        expect(await FsUtilities.exists(FsUtilities.getPath(root, 'src', 'templates', 'emails', 'greeting.hbs.ts'))).toBe(true);
        // the providers file of the project is found, so nothing says it is missing
        expect(infoSpy.mock.calls.map(([message]) => String(message))).not.toContainEqual(expect.stringContaining('providers.ts'));
        infoSpy.mockRestore();
    });

    // the framework's strings come from the source.xlf it ships, so a build scans the project
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