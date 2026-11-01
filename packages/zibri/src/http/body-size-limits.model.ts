import { FileSize } from '../entity/models/file-property-metadata.model';

/**
 * The most a body may weigh, for each kind of body, unless its declaration names a size of its own.
 */
export type BodySizeLimits = {
    /**
     * A json body, of every json type.
     */
    json: FileSize,
    /**
     * An xml body.
     */
    xml: FileSize,
    /**
     * A url encoded form.
     */
    formUrlEncoded: FileSize,
    /**
     * A multipart form without its files. The sizes its file properties declare are added to it.
     */
    formData: FileSize,
    /**
     * A stream.
     */
    stream: FileSize
};
