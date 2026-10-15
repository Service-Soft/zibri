import { EntityMigrationInput } from './entity-migration-input.model';
import { BaseEntity } from '../../entity/base-entity.model';

/**
 * What a migration says when it removes a property from an entity.
 */
export type RemovePropertyFromEntityInput<T extends BaseEntity> = EntityMigrationInput<T> & {
    /**
     * The property to remove. Usually one the entity no longer declares, which is the reason to remove it.
     */
    propertyKey: keyof T | string & {}
};