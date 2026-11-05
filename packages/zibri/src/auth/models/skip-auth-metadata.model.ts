/**
 * Metadata for the skip variant of a single \@Auth decorator, none of which take options.
 *
 * Separate from the metadata of \@Auth.skip below, which does: those decorators cannot express
 * `allowRedundant`, so aliasing them to a type that offers it would describe a decorator that does
 * not exist.
 */
export type SkipMetadata = object;

/**
 * Metadata for the \@Auth.skip decorator.
 */
export type SkipAuthMetadata = {
    /**
     * Whether this skip is allowed to be on endpoints where there is nothing to skip, eg. When `defaultAuth` is set to `'public'`.
     *
     * A controller that ships
     * inside a library cannot know which default the application picked, though, and has to state
     * its own posture either way, so it says so here and is left alone.
     */
    allowRedundant: boolean
};