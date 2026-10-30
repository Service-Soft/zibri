import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { extractTranslationStrings } from './extract-translation-strings.function';
import { ExtractedTranslationString } from './models/extracted-translation-string.model';
import { testFileFolder } from '../../__testing__/constants';
import { FsPath, FsUtilities } from '../../utilities/fs.utilities';

const fixtureDir: FsPath = FsUtilities.getPath(testFileFolder, 'xlf-extraction-fixtures');

async function extractFixture(code: string): Promise<ExtractedTranslationString[]> {
    const file: FsPath = FsUtilities.getPath(fixtureDir, `${Date.now()}-${Math.random().toString(36)
        .slice(2)}.ts`);
    await FsUtilities.createFile(file, code);
    return await extractTranslationStrings(fixtureDir, [{ patterns: file, origin: 'test-origin', originLocale: 'en-US' }]);
}

describe('extractTranslationStrings', () => {
    beforeAll(async () => {
        await FsUtilities.mkdir(fixtureDir);
    });

    afterAll(async () => {
        await FsUtilities.rm(fixtureDir);
    });

    it('extracts a plain $t tagged template with no placeholders', async () => {
        const extracted: ExtractedTranslationString[] = await extractFixture('const x = $t`Hello world`;');

        expect(extracted).toHaveLength(1);
        expect(extracted[0]).toMatchObject({ source: 'Hello world', sourceLocale: 'en-US', origin: 'test-origin', line: 1 });
    });

    it('extracts a $ts tagged template the same way as $t', async () => {
        const extracted: ExtractedTranslationString[] = await extractFixture('const x = $ts`Hello world`;');

        expect(extracted).toHaveLength(1);
        expect(extracted[0]?.source).toBe('Hello world');
    });

    // 07 §T22: the placeholder has to be the one $t builds at runtime, which numbers every
    // expression it is not handed as a single key object. A name derived from the expression text
    // was never what $t looked up
    it('numbers the placeholder of a property access by its position', async () => {
        const extracted: ExtractedTranslationString[] = await extractFixture('const x = $t`Hello ${user.firstName}`;');

        expect(extracted[0]?.source).toBe('Hello {$1}');
    });

    it('numbers the placeholder of a plain identifier by its position', async () => {
        const extracted: ExtractedTranslationString[] = await extractFixture('const name = "a"; const x = $t`Hello ${name}`;');

        expect(extracted[0]?.source).toBe('Hello {$1}');
    });

    it('numbers the placeholders of several expressions in order', async () => {
        const extracted: ExtractedTranslationString[] = await extractFixture('const x = $t`Total: ${formatPrice(total)} for ${items.length} items`;');

        expect(extracted[0]?.source).toBe('Total: {$1} for {$2} items');
    });

    it('names the placeholder after the key of an inline object with one key', async () => {
        const extracted: ExtractedTranslationString[] = await extractFixture('const x = $t`Hello ${{ "custom.key": 5 }}`;');

        expect(extracted[0]?.source).toBe('Hello {custom.key}');
    });

    it('names the placeholder after a shorthand key', async () => {
        const extracted: ExtractedTranslationString[] = await extractFixture('const firstName = "a"; const x = $t`Hello ${{ firstName }}`;');

        expect(extracted[0]?.source).toBe('Hello {firstName}');
    });

    it('names the placeholder through parentheses and a type assertion', async () => {
        const extracted: ExtractedTranslationString[] = await extractFixture('const x = $t`Hello ${({ firstName: "a" }) as object}`;');

        expect(extracted[0]?.source).toBe('Hello {firstName}');
    });

    it('numbers the placeholder of an object with two keys, as $t does', async () => {
        const extracted: ExtractedTranslationString[] = await extractFixture('const x = $t`Hello ${{ a: 1, b: 2 }}`;');

        expect(extracted[0]?.source).toBe('Hello {$1}');
    });

    it('escapes literal braces in the surrounding text as doubled braces', async () => {
        const extracted: ExtractedTranslationString[] = await extractFixture('const x = $t`literal {brace} text`;');

        expect(extracted[0]?.source).toBe('literal {{brace}} text');
    });

    it('records the 1-indexed line number and the file relative to the root', async () => {
        const extracted: ExtractedTranslationString[] = await extractFixture('\n\nconst x = $t`on line three`;');

        expect(extracted[0]?.line).toBe(3);
        expect(extracted[0]?.file).toMatch(/^\d+-\w+\.ts$/);
    });

    it('extracts multiple tagged templates from the same file', async () => {
        const extracted: ExtractedTranslationString[] = await extractFixture('const a = $t`first`;\nconst b = $t`second`;');

        expect(extracted).toHaveLength(2);
        expect(extracted.map(e => e.source).sort()).toEqual(['first', 'second']);
    });

    it('does not extract a template tagged with an unrelated function', async () => {
        const extracted: ExtractedTranslationString[] = await extractFixture('function other(strings: TemplateStringsArray): string { return strings[0]; }\nconst x = other`Hello`;');

        expect(extracted).toHaveLength(0);
    });
});