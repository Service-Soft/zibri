import { BaseEntity } from '../../entity/base-entity.model.ts';
import { EntityMetadata } from '../../entity/decorators/entity.decorator.ts';
import { createArrayPropertyMetadata, createOneOfPropertyMetadata, PropertyMetadata, Property } from '../../entity/decorators/property.decorator.ts';
import { EntityMetadataMissingError } from '../../entity/entity-metadata-missing.error.ts';
import { InternalError } from '../../error-handling/internal-error.model.ts';
import { Newable } from '../../types/newable.type.ts';
import { MetadataUtilities } from '../../utilities/metadata.utilities.ts';
import { ObjectUtilities } from '../../utilities/object.utilities.ts';
import { MigrationPropertyMetadata } from '../models/migration-property-metadata.model.ts';

/**
 * Turns what a migration says about an entity into the declarations an entity class carries.
 *
 * So that a data source reads a migration the way it reads an entity, and a property or table a
 * migration describes is stored exactly as the same declaration on an entity would be - the
 * defaults filled in by the same decorators, the columns built by the same code.
 */
export abstract class MigratedEntityUtilities {

    /**
     * Builds an entity class declaring exactly what a migration says.
     *
     * It declares no indexes and no uniques: a migration says nothing about those, which the data
     * source keeps as the entity declares them now.
     * @param tableName - The table the entity is stored in.
     * @param properties - Its properties by name. `id` is the default primary key unless one is given.
     * @returns The class.
     */
    static defineEntity(tableName: string, properties: Record<string, MigrationPropertyMetadata>): Newable<BaseEntity> {
        // a class of its own per call: the declarations live on the class, and two migrations
        // describing the same table differently must not share them
        /**
         * The entity as the migration describes it.
         */
        class MigratedEntity extends BaseEntity {}
        for (const [name, metadata] of ObjectUtilities.entries(properties)) {
            this.declareProperty(metadata)(MigratedEntity.prototype, name);
        }
        // set rather than declared with @Entity, which would register the class as one of the
        // application's own entities
        MetadataUtilities.setEntityMetadata(MigratedEntity, {
            tableName,
            allowOrphan: true,
            allowDuplicate: true,
            uniques: [],
            indexes: [],
            // a migration describes columns, and the keys the tenant leads are kept as the entity
            // declares them now, like every other key
            tenant: 'shared'
        });
        return MigratedEntity;
    }

    /**
     * Resolves what a migration says about a property into the metadata the decorator would store.
     * @param metadata - What the migration says.
     * @returns The full metadata, defaults included.
     * @throws When the decorator stores nothing, which would be a defect of this class.
     */
    static resolvePropertyMetadata(metadata: MigrationPropertyMetadata): PropertyMetadata {
        /**
         * Carries the one property while the decorator resolves it.
         */
        class MigratedProperty {}
        this.declareProperty(metadata)(MigratedProperty.prototype, 'property');
        const res: PropertyMetadata | undefined = MetadataUtilities.getModelProperties(MigratedProperty)['property'];
        if (res == undefined) {
            throw new InternalError(`A ${metadata.type} property declared nothing.`);
        }
        return res;
    }

    /**
     * Resolves the table an entity is stored in.
     * @param entity - The entity.
     * @returns The name of its table.
     * @throws When the class is not an entity.
     */
    static resolveTableName<T extends BaseEntity>(entity: Newable<T>): string {
        const metadata: EntityMetadata<T> | undefined = MetadataUtilities.getEntityMetadata(entity);
        if (metadata == undefined) {
            throw new EntityMetadataMissingError(entity);
        }
        return metadata.tableName;
    }

    /**
     * The decorator a property of the given metadata is declared with.
     * @param metadata - What the migration says about the property.
     * @returns The decorator.
     */
    private static declareProperty(metadata: MigrationPropertyMetadata): (target: object, name: string) => void {
        switch (metadata.type) {
            case 'string': {
                return Property.string(metadata);
            }
            case 'number': {
                return Property.number(metadata);
            }
            case 'boolean': {
                return Property.boolean(metadata);
            }
            case 'date': {
                return Property.date(metadata);
            }
            case 'object': {
                return Property.object(metadata);
            }
            case 'array': {
                // stored directly rather than through Property.array, whose signature checks each string
                // in the items against the strategy it names - in the types of the declaration as written,
                // which metadata a migration reads back no longer has
                return this.storeProperty(fullKey => createArrayPropertyMetadata(metadata, fullKey));
            }
            case 'unknown': {
                return Property.unknown(metadata);
            }
            case 'oneOf': {
                // stored directly rather than through Property.oneOf, whose decorator checks the class
                // declares the property as OneOf - which a class built from a migration cannot. The
                // checks the other decorators run are about keys and formats, none of which a value of
                // several shapes has
                return this.storeProperty(fullKey => createOneOfPropertyMetadata(metadata, fullKey));
            }
        }
    }

    /**
     * The decorator that stores the metadata of a property as it is created.
     * @param createMetadata - Creates the metadata, given the class and property it is for.
     * @returns The decorator.
     */
    private static storeProperty(createMetadata: (fullKey: string) => PropertyMetadata): (target: object, name: string) => void {
        return (target, name) => {
            const ctor: Newable<unknown> = target.constructor as Newable<unknown>;
            MetadataUtilities.setModelProperties(ctor, {
                ...MetadataUtilities.getModelProperties(ctor),
                [name]: createMetadata(`${ctor.name}.${name}`)
            });
        };
    }
}