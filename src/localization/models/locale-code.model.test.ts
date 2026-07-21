import { describe, expect, it } from '@jest/globals';

import { LocaleCode, resolveLocaleCode } from './locale-code.model';

describe('resolveLocaleCode', () => {
    it('returns the requested locale directly when it is available', () => {
        expect(resolveLocaleCode('de-DE', ['en', 'de-DE'])).toBe('de-DE');
    });

    it('falls back from a 3-part locale to its 2-part language-script/region form', () => {
        const available: LocaleCode[] = ['en', 'de-Latn'];
        expect(resolveLocaleCode('de-Latn-DE', available)).toBe('de-Latn');
    });

    it('falls back from a locale with a region to just the language', () => {
        expect(resolveLocaleCode('de-DE', ['en', 'de'])).toBe('de');
    });

    it('falls back to any available locale that starts with the requested language', () => {
        expect(resolveLocaleCode('de', ['en', 'de-AT'])).toBe('de-AT');
    });

    it('returns undefined when nothing related is available', () => {
        expect(resolveLocaleCode('fr', ['en', 'de'])).toBeUndefined();
    });

    it('prefers an exact match over any fallback', () => {
        expect(resolveLocaleCode('de-DE', ['de', 'de-DE', 'de-AT'])).toBe('de-DE');
    });
});