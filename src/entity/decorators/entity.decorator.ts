import { GlobalRegistry } from '../../global/global-registry';
import { Newable } from '../../types/newable.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { toSnakeCase } from '../../utilities/to-snake-case.function';
import { type BaseEntity } from '../base-entity.model';

/**
 * Metadata for an Entity.
 */
export type EntityMetadata = {
    /**
     * The name of the table in the db.
     */
    tableName: string,
    /**
     * Whether or not this entity is allowed to exist without belonging to a data source.
     */
    allowOrphan: boolean
};

/**
 * Marks an entity.
 * @param options - Configuration options for the entity.
 */
export function Entity(options: Partial<EntityMetadata> = {}): ClassDecorator {
    const { tableName, allowOrphan = false } = options;
    return target => {
        const metadata: EntityMetadata = {
            tableName: tableName ?? toSnakeCase(target.name),
            allowOrphan
        };
        MetadataUtilities.setEntityMetadata(target as unknown as Newable<BaseEntity>, metadata);
        GlobalRegistry.entityClasses.push(target as unknown as Newable<BaseEntity>);
    };
}