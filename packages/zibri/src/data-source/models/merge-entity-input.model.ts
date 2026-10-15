import { EntityMigrationInput } from './entity-migration-input.model';
import { BaseEntity } from '../../entity/base-entity.model';

/**
 * What a migration says when it merges what is stored under another table name into an entity.
 */
export type MergeEntityInput<T extends BaseEntity> = EntityMigrationInput<T> & {
    /**
     * The table name the entities to merge are stored under. Nothing is stored there afterwards.
     */
    currentTableName: string
};