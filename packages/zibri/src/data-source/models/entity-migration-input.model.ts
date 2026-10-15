import { BaseEntity } from '../../entity/base-entity.model';
import { Newable } from '../../types/newable.type';
import { Transaction } from '../transaction/transaction.model';

/**
 * What a migration says when it changes how a whole entity is stored.
 */
export type EntityMigrationInput<T extends BaseEntity> = {
    /**
     * The entity to change.
     */
    entity: Newable<T>,
    /**
     * The transaction of the migration.
     */
    transaction: Transaction
};