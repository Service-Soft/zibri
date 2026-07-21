/**
 * The locale language code, like eg. 'en' or 'de'.
 */
type LocaleCodeLanguage = 'de' | 'en' | Lowercase<string>;

/**
 * The locale script code.
 */
type LocaleCodeScript = Capitalize<Lowercase<string>> & {};

/**
 * The locale region code like eg. 'US' or 'DE'.
 */
type LocaleCodeRegion = 'DE' | 'US' | Uppercase<string> & {};

/**
 * Codes for the different locales of the world.
 * Is loosely typed to support custom string values.
 * The format is either:
 * - '{language}'
 * - '{language}-{region}'
 * - '{language}-{script}'.
 * - '{language}-{script}-{region}'.
 */
export type LocaleCode = LocaleCodeLanguage
    | `${LocaleCodeLanguage}-${LocaleCodeRegion}`
    | `${LocaleCodeLanguage}-${LocaleCodeScript}`
    | `${LocaleCodeLanguage}-${LocaleCodeScript}-${LocaleCodeRegion}`;

/**
 * Searches for the best match of the requested locale inside the given available locales.
 * @param requested - The locale to find the best match for.
 * @param available - All available locales that can be matched against.
 * @returns A fitting locale or undefined if nothing related was found.
 */
export function resolveLocaleCode(requested: LocaleCode, available: LocaleCode[]): LocaleCode | undefined {
    if (available.includes(requested)) {
        return requested;
    }

    const [language, second, third] = requested.split('-');

    if (third) {
        const twoPartLocale: LocaleCode = `${language}-${second}` as LocaleCode;
        if (available.includes(twoPartLocale)) {
            return twoPartLocale;
        }
    }

    if (available.includes(language as LocaleCode)) {
        return language as LocaleCode;
    }

    return available.find((locale) => locale.startsWith(`${language}-`));
}