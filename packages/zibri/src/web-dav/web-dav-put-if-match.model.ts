/**
 * Writes the file only while it is the version the server named with the ETag.
 */
export type WebDavPutIfMatch = {
    /**
     * The ETag of the version that may be replaced, quotes included. Any other version, or no file, fails the put
     * with a `WebDavPreconditionFailedError`.
     */
    ifMatch: string,
    // eslint-disable-next-line jsdoc/require-jsdoc
    ifNoneMatch?: undefined,
    // eslint-disable-next-line jsdoc/require-jsdoc
    overwrite?: undefined
};