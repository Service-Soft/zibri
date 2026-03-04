import { BasePropertyMetadata, WithDefaultMetadata } from './base-property-metadata.model';
import { OmitStrict } from '../../types/omit-strict.type';

/**
 * Metadata for boolean properties.
 */
export type BooleanPropertyMetadata = BasePropertyMetadata & WithDefaultMetadata<boolean> & {
    /**
     * The type of the property.
     */
    type: 'boolean'
};

/**
 * Input Metadata for boolean properties.
 */
export type BooleanPropertyMetadataInput = Partial<OmitStrict<BooleanPropertyMetadata, 'type'>>;