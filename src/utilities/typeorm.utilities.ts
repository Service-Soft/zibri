import { DataSource, EntityTarget, EntityMetadata as TOEntityMetadata } from 'typeorm';
import { ColumnMetadata } from 'typeorm/metadata/ColumnMetadata.js';

import { ColumnType } from '../data-source/models/column-type.model';
import { Transaction } from '../data-source/transaction/transaction.model';
import { BaseEntity } from '../entity/base-entity.model';

/**
 * Utilities for dealing with typeorm.
 */
export abstract class TypeOrmUtilities {
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
            throw new Error(
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
        return transaction.queryRunner.connection.getMetadata(target);
    }

    // eslint-disable-next-line jsdoc/require-param
    /**
     * Normalizes the type of the given column using the provided dataSource.
     * @returns The normalized column type as a string.
     * @throws When no dataSource has been provided.
     */
    static normalizeColumnType(
        dataSource: DataSource | undefined,
        column: {
            // eslint-disable-next-line jsdoc/require-jsdoc
            type?: ColumnType | string & {},
            // eslint-disable-next-line jsdoc/require-jsdoc
            length?: number | string,
            // eslint-disable-next-line jsdoc/require-jsdoc
            precision?: number | null,
            // eslint-disable-next-line jsdoc/require-jsdoc
            scale?: number,
            // eslint-disable-next-line jsdoc/require-jsdoc
            isArray?: boolean
        }
    ): string {
        if (!dataSource) {
            throw new Error('The data source needs to be initialized before it can be used.');
        }
        return dataSource.driver.normalizeType(column);
    }
}