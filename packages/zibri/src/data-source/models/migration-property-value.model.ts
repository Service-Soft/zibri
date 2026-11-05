import { MigrationPropertyMetadata } from './migration-property-metadata.model';
import { BigNumber } from '../../utilities/number.utilities';

/**
 * Metadata naming the enum a string property holds the members of.
 */
type EnumMetadata<E> = {
    /**
     * The enum.
     */
    enum: E
};

/**
 * Metadata naming the kind of number a number property holds.
 */
type FormatMetadata<F> = {
    /**
     * The format.
     */
    format: F
};

/**
 * Metadata of a property that may hold nothing.
 */
type OptionalMetadata = {
    /**
     * Whether a value is required.
     */
    required: false
};

/**
 * The value a property of the given migration metadata holds, for example the members of its enum.
 */
export type MigrationPropertyValue<M extends MigrationPropertyMetadata> = (
    M['type'] extends 'string' ? M extends EnumMetadata<infer E extends object> ? E[keyof E] : string
        : M['type'] extends 'number'
            ? M extends FormatMetadata<'bigint'> ? bigint : M extends FormatMetadata<'bignumber'> ? BigNumber : number
            : M['type'] extends 'boolean' ? boolean
                : M['type'] extends 'date' ? Date
                    : unknown
) | (M extends OptionalMetadata ? null : never);