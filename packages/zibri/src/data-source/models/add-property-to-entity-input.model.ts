import { EntityMigrationInput } from './entity-migration-input.model';
import { MigrationPropertyMetadata } from './migration-property-metadata.model';
import { BaseEntity } from '../../entity/base-entity.model';

/**
 * What a migration says when it adds a property to an entity.
 */
export type AddPropertyToEntityInput<T extends BaseEntity> = EntityMigrationInput<T> & {
    /**
     * The property to add: its name, and the metadata it would be declared with.
     */
    property: MigrationPropertyMetadata & {
        /**
         * The name of the property.
         */
        name: keyof T | string & {}
    }
};