import { FileSize } from '../entity/models/file-property-metadata.model.ts';

/**
 * What a request sent with `fetchForLibrary` may do beyond the client's defaults.
 */
export type FetchForLibraryOptions = {
    /**
     * The largest response body read, in place of the client's `defaultMaxResponseSize`.
     */
    maxResponseSize?: FileSize
};