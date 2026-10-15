import { EntityMigrationInput } from './entity-migration-input.model';
import { BaseEntity } from '../../entity/base-entity.model';

/**
 * What a migration says when it renames an entity.
 */
export type RenameEntityInput<T extends BaseEntity> = EntityMigrationInput<T> & {
    /**
     * The table name the entity is stored under now. What is stored there moves to the table name
     * `entity` declares.
     */
    currentTableName: string
};