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
    tableName: string
};

/**
 * Marks an entity.
 * @param tableName - The name of the table to generate for the entity.
 */
export function Entity(tableName?: string): ClassDecorator {
    return target => {
        const metadata: EntityMetadata = {
            tableName: tableName ?? toSnakeCase(target.name)
        };
        MetadataUtilities.setEntityMetadata(target as unknown as Newable<BaseEntity>, metadata);
        GlobalRegistry.entityClasses.push(target as unknown as Newable<BaseEntity>);
    };
}