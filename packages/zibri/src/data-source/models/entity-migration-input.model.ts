import { MigrationTableReference } from './migration-table-reference.model';
import { BaseEntity } from '../../entity/base-entity.model';
import { Newable } from '../../types/newable.type';
import { Transaction } from '../transaction/transaction.model';

/**
 * What a migration says when it changes how a whole entity is stored.
 */
export type EntityMigrationInput<T extends BaseEntity> = {
    /**
     * The entity to change: its class, or the table it is stored in. Named by its table, it is the
     * entity of the data source stored there, and otherwise one declaring only its primary key.
     */
    entity: Newable<T> | MigrationTableReference,
    /**
     * The transaction of the migration.
     */
    transaction: Transaction
};