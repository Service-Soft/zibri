import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { ExtractedTranslationString,
    SourceTranslationOrigin,
    TransformResult,
    transformSourceTranslationOriginTokens } from './transform-source-translation-tokens.function';
import { testFileFolder } from '../../__testing__/constants';
import { FsPath, FsUtilities } from '../../utilities/fs.utilities';

const fixtureDir: FsPath = FsUtilities.getPath(testFileFolder, 'xlf-transform-fixtures');

async function transformFixture(code: string): Promise<{ result: TransformResult, extracted: ExtractedTranslationString[] }> {
    const file: FsPath = FsUtilities.getPath(fixtureDir, `${Date.now()}-${Math.random().toString(36)
        .slice(2)}.ts`);
    await FsUtilities.createFile(file, code);

    const origin: SourceTranslationOrigin = {
        patterns: file,
        origin: 'test-origin',
        originLocale: 'en-US'
    };
    const results: Record<string, TransformResult> = await transformSourceTranslationOriginTokens([origin]);
    const result: TransformResult = results[file];
    return { result, extracted: result.extracted };
}

describe('transformSourceTranslationOriginTokens', () => {
    beforeAll(async () => {
        await FsUtilities.mkdir(fixtureDir);
    });

    afterAll(async () => {
        await FsUtilities.rm(fixtureDir);
    });

    it('extracts a plain $t tagged template with no placeholders', async () => {
        const { extracted } = await transformFixture('const x = $t`Hello world`;');

        expect(extracted).toHaveLength(1);
        expect(extracted[0]).toMatchObject({ source: 'Hello world', sourceLocale: 'en-US', origin: 'test-origin', line: 1 });
    });

    it('extracts a $ts tagged template the same way as $t', async () => {
        const { extracted } = await transformFixture('const x = $ts`Hello world`;');

        expect(extracted).toHaveLength(1);
        expect(extracted[0].source).toBe('Hello world');
    });

    it('uses the member access chain as the placeholder key for property access expressions', async () => {
        const { extracted } = await transformFixture('const x = $t`Hello ${user.firstName}`;');

        expect(extracted[0].source).toBe('Hello {user.firstName}');
    });

    it('uses a plain identifier as the placeholder key', async () => {
        const { extracted } = await transformFixture('const name = "a"; const x = $t`Hello ${name}`;');

        expect(extracted[0].source).toBe('Hello {name}');
    });

    it('falls back to a positional key for a complex expression without braces', async () => {
        const { extracted } = await transformFixture('const x = $t`Total: ${1 + 1}`;');

        expect(extracted[0].source).toBe('Total: {1 + 1}');
    });

    it('falls back to a purely positional $N key when the expression source contains a brace', async () => {
        const { extracted } = await transformFixture('const x = $t`Val: ${({ a: 1 }).a}`;');

        expect(extracted[0].source).toBe('Val: {$1}');
    });

    it('leaves an already-wrapped object literal expression alone and uses its key', async () => {
        const { extracted } = await transformFixture('const x = $t`Hello ${{ "custom.key": 5 }}`;');

        expect(extracted[0].source).toBe('Hello {custom.key}');
    });

    it('escapes literal braces in the surrounding text as doubled braces', async () => {
        const { extracted } = await transformFixture('const x = $t`literal {brace} text`;');

        expect(extracted[0].source).toBe('literal {{brace}} text');
    });

    it('records the correct 1-indexed line number', async () => {
        const { extracted } = await transformFixture('\n\nconst x = $t`on line three`;');

        expect(extracted[0].line).toBe(3);
    });

    it('extracts multiple tagged templates from the same file', async () => {
        const { extracted } = await transformFixture('const a = $t`first`;\nconst b = $t`second`;');

        expect(extracted).toHaveLength(2);
        expect(extracted.map(e => e.source).sort()).toEqual(['first', 'second']);
    });

    it('does not extract a template tagged with an unrelated function', async () => {
        const { extracted } = await transformFixture('function other(strings: TemplateStringsArray): string { return strings[0]; }\nconst x = other`Hello`;');

        expect(extracted).toHaveLength(0);
    });

    it('rewrites the source code to wrap placeholder expressions as object literals', async () => {
        const { result } = await transformFixture('const name = "a"; const x = $t`Hello ${name}`;');

        expect(result.code).toMatch(/\$t\s*`Hello \${{ "name": name }}`/);
    });
});