import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { QueuedWorkEntity } from '../queue/queued-work-entity.model';

/**
 * A file to mirror that is not written into its folder yet, with its content. Written in the transaction of the
 * caller, so that a write rolled back mirrors nothing and one committed is mirrored, retried while the server cannot
 * be reached. The newest one of a file in conflict is kept until the conflict is resolved, as what overwriting the
 * file writes.
 */
// a row per call rather than one per file: a run reads the newest of a file, so rows of one file are done by the
// first that succeeds, and no row is changed by a call while it runs
@Entity({ allowOrphan: true, defaultOrder: { createdAt: 'ASC' }, indexes: [['nextAttemptAt'], ['connectionId', 'path']] })
export class FileMirrorRequest extends QueuedWorkEntity {
    /**
     * The tenant the file is mirrored for.
     */
    @Property.string({ format: 'uuid' })
    tenantId!: string;

    /**
     * The id of the `TenantWebDavConnection` the folder is reached through.
     */
    @Property.string({ format: 'uuid' })
    connectionId!: string;

    /**
     * Where the file goes, relative to the url of the connection.
     */
    @Property.string({ maxLength: 1500 })
    path!: string;

    /**
     * The media type the file is stored as.
     */
    @Property.string({ maxLength: 255 })
    contentType!: string;

    /**
     * What the file holds.
     */
    @Property.file({ allowedMimeTypes: 'all', maxSize: '50mb' })
    content!: Buffer;

    /**
     * The SHA-256 of the content, in hex.
     */
    @Property.string({ maxLength: 64 })
    contentHash!: string;

    /**
     * The kind of row the file is of.
     */
    @Property.string({ maxLength: 100 })
    sourceType!: string;

    /**
     * The id of the row.
     */
    @Property.string({ maxLength: 200 })
    sourceId!: string;

    /**
     * When the file was handed to the mirror.
     */
    @Property.date({ default: () => new Date() })
    createdAt!: Date;

    /**
     * Whether it was not written for a conflict, and is kept as what overwriting the file writes. Never written by a
     * pass of the queue.
     */
    // kept rather than read again from the application: the content of a version is handed to the mirror once
    @Property.boolean({ default: false })
    heldForConflict!: boolean;
}