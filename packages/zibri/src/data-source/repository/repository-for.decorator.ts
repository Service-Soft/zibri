import { type BaseEntity } from '../../entity/base-entity.model';
import { GlobalRegistry } from '../../global/global-registry';
import { Newable } from '../../types/newable.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { type RepositoryTypeForEntity } from '../data-sources/data-source.interface';

/**
 * A repository class of an entity, which the framework builds over the repository its data source
 * builds for the entity. It declares no constructor of its own.
 */
export type RepositoryClassFor<T extends BaseEntity> = new (entityClass: Newable<T>, repo: RepositoryTypeForEntity<T>) => RepositoryTypeForEntity<T>;

/**
 * Declares the class as the repository of the given entity, in every data source that lists it in
 * its `repositories`. `@InjectRepository(entity)`, `repositoryTokenFor(entity)` and the class itself
 * then hand out the one instance of it, and the framework reads and writes the entity through it.
 *
 * The class extends `Repository`, or `SoftDeleteRepository` or `ChangeSetRepository` for an entity
 * that soft deletes or records change sets, and declares no constructor: the framework builds it.
 * It reaches anything else it needs through `inject`.
 * @param entity - The entity the class is the repository of.
 * @returns The decorator.
 */
export function RepositoryFor<T extends BaseEntity>(entity: Newable<T>): (target: RepositoryClassFor<T>) => void {
    return target => {
        MetadataUtilities.setRepositoryForMetadata(target, { entity });
        GlobalRegistry.repositoryClasses.push(target);
    };
}
