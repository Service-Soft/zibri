import { BasePropertyMetadata, WithDefaultMetadata } from './base-property-metadata.model';
import { OmitStrict } from '../../types';

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
     * The minimum value of the property.
     */
    min: number | undefined,
    /**
     * The maximum value of the property.
     */
    max: number | undefined
};

/**
 * Input Metadata for number properties.
 */
export type NumberPropertyMetadataInput = Partial<OmitStrict<NumberPropertyMetadata, 'type'>>;