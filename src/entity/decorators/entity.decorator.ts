import { GlobalRegistry } from '../../global';
import { Newable } from '../../types';
import { MetadataUtilities } from '../../utilities';
import { BaseEntity } from '../models';

/**
 * Metadata for an Entity.
 */
export type EntityMetadata = {
    /**
     * The name of the table in the db.
     */
    tableName: string
};

// eslint-disable-next-line jsdoc/require-returns
/**
 * Marks an entity.
 * @param tableName - The name of the table to generate for the entity.
 */
export function Entity(tableName?: string): ClassDecorator {
    return target => {
        const metadata: EntityMetadata = {
            tableName: tableName ?? target.name.toLowerCase()
        };
        MetadataUtilities.setEntityMetadata(target as unknown as Newable<BaseEntity>, metadata);
        GlobalRegistry.entityClasses.push(target as unknown as Newable<BaseEntity>);
    };
}