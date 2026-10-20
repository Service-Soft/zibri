import { BaseParamMetadata } from './base-param-metadata.model.ts';
import { ArrayPropertyMetadataInput } from '../../entity/models/array-property-metadata.model.ts';
import { BasePropertyMetadata } from '../../entity/models/base-property-metadata.model.ts';
import { BooleanPropertyMetadataInput } from '../../entity/models/boolean-property-metadata.model.ts';
import { DatePropertyMetadataInput } from '../../entity/models/date-property-metadata.model.ts';
import { NumberPropertyMetadataInput } from '../../entity/models/number-property-metadata.model.ts';
import { ObjectPropertyMetadataInput } from '../../entity/models/object-property-metadata.model.ts';
import { AnyOfShapesMetadata } from '../../entity/models/one-of-property-metadata.model.ts';
import { IncomingStringPropertyMetadataInput } from '../../entity/models/string-property-metadata.model.ts';
import { OmitStrict } from '../../types/omit-strict.type.ts';

/**
 * Metadata of a parameter that is the first of several shapes it fits.
 */
export type OneOfParamMetadata = BaseParamMetadata & Pick<BasePropertyMetadata, 'required' | 'description'> & {
    /**
     * The type of the parameter.
     */
    type: 'oneOf',
    /**
     * What the parameter can be, in the order they are tried.
     */
    shapes: AnyOfShapesMetadata['shapes']
};

/**
 * A shape a path parameter can be one of. A path segment is one piece of text, so it is text, a number,
 * a boolean or a date.
 */
// eslint-disable-next-line jsdoc-js/require-jsdoc
export type PathParamShapeMetadataInput = IncomingStringPropertyMetadataInput & { type: 'string' }
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    | NumberPropertyMetadataInput & { type: 'number' }
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    | BooleanPropertyMetadataInput & { type: 'boolean' }
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    | DatePropertyMetadataInput & { type: 'date' };

/**
 * A shape a query or header parameter can be one of.
 */
export type QueryParamShapeMetadataInput = PathParamShapeMetadataInput
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    | ObjectPropertyMetadataInput & { type: 'object' }
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    | ArrayPropertyMetadataInput<IncomingStringPropertyMetadataInput> & { type: 'array' };

/**
 * Metadata Input of a path parameter that is one of several shapes.
 */
export type OneOfPathParamMetadataInput = Partial<OmitStrict<OneOfParamMetadata, 'name' | 'type' | 'shapes'>> & {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    type: 'oneOf',
    /**
     * The shapes the parameter can be. It becomes the first, in this order, that it fits.
     */
    shapes: PathParamShapeMetadataInput[]
};

/**
 * Metadata Input of a query or header parameter that is one of several shapes.
 */
export type OneOfQueryParamMetadataInput = Partial<OmitStrict<OneOfParamMetadata, 'name' | 'type' | 'shapes'>> & {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    type: 'oneOf',
    /**
     * The shapes the parameter can be. It becomes the first, in this order, that it fits.
     */
    shapes: QueryParamShapeMetadataInput[]
};