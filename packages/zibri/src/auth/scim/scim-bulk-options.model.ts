import { FileSize } from '../../entity/models/file-property-metadata.model';

/**
 * How much one bulk request of an identity provider may do.
 */
export type ScimBulkOptions = {
    /**
     * The most operations a bulk request may hold. 1000 by default.
     */
    maxOperations?: number,
    /**
     * The most a bulk request may weigh. `'1mb'` by default.
     */
    maxPayloadSize?: FileSize
};