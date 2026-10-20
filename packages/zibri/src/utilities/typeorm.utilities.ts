import { DataSource, EntityTarget, EntityMetadata as TOEntityMetadata } from 'typeorm';
import { ColumnMetadata } from 'typeorm/metadata/ColumnMetadata.js';
import { ApplyValueTransformers } from 'typeorm/util/ApplyValueTransformers.js';

import { DataSourceInitializationError } from '../data-source/data-sources/data-source-initialization.error.ts';
import { ColumnType } from '../data-source/models/column-type.model.ts';
import { Transaction } from '../data-source/transaction/transaction.model.ts';
import { TypeOrmTransaction } from '../data-source/transaction/typeorm-transaction.model.ts';
import { BaseEntity } from '../entity/base-entity.model.ts';
import { InternalError } from '../error-handling/internal-error.model.ts';
import { Newable } from '../types/newable.type.ts';

/**
 * Utilities for dealing with typeorm.
 */
export abstract class TypeOrmUtilities {
    /**
     * The columns an entity declares, which is what a read of one row fills in.
     *
     * Told apart by `isVirtual` rather than by carrying a relation, and the difference is the whole
     * point: a relation whose key the entity does not declare gets a column the orm invented, named
     * after the relation, and writing that onto the entity would produce a half resolved relation
     * where a read produces nothing. A relation whose key the entity *does* declare shares that
     * column - the orm marks the declared one as the join column rather than adding a second - and
     * dropping it would lose a property every read hands back.
     * @param metadata - The entity's typeorm metadata.
     * @returns The columns to fill an entity in from.
     */
    static declaredColumnsOf(metadata: TOEntityMetadata): ColumnMetadata[] {
        return metadata.columns.filter(c => !c.isVirtual);
    }

    /**
     * Rebuilds entities out of the rows a statement handed back.
     *
     * The orm maps rows to entities for a read and not for a write, so this is the same walk over
     * the same metadata: a column says which key of the row it is stored under and what has to
     * happen to the value on the way out, which is where a json document is parsed and a number
     * regains the precision its column keeps. Written once because every statement that returns rows
     * itself - an upsert, an update that reports what it wrote - needs the identical walk.
     * @param entityClass - The entity to build.
     * @param columns - The columns to read, as {@link declaredColumnsOf} resolves them.
     * @param raw - What the statement returned, one entry per row.
     * @returns The rows as entities.
     */
    static toEntities<T extends BaseEntity>(entityClass: Newable<T>, columns: ColumnMetadata[], raw: unknown): T[] {
        if (!Array.isArray(raw)) {
            return [];
        }
        const rows: Record<string, unknown>[] = raw as Record<string, unknown>[];
        return rows.map((row) => {
            const entity: T = new entityClass();
            for (const column of columns) {
                if (!(column.databaseName in row)) {
                    continue;
                }
                column.setEntityValue(entity, this.fromColumnValue(column, row[column.databaseName]));
            }
            return entity;
        });
    }

    /**
     * Turns one stored value into what the entity holds.
     * @param column - The column it was read from.
     * @param value - The value as the database handed it over.
     * @returns The value the entity's property takes.
     */
    private static fromColumnValue(column: ColumnMetadata, value: unknown): unknown {
        if (column.transformer == undefined) {
            return value;
        }
        return ApplyValueTransformers.transformFrom(column.transformer, value);
    }

    /**
     * Turns one value an entity holds into what the column stores.
     * @param column - The column it is written to or compared against.
     * @param value - The value as the entity's property takes it.
     * @returns The value the database is handed.
     */
    static toColumnValue(column: ColumnMetadata, value: unknown): unknown {
        if (column.transformer == undefined) {
            return value;
        }
        return ApplyValueTransformers.transformTo(column.transformer, value);
    }

    /**
     * Gets the metadata for a typeorm column.
     * @param target - The entity.
     * @param propertyName - The name of the property to get the column metadata for.
     * @param transaction - The transaction to use to get the column metadata.
     * @returns The typeorm column metadata.
     * @throws When the provided propertyName could not be found as a column.
     */
    static getColumnMetadata<T extends BaseEntity>(
        target: EntityTarget<T>,
        propertyName: keyof T | string & {},
        transaction: Transaction
    ): ColumnMetadata {
        const metadata: TOEntityMetadata = this.getEntityMetadata(target, transaction);
        const column: ColumnMetadata | undefined = metadata.columns.find(
            (col) => col.propertyName === propertyName
        );

        if (!column) {
            throw new InternalError(
                `Column ${propertyName.toString()} not found in model`
            );
        }

        return column;
    }

    /**
     * Gets the typeorm metadata for a given entity.
     * @param target - The target entity.
     * @param transaction - The transaction to run this command with.
     * @returns The typeorm metadata.
     */
    static getEntityMetadata<T extends BaseEntity>(target: EntityTarget<T>, transaction: Transaction): TOEntityMetadata {
        return this.toTypeOrmTransaction(transaction).queryRunner.connection.getMetadata(target);
    }

    /**
     * Narrows the given transaction to a typeorm transaction.
     * @param transaction - The transaction to narrow.
     * @returns The transaction as a typeorm transaction.
     * @throws When the transaction has not been started by a typeorm based data source.
     */
    static toTypeOrmTransaction(transaction: Transaction): TypeOrmTransaction {
        if (!(transaction instanceof TypeOrmTransaction)) {
            throw new InternalError('The provided transaction does not belong to a typeorm based data source.');
        }
        return transaction;
    }

    // eslint-disable-next-line jsdoc/require-param
    /**
     * Normalizes the type of the given column using the provided dataSource.
     * @returns The normalized column type as a string.
     * @throws When no dataSource has been provided.
     */
    static normalizeColumnType(
        // oxlint-disable-next-line jsdoc/require-param
        dataSource: DataSource | undefined,
        column: {
            // eslint-disable-next-line jsdoc-js/require-jsdoc
            type?: ColumnType | string & {},
            // eslint-disable-next-line jsdoc-js/require-jsdoc
            length?: number | string,
            // eslint-disable-next-line jsdoc-js/require-jsdoc
            precision?: number | null,
            // eslint-disable-next-line jsdoc-js/require-jsdoc
            scale?: number,
            // eslint-disable-next-line jsdoc-js/require-jsdoc
            isArray?: boolean
        }
    ): string {
        if (!dataSource) {
            throw new DataSourceInitializationError();
        }
        return dataSource.driver.normalizeType(column);
    }
}