import { BasePropertyMetadata, WithDefaultMetadata } from './base-property-metadata.model';
import { OmitStrict } from '../../types';

/**
 * Metadata for date properties.
 */
export type DatePropertyMetadata = BasePropertyMetadata & WithDefaultMetadata<Date> & {
    /**
     * The type of the property.
     */
    type: 'date',
    /**
     * A date after which the property must be.
     */
    after: Date | undefined,
    /**
     * A date before the property must be.
     */
    before: Date | undefined
};

/**
 * Input Metadata for date properties.
 */
export type DatePropertyMetadataInput = Partial<OmitStrict<DatePropertyMetadata, 'type'>>;