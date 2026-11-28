import { Property } from '../entity/decorators/property.decorator';

/**
 * What a response answers for a file of an entity kept in a file store: what the file is, and where its bytes are
 * downloaded from. Written when the response is, never stored, and never the bytes.
 */
export class FileReference {
    /**
     * The name of the file, such as `receipt-2026-11.pdf`.
     */
    @Property.string()
    name!: string;

    /**
     * The mime type of the file, such as `application/pdf`.
     */
    @Property.string()
    mimeType!: string;

    /**
     * How many bytes the file holds.
     */
    @Property.number({ format: 'integer' })
    size!: number;

    /**
     * Where the bytes are downloaded from: the download route of the `CrudController` serving the entity, or null
     * when no `CrudController` serves it.
     */
    @Property.string({ required: false })
    url?: string | null;
}