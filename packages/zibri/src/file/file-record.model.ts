import { BaseTenantEntity } from '../entity/base-tenant-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { OmitStrict } from '../types/omit-strict.type';

/**
 * A file the `FileService` stored: what it is, and where its bytes are kept. Every file stored is a row of its own,
 * and files of the same content in the same store and tenant share their bytes.
 */
// the index answers whether another row shares the bytes of one being deleted, and which bytes no row references
@Entity({ allowOrphan: true, indexes: [['storeName', 'key']] })
export class FileRecord extends BaseTenantEntity() {
    /**
     * The name of the file, such as `invoice-2026-11.pdf`.
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
     * The SHA-256 of the bytes, in hex, which every read is checked against.
     */
    @Property.string()
    sha256!: string;

    /**
     * The name of the file store the bytes are kept in.
     */
    @Property.string()
    storeName!: string;

    /**
     * The key the bytes are kept under in the store.
     */
    @Property.string()
    key!: string;

    /**
     * When the file was stored.
     */
    @Property.date({ default: () => new Date() })
    createdAt!: Date;

    /**
     * The id of the user who stored the file, or null when no user did.
     */
    @Property.string({ required: false })
    createdBy?: string | null;
}

/**
 * What a row of a stored file is created from.
 */
export type FileRecordCreateData = OmitStrict<FileRecord, 'id' | 'tenantId' | 'createdAt'>;