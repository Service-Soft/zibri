/**
 * The translation source strings a piece of client code looks up.
 */
export type TranslationSources = {
    /**
     * The source strings, in the exact form `$t` builds them at runtime.
     */
    sources: string[],
    /**
     * Whether every `$t`/`$ts` usage could be resolved statically. When false the collected sources
     * are incomplete and the full translation table has to be shipped, because `$t` decides its
     * placeholder names from runtime values.
     */
    complete: boolean
};