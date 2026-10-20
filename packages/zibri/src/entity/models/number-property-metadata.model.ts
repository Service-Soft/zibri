import { BasePropertyMetadata, WithDefaultMetadata } from './base-property-metadata.model.ts';
import { UniqueDeclaration } from './unique-declaration.model.ts';
import { AnyEnum } from '../../types/any-enum.type.ts';
import { OmitStrict } from '../../types/omit-strict.type.ts';

/**
 * The possible formats a number value can have.
 *
 * The format says what kind of number the property holds, which decides both what it is stored as
 * and what type it is in TypeScript:
 * - `number` is a JavaScript number, which is a double. It holds fractions, and it is exact only up
 * to `Number.MAX_SAFE_INTEGER`.
 * - `integer` is a whole number inside that same safe range, and is what a counter, a duration or a
 * status code wants.
 * - `bigint` is a whole number of any size, and is a `bigint`.
 * - `bignumber` is an exact decimal of any size, and is a `BigNumber`. It is what a price
 * wants, because a double cannot hold one exactly.
 */
export type NumberFormat = 'number' | 'integer' | 'bigint' | 'bignumber';

/**
 * Metadata for number properties.
 */
export type NumberPropertyMetadata = BasePropertyMetadata & WithDefaultMetadata<number> & {
    /**
     * The type of the property.
     */
    type: 'number',
    /**
     * Whether or not the property is a primary key.
     * Enabling this also sets 'unique' to true.
     *
     * A primary key names at most one row through an index of its own, so declaring 'unique' or
     * 'index' beside it is refused.
     */
    primary: boolean,
    /**
     * Whether or not the property should be unique, and among which rows.
     *
     * `true` is unique across the whole table. Naming a `where` narrows it to the rows that match,
     * which is how a value stays free for the rows the filter excludes. Use `whereFor` to type the
     * filter against the entity.
     */
    unique: UniqueDeclaration,
    /**
     * Whether or not the property should be indexed.
     *
     * A unique property is indexed by the constraint that enforces it, so declaring both is refused.
     */
    index: boolean,
    /**
     * Whether writing this property requires saying what it was.
     *
     * Last write wins everywhere by default, which is right for most properties and silent data loss
     * for the ones two people edit at once. Declaring this refuses an update that names the property
     * unless the filter names it too, so the write becomes a compare and set: it lands only if the
     * value is still the one the caller acted on.
     */
    optimisticLocking: boolean,
    /**
     * What kind of number the property holds.
     *
     * Defaults to `number`, which is what a JavaScript number already is. Say one of the others
     * where the value is outside what a double holds exactly - a whole number past
     * `Number.MAX_SAFE_INTEGER` is `bigint`, an exact decimal is `bignumber` - or where it is a
     * whole number and the narrower column is worth having, which is `integer`.
     *
     * The declared TypeScript type has to match: `number` and `integer` are a `number`, `bigint` is
     * a `bigint`, and `bignumber` is a `BigNumber`. A declaration that contradicts its format
     * is refused where the type can be read, and the value is refused on the way in either way.
     *
     * CAUTION:
     * The 'bigint' and 'bignumber' formats travel through json as strings, because neither survives
     * `JSON.stringify` as a number.
     */
    format: NumberFormat,
    /**
     * The minimum value of the property.
     */
    min: number | undefined,
    /**
     * The maximum value of the property.
     */
    max: number | undefined,
    /**
     * An enum that this property is one of.
     */
    enum: AnyEnum | undefined
};

/**
 * Input Metadata for number properties.
 */
export type NumberPropertyMetadataInput = Partial<OmitStrict<NumberPropertyMetadata, 'type'>>;