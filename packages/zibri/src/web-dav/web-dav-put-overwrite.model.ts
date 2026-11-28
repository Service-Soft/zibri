/**
 * Writes the file whatever is there.
 */
export type WebDavPutOverwrite = {
    /**
     * `true`: a file that exists is replaced, whatever its version.
     */
    overwrite: true,
    // eslint-disable-next-line jsdoc/require-jsdoc
    ifMatch?: undefined,
    // eslint-disable-next-line jsdoc/require-jsdoc
    ifNoneMatch?: undefined
};