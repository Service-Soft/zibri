import { FindOptionsOrder, FindOptionsOrderValue, FindOptionsRelations } from 'typeorm';

import { GlobalRegistry } from '../../global/global-registry';
import { Newable } from '../../types/newable.type';
import { OmitStrict } from '../../types/omit-strict.type';
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
    allowOrphan: boolean,
    /**
     * Default ordering to apply to results when nothing has been specified.
     */
    // eslint-disable-next-line typescript/no-explicit-any
    defaultOrder?: FindOptionsOrder<any>,
    /**
     * Default relations to include in results when nothing has been specified.
     */
    // eslint-disable-next-line typescript/no-explicit-any
    defaultRelations?: FindOptionsRelations<any>
};

// eslint-disable-next-line jsdoc/require-jsdoc
type EntityMetadataInput<
    TOrderKey extends string = never,
    TRelationKey extends string = never
> = OmitStrict<Partial<EntityMetadata>, 'defaultOrder' | 'defaultRelations'> & {
    /**
     * Default ordering to apply to results when nothing has been specified.
     */
    defaultOrder?: { [K in TOrderKey]?: FindOptionsOrderValue },
    /**
     * Default relations to include in results when nothing has been specified.
     */
    // eslint-disable-next-line typescript/no-explicit-any
    defaultRelations?: { [K in TRelationKey]?: FindOptionsRelations<any> | boolean }
};

// eslint-disable-next-line jsdoc/require-jsdoc, typescript/no-explicit-any
type ConstrainKeys<TKey extends string> = [TKey] extends [never] ? object : Record<TKey, any>;

// eslint-disable-next-line jsdoc/require-returns
/**
 * Marks an entity.
 * @param options - Configuration options for the entity.
 */
export function Entity<TOrderKey extends string, TRelationKey extends string>(
    options: EntityMetadataInput<TOrderKey, TRelationKey> = {}
) {
    const { tableName, defaultOrder, defaultRelations, allowOrphan = false } = options;
    return <T extends ConstrainKeys<TOrderKey> & ConstrainKeys<TRelationKey>>(
        target: Newable<T>
    ): void => {
        const metadata: EntityMetadata = {
            tableName: tableName ?? toSnakeCase(target.name),
            allowOrphan,
            defaultOrder,
            defaultRelations
        };
        MetadataUtilities.setEntityMetadata(target as unknown as Newable<BaseEntity>, metadata);
        GlobalRegistry.entityClasses.push(target as unknown as Newable<BaseEntity>);
    };
}