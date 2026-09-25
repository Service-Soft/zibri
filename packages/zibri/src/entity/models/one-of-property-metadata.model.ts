import { type ArrayPropertyItemMetadata, type ArrayPropertyItemMetadataInput } from './array-property-metadata.model';
import { BasePropertyMetadata } from './base-property-metadata.model';
import { type FilePropertyMetadata } from './file-property-metadata.model';
import { ExcludeStrict } from '../../types/exclude-strict.type';
import { OmitStrict } from '../../types/omit-strict.type';

/**
 * Metadata for a property that holds one of several named shapes.
 */
export type OneOfPropertyMetadata = BasePropertyMetadata & {
    /**
     * The type of the property.
     */
    type: 'oneOf',
    /**
     * What the value can be, by name. A value says which of these it is.
     */
    shapes: Record<string, OneOfShapeMetadata>
};

/**
 * Metadata of one of the shapes a value can be.
 *
 * Anything an array item can be, except a file, which json cannot carry, and another value of several
 * shapes, which would only wrap the value a second time.
 */
export type OneOfShapeMetadata = ExcludeStrict<ArrayPropertyItemMetadata, OneOfPropertyMetadata | FilePropertyMetadata>;

/**
 * Input metadata of one of the shapes a value can be.
 */
// eslint-disable-next-line jsdoc/require-jsdoc
export type OneOfShapeMetadataInput = Exclude<ArrayPropertyItemMetadataInput, { type: 'oneOf' } | { type: 'file' }>;

/**
 * Input metadata of several shapes, by name.
 *
 * An interface rather than a record, because a shape can be an array whose items are one of several
 * shapes again, and only an interface lets the input types refer to each other that way.
 */
export interface OneOfShapesMetadataInput {
    [name: string]: OneOfShapeMetadataInput
}

/**
 * Input metadata for a property that holds one of several named shapes.
 */
export type OneOfPropertyMetadataInput<
    Shapes extends OneOfShapesMetadataInput = OneOfShapesMetadataInput
> = Partial<OmitStrict<OneOfPropertyMetadata, 'type' | 'shapes'>> & {
    /**
     * What the value can be, by name. The property is declared as `OneOf` of the same names.
     */
    shapes: Shapes
};

/**
 * Metadata for a value that is the first of several shapes it fits, in the order they are listed.
 *
 * What a request body, a parameter or a response read by the http client can be: a format described
 * rather than owned, which names no shape of its own.
 */
export type AnyOfShapesMetadata = {
    /**
     * The type of the value.
     */
    type: 'anyOf',
    /**
     * What the value can be, in the order they are tried.
     */
    shapes: OneOfShapeMetadata[]
};