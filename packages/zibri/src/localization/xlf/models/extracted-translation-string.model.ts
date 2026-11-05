/**
 * A string marked for translation, as the build finds it in the code.
 */
export type ExtractedTranslationString = {
    /**
     * The string as `$t` builds it at runtime, such as 'Hello {$1}' or 'Hello {firstName}'.
     */
    source: string,
    /**
     * Which locale this string is written in.
     */
    sourceLocale: string,
    /**
     * The file the string is in, relative to the root of its origin.
     */
    file: string,
    /**
     * The line of the file the string is on.
     */
    line: number,
    /**
     * Where the string comes from, such as 'zibri' or 'project'.
     */
    origin: string
};