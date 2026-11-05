import { BaseEntity } from '../../entity/base-entity.model';
import { EntityMetadata } from '../../entity/decorators/entity.decorator';
import { createArrayPropertyMetadata, createOneOfPropertyMetadata, PropertyMetadata, Property } from '../../entity/decorators/property.decorator';
import { EntityMetadataMissingError } from '../../entity/entity-metadata-missing.error';
import { InternalError } from '../../error-handling/internal-error.model';
import { isNewable, Newable } from '../../types/newable.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { ObjectUtilities } from '../../utilities/object.utilities';
import { MigrationPropertyMetadata } from '../models/migration-property-metadata.model';
import { MigrationTableReference } from '../models/migration-table-reference.model';

/**
 * An entity a migration renames or merges, and the table it is moved to.
 */
export type MovedEntity = {
    /**
     * The class declaring what the entity holds.
     */
    entityClass: Newable<BaseEntity>,
    /**
     * The table its rows are moved to.
     */
    tableName: string
};

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
            backedUp: true,
            appendOnly: false,
            chained: false,
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
     * @param entity - The entity, or the table it is stored in.
     * @returns The name of its table.
     * @throws When the class is not an entity.
     */
    static resolveTableName<T extends BaseEntity>(entity: Newable<T> | MigrationTableReference): string {
        if (!isNewable(entity)) {
            return entity.tableName;
        }
        const metadata: EntityMetadata<T> | undefined = MetadataUtilities.getEntityMetadata(entity);
        if (metadata == undefined) {
            throw new EntityMetadataMissingError(entity);
        }
        return metadata.tableName;
    }

    /**
     * Resolves the class of an entity a migration names.
     * @param entity - The entity, or the table it is stored in.
     * @param entities - The entities of the data source the migration runs on.
     * @returns The class given; for a table, the entity of the data source stored in it, or one declaring
     * only its primary key when the data source declares none there.
     */
    static resolveEntityClass<T extends BaseEntity>(
        entity: Newable<T> | MigrationTableReference,
        entities: Newable<BaseEntity>[]
    ): Newable<BaseEntity> {
        return isNewable(entity)
            ? entity
            // the entity declared now, so that what is kept about its rows - its indexes, its relations -
            // is kept for the rows a migration rewrites as for every other row
            : this.findEntityStoredIn(entity.tableName, entities) ?? this.defineEntity(entity.tableName, {});
    }

    /**
     * Resolves the entity a migration renames or merges, and the table it is moved to.
     * @param entity - The entity, or the table it is moved to.
     * @param currentTableName - The table it is stored in now.
     * @param entities - The entities of the data source the migration runs on.
     * @returns The class given, or the entity of the data source stored in the table it is moved to, or
     * else the one stored in the table it is moved from, or else one declaring only its primary key.
     */
    static resolveMovedEntity<T extends BaseEntity>(
        entity: Newable<T> | MigrationTableReference,
        currentTableName: string,
        entities: Newable<BaseEntity>[]
    ): MovedEntity {
        const tableName: string = this.resolveTableName(entity);
        if (isNewable(entity)) {
            return { entityClass: entity, tableName };
        }
        // the entity stored where the rows come from when none is declared where they go: what reverts
        // renaming an entity names the table it had, which no entity declares any more - and the
        // relations its rows hold are the ones that entity declares
        const entityClass: Newable<BaseEntity> = this.findEntityStoredIn(tableName, entities)
            ?? this.findEntityStoredIn(currentTableName, entities)
            ?? this.defineEntity(tableName, {});
        return { entityClass, tableName };
    }

    /**
     * Resolves the class a store moves the rows of an entity a migration renames or merges with.
     * @param entity - The entity, or the table it is moved to.
     * @param currentTableName - The table it is stored in now.
     * @param entities - The entities of the data source the migration runs on.
     * @returns A class stored in the table the rows are moved to, declaring what the entity resolved
     * by {@link resolveMovedEntity} declares.
     */
    static resolveMovedEntityClass<T extends BaseEntity>(
        entity: Newable<T> | MigrationTableReference,
        currentTableName: string,
        entities: Newable<BaseEntity>[]
    ): Newable<BaseEntity> {
        const { entityClass, tableName }: MovedEntity = this.resolveMovedEntity(entity, currentTableName, entities);
        return this.resolveTableName(entityClass) === tableName ? entityClass : this.defineEntityStoredIn(entityClass, tableName);
    }

    /**
     * Builds a class declaring what an entity declares, stored in another table.
     * @param entity - The entity.
     * @param tableName - The table.
     * @returns The class.
     * @throws When the class is not an entity.
     */
    private static defineEntityStoredIn(entity: Newable<BaseEntity>, tableName: string): Newable<BaseEntity> {
        const metadata: EntityMetadata | undefined = MetadataUtilities.getEntityMetadata(entity);
        if (metadata == undefined) {
            throw new EntityMetadataMissingError(entity);
        }
        /**
         * The entity, stored in another table. Its properties are the entity's, which a class extending
         * it inherits.
         */
        class StoredElsewhere extends entity {}
        MetadataUtilities.setEntityMetadata(StoredElsewhere, { ...metadata, tableName });
        return StoredElsewhere;
    }

    /**
     * Finds the entity of a data source stored in a table.
     * @param tableName - The table.
     * @param entities - The entities of the data source.
     * @returns The entity, if one is stored there.
     */
    private static findEntityStoredIn(tableName: string, entities: Newable<BaseEntity>[]): Newable<BaseEntity> | undefined {
        return entities.find(e => MetadataUtilities.getEntityMetadata(e)?.tableName === tableName);
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
            case 'file': {
                return Property.file(metadata);
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