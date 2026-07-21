import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { LocaleCode } from './models/locale-code.model';
import { TranslationRegistry } from './translation.registry';

describe('TranslationRegistry.findTranslation', () => {
    beforeEach(() => {
        (TranslationRegistry as unknown as { translations: Partial<Record<LocaleCode, Partial<Record<string, string>>>> })['translations']['de'] = {
            Hello: 'Hallo'
        };
    });

    afterEach(() => {
        delete (TranslationRegistry as unknown as { translations: Partial<Record<LocaleCode, Partial<Record<string, string>>>> })['translations']['de'];
    });

    it('finds a translation for an exactly registered locale', () => {
        expect(TranslationRegistry.findTranslation('de', 'Hello')).toBe('Hallo');
    });

    it('falls back through resolveLocaleCode for a more specific locale request', () => {
        expect(TranslationRegistry.findTranslation('de-DE', 'Hello')).toBe('Hallo');
    });

    it('returns undefined when the locale has no registered translations at all', () => {
        expect(TranslationRegistry.findTranslation('fr', 'Hello')).toBeUndefined();
    });

    it('returns undefined when the locale is registered but the source string is not', () => {
        expect(TranslationRegistry.findTranslation('de', 'Goodbye')).toBeUndefined();
    });
});