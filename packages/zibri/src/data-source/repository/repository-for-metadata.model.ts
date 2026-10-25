import { type BaseEntity } from '../../entity/base-entity.model';
import { Newable } from '../../types/newable.type';

/**
 * What `@RepositoryFor` records about a repository class.
 */
export type RepositoryForMetadata = {
    /**
     * The entity the class is the repository of.
     */
    entity: Newable<BaseEntity>
};
