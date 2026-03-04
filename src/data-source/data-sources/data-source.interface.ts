import { IsolationLevel } from 'typeorm/driver/types/IsolationLevel';

import { BackupResourceInterface } from '../../backup/backup-resource.interface';
import { BaseEntity } from '../../entity/base-entity.model';
import { PropertyMetadataInput, PropertyMetadata, RelationMetadata } from '../../entity/decorators/property.decorator';
import { FilePropertyMetadata } from '../../entity/models/file-property-metadata.model';
import { ExcludeStrict } from '../../types/exclude-strict.type';
import { Newable } from '../../types/newable.type';
import { Migration } from '../migration/migration.model';
import { Repository } from '../repository';
import { Transaction } from '../transaction/transaction.model';

/**
 * Definition for a data source.
 */
export interface DataSourceInterface extends BackupResourceInterface {
    /**
     * The entities of this data source.
     */
    readonly entities: Newable<BaseEntity>[],

    /**
     * All migrations that belong to this data source.
     */
    readonly migrations: Newable<Migration>[],

    /**
     * Initializes the data source.
     */
    init: () => Promise<void>,

    /**
     * Gets a repository to manage the provided entity class in the data source.
     * @param cls - The entity class to get the repository for.
     * @returns A repository for the provided entity class.
     * @throws When the data source has not been initialized yet or the provided entity does not belong to this data source.
     */
    getRepository: <T extends BaseEntity>(cls: Newable<T>) => Repository<T>,

    /**
     * Starts a new transaction.
     * @param isolationLevel - The isolation level of the transaction.
     * @returns A new transaction that can be passed to any repository methods.
     */
    startTransaction: (isolationLevel?: IsolationLevel) => Promise<Transaction>,

    /**
     * Runs migrations for the data source.
     */
    runMigrations: () => Promise<void>,

    /**
     * Adds a new property to the given entity.
     *
     * Mostly needed in the context of migrations.
     */
    addPropertyToEntity: <T extends BaseEntity>(
        entity: Newable<T>,
        key: keyof T,
        transaction: Transaction
    ) => Promise<void>,

    /**
     * Changes the given oldProperty to the newProperty on the given entity.
     */
    changePropertyOfEntity: <T extends BaseEntity>(
        entity: Newable<T>,
        oldProperty: keyof T | string & {},
        newProperty: PropertyMetadataInput & {
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
    ) => Promise<void>
}