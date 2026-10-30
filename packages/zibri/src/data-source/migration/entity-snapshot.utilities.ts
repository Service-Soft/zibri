import { EntitySnapshot, SnapshotColumn, SnapshotEntity, SnapshotKeys, SnapshotProperty, SnapshotRelation } from './entity-snapshot.model';
import { MigratedEntityUtilities } from './migrated-entity.utilities';
import { MigrationEntity } from './migration-entity.model';
import { BaseEntity } from '../../entity/base-entity.model';
import { PropertyMetadata, RelationMetadata } from '../../entity/decorators/property.decorator';
import { ArrayPropertyItemMetadata } from '../../entity/models/array-property-metadata.model';
import { isRelationMetadata } from '../../entity/models/is-relation-metadata.function';
import { NumberFormat, NumberPropertyMetadata } from '../../entity/models/number-property-metadata.model';
import { Relation } from '../../entity/models/relation.enum';
import { StoredStringPropertyMetadata, StringFormat } from '../../entity/models/string-property-metadata.model';
import { KeyWhere } from '../../entity/models/unique-declaration.model';
import { KeyGroups, keyGroupsOf } from '../../global/model-registry/key-descriptor';
import { AnyEnum } from '../../types/any-enum.type';
import { ExcludeStrict } from '../../types/exclude-strict.type';
import { Newable } from '../../types/newable.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { ObjectUtilities } from '../../utilities/object.utilities';

const STRING_FORMATS: StringFormat[] = ['uuid', 'email', 'phone'];

const NUMBER_FORMATS: NumberFormat[] = ['number', 'integer', 'bigint', 'bignumber'];

const PLAIN_TYPES: SnapshotColumn['type'][] = ['boolean', 'date', 'object', 'unknown', 'file'];

/**
 * Takes the snapshot of how a data source stores its entities, which generating a migration compares
 * with the one committed with the migrations before it.
 */
export abstract class EntitySnapshotUtilities {
    /**
     * Resolves how the given entities are stored.
     * @param dataSourceName - The data source they are stored in.
     * @param entities - The entities.
     * @returns The snapshot, every entity by its table, every property by its name, in the order they
     * are declared.
     */
    static resolveSnapshot(dataSourceName: string, entities: Newable<BaseEntity>[]): EntitySnapshot {
        const res: Record<string, SnapshotEntity> = {};
        for (const entity of new Set(entities)) {
            // the data source creates its table itself, before any migration runs
            if (entity === MigrationEntity) {
                continue;
            }
            const properties: Record<string, SnapshotProperty> = {};
            for (const [key, metadata] of ObjectUtilities.entries(MetadataUtilities.getModelProperties(entity))) {
                properties[key] = this.resolveProperty(metadata);
            }
            const keys: SnapshotKeys | undefined = this.resolveKeys(entity);
            res[MigratedEntityUtilities.resolveTableName(entity)] = {
                className: entity.name,
                properties,
                ...keys == undefined ? {} : { keys }
            };
        }
        return { dataSource: dataSourceName, entities: res };
    }

    /**
     * Whether a value is a snapshot, such as one read back from the file it was committed in.
     * @param value - The value.
     * @returns True when it has the shape of a snapshot.
     */
    static isSnapshot(value: unknown): value is EntitySnapshot {
        if (!this.isRecord(value) || typeof value['dataSource'] !== 'string' || !this.isRecord(value['entities'])) {
            return false;
        }
        return Object.values(value['entities']).every(entity => this.isRecord(entity)
            && typeof entity['className'] === 'string'
            && this.isRecord(entity['properties'])
            && Object.values(entity['properties']).every(p => this.isSnapshotRelation(p) || this.isSnapshotColumn(p))
            && (entity['keys'] == undefined || this.isSnapshotKeys(entity['keys'])));
    }

    /**
     * Resolves how a property an entity declares is stored.
     * @param metadata - What it declares.
     * @returns How it is stored.
     */
    static resolveProperty(metadata: PropertyMetadata): SnapshotProperty {
        if (!isRelationMetadata(metadata)) {
            return this.toSnapshotColumn(metadata);
        }
        const relation: SnapshotRelation = {
            type: 'relation',
            relation: metadata.type,
            target: MigratedEntityUtilities.resolveTableName(metadata.target()),
            inverseSide: String(metadata.inverseSide)
        };
        return metadata.type === Relation.MANY_TO_MANY && metadata.joinTable === true ? { ...relation, joinTable: true } : relation;
    }

    /**
     * Resolves the indexes, uniques and checks the data source keeps for an entity.
     *
     * Part of the snapshot although no migration changes them: a change of them gets a migration all
     * the same, which is what an earlier build of the same release finds it does not carry.
     * @param entity - The entity.
     * @returns Them, as the stores keep them, or undefined when it declares none.
     */
    private static resolveKeys(entity: Newable<BaseEntity>): SnapshotKeys | undefined {
        // the groups every store keeps, with the tenant leading them
        const groups: KeyGroups = keyGroupsOf(entity);
        const checks: KeyWhere[] = MetadataUtilities.getEntityMetadata(entity)?.checks?.map(c => c.where) ?? [];
        if (!groups.uniques.length && !groups.indexes.length && !checks.length) {
            return undefined;
        }
        return {
            ...groups.uniques.length ? { uniques: groups.uniques.map(u => u.where == undefined ? { properties: u.properties } : u) } : {},
            ...groups.indexes.length ? { indexes: groups.indexes } : {},
            ...checks.length ? { checks } : {}
        };
    }

    /**
     * Turns what an entity declares about a property that is no relation into how it is stored.
     *
     * What it holds by default, how it is encrypted and what it is validated against are left out:
     * none of it changes how it is stored, and a default or an encryption option may be a secret.
     * @param metadata - What it declares, or what an array declares about its items.
     * @returns How it is stored.
     */
    private static toSnapshotColumn(
        metadata: ExcludeStrict<PropertyMetadata, RelationMetadata<BaseEntity>> | ArrayPropertyItemMetadata
    ): SnapshotColumn {
        // a property required only sometimes is one whose column takes no value at all
        const required: Pick<SnapshotColumn, 'required'> = metadata.required === true ? {} : { required: false };
        switch (metadata.type) {
            case 'string': {
                return this.toStringColumn(metadata, required);
            }
            case 'number': {
                return this.toNumberColumn(metadata, required);
            }
            case 'array': {
                return { type: 'array', ...required, items: this.toSnapshotColumn(metadata.items) };
            }
            case 'oneOf': {
                const shapes: Record<string, SnapshotColumn> = {};
                for (const [name, shape] of ObjectUtilities.entries(metadata.shapes)) {
                    shapes[name] = this.toSnapshotColumn(shape);
                }
                return { type: 'oneOf', ...required, shapes };
            }
            case 'boolean':
            case 'date':
            case 'object':
            case 'unknown':
            case 'file': {
                return { type: metadata.type, ...required };
            }
        }
    }

    /**
     * Turns what an entity declares about a string property into how it is stored.
     * @param metadata - What it declares.
     * @param required - Whether its column takes no value at all.
     * @returns How it is stored.
     */
    private static toStringColumn(
        metadata: StoredStringPropertyMetadata,
        required: Pick<SnapshotColumn, 'required'>
    ): SnapshotColumn {
        return {
            type: 'string',
            ...required,
            ...metadata.primary ? { primary: true } : {},
            ...metadata.format == undefined ? {} : { format: metadata.format },
            ...metadata.maxLength == undefined ? {} : { maxLength: metadata.maxLength },
            ...metadata.enum == undefined ? {} : { enum: this.toEnumValues(metadata.enum, (v): v is string => typeof v === 'string') },
            ...metadata.encryption === false ? {} : { encrypted: true },
            ...metadata.hash === false ? {} : { hashed: true }
        };
    }

    /**
     * Turns what an entity declares about a number property into how it is stored.
     * @param metadata - What it declares.
     * @param required - Whether its column takes no value at all.
     * @returns How it is stored.
     */
    private static toNumberColumn(
        metadata: NumberPropertyMetadata,
        required: Pick<SnapshotColumn, 'required'>
    ): SnapshotColumn {
        return {
            type: 'number',
            ...required,
            ...metadata.primary ? { primary: true } : {},
            format: metadata.format,
            ...metadata.enum == undefined ? {} : { enum: this.toEnumValues(metadata.enum, (v): v is number => typeof v === 'number') }
        };
    }

    /**
     * The values of an enum, without the names a numeric enum maps back to.
     * @param values - The enum.
     * @param isValue - Whether a member is one of its values rather than a name mapped back.
     * @returns The values by name.
     */
    private static toEnumValues<T extends string | number>(values: AnyEnum, isValue: (value: unknown) => value is T): Record<string, T> {
        const res: Record<string, T> = {};
        for (const [name, value] of Object.entries(values)) {
            if (isValue(value)) {
                res[name] = value;
            }
        }
        return res;
    }

    private static isSnapshotRelation(value: unknown): value is SnapshotRelation {
        return this.isRecord(value)
            && value['type'] === 'relation'
            && Object.values(Relation).some(r => r === value['relation'])
            && typeof value['target'] === 'string'
            && typeof value['inverseSide'] === 'string'
            && (value['joinTable'] == undefined || value['joinTable'] === true);
    }

    private static isSnapshotColumn(value: unknown): value is SnapshotColumn {
        if (!this.isRecord(value) || (value['required'] != undefined && value['required'] !== false)) {
            return false;
        }
        switch (value['type']) {
            case 'string': {
                return (value['format'] == undefined || STRING_FORMATS.some(f => f === value['format']))
                    && (value['maxLength'] == undefined || typeof value['maxLength'] === 'number')
                    && (value['enum'] == undefined || this.isRecordOf(value['enum'], v => typeof v === 'string'));
            }
            case 'number': {
                return NUMBER_FORMATS.some(f => f === value['format'])
                    && (value['enum'] == undefined || this.isRecordOf(value['enum'], v => typeof v === 'number'));
            }
            case 'array': {
                return this.isSnapshotColumn(value['items']);
            }
            case 'oneOf': {
                return this.isRecordOf(value['shapes'], shape => this.isSnapshotColumn(shape));
            }
            default: {
                return PLAIN_TYPES.some(t => t === value['type']);
            }
        }
    }

    private static isSnapshotKeys(value: unknown): value is SnapshotKeys {
        const isProperties: (v: unknown) => boolean = v => Array.isArray(v) && v.every(p => typeof p === 'string');
        return this.isRecord(value)
            && (
                value['uniques'] == undefined
                || (Array.isArray(value['uniques']) && value['uniques'].every(u => this.isRecord(u) && isProperties(u['properties'])))
            )
            && (value['indexes'] == undefined || (Array.isArray(value['indexes']) && value['indexes'].every(isProperties)))
            && (value['checks'] == undefined || Array.isArray(value['checks']));
    }

    private static isRecordOf(value: unknown, isMember: (member: unknown) => boolean): boolean {
        return this.isRecord(value) && Object.values(value).every(isMember);
    }

    private static isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === 'object' && value != undefined && !Array.isArray(value);
    }
}