import { type ArrayPropertyItemMetadata, type ArrayPropertyItemMetadataInput } from './array-property-metadata.model.ts';
import { BasePropertyMetadata } from './base-property-metadata.model.ts';
import { type FilePropertyMetadata } from './file-property-metadata.model.ts';
import { type StringPropertyMetadataInput } from './string-property-metadata.model.ts';
import { ExcludeStrict } from '../../types/exclude-strict.type.ts';
import { OmitStrict } from '../../types/omit-strict.type.ts';

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
export type OneOfShapeMetadataInput<TStringInput = StringPropertyMetadataInput> = Exclude<
    ArrayPropertyItemMetadataInput<TStringInput>,
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    { type: 'oneOf' } | { type: 'file' }
>;

/**
 * Input metadata of several shapes, by name.
 *
 * An interface rather than a record, because a shape can be an array whose items are one of several
 * shapes again, and only an interface lets the input types refer to each other that way.
 */
export interface OneOfShapesMetadataInput<TStringInput = StringPropertyMetadataInput> {
    [name: string]: OneOfShapeMetadataInput<TStringInput>
}

/**
 * Input metadata for a property that holds one of several named shapes.
 */
export type OneOfPropertyMetadataInput<
    // unconstrained, because the decorator checks the shapes as declared, each string against the
    // strategy it names, and that check is a type of its own rather than one instantiation of these
    Shapes = OneOfShapesMetadataInput
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