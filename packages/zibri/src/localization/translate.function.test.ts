import { beforeAll, describe, expect, it } from '@jest/globals';

import { $t, TranslationToken } from './translate.function';
import { TranslationRegistry } from './translation.registry';

describe('$t function', () => {
    beforeAll(() => {
        // mock german xlf file being registered
        TranslationRegistry.translations['de'] ??= {};
        TranslationRegistry.translations['de']['Hello {$1} {$2} {$3}'] = 'Hallo {$1} {$2} {$3}';
    });

    it('should generate the expected token', () => {
        const formOfAddress: string = 'Mr.';
        const firstName: string = 'James';
        const lastName: string = 'Smith';
        const token: TranslationToken = $t`Hello ${formOfAddress} ${firstName} ${lastName}`;

        expect(token.source).toBe('Hello {$1} {$2} {$3}');

        expect(token.getValue('en')).toBe('Hello Mr. James Smith');
        // unknown locale falls back to source
        expect(token.getValue('it')).toBe('Hello Mr. James Smith');
        // for the locale 'de' our mocked translation registry should return a correct value.
        expect(token.getValue('de')).toBe('Hallo Mr. James Smith');
        // 'de-DE' etc. should fall back to 'de'
        expect(token.getValue('de-DE')).toBe('Hallo Mr. James Smith');
    });
});