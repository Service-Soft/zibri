import { BaseEntity } from '../entity/base-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { OmitStrict } from '../types/omit-strict.type';

/**
 * A chunk of a deduplicated backup that a transport is known to hold, so that a backup does not have to
 * ask the transport.
 *
 * Only ever some of what a transport holds: a chunk is recorded once it is stored, and the record goes
 * before the chunk does. One missing makes a backup store it again, and nothing worse.
 */
// not backed up: a database restored from a backup would bring back chunks deleted since, and a backup
// trusting those would point at nothing
@Entity({ tenant: 'shared', allowOrphan: true, backedUp: false, indexes: [['storeName']] })
export class BackupChunkEntity extends BaseEntity {
    /**
     * The transport and the key the chunk is stored under there, as `<transport>:<key>`.
     */
    // one column rather than the two together, since a lookup of many chunks names one column with a
    // list of values, which every data source answers from the index of a column unique on its own
    @Property.string({ unique: true })
    key!: string;
    /**
     * The name of the transport holding the chunk.
     */
    @Property.string()
    storeName!: string;
    /**
     * How many bytes the chunk takes where it is stored.
     */
    @Property.number({ format: 'integer' })
    storedBytes!: number;
}

/**
 * The data required to record a chunk.
 */
export type BackupChunkEntityCreateData = OmitStrict<BackupChunkEntity, 'id'>;