import { BaseParamMetadata } from './base-param-metadata.model';
import { BooleanParamMetadata, BooleanParamMetadataInput } from './boolean-param-metadata.model';
import { DateParamMetadata, DateParamMetadataInput } from './date-param-metadata.model';
import { NumberParamMetadata, NumberParamMetadataInput } from './number-param-metadata.model';
import { ObjectParamMetadata, ObjectParamMetadataInput } from './object-param-metadata.model';
import { StringParamMetadata, StringParamMetadataInput } from './string-param-metadata.model';
import { ArrayPropertyMetadata } from '../../entity/models/array-property-metadata.model';
import { OmitStrict } from '../../types/omit-strict.type';

/**
 * Metadata for an item of an array parameter.
 */
export type ArrayParamItemMetadata = OmitStrict<StringParamMetadata, 'name'>
    | OmitStrict<NumberParamMetadata, 'name'>
    | OmitStrict<BooleanParamMetadata, 'name'>
    | OmitStrict<DateParamMetadata, 'name'>
    | OmitStrict<ObjectParamMetadata, 'name'>
    | OmitStrict<ArrayParamMetadata, 'name'>;

/**
 * Input metadata for an item of an array parameter.
 */
export type ArrayParamItemMetadataInput = StringParamMetadataInput
    | NumberParamMetadataInput
    | BooleanParamMetadataInput
    | DateParamMetadataInput
    | ObjectParamMetadataInput
    | ArrayParamMetadataInput;

/**
 * Metadata for array parameters.
 */
export type ArrayParamMetadata = BaseParamMetadata & OmitStrict<ArrayPropertyMetadata, 'excludeFromChangeSets' | 'exclude' | 'items'> & {
    /**
     * Metadata for the items inside this array parameter.
     */
    items: ArrayParamItemMetadata
};

/**
 * Metadata Input for array parameters.
 */
export type ArrayParamMetadataInput = Partial<OmitStrict<ArrayParamMetadata, 'type' | 'items'>>
    & Pick<ArrayParamMetadata, 'type'>
    & {
        /**
         * Metadata of the array items.
         */
        items: ArrayParamItemMetadataInput
    };