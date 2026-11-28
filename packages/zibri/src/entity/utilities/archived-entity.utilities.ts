import { type BaseArchivedEntity } from '../../archive/base-archived-entity.model';
import { Newable } from '../../types/newable.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { type BaseEntity } from '../base-entity.model';

// below the data layer rather than in the archive, so that the repositories and the chains ask whether an entity is
// archived without importing the archive
/**
 * Says which entities are archived, for the data layer as much as for the archive.
 */
export abstract class ArchivedEntityUtilities {
    /**
     * Whether an entity is declared with `@Archive`, which also says it extends `BaseArchivedEntity`.
     * @param entityClass - The entity.
     * @returns True when its rows are archived.
     */
    static isArchived(entityClass: Newable<BaseEntity>): entityClass is Newable<BaseArchivedEntity> {
        return MetadataUtilities.getArchiveMetadata(entityClass) != undefined;
    }
}