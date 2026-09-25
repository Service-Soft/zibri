/**
 * How many parts a single multipart body may be made of.
 *
 * Counts rather than sizes, because the two bound different costs. A body's `maxSize` bounds the
 * bytes that have to be read; these bound what has to be held open while reading them. Every file
 * part keeps a write stream open for as long as it is arriving, so a body of a hundred thousand one
 * byte files weighs almost nothing and still opens a hundred thousand file descriptors - `EMFILE`,
 * after which the process cannot accept a socket at all.
 *
 * There is deliberately no per field size here. A field's bytes are already inside the body's
 * `maxSize`, and how long one value may legitimately be is a question about that field rather than
 * about the request - `@Property.string({ maxLength })` on the model answers it where the field is
 * described.
 *
 * The defaults sit well above what an ordinary form sends and well below what hurts.
 */
export type FormDataLimits = {
    /**
     * How many file parts one body may carry.
     */
    maxFiles: number,
    /**
     * How many parts of any kind - files and fields together - one body may carry.
     *
     * Counted as well as the other two, because a body made entirely of fields costs parsing work
     * without ever opening a file.
     */
    maxParts: number,
    /**
     * How many non-file fields one body may carry.
     */
    maxFields: number
};