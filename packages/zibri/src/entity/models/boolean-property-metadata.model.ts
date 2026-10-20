import { BasePropertyMetadata, WithDefaultMetadata } from './base-property-metadata.model.ts';
import { OmitStrict } from '../../types/omit-strict.type.ts';

/**
 * Metadata for boolean properties.
 */
export type BooleanPropertyMetadata = BasePropertyMetadata & WithDefaultMetadata<boolean> & {
    /**
     * The type of the property.
     */
    type: 'boolean',
    /**
     * Whether or not the property should be indexed.
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
    optimisticLocking: boolean
};

/**
 * Input Metadata for boolean properties.
 */
export type BooleanPropertyMetadataInput = Partial<OmitStrict<BooleanPropertyMetadata, 'type'>>;