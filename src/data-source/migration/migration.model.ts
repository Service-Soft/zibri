import { EntityMetadata as TOEntityMetadata, EntityTarget, TableColumn, TableColumnOptions } from 'typeorm';
import { ColumnMetadata as TOColumnMetadata } from 'typeorm/metadata/ColumnMetadata';

import { inject, repositoryTokenFor } from '../../di';
import { BaseEntity, FilePropertyMetadata, PropertyMetadata, PropertyMetadataInput, RelationMetadata } from '../../entity';
import { ExcludeStrict, Newable, Version } from '../../types';
import { BaseDataSource } from '../base-data-source.model';
import { Repository } from '../repository';
import { Transaction } from '../transaction';
import { MigrationEntity } from './migration-entity.model';

/**
 * Base class for a database migration.
 */
export abstract class Migration {
    abstract readonly version: Version;
    /**
     * The data source that the migration is for.
     */
    protected readonly dataSource: BaseDataSource;
    /**
     * The repository that syncs migrations back and forth to the db.
     */
    protected readonly migrationRepository: Repository<MigrationEntity>;

    constructor(dataSourceClass: Newable<BaseDataSource>) {
        this.dataSource = inject(dataSourceClass);
        this.migrationRepository = inject(repositoryTokenFor(MigrationEntity));
    }

    /**
     * Runs the migration.
     */
    async runUp(): Promise<void> {
        const transaction: Transaction = await this.dataSource.startTransaction();
        try {
            await this.up(transaction);
            await this.migrationRepository.create(
                {
                    version: this.version,
                    name: this.constructor.name,
                    ranAt: new Date()
                },
                { transaction }
            );
            await transaction.commit();
        }
        catch (error) {
            await transaction.rollback();
            throw error;
        }
    }

    /**
     * Revers the migration.
     */
    async runDown(): Promise<void> {
        const transaction: Transaction = await this.dataSource.startTransaction();
        try {
            await this.down(transaction);
            await this.migrationRepository.deleteAll({ version: this.version }, { transaction });
            await transaction.commit();
        }
        catch (error) {
            await transaction.rollback();
            throw error;
        }
    }

    protected abstract up(transaction: Transaction): Promise<void>;
    protected abstract down(transaction: Transaction): Promise<void>;

    /**
     * Adds a column to the table of the given entity.
     * @param entity - The entity for which the column should be added.
     * @param key - The key of the entity for which a column should be added.
     * @param transaction - The transaction to run this inside of.
     */
    protected async addColumn<T extends BaseEntity>(
        entity: Newable<T>,
        key: keyof T,
        transaction: Transaction
    ): Promise<void> {
        const col: TableColumnOptions = this.dataSource.propertyToTableColumnOptions(entity, key);
        await transaction.queryRunner.addColumn(
            this.getEntityMetadata(entity, transaction).tableName,
            new TableColumn({ ...col, isNullable: true })
        );
    }

    /**
     * Changes a column of the provided entity to the new column value.
     * @param entity - The entity that the column belongs to which should be changed.
     * @param oldColumn - The old column key.
     * @param newColumn - The new data that should replace the provided old column.
     * @param transaction - The transaction that should be used.
     */
    protected async changeColumn<T extends BaseEntity>(
        entity: Newable<T>,
        oldColumn: keyof T | string & {},
        newColumn: PropertyMetadataInput & {
            /**
             * The name of the new column.
             */
            name?: keyof T,
            /**
             * The type of the new column.
             */
            type: ExcludeStrict<PropertyMetadata, RelationMetadata<BaseEntity> | FilePropertyMetadata>['type']
        },
        transaction: Transaction
    ): Promise<void> {
        const entityMetadata: TOEntityMetadata = this.getEntityMetadata(entity, transaction);
        const columnMetadata: TOColumnMetadata = this.getColumnMetadata(entity, oldColumn, transaction);

        const col: TableColumnOptions = {
            ...columnMetadata,
            ...newColumn,
            enum: 'enum' in newColumn && newColumn.enum
                ? Object.values(newColumn.enum).map(v => String(v))
                : columnMetadata.enum
                    ? columnMetadata.enum.map(v => String(v))
                    : undefined,
            name: String(newColumn.name ?? oldColumn),
            type: this.dataSource.normalizeColumnType({
                precision: undefined,
                scale: undefined,
                ...columnMetadata,
                ...newColumn,
                type: this.dataSource['columnTypeMapping'][newColumn.type]
            })
        };

        await transaction.queryRunner.changeColumn(entityMetadata.tableName, String(oldColumn), new TableColumn(col));
    }

    /**
     * Gets the metadata for a typeorm column.
     * @param target - The entity.
     * @param propertyName - The name of the property to get the column metadata for.
     * @param transaction - The transaction to use to get the column metadata.
     * @returns The typeorm column metadata.
     * @throws When the provided propertyName could not be found as a column.
     */
    protected getColumnMetadata<T extends BaseEntity>(
        target: EntityTarget<T>,
        propertyName: keyof T | string & {},
        transaction: Transaction
    ): TOColumnMetadata {
        const metadata: TOEntityMetadata = this.getEntityMetadata(target, transaction);
        const column: TOColumnMetadata | undefined = metadata.columns.find(
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
    protected getEntityMetadata<T extends BaseEntity>(target: EntityTarget<T>, transaction: Transaction): TOEntityMetadata {
        return transaction.queryRunner.connection.getMetadata(target);
    }
}