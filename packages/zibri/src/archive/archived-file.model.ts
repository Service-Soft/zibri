import { Property } from '../entity/decorators/property.decorator';

/**
 * A file of a row of an archived entity, as the row recorded it when it was created: its `FileRecord`, the SHA-256 of
 * its bytes, and its copies in other stores.
 */
export class ArchivedFile {
    /**
     * The id of the `FileRecord` the row holds in one of its file properties.
     */
    @Property.string()
    id!: string;

    /**
     * The SHA-256 of the bytes, in hex, as they were when the row was created.
     */
    @Property.string()
    sha256!: string;

    /**
     * The ids of the `FileRecord`s of its copies, one in each store `copies` of `@Archive` names.
     */
    @Property.array({ items: { type: 'string' } })
    copies!: string[];
}