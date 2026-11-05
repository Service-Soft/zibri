import { ObjectUtilities } from '../utilities/object.utilities';
import { LocaleCode, resolveLocaleCode } from './models/locale-code.model';

/**
 * Registry responsible for all translations.
 */
export abstract class TranslationRegistry {
    /**
     * All registered translations.
     *
     * This happens on two levels:
     * 1. The locale
     * 2. The translation string for a specific source string.
     */
    static readonly translations: Partial<
        Record<
            LocaleCode,
            Partial<Record<string, string>>
        >
    > = {};

    /**
     * Finds a translation for the given locale and source.
     * @param locale - The locale to get the translation for.
     * @param source - The source to get the translation for.
     * @returns The found translation or undefined if it could not be resolved.
     */
    static findTranslation(locale: LocaleCode, source: string): string | undefined {
        const resolvedLocale: LocaleCode | undefined = resolveLocaleCode(locale, ObjectUtilities.keys(this.translations));
        return resolvedLocale ? this.translations[resolvedLocale]?.[source] : undefined;
    }
}