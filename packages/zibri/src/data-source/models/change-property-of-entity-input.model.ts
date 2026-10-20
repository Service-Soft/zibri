import { CastablePropertyType } from './castable-property-type.type.ts';
import { EntityMigrationInput } from './entity-migration-input.model.ts';
import { MigrationPropertyMetadata } from './migration-property-metadata.model.ts';
import { PropertyConversion } from './property-conversion.model.ts';
import { BaseEntity } from '../../entity/base-entity.model.ts';

/**
 * Everything a migration says when it changes a property of an entity.
 */
export type ChangePropertyOfEntityInput<
    T extends BaseEntity,
    C extends MigrationPropertyMetadata,
    M extends MigrationPropertyMetadata
> = EntityMigrationInput<T> & {
    /**
     * The property as it is stored now: its name, and the metadata it was declared with.
     */
    currentProperty: C & {
        /**
         * The name of the property.
         */
        name: keyof T | string & {}
    },
    /**
     * The property as it is stored from now on: its name, and the metadata it would be declared with.
     */
    property: M & {
        /**
         * The name of the property.
         */
        name: keyof T | string & {}
    }
} & (M['type'] extends CastablePropertyType<C['type']>
    ? {
        /**
         * What happens to the values stored now. Left out, each one is cast, as
         * {@link ValueConversion.CAST} does.
         */
        convert?: PropertyConversion<C, M>
    }
    : {
        /**
         * What happens to the values stored now. Required, because the current type cannot be cast
         * into the new one.
         */
        convert: PropertyConversion<C, M>
    });