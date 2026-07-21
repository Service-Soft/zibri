import { utimes } from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { testFileFolder } from '../../__testing__/constants';
import { FsPath, FsUtilities } from '../../utilities/fs.utilities';
import { generateHandlebarTypeFiles } from '../generate-handlebar-type-files.function';

const rootFolder: FsPath = FsUtilities.getPath(testFileFolder, 'handlebars-glob');

describe('generateHandlebarTypeFiles', () => {
    beforeEach(async () => {
        await FsUtilities.rm(rootFolder);
        await FsUtilities.mkdir(rootFolder);
    });

    afterEach(async () => {
        await FsUtilities.rm(rootFolder);
    });

    it('expands the glob recursively and generates a type file per matched template', async () => {
        await FsUtilities.createFile(FsUtilities.getPath(rootFolder, 'a.hbs'), '{{x}}');
        await FsUtilities.createFile(FsUtilities.getPath(rootFolder, 'nested', 'b.hbs'), '{{y}}');

        await generateHandlebarTypeFiles(`${rootFolder}/**/*.hbs`);

        const aContent: string = await FsUtilities.readFile(FsUtilities.getPath(rootFolder, 'a.hbs.ts'));
        expect(aContent).toContain('x: string');
        const bContent: string = await FsUtilities.readFile(FsUtilities.getPath(rootFolder, 'nested', 'b.hbs.ts'));
        expect(bContent).toContain('y: string');
    });

    it('skips regenerating a type file that is already up to date, and regenerates once the template changes', async () => {
        const hbsFile: FsPath = FsUtilities.getPath(rootFolder, 'a.hbs');
        const tsFile: FsPath = FsUtilities.getPath(rootFolder, 'a.hbs.ts');
        await FsUtilities.createFile(hbsFile, '{{x}}');

        await generateHandlebarTypeFiles(`${rootFolder}/**/*.hbs`);
        expect(await FsUtilities.readFile(tsFile)).toContain('x: string');

        // simulate a stale, hand-edited output file and make the .ts file clearly newer than the .hbs source
        await FsUtilities.updateFile(tsFile, 'sentinel content', 'replace');
        const past: Date = new Date(Date.now() - 10_000);
        await utimes(hbsFile, past, past);

        await generateHandlebarTypeFiles(`${rootFolder}/**/*.hbs`);
        expect(await FsUtilities.readFile(tsFile)).toBe('sentinel content');

        // now make the .hbs source clearly newer than the (stale) .ts file
        const future: Date = new Date(Date.now() + 10_000);
        await utimes(hbsFile, future, future);

        await generateHandlebarTypeFiles(`${rootFolder}/**/*.hbs`);
        expect(await FsUtilities.readFile(tsFile)).toContain('x: string');
    });

    it('logs and skips a template that fails to process, without aborting the remaining files', async () => {
        const brokenFile: FsPath = FsUtilities.getPath(rootFolder, 'broken.hbs');
        const goodFile: FsPath = FsUtilities.getPath(rootFolder, 'good.hbs');
        // "with" blocks are a known unimplemented AST path (see resolve-keys-for-block-statement.function.ts)
        await FsUtilities.createFile(brokenFile, '{{#with x}}{{y}}{{/with}}');
        await FsUtilities.createFile(goodFile, '{{z}}');

        const errorSpy: jest.SpiedFunction<typeof console.error> = jest.spyOn(console, 'error').mockImplementation(() => undefined);

        await expect(generateHandlebarTypeFiles(`${rootFolder}/**/*.hbs`)).resolves.toBeUndefined();

        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Error processing'), expect.anything());
        expect(await FsUtilities.exists(FsUtilities.getPath(rootFolder, 'broken.hbs.ts'))).toBe(false);
        expect(await FsUtilities.readFile(FsUtilities.getPath(rootFolder, 'good.hbs.ts'))).toContain('z: string');

        errorSpy.mockRestore();
    });
});