import { BaseChainedEntity } from '../data-source/chain/base-chained-entity.model';
import { Property } from '../entity/decorators/property.decorator';
import { ArchivedFile } from './archived-file.model';

/**
 * The base of an entity declared with `@Archive`, whose rows are chained and kept for their retention. The repository
 * fills in what it holds when a row is created.
 */
export class BaseArchivedEntity extends BaseChainedEntity {
    /**
     * When the retention of the row ends, from which it may be deleted. Counted when the row is created, unless it is
     * created with one of its own, and never changed.
     */
    @Property.date()
    retainUntil!: Date;

    /**
     * The files the row holds in its file properties, with the SHA-256 of each and its copies, as they were when the
     * row was created.
     */
    @Property.array({ items: { type: 'object', cls: () => ArchivedFile } })
    archivedFiles!: ArchivedFile[];
}