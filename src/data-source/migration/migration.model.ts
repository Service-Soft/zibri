import { EntityMetadata as TOEntityMetadata, EntityTarget, TableColumn, TableColumnOptions } from 'typeorm';
import { ColumnMetadata as TOColumnMetadata } from 'typeorm/metadata/ColumnMetadata';

import { inject, repositoryTokenFor } from '../../di';
import { BaseEntity, FilePropertyMetadata, PropertyMetadata, PropertyMetadataInput, RelationMetadata } from '../../entity';
import { ExcludeStrict, Newable, Version } from '../../types';
import { BaseDataSource } from '../base-data-source.model';
import { Repository } from '../repository.model';
import { Transaction } from '../transaction';
import { MigrationEntity } from './migration-entity.model';

export abstract class Migration {
    abstract readonly version: Version;
    protected readonly dataSource: BaseDataSource;
    protected readonly migrationRepository: Repository<MigrationEntity>;

    constructor(dataSourceClass: Newable<BaseDataSource>) {
        this.dataSource = inject(dataSourceClass);
        this.migrationRepository = inject(repositoryTokenFor(MigrationEntity));
    }

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

    protected async changeColumn<T extends BaseEntity>(
        entity: Newable<T>,
        oldColumn: keyof T | string & {},
        newColumn: PropertyMetadataInput & {
            name?: keyof T,
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

    protected getEntityMetadata<T extends BaseEntity>(target: EntityTarget<T>, transaction: Transaction): TOEntityMetadata {
        return transaction.queryRunner.connection.getMetadata(target);
    }
}