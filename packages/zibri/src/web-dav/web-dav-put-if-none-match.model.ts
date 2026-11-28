/**
 * Writes the file only where there is none.
 */
export type WebDavPutIfNoneMatch = {
    /**
     * `'*'`: a file that exists fails the put with a `WebDavPreconditionFailedError`.
     */
    ifNoneMatch: '*',
    // eslint-disable-next-line jsdoc/require-jsdoc
    ifMatch?: undefined,
    // eslint-disable-next-line jsdoc/require-jsdoc
    overwrite?: undefined
};