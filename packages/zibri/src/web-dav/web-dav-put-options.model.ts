/**
 * Writes the file only while it is the version the server named with the ETag.
 */
type WebDavPutIfMatch = {
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

/**
 * Writes the file only where there is none.
 */
type WebDavPutIfNoneMatch = {
    /**
     * `'*'`: a file that exists fails the put with a `WebDavPreconditionFailedError`.
     */
    ifNoneMatch: '*',
    // eslint-disable-next-line jsdoc/require-jsdoc
    ifMatch?: undefined,
    // eslint-disable-next-line jsdoc/require-jsdoc
    overwrite?: undefined
};

/**
 * Writes the file whatever is there.
 */
type WebDavPutOverwrite = {
    /**
     * `true`: a file that exists is replaced, whatever its version.
     */
    overwrite: true,
    // eslint-disable-next-line jsdoc/require-jsdoc
    ifMatch?: undefined,
    // eslint-disable-next-line jsdoc/require-jsdoc
    ifNoneMatch?: undefined
};

/**
 * How a file is written to a WebDAV server: its content type, and which of the three conditions it is written
 * under. A put names exactly one of them.
 */
// one of three required rather than an unconditional put by default: replacing a file someone changed in the
// meantime is what a mirror has to rule out, and it says so once, here, rather than by forgetting an option
export type WebDavPutOptions = {
    /**
     * The media type the file is stored as, such as `application/pdf` or `text/calendar; charset=utf-8`.
     */
    contentType: string
} & (WebDavPutIfMatch | WebDavPutIfNoneMatch | WebDavPutOverwrite);
