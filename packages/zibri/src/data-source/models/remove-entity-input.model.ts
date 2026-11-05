import { EntityMigrationInput } from './entity-migration-input.model';
import { BaseEntity } from '../../entity/base-entity.model';

/**
 * What a migration says when it removes an entity, with its rows and the many to many relations they
 * hold.
 */
export type RemoveEntityInput<T extends BaseEntity> = EntityMigrationInput<T>;