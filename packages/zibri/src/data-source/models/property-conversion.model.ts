import { CastablePropertyType } from './castable-property-type.type.ts';
import { MigrationPropertyMetadata } from './migration-property-metadata.model.ts';
import { MigrationPropertyValue } from './migration-property-value.model.ts';
import { ValueConversion } from './value-conversion.enum.ts';

/**
 * What happens to the values of a property whose storage a migration changes.
 */
export type PropertyConversion<C extends MigrationPropertyMetadata, M extends MigrationPropertyMetadata> = {
    /**
     * Values that become a specific other value, eg. `{ from: true, to: CronJobState.ACTIVE }`.
     * They take priority over `default`.
     */
    values?: {
        /**
         * A value as the property holds it now.
         */
        from: MigrationPropertyValue<C>,
        /**
         * The value it holds instead.
         */
        to: MigrationPropertyValue<M>
    }[],
    /**
     * What happens to the values `values` does not list. Only {@link ValueConversion.NONE} when the
     * property's type cannot be cast into the new one.
     */
    default: M['type'] extends CastablePropertyType<C['type']> ? ValueConversion : ValueConversion.NONE
};