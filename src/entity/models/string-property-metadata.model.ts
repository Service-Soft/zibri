import { BasePropertyMetadata, WithDefaultMetadata } from './base-property-metadata.model';
import { AnyEnum, OmitStrict } from '../../types';

/**
 * The possible formats a string value can have.
 */
export type StringFormat = 'uuid' | 'email';

/**
 * Metadata for string properties.
 */
export type StringPropertyMetadata = BasePropertyMetadata & WithDefaultMetadata<string> & {
    /**
     * The type of the property.
     */
    type: 'string',
    /**
     * Whether or not the property is a primary key.
     * Enabling this also turns on 'uuid' as the format and sets 'unique' to true.
     */
    primary: boolean,
    /**
     * The format of the property, or undefined if none.
     */
    format: StringFormat | undefined,
    /**
     * Whether or not the property should be unique.
     */
    unique: boolean,
    /**
     * The minimum length of the property, or undefined if not limited.
     */
    minLength: number | undefined,
    /**
     * The maximum length of the property, or undefined if not limited.
     */
    maxLength: number | undefined,
    /**
     * A regex to validate the property, or undefined.
     */
    regex: string | RegExp | undefined,
    /**
     * An enum that this property is one of.
     */
    enum: AnyEnum<string> | undefined
};

/**
 * Input Metadata for string properties.
 */
export type StringPropertyMetadataInput = Partial<OmitStrict<StringPropertyMetadata, 'type'>>;