import { type MirroredFileModel } from 'zibri-contract';

import { BaseTenantEntity } from '../entity/base-tenant-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { MirroredFileConflict } from './mirrored-file-conflict.enum';

/**
 * A file mirrored into a folder of a WebDAV server: where the application mirrored it to, where it is now, the version
 * written last, and the conflict that keeps it from being written, if any. One per connection and path.
 */
// declared only by an application that mirrors files
@Entity({ allowOrphan: true, uniques: [['connectionId', 'path']], indexes: [['sourceType', 'sourceId'], ['conflict']] })
export class MirroredFile extends BaseTenantEntity() implements MirroredFileModel {
    /**
     * The kind of row the file is of, such as `invoice`.
     */
    @Property.string({ maxLength: 100 })
    sourceType!: string;

    /**
     * The id of the row.
     */
    @Property.string({ maxLength: 200 })
    sourceId!: string;

    /**
     * The id of the `TenantWebDavConnection` the folder is reached through.
     */
    @Property.string({ format: 'uuid' })
    connectionId!: string;

    /**
     * Where the application mirrors the file to, relative to the url of the connection.
     */
    @Property.string({ maxLength: 1500 })
    path!: string;

    /**
     * Where the file is now, relative to the url of the connection: its `path`, or where somebody moved it to on a
     * Nextcloud.
     */
    @Property.string({ maxLength: 1500 })
    currentPath!: string;

    /**
     * The id Nextcloud keeps the file under, or null for a connection to another server.
     */
    @Property.string({ maxLength: 100, required: false })
    fileId?: string | null;

    /**
     * The ETag of the version written last, or null while none was written.
     */
    @Property.string({ maxLength: 500, required: false })
    etag?: string | null;

    /**
     * The SHA-256 of the content written last, in hex, or null while none was written.
     */
    @Property.string({ maxLength: 64, required: false })
    contentHash?: string | null;

    /**
     * When the version written last was written, or null while none was.
     */
    @Property.date({ required: false })
    mirroredAt?: Date | null;

    /**
     * Why the last content mirrored was not written, or null when it was.
     */
    @Property.string({ enum: MirroredFileConflict, required: false })
    conflict?: MirroredFileConflict | null;

    /**
     * When the conflict was found, or null without one.
     */
    @Property.date({ required: false })
    conflictAt?: Date | null;
}