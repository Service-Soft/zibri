import { ExcludeStrict } from '../../types';
import { type BaseEntity } from '../base-entity.model';
import { PropertyMetadata, RelationMetadata } from '../decorators';
import { BasePropertyMetadata } from './base-property-metadata.model';
import { BooleanPropertyMetadataInput } from './boolean-property-metadata.model';
import { DatePropertyMetadataInput } from './date-property-metadata.model';
import { FilePropertyMetadataInput, FileSize } from './file-property-metadata.model';
import { NumberPropertyMetadataInput } from './number-property-metadata.model';
import { ObjectPropertyMetadataInput } from './object-property-metadata.model';
import { StringPropertyMetadataInput } from './string-property-metadata.model';
import { UnknownPropertyMetadataInput } from './unknown-property-metadata.model';

/**
 * Metadata for array properties.
 */
export type ArrayPropertyMetadata = BasePropertyMetadata & {
    /**
     * The type of the property.
     */
    type: 'array',
    /**
     * The definition for the items of the property.
     */
    items: ArrayPropertyItemMetadata,
    /**
     * The total maximum size that all files in the array combined can have.
     */
    totalMaxSize: FileSize
};

/**
 * Metadata for array property items.
 */
export type ArrayPropertyItemMetadata = ExcludeStrict<PropertyMetadata, RelationMetadata<BaseEntity>>;

/**
 * Input Metadata for array property items.
 */
// eslint-disable-next-line jsdoc/require-jsdoc
export type ArrayPropertyItemMetadataInput = StringPropertyMetadataInput & { type: 'string' }
    // eslint-disable-next-line jsdoc/require-jsdoc
    | NumberPropertyMetadataInput & { type: 'number' }
    // eslint-disable-next-line jsdoc/require-jsdoc
    | ObjectPropertyMetadataInput & { type: 'object' }
    // eslint-disable-next-line jsdoc/require-jsdoc
    | ArrayPropertyMetadataInput & { type: 'array' }
    // eslint-disable-next-line jsdoc/require-jsdoc
    | DatePropertyMetadataInput & { type: 'date' }
    // eslint-disable-next-line jsdoc/require-jsdoc
    | BooleanPropertyMetadataInput & { type: 'boolean' }
    // eslint-disable-next-line jsdoc/require-jsdoc
    | UnknownPropertyMetadataInput & { type: 'unknown' }
    // eslint-disable-next-line jsdoc/require-jsdoc
    | FilePropertyMetadataInput & { type: 'file' };

/**
 * Input Metadata for array properties.
 */
type DefaultArrayPropertyMetadataInput = Partial<BasePropertyMetadata> & {
    /**
     * Input Metadata for array property items.
     */
    items: ExcludeStrict<ArrayPropertyItemMetadataInput, FileArrayPropertyMetadataInput['items']>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    totalMaxSize?: never
};

/**
 * Input Metadata for file array properties.
 */
type FileArrayPropertyMetadataInput = Partial<BasePropertyMetadata> & {
    /**
     * Input Metadata for file array property items.
     */
    // eslint-disable-next-line jsdoc/require-jsdoc
    items: FilePropertyMetadataInput & { type: 'file' },
    /**
     * The total maximum file size.
     */
    totalMaxSize?: FileSize
};

/**
 * Input Metadata for array properties.
 */
export type ArrayPropertyMetadataInput = DefaultArrayPropertyMetadataInput | FileArrayPropertyMetadataInput;