import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';

import { generateSourceXlf } from './generate-source-xlf.function';
import { ScannedTranslationOrigin } from './models/source-translation-origin.model';
import { testFileFolder } from '../../__testing__/constants';
import { FsPath, FsUtilities } from '../../utilities/fs.utilities';

describe('generateSourceXlf', () => {
    const workDir: FsPath = FsUtilities.getPath(testFileFolder, 'generate-source-xlf');
    const outputPath: FsPath = FsUtilities.getPath(workDir, 'translations', 'source.xlf');

    beforeAll(async () => {
        await FsUtilities.mkdir(workDir);
    });

    afterAll(async () => {
        await FsUtilities.rm(workDir);
    });

    afterEach(async () => {
        await FsUtilities.rm(FsUtilities.getPath(workDir, 'translations'));
    });

    async function makeOrigin(code: string): Promise<ScannedTranslationOrigin> {
        const file: FsPath = FsUtilities.getPath(workDir, `${Date.now()}-${Math.random().toString(36)
            .slice(2)}.ts`);
        await FsUtilities.createFile(file, code);
        return { patterns: file, origin: 'test-origin', originLocale: 'en-US' };
    }

    it('writes translations/source.xlf of the root, containing the extracted translation tokens', async () => {
        const origin: ScannedTranslationOrigin = await makeOrigin('const x = $t`Hello world`;');

        await generateSourceXlf(workDir, [origin]);

        expect(await FsUtilities.exists(outputPath)).toBe(true);
        const content: string = await FsUtilities.readFile(outputPath);
        expect(content).toContain('Hello world');
    });

    it('does not rewrite the file when the generated content is unchanged', async () => {
        const origin: ScannedTranslationOrigin = await makeOrigin('const x = $t`stable content`;');

        await generateSourceXlf(workDir, [origin]);
        const upsertSpy: jest.SpiedFunction<typeof FsUtilities.upsertFile> = jest.spyOn(FsUtilities, 'upsertFile');

        await generateSourceXlf(workDir, [origin]);

        expect(upsertSpy).not.toHaveBeenCalled();
        upsertSpy.mockRestore();
    });

    it('rewrites the file when the extracted tokens change', async () => {
        const origin: ScannedTranslationOrigin = await makeOrigin('const x = $t`first version`;');
        await generateSourceXlf(workDir, [origin]);

        const changedOrigin: ScannedTranslationOrigin = await makeOrigin('const x = $t`second version`;');
        await generateSourceXlf(workDir, [origin, changedOrigin]);

        const content: string = await FsUtilities.readFile(outputPath);
        expect(content).toContain('first version');
        expect(content).toContain('second version');
    });

    // the framework's strings ship as a source.xlf of its own, and a build of the
    // application takes them from there rather than scanning the framework's sources again
    it('takes the strings of an origin whose source.xlf ships with it as they are, scanning nothing of it', async () => {
        const shippedRoot: FsPath = FsUtilities.getPath(workDir, 'shipped');
        await FsUtilities.createFile(FsUtilities.getPath(shippedRoot, 'src', 'shipped.ts'), 'const x = $t`Shipped ${name}`;');
        await generateSourceXlf(shippedRoot, [{ origin: 'library', originLocale: 'en-US', patterns: `${shippedRoot}/src/**/*.ts` }]);
        const origin: ScannedTranslationOrigin = await makeOrigin('const x = $t`Own string`;');
        const globSpy: jest.SpiedFunction<typeof FsUtilities.glob> = jest.spyOn(FsUtilities, 'glob');

        await generateSourceXlf(workDir, [{ sourceXlf: FsUtilities.getPath(shippedRoot, 'translations', 'source.xlf') }, origin]);

        const content: string = await FsUtilities.readFile(outputPath);
        expect(content).toContain('original="library"');
        expect(content).toContain('<trans-unit id="Shipped {$1}"');
        expect(content).toContain('<note>src/shipped.ts:1</note>');
        expect(content).toContain('original="test-origin"');
        expect(content).toContain('Own string');
        expect(globSpy.mock.calls).toEqual([[origin.patterns]]);
        globSpy.mockRestore();
        await FsUtilities.rm(shippedRoot);
    });
});