import { NumberFormat } from '../../entity/models/number-property-metadata.model';
import { Relation } from '../../entity/models/relation.enum';
import { StringFormat } from '../../entity/models/string-property-metadata.model';

/**
 * How a data source stores its entities, as generating a migration compares it: what decides how
 * each property is stored, and the indexes, uniques and checks kept on them. No default, no encryption
 * option and no validation is part of it, so nothing a snapshot holds is a secret.
 */
export type EntitySnapshot = {
    /**
     * The data source.
     */
    dataSource: string,
    /**
     * Its entities, by the table they are stored in.
     */
    entities: Record<string, SnapshotEntity>
};

/**
 * How one entity is stored.
 */
export type SnapshotEntity = {
    /**
     * The name of its class, which tells a renamed table from a new entity.
     */
    className: string,
    /**
     * Its properties by name.
     */
    properties: Record<string, SnapshotProperty>,
    /**
     * Its indexes, uniques and checks, present when it declares any.
     */
    keys?: SnapshotKeys
};

/**
 * The indexes, uniques and checks of an entity, as the data source keeps them.
 */
export type SnapshotKeys = {
    /**
     * The groups of properties that are unique together.
     */
    uniques?: SnapshotUnique[],
    /**
     * The groups of properties that are indexed together.
     */
    indexes?: string[][],
    /**
     * The filter of each check, which every row has to match.
     */
    checks?: unknown[]
};

/**
 * A group of properties that is unique together.
 */
export type SnapshotUnique = {
    /**
     * The properties, in the order they are declared.
     */
    properties: string[],
    /**
     * The filter of the rows they are unique among, when it is not all of them. Compared, never read.
     */
    where?: unknown
};

/**
 * How one property is stored: a column, or a relation.
 */
export type SnapshotProperty = SnapshotColumn | SnapshotRelation;

/**
 * How a property that is not a relation is stored.
 */
export type SnapshotColumn = SnapshotStringColumn | SnapshotNumberColumn | SnapshotArrayColumn | SnapshotOneOfColumn | SnapshotPlainColumn;

/**
 * What every column says.
 */
type SnapshotBaseColumn = {
    /**
     * Present when an entity may be stored without it.
     */
    required?: false
};

/**
 * How a string is stored.
 */
export type SnapshotStringColumn = SnapshotBaseColumn & {
    // eslint-disable-next-line jsdoc/require-jsdoc
    type: 'string',
    /**
     * Present on the primary key.
     */
    primary?: true,
    /**
     * Its format.
     */
    format?: StringFormat,
    /**
     * The most characters it holds.
     */
    maxLength?: number,
    /**
     * The values it may be.
     */
    enum?: Record<string, string>,
    /**
     * Present when what is stored is encrypted, which a conversion cannot read.
     */
    encrypted?: true,
    /**
     * Present when what is stored is a hash, which a conversion cannot read.
     */
    hashed?: true
};

/**
 * How a number is stored.
 */
export type SnapshotNumberColumn = SnapshotBaseColumn & {
    // eslint-disable-next-line jsdoc/require-jsdoc
    type: 'number',
    /**
     * Present on the primary key.
     */
    primary?: true,
    /**
     * Its format.
     */
    format: NumberFormat,
    /**
     * The values it may be.
     */
    enum?: Record<string, number>
};

/**
 * How an array is stored.
 */
export type SnapshotArrayColumn = SnapshotBaseColumn & {
    // eslint-disable-next-line jsdoc/require-jsdoc
    type: 'array',
    /**
     * What each item is.
     */
    items: SnapshotColumn
};

/**
 * How a value of several shapes is stored.
 */
export type SnapshotOneOfColumn = SnapshotBaseColumn & {
    // eslint-disable-next-line jsdoc/require-jsdoc
    type: 'oneOf',
    /**
     * What it may be, by the name of each shape.
     */
    shapes: Record<string, SnapshotColumn>
};

/**
 * How a property is stored whose type alone says it.
 */
export type SnapshotPlainColumn = SnapshotBaseColumn & {
    // eslint-disable-next-line jsdoc/require-jsdoc
    type: 'boolean' | 'date' | 'object' | 'unknown' | 'file'
};

/**
 * A relation, by the table on its other side.
 */
export type SnapshotRelation = {
    /**
     * Marks it as a relation.
     */
    type: 'relation',
    /**
     * Which kind of relation it is.
     */
    relation: Relation,
    /**
     * The table of the entity on its other side.
     */
    target: string,
    /**
     * The property on the other side that points back.
     */
    inverseSide: string,
    /**
     * Whether this side keeps the join table of a many to many relation.
     */
    joinTable?: true
};