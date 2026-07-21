import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { generateSourceXlf } from './generate-source-xlf.function';
import { SourceTranslationOrigin } from './transform-source-translation-tokens.function';
import { testFileFolder } from '../../__testing__/constants';
import { FsPath, FsUtilities } from '../../utilities/fs.utilities';

describe('generateSourceXlf', () => {
    const workDir: FsPath = FsUtilities.getPath(testFileFolder, 'generate-source-xlf');
    const outputPath: FsPath = FsUtilities.getPath(workDir, 'translations', 'source.xlf');
    let originalCwd: FsPath;

    beforeAll(async () => {
        await FsUtilities.mkdir(workDir);
    });

    afterAll(async () => {
        await FsUtilities.rm(workDir);
    });

    beforeEach(() => {
        originalCwd = process.cwd() as FsPath;
        // generateSourceXlf writes to `${process.cwd()}/translations/source.xlf` with no path parameter,
        // so the cwd is redirected into a scratch directory for the duration of each test — same approach
        // as resolve-zibri-root.function.test.ts — to avoid touching the real repo's translations file.
        process.chdir(workDir);
    });

    afterEach(async () => {
        process.chdir(originalCwd);
        await FsUtilities.rm(FsUtilities.getPath(workDir, 'translations'));
    });

    async function makeOrigin(code: string): Promise<SourceTranslationOrigin> {
        const file: FsPath = FsUtilities.getPath(workDir, `${Date.now()}-${Math.random().toString(36)
            .slice(2)}.ts`);
        await FsUtilities.createFile(file, code);
        return { patterns: file, origin: 'test-origin', originLocale: 'en-US' };
    }

    it('writes an xlf file containing the extracted translation tokens', async () => {
        const origin: SourceTranslationOrigin = await makeOrigin('const x = $t`Hello world`;');

        await generateSourceXlf([origin]);

        expect(await FsUtilities.exists(outputPath)).toBe(true);
        const content: string = await FsUtilities.readFile(outputPath);
        expect(content).toContain('Hello world');
    });

    it('does not rewrite the file when the generated content is unchanged', async () => {
        const origin: SourceTranslationOrigin = await makeOrigin('const x = $t`stable content`;');

        await generateSourceXlf([origin]);
        const upsertSpy: jest.SpiedFunction<typeof FsUtilities.upsertFile> = jest.spyOn(FsUtilities, 'upsertFile');

        await generateSourceXlf([origin]);

        expect(upsertSpy).not.toHaveBeenCalled();
        upsertSpy.mockRestore();
    });

    it('rewrites the file when the extracted tokens change', async () => {
        const origin: SourceTranslationOrigin = await makeOrigin('const x = $t`first version`;');
        await generateSourceXlf([origin]);

        const changedOrigin: SourceTranslationOrigin = await makeOrigin('const x = $t`second version`;');
        await generateSourceXlf([origin, changedOrigin]);

        const content: string = await FsUtilities.readFile(outputPath);
        expect(content).toContain('first version');
        expect(content).toContain('second version');
    });
});