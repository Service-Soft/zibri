import { BaseEntity } from '../../../entity/base-entity.model';
import { Newable } from '../../../types/newable.type';

/**
 * One column of a table, as the data source creates it and reads and writes it.
 */
export type PostgresColumn = {
    /**
     * Its name.
     */
    name: string,
    /**
     * The property it holds, or undefined for a key nothing declares: the key of a relation the
     * entity declares no property for, or a column of a join table.
     */
    property: string | undefined,
    /**
     * Its type, as postgres names it, without a length and without being an array.
     */
    type: string,
    /**
     * The longest text it holds, when it is limited.
     */
    length: number | undefined,
    /**
     * Whether it holds a list of its type.
     */
    isArray: boolean,
    /**
     * Whether it may hold no value.
     */
    nullable: boolean,
    /**
     * What it defaults to, as sql.
     */
    default: string | undefined,
    /**
     * How the database fills it in when a row is inserted without it.
     */
    generated: 'uuid' | 'increment' | undefined,
    /**
     * The collation it orders text by.
     */
    collation: string | undefined,
    /**
     * Turns a value of the property into what the column is handed.
     */
    toColumn: (value: unknown) => unknown,
    /**
     * Turns what the column hands back into a value of the property.
     */
    fromColumn: (value: unknown) => unknown
};

/**
 * What a foreign key does to the rows referring to a row that is deleted or whose key changes.
 */
export type PostgresReferentialAction = 'CASCADE' | 'NO ACTION';

/**
 * A named group of columns: a primary key, a unique or an index.
 */
export type PostgresKey = {
    /**
     * Its name.
     */
    name: string,
    /**
     * Its columns.
     */
    columns: string[]
};

/**
 * A foreign key of a table.
 */
export type PostgresForeignKey = PostgresKey & {
    /**
     * The table it refers to.
     */
    referencedTable: string,
    /**
     * The columns of that table it refers to.
     */
    referencedColumns: string[],
    /**
     * What it does once a referred row is deleted.
     */
    onDelete: PostgresReferentialAction,
    /**
     * What it does once the key of a referred row changes.
     */
    onUpdate: PostgresReferentialAction
};

/**
 * A table the data source creates: the table of an entity, or the join table of a many to many
 * relation.
 *
 * The indexes, uniques and checks an entity declares are not part of it: the data source keeps those
 * apart, as the entity declares them.
 */
export type PostgresTable = {
    /**
     * Its name.
     */
    name: string,
    /**
     * The entity it holds the rows of, or undefined for a join table.
     */
    entityClass: Newable<BaseEntity> | undefined,
    /**
     * Its columns.
     */
    columns: PostgresColumn[],
    /**
     * Its primary key.
     */
    primaryKey: PostgresKey,
    /**
     * Its foreign keys.
     */
    foreignKeys: PostgresForeignKey[],
    /**
     * The uniques its relations need: the key of a relation to one row that only one row may point at.
     */
    uniques: PostgresKey[],
    /**
     * The indexes its relations need: each column of a join table.
     */
    indexes: PostgresKey[]
};

/**
 * Where the rows of a relation are found, as a statement joins them.
 */
export type PostgresRelationJoin = {
    /**
     * The row holds the key of its related row, in `column` of its own table.
     */
    kind: 'key',
    /**
     * The table of the related rows.
     */
    table: string,
    /**
     * The column of the row's own table holding the key.
     */
    column: string
} | {
    /**
     * The related rows hold the key of the row, in `column` of their table.
     */
    kind: 'inverse',
    /**
     * The table of the related rows.
     */
    table: string,
    /**
     * The column of their table holding the key.
     */
    column: string
} | {
    /**
     * A join table holds a row per pair.
     */
    kind: 'junction',
    /**
     * The table of the related rows.
     */
    table: string,
    /**
     * The join table.
     */
    junction: string,
    /**
     * The column of the join table holding the key of the row.
     */
    ownColumn: string,
    /**
     * The column of the join table holding the key of the related row.
     */
    targetColumn: string
};