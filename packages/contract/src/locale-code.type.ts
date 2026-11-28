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