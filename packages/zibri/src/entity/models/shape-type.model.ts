/* eslint-disable jsdoc/require-jsdoc */
import { type ArrayPropertyItemMetadata, type ArrayPropertyMetadata } from './array-property-metadata.model';
import { type NumberFormat, type NumberPropertyMetadata } from './number-property-metadata.model';
import { type ObjectPropertyMetadata } from './object-property-metadata.model';
import { type AnyOfShapesMetadata, type OneOfPropertyMetadata } from './one-of-property-metadata.model';
import { type OneOf } from './one-of.model';
import { type File } from '../../parsing/form-data/file.model';
import { type DeclaredBodyInput } from '../../routing/decorators/body-metadata.model';
import { type Newable } from '../../types/newable.type';
import { type OmitStrict } from '../../types/omit-strict.type';
import { type BigNumber } from '../../utilities/number.utilities';

/**
 * The TypeScript type of a value of the given shape.
 *
 * Reads a shape as it was declared as well as its full metadata, as long as the metadata still knows
 * the class of an object shape - see `DeclaredShape`.
 */
export type ShapeType<S> = S extends { type: 'string' }
    ? string
    : S extends { type: 'number', format: 'bigint' }
        ? bigint
        : S extends { type: 'number', format: 'bignumber' }
            ? BigNumber
            : S extends { type: 'number' }
                ? number
                : S extends { type: 'boolean' }
                    ? boolean
                    : S extends { type: 'date' }
                        ? Date
                        : S extends { type: 'object', cls: () => Newable<infer T> }
                            ? T
                            : S extends { type: 'array', items: infer I }
                                ? ShapeType<I>[]
                                : S extends { type: 'file' }
                                    ? File
                                    : S extends { type: 'oneOf', shapes: infer Shapes }
                                        ? OneOf<{ [Name in keyof Shapes]: ShapeType<Shapes[Name]> }>
                                        : S extends { type: 'anyOf', shapes: readonly (infer Item)[] }
                                            ? ShapeType<Item>
                                            : unknown;

/**
 * The full metadata of a shape, still carrying what its declaration said about its type.
 *
 * Metadata on its own knows an object shape's class only as some class, so a type derived from it
 * would be `unknown`. This keeps the class, the number format, the items and the shapes the
 * declaration named.
 */
export type DeclaredShape<S> = S extends { type: 'object', cls: infer C }
    ? OmitStrict<ObjectPropertyMetadata, 'cls'> & { cls: C }
    : S extends { type: 'number', format: infer F extends NumberFormat }
        ? OmitStrict<NumberPropertyMetadata, 'format'> & { format: F }
        : S extends { type: 'array', items: infer I }
            ? OmitStrict<ArrayPropertyMetadata, 'items'> & { items: DeclaredShape<I> }
            : S extends { type: 'oneOf', shapes: infer Shapes }
                ? OmitStrict<OneOfPropertyMetadata, 'shapes'> & { shapes: { [Name in keyof Shapes]: DeclaredShape<Shapes[Name]> } }
                : S extends { type: 'anyOf', shapes: readonly (infer Item)[] }
                    ? OmitStrict<AnyOfShapesMetadata, 'shapes'> & { shapes: DeclaredShape<Item>[] }
                    : S extends { type: infer K }
                        ? Extract<ArrayPropertyItemMetadata, { type: K }>
                        : never;

/**
 * The shape a body declaration describes, still carrying the classes it named.
 */
export type DeclaredBodyShape<I extends DeclaredBodyInput> = I extends { shapes: (infer S)[] }
    ? DeclaredShape<{ type: 'anyOf', shapes: S[] }>
    : I extends { modelClass: infer C, isArray: true }
        ? DeclaredShape<{ type: 'array', items: { type: 'object', cls: () => C } }>
        : I extends { modelClass: infer C }
            ? DeclaredShape<{ type: 'object', cls: () => C }>
            : never;