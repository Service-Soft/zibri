import { BasePropertyMetadata } from './base-property-metadata.model';
import { OmitStrict } from '../../types';

/**
 * Metadata for unknown properties.
 */
export type UnknownPropertyMetadata = BasePropertyMetadata & {
    /**
     * The type of the property.
     */
    type: 'unknown'
};

/**
 * Input Metadata for unknown properties.
 */
export type UnknownPropertyMetadataInput = Partial<OmitStrict<UnknownPropertyMetadata, 'type'>>;