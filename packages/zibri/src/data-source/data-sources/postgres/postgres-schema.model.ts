import { createHash } from 'node:crypto';

import { PostgresColumn, PostgresForeignKey, PostgresKey, PostgresReferentialAction, PostgresRelationJoin, PostgresTable } from './postgres-table.model';
import { BaseEntity } from '../../../entity/base-entity.model';
import { EntityMetadata } from '../../../entity/decorators/entity.decorator';
import { PropertyMetadata, RelationMetadata } from '../../../entity/decorators/property.decorator';
import { EntityMetadataMissingError } from '../../../entity/entity-metadata-missing.error';
import { ArrayPropertyItemMetadata } from '../../../entity/models/array-property-metadata.model';
import { isRelationMetadata } from '../../../entity/models/is-relation-metadata.function';
import { NumberFormat } from '../../../entity/models/number-property-metadata.model';
import { Relation } from '../../../entity/models/relation.enum';
import { InternalError } from '../../../error-handling/internal-error.model';
import { parseArray } from '../../../parsing/functions/parse-array.function';
import { parseObject } from '../../../parsing/functions/parse-object.function';
import { parseOneOf } from '../../../parsing/functions/parse-one-of.function';
import { toJsonValue } from '../../../parsing/functions/to-json-value.function';
import { ExcludeStrict } from '../../../types/exclude-strict.type';
import { Newable } from '../../../types/newable.type';
import { JsonUtilities } from '../../../utilities/json.utilities';
import { MetadataUtilities } from '../../../utilities/metadata.utilities';
import { BigNumber } from '../../../utilities/number.utilities';
import { ObjectUtilities } from '../../../utilities/object.utilities';
import { readNumber } from '../../../utilities/read-number.function';
import { literalToSql } from '../../literal-to-sql.function';

/**
 * A property that is stored in a column of its own, rather than through a relation.
 */
export type ColumnPropertyMetadata = ExcludeStrict<PropertyMetadata, RelationMetadata<BaseEntity>>;

/**
 * What a data source decides about the columns it creates.
 */
export type PostgresColumnSettings = {
    /**
     * The type a property of the given kind is stored as.
     */
    resolveType: (metadata: ColumnPropertyMetadata | ArrayPropertyItemMetadata) => string,
    /**
     * The collation every text column orders by.
     */
    textCollation: string,
    /**
     * What a column defaults to, for the writes the application does not make itself.
     */
    resolveDefault: (metadata: ColumnPropertyMetadata) => string | number | boolean | Date | undefined
};

/**
 * The names postgres knows a type by, for the ones it has a second name for.
 */
const TYPE_NAMES: ReadonlyMap<string, string> = new Map([
    ['varchar', 'character varying'],
    ['timestamptz', 'timestamp with time zone'],
    ['timestamp', 'timestamp without time zone'],
    ['bool', 'boolean'],
    ['int', 'integer'],
    ['int4', 'integer'],
    ['int2', 'smallint'],
    ['int8', 'bigint'],
    ['decimal', 'numeric'],
    ['float', 'double precision'],
    ['float8', 'double precision'],
    ['float4', 'real']
]);

/**
 * The tables a postgres data source keeps for its entities, built from what the entities declare.
 *
 * Named the way typeorm named them, which created the tables of every database before this did: a
 * key named otherwise would be dropped and built again by the first start against such a database.
 */
export class PostgresSchema {

    private readonly entityTables: Map<Newable<BaseEntity>, PostgresTable> = new Map();

    private readonly joins: Map<Newable<BaseEntity>, Map<string, PostgresRelationJoin>> = new Map();

    /**
     * Every table, those of the entities and their join tables.
     */
    readonly tables: PostgresTable[] = [];

    /**
     * Builds the tables of the given entities.
     * @param entities - The entities, each once.
     * @param settings - What the data source decides about the columns.
     * @param tableNames - The tables entities are stored in other than the one they declare, for a
     * migration naming what was stored under an older name.
     */
    constructor(
        entities: Newable<BaseEntity>[],
        private readonly settings: PostgresColumnSettings,
        private readonly tableNames: ReadonlyMap<Newable<BaseEntity>, string> = new Map()
    ) {
        for (const entity of entities) {
            this.entityTables.set(entity, this.buildColumns(entity));
        }
        // once every table has its columns, since a key refers to the primary key of another table
        for (const entity of entities) {
            this.addRelations(entity);
        }
        this.tables.unshift(...this.entityTables.values());
    }

    /**
     * Gets the collation every text column orders by.
     * @returns Its name.
     */
    getTextCollation(): string {
        return this.settings.textCollation;
    }

    /**
     * Gets the table of an entity.
     * @param entityClass - The entity.
     * @returns Its table.
     * @throws When the entity is not one of this schema.
     */
    getTable(entityClass: Newable<BaseEntity>): PostgresTable {
        const table: PostgresTable | undefined = this.entityTables.get(entityClass);
        if (table == undefined) {
            throw new InternalError(`The entity "${entityClass.name}" is not stored in this data source.`);
        }
        return table;
    }

    /**
     * Gets the column a property of an entity is stored in.
     * @param entityClass - The entity.
     * @param property - The property.
     * @returns The column.
     * @throws When the property has no column of its own.
     */
    getColumn(entityClass: Newable<BaseEntity>, property: string): PostgresColumn {
        const column: PostgresColumn | undefined = this.getTable(entityClass).columns.find(c => c.property === property);
        if (column == undefined) {
            throw new InternalError(`"${entityClass.name}" stores no column for "${property}".`);
        }
        return column;
    }

    /**
     * Gets where the rows of a relation are found.
     * @param entityClass - The entity the relation is read from.
     * @param property - The relation.
     * @returns How a statement joins its rows.
     * @throws When the property is no relation of the entity.
     */
    getJoin(entityClass: Newable<BaseEntity>, property: string): PostgresRelationJoin {
        const join: PostgresRelationJoin | undefined = this.joins.get(entityClass)?.get(property);
        if (join == undefined) {
            throw new InternalError(`"${entityClass.name}.${property}" is no relation stored in this data source.`);
        }
        return join;
    }

    /**
     * Rebuilds entities out of rows a statement read, under the names the columns were selected as.
     * @param entityClass - The entity to build.
     * @param rows - The rows.
     * @param prefix - What the name of each column was selected under starts with, nothing for its own name.
     * @returns The entities.
     */
    toEntities<T extends BaseEntity>(entityClass: Newable<T>, rows: Record<string, unknown>[], prefix: string = ''): T[] {
        const columns: PostgresColumn[] = this.getTable(entityClass).columns.filter(c => c.property != undefined);
        return rows.map(row => {
            const entity: T = new entityClass();
            for (const column of columns) {
                const name: string = `${prefix}${column.name}`;
                if (name in row) {
                    Reflect.set(entity, column.property ?? column.name, column.fromColumn(row[name]));
                }
            }
            return entity;
        });
    }

    /**
     * The full type of a column, as a statement declares it.
     * @param column - The column.
     * @returns Its type, with its length and as an array when it is one.
     */
    static resolveFullType(column: Pick<PostgresColumn, 'type' | 'length' | 'isArray'>): string {
        const length: string = column.length == undefined ? '' : `(${column.length})`;
        return `${column.type}${length}${column.isArray ? '[]' : ''}`;
    }

    /**
     * The name a key gets, the way typeorm named the keys it created: a prefix and part of a hash of
     * the table and the columns.
     * @param prefix - What the name starts with, such as `PK_`.
     * @param table - The table.
     * @param columns - The columns, in any order.
     * @param hashLength - How much of the hash the name holds.
     * @returns The name.
     */
    static resolveKeyName(prefix: string, table: string, columns: string[], hashLength: number): string {
        const key: string = `${table.replace('.', '_')}_${[...columns].sort().join('_')}`;
        return prefix + createHash('sha1').update(key)
            .digest('hex')
            .slice(0, hashLength);
    }

    /**
     * Resolves the name of the join table of a many to many relation.
     * @param ownerTable - The table of the side owning the join table.
     * @param key - The relation's property on that side.
     * @param inverseTable - The table of the other side.
     * @returns The name, in snake case.
     */
    static resolveJoinTableName(ownerTable: string, key: string, inverseTable: string): string {
        return `${ownerTable}_${key}_${inverseTable}`
            .replaceAll(/([A-Z])([A-Z])([a-z])/g, '$1_$2$3')
            .replaceAll(/([\da-z])([A-Z])/g, '$1_$2')
            .toLowerCase();
    }

    /**
     * Builds the table of an entity, with the columns of its own properties.
     * @param entity - The entity.
     * @returns The table, without the columns and keys of its relations.
     * @throws When the entity declares no primary property, or more than one.
     */
    private buildColumns(entity: Newable<BaseEntity>): PostgresTable {
        const metadata: EntityMetadata | undefined = MetadataUtilities.getEntityMetadata(entity);
        if (metadata == undefined) {
            throw new EntityMetadataMissingError(entity);
        }
        const tableName: string = this.tableNames.get(entity) ?? metadata.tableName;
        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(entity);
        const primaries: string[] = ObjectUtilities.keys(properties).filter(key => {
            const property: PropertyMetadata | undefined = properties[key];
            return property != undefined && 'primary' in property && property.primary;
        });
        if (primaries.length !== 1) {
            throw new InternalError(
                `The entity "${entity.name}" declares ${primaries.length} primary properties, where it needs exactly one.`
            );
        }
        const columns: PostgresColumn[] = [];
        for (const [key, property] of ObjectUtilities.entries(properties)) {
            if (!isRelationMetadata(property)) {
                columns.push(this.buildColumn(key, property));
            }
        }
        return {
            name: tableName,
            entityClass: entity,
            columns,
            primaryKey: { name: PostgresSchema.resolveKeyName('PK_', tableName, primaries, 27), columns: primaries },
            foreignKeys: [],
            uniques: [],
            indexes: []
        };
    }

    /**
     * Builds the column a property is stored in.
     * @param name - The property.
     * @param metadata - What it declares.
     * @returns The column.
     */
    private buildColumn(name: string, metadata: ColumnPropertyMetadata): PostgresColumn {
        const isPrimary: boolean = 'primary' in metadata && metadata.primary;
        const column: PostgresColumn = {
            name,
            property: name,
            type: this.resolveTypeName(metadata),
            length: undefined,
            isArray: false,
            nullable: !isPrimary && metadata.required !== true,
            default: this.resolveDefaultSql(this.settings.resolveDefault(metadata)),
            generated: undefined,
            collation: undefined,
            toColumn: value => value,
            fromColumn: value => value
        };
        switch (metadata.type) {
            case 'string': {
                if (metadata.format === 'uuid' || isPrimary) {
                    column.type = 'uuid';
                }
                else {
                    // the order the application says text has, so that a query ordering or comparing
                    // this column answers what the same order and filter answer in process
                    column.collation = this.settings.textCollation;
                    column.length = metadata.maxLength;
                }
                if (isPrimary) {
                    column.generated = 'uuid';
                }
                return column;
            }
            case 'number': {
                if (isPrimary) {
                    column.generated = 'increment';
                }
                return { ...column, ...this.resolveNumberCodec(metadata.format, false) };
            }
            case 'object': {
                return { ...column, ...this.resolveJsonCodec(value => parseObject(value, metadata.cls())) };
            }
            case 'oneOf': {
                return { ...column, default: undefined, ...this.resolveJsonCodec(value => parseOneOf(value, metadata)) };
            }
            case 'unknown': {
                // no way back: a property that says nothing about what it holds leaves nothing to read
                // a date or an exact decimal by, so what json held is what comes out
                return { ...column, ...this.resolveJsonCodec(undefined) };
            }
            case 'array': {
                // an array of objects, or of values of several shapes, is one json value rather than a list
                const items: ArrayPropertyItemMetadata = metadata.items;
                if (items.type === 'object' || items.type === 'oneOf') {
                    return { ...column, default: undefined, ...this.resolveJsonCodec(value => parseArray(value, items)) };
                }
                const itemColumn: PostgresColumn = { ...column, type: this.resolveTypeName(items), isArray: true, default: undefined };
                return items.type === 'number' ? { ...itemColumn, ...this.resolveNumberCodec(items.format, true) } : itemColumn;
            }
            case 'boolean':
            case 'date':
            case 'file': {
                return column;
            }
        }
    }

    /**
     * Resolves the type a property is stored as, by the name postgres knows it by.
     * @param metadata - The property, or the items of an array.
     * @returns The type.
     */
    private resolveTypeName(metadata: ColumnPropertyMetadata | ArrayPropertyItemMetadata): string {
        const type: string = this.settings.resolveType(metadata);
        return TYPE_NAMES.get(type) ?? type;
    }

    /**
     * Writes a default as the sql a column declares it with.
     * @param value - The default.
     * @returns The sql, or undefined for no default.
     */
    private resolveDefaultSql(value: string | number | boolean | Date | undefined): string | undefined {
        if (value == undefined) {
            return undefined;
        }
        if (typeof value === 'boolean') {
            return String(value);
        }
        // a number quoted, as the tables typeorm created declare it
        return typeof value === 'number' ? `'${value}'` : literalToSql(value);
    }

    /**
     * The codec of a number column, or of an array of numbers.
     *
     * What comes back is text wherever the column holds more than a javascript number does, so the
     * format is what reads it into the type its property declares. An exact decimal is the one kind
     * the driver cannot write, so it is handed over as text.
     * @param format - What kind of number the property holds.
     * @param isArray - Whether the column holds a list of them.
     * @returns The codec.
     */
    private resolveNumberCodec(format: NumberFormat, isArray: boolean): Pick<PostgresColumn, 'toColumn' | 'fromColumn'> {
        // toFixed rather than toString, because bignumber.js writes an exponent past its configured
        // range and postgres reads "1e+25" as a numeric it cannot parse
        // a missing value is written as sql NULL
        // eslint-disable-next-line unicorn/no-null
        const to: (value: unknown) => unknown = value => value instanceof BigNumber ? value.toFixed() : value ?? null;
        const from: (value: unknown) => unknown = value => {
            if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
                return readNumber(value, format);
            }
            return value;
        };
        return isArray
            ? {
                toColumn: value => Array.isArray(value) ? value.map(to) : to(value),
                fromColumn: value => Array.isArray(value) ? value.map(from) : from(value)
            }
            : { toColumn: to, fromColumn: from };
    }

    /**
     * The codec of a json column.
     *
     * A json column is the one place a value is stored without a column saying what it is, so a date,
     * a bigint or an exact decimal travels as text and the property is what reads it back.
     * @param restore - What turns what json holds back into what the property declares, undefined to
     * hand it over as it is.
     * @returns The codec.
     */
    private resolveJsonCodec(restore: ((value: unknown) => unknown) | undefined): Pick<PostgresColumn, 'type' | 'toColumn' | 'fromColumn'> {
        return {
            type: 'jsonb',
            toColumn: value => value == undefined ? value : JsonUtilities.stringify(toJsonValue(value)),
            fromColumn: value => restore == undefined || value == undefined ? value : restore(value)
        };
    }

    /**
     * Adds the columns, keys and joins of an entity's relations.
     * @param entity - The entity.
     */
    private addRelations(entity: Newable<BaseEntity>): void {
        const table: PostgresTable = this.getTable(entity);
        const joins: Map<string, PostgresRelationJoin> = new Map();
        this.joins.set(entity, joins);
        for (const [key, property] of ObjectUtilities.entries(MetadataUtilities.getModelProperties(entity))) {
            if (!isRelationMetadata(property)) {
                continue;
            }
            const target: PostgresTable = this.resolveRelatedTable(entity, key, property);
            switch (property.type) {
                case Relation.MANY_TO_ONE:
                case Relation.BELONGS_TO_ONE: {
                    this.addKeyColumn(table, target, property);
                    joins.set(key, { kind: 'key', table: target.name, column: property.joinColumn });
                    break;
                }
                case Relation.ONE_TO_MANY:
                case Relation.HAS_ONE: {
                    joins.set(key, { kind: 'inverse', table: target.name, column: this.resolveInverseColumn(entity, key, property) });
                    break;
                }
                case Relation.MANY_TO_MANY: {
                    joins.set(key, this.resolveJunctionJoin(table, target, key, property));
                    break;
                }
            }
        }
    }

    /**
     * Adds the column a relation to one row keeps the key of its related row in, with the foreign key
     * on it - and, for a relation only one row may point at the related row through, the unique.
     * @param table - The table of the row.
     * @param target - The table of the related row.
     * @param property - The relation.
     */
    private addKeyColumn(
        table: PostgresTable,
        target: PostgresTable,
        property: RelationMetadata<BaseEntity> & {
            /**
             * The column the key of the related row is kept in.
             */
            joinColumn: string
        }
    ): void {
        const referenced: PostgresColumn = this.resolvePrimaryColumn(target);
        const declared: PostgresColumn | undefined = table.columns.find(c => c.name === property.joinColumn);
        if (declared == undefined) {
            table.columns.push({
                ...referenced,
                name: property.joinColumn,
                property: undefined,
                nullable: property.required !== true,
                default: undefined,
                generated: undefined
            });
        }
        else {
            // a key holds what the key it refers to holds, whatever the property declares
            declared.type = referenced.type;
        }
        table.foreignKeys.push({
            name: PostgresSchema.resolveKeyName('FK_', table.name, [property.joinColumn], 27),
            columns: [property.joinColumn],
            referencedTable: target.name,
            referencedColumns: [referenced.name],
            ...this.resolveActions(property)
        });
        if (property.type === Relation.BELONGS_TO_ONE) {
            table.uniques.push({
                name: PostgresSchema.resolveKeyName('REL_', table.name, [property.joinColumn], 26),
                columns: [property.joinColumn]
            });
        }
    }

    /**
     * Resolves the join of a many to many relation, and creates its join table on the side that owns it.
     * @param table - The table of the side the relation is read from.
     * @param target - The table of the other side.
     * @param key - The relation's property.
     * @param property - The relation.
     * @returns The join.
     * @throws When neither side of the relation sets `joinTable`.
     */
    private resolveJunctionJoin(
        table: PostgresTable,
        target: PostgresTable,
        key: string,
        property: RelationMetadata<BaseEntity> & {
            /**
             * Whether this side owns the join table.
             */
            joinTable: boolean | undefined
        }
    ): PostgresRelationJoin {
        if (property.joinTable === true) {
            const junction: PostgresTable = this.buildJunctionTable(table, target, key, property);
            this.tables.push(junction);
            const [own, related] = junction.columns;
            return {
                kind: 'junction',
                table: target.name,
                junction: junction.name,
                ownColumn: own?.name ?? '',
                targetColumn: related?.name ?? ''
            };
        }
        const inverse: PropertyMetadata | undefined = MetadataUtilities.getModelProperties(property.target())[String(property.inverseSide)];
        if (inverse?.type !== Relation.MANY_TO_MANY || inverse.joinTable !== true) {
            throw new InternalError(
                `The many to many relation "${table.name}.${key}" needs "joinTable" set on one of its two sides.`
            );
        }
        // the owning side builds the join table, from its own end
        const owned: PostgresTable = this.buildJunctionTable(target, table, String(property.inverseSide), inverse);
        const [related, own] = owned.columns;
        return {
            kind: 'junction',
            table: target.name,
            junction: owned.name,
            ownColumn: own?.name ?? '',
            targetColumn: related?.name ?? ''
        };
    }

    /**
     * Builds the join table of a many to many relation, from the side owning it.
     * @param owner - The table of the owning side.
     * @param inverse - The table of the other side.
     * @param key - The relation's property on the owning side.
     * @param property - The relation, as the owning side declares it.
     * @returns The join table: the column of the owning side first.
     */
    private buildJunctionTable(
        owner: PostgresTable,
        inverse: PostgresTable,
        key: string,
        property: RelationMetadata<BaseEntity>
    ): PostgresTable {
        const name: string = PostgresSchema.resolveJoinTableName(owner.name, key, inverse.name);
        const ownerKey: PostgresColumn = this.resolvePrimaryColumn(owner);
        const inverseKey: PostgresColumn = this.resolvePrimaryColumn(inverse);
        let ownerColumn: string = this.camelCase(`${owner.name}_${ownerKey.name}`);
        let inverseColumn: string = this.camelCase(`${inverse.name}_${inverseKey.name}`);
        if (ownerColumn === inverseColumn) {
            ownerColumn = `${ownerColumn}_1`;
            inverseColumn = `${inverseColumn}_2`;
        }
        const columnOf: (column: string, referenced: PostgresColumn) => PostgresColumn = (column, referenced) => ({
            ...referenced,
            name: column,
            property: undefined,
            nullable: false,
            default: undefined,
            generated: undefined
        });
        const inverseProperty: PropertyMetadata | undefined = MetadataUtilities
            .getModelProperties(property.target())[String(property.inverseSide)];
        const ownerActions: Pick<PostgresForeignKey, 'onDelete' | 'onUpdate'> = this.resolveActions(property);
        return {
            name,
            entityClass: undefined,
            columns: [columnOf(ownerColumn, ownerKey), columnOf(inverseColumn, inverseKey)],
            primaryKey: {
                name: PostgresSchema.resolveKeyName('PK_', name, [ownerColumn, inverseColumn], 27),
                columns: [ownerColumn, inverseColumn]
            },
            foreignKeys: [
                {
                    name: PostgresSchema.resolveKeyName('FK_', name, [ownerColumn], 27),
                    columns: [ownerColumn],
                    referencedTable: owner.name,
                    referencedColumns: [ownerKey.name],
                    // the side owning the join table removes its rows with it, whatever it declares
                    onDelete: 'CASCADE',
                    onUpdate: 'CASCADE'
                },
                {
                    name: PostgresSchema.resolveKeyName('FK_', name, [inverseColumn], 27),
                    columns: [inverseColumn],
                    referencedTable: inverse.name,
                    referencedColumns: [inverseKey.name],
                    ...isRelationMetadata(inverseProperty) ? ownerActions : { onDelete: 'CASCADE', onUpdate: 'CASCADE' }
                }
            ],
            uniques: [],
            indexes: [ownerColumn, inverseColumn].map((column): PostgresKey => ({
                name: PostgresSchema.resolveKeyName('IDX_', name, [column], 26),
                columns: [column]
            }))
        };
    }

    /**
     * Resolves the column of the related rows holding the key of the row a relation is read from.
     * @param entity - The entity the relation is read from.
     * @param key - The relation's property.
     * @param property - The relation.
     * @returns The column: the key of the relation back, or the property itself when it is a column,
     * as the id a change set carries of its entity is.
     * @throws When the related entity declares nothing holding the key.
     */
    private resolveInverseColumn(entity: Newable<BaseEntity>, key: string, property: RelationMetadata<BaseEntity>): string {
        const inverseSide: string = String(property.inverseSide);
        const inverse: PropertyMetadata | undefined = MetadataUtilities.getModelProperties(property.target())[inverseSide];
        if (inverse?.type === Relation.MANY_TO_ONE || inverse?.type === Relation.BELONGS_TO_ONE) {
            return inverse.joinColumn;
        }
        if (inverse == undefined || isRelationMetadata(inverse)) {
            throw new InternalError(
                `"${entity.name}.${key}" needs "${inverseSide}" of "${property.target().name}" to hold its key.`
            );
        }
        return inverseSide;
    }

    /**
     * What a foreign key of a relation does to the rows referring to one that changes: cascade, when
     * the relation or its inverse cascades removes or updates, and nothing otherwise.
     * @param property - The relation.
     * @returns The actions.
     */
    private resolveActions(property: RelationMetadata<BaseEntity>): Pick<PostgresForeignKey, 'onDelete' | 'onUpdate'> {
        const inverse: PropertyMetadata | undefined = MetadataUtilities.getModelProperties(property.target())[String(property.inverseSide)];
        const cascades: (flag: 'remove' | 'update') => PostgresReferentialAction = flag => this.hasCascade(property.cascade, flag)
            || (isRelationMetadata(inverse) && this.hasCascade(inverse.cascade, flag))
            ? 'CASCADE'
            : 'NO ACTION';
        return { onDelete: cascades('remove'), onUpdate: cascades('update') };
    }

    private hasCascade(cascade: RelationMetadata<BaseEntity>['cascade'], flag: 'remove' | 'update'): boolean {
        return cascade === true || (Array.isArray(cascade) && cascade.includes(flag));
    }

    /**
     * Resolves the table of the entity a relation points at.
     * @param entity - The entity the relation is declared on.
     * @param key - The relation's property.
     * @param property - The relation.
     * @returns The table.
     * @throws When the related entity is not one of this schema.
     */
    private resolveRelatedTable(entity: Newable<BaseEntity>, key: string, property: RelationMetadata<BaseEntity>): PostgresTable {
        const target: PostgresTable | undefined = this.entityTables.get(property.target());
        if (target == undefined) {
            throw new InternalError(
                `"${entity.name}.${key}" points at "${property.target().name}", which is not stored in the same data source.`
            );
        }
        return target;
    }

    private resolvePrimaryColumn(table: PostgresTable): PostgresColumn {
        const column: PostgresColumn | undefined = table.columns.find(c => c.name === table.primaryKey.columns[0]);
        if (column == undefined) {
            throw new InternalError(`The table "${table.name}" has no primary column.`);
        }
        return column;
    }

    private camelCase(value: string): string {
        return value.replaceAll(
            /^([A-Z])|[\s_-](\w)/g,
            (_, first?: string, next?: string) => next?.toUpperCase() ?? first?.toLowerCase() ?? ''
        );
    }
}