import { ExcludeStrict } from '../../types/exclude-strict.type.ts';
import { type BaseEntity } from '../base-entity.model.ts';
import { BasePropertyMetadata } from './base-property-metadata.model.ts';
import { BooleanPropertyMetadataInput } from './boolean-property-metadata.model.ts';
import { DatePropertyMetadataInput } from './date-property-metadata.model.ts';
import { FilePropertyMetadataInput, FileSize } from './file-property-metadata.model.ts';
import { NumberPropertyMetadataInput } from './number-property-metadata.model.ts';
import { ObjectPropertyMetadataInput } from './object-property-metadata.model.ts';
import { type OneOfPropertyMetadataInput, type OneOfShapesMetadataInput } from './one-of-property-metadata.model.ts';
import { StringPropertyMetadataInput } from './string-property-metadata.model.ts';
import { UnknownPropertyMetadataInput } from './unknown-property-metadata.model.ts';
import { PropertyMetadata, RelationMetadata } from '../decorators/property.decorator.ts';

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
 *
 * Takes what a string anywhere in the item is declared with, which the property decorators widen to any
 * strategy once each string has been checked against its own - see `StrategyCheckedItemInput`.
 */
export type ArrayPropertyItemMetadataInput<
    TStringInput = StringPropertyMetadataInput
    // eslint-disable-next-line jsdoc-js/require-jsdoc
> = TStringInput & { type: 'string' }
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    | NumberPropertyMetadataInput & { type: 'number' }
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    | ObjectPropertyMetadataInput & { type: 'object' }
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    | ArrayPropertyMetadataInput<TStringInput> & { type: 'array' }
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    | DatePropertyMetadataInput & { type: 'date' }
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    | BooleanPropertyMetadataInput & { type: 'boolean' }
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    | UnknownPropertyMetadataInput & { type: 'unknown' }
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    | FilePropertyMetadataInput & { type: 'file' }
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    | OneOfPropertyMetadataInput<OneOfShapesMetadataInput<TStringInput>> & { type: 'oneOf' };

/**
 * Input Metadata for array properties.
 */
type DefaultArrayPropertyMetadataInput<TStringInput> = Partial<BasePropertyMetadata> & {
    /**
     * Input Metadata for array property items.
     */
    items: ExcludeStrict<ArrayPropertyItemMetadataInput<TStringInput>, FileArrayPropertyMetadataInput['items']>,
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    totalMaxSize?: never
};

/**
 * Input Metadata for file array properties.
 */
type FileArrayPropertyMetadataInput = Partial<BasePropertyMetadata> & {
    /**
     * Input Metadata for file array property items.
     */
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    items: FilePropertyMetadataInput & { type: 'file' },
    /**
     * The total maximum file size.
     */
    totalMaxSize?: FileSize
};

/**
 * Input Metadata for array properties.
 */
export type ArrayPropertyMetadataInput<
    TStringInput = StringPropertyMetadataInput
> = DefaultArrayPropertyMetadataInput<TStringInput> | FileArrayPropertyMetadataInput;