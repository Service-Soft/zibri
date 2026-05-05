import { BasePropertyMetadata, WithDefaultMetadata } from './base-property-metadata.model';
import { AnyEnum } from '../../types/any-enum.type';
import { OmitStrict } from '../../types/omit-strict.type';

/**
 * The possible formats a number value can have.
 */
export type NumberFormat = 'integer' | 'bigint';

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
     */
    primary: boolean,
    /**
     * Whether or not the property should be unique.
     */
    unique: boolean,
    /**
     * The format of the property, or undefined if none.
     *
     * CAUTION:
     * The 'bigint' format is handled as a string/BigIntString, because the native bigint type causes problems with serialization into json.
     */
    format: NumberFormat | undefined,
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