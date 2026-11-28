import { type LocaleCode } from 'zibri-contract';

// declared by the contract, as the locale of a user is part of what a frontend reads and sends
/**
 * Codes for the different locales of the world, such as 'de' or 'en-US'.
 */
export { type LocaleCode } from 'zibri-contract';

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

    return available.includes(language as LocaleCode)
        ? language as LocaleCode
        : available.find((locale) => locale.startsWith(`${language}-`));
}