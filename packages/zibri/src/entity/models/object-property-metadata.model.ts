import { BasePropertyMetadata } from './base-property-metadata.model.ts';
import { Newable } from '../../types/newable.type.ts';
import { OmitStrict } from '../../types/omit-strict.type.ts';

/**
 * Metadata for object properties.
 */
export type ObjectPropertyMetadata = BasePropertyMetadata & {
    /**
     * The type of the property.
     */
    type: 'object',
    /**
     * The class that defines the structure of the object.
     */
    cls: () => Newable<unknown>,
    /**
     * Whether or not the object should allow additional keys.
     * @default false
     */
    allowAdditionalProperties: boolean
};

/**
 * Input Metadata for object properties.
 */
export type ObjectPropertyMetadataInput = Partial<OmitStrict<ObjectPropertyMetadata, 'type'>>
    & Pick<ObjectPropertyMetadata, 'cls'>;