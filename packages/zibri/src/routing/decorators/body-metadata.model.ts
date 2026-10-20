import { BasePropertyMetadata } from '../../entity/models/base-property-metadata.model.ts';
import { FileSize } from '../../entity/models/file-property-metadata.model.ts';
import { ObjectPropertyMetadata, ObjectPropertyMetadataInput } from '../../entity/models/object-property-metadata.model.ts';
import { AnyOfShapesMetadata, OneOfShapeMetadata, OneOfShapeMetadataInput } from '../../entity/models/one-of-property-metadata.model.ts';
import { IncomingStringPropertyMetadataInput } from '../../entity/models/string-property-metadata.model.ts';
import { JsonMimeType } from '../../http/json-mime-type.type.ts';
import { MimeType } from '../../http/mime-type.enum.ts';
import { FormDataLimits } from '../../parsing/form-data/form-data-limits.model.ts';
import { Newable } from '../../types/newable.type.ts';
import { OmitStrict } from '../../types/omit-strict.type.ts';
import { BigNumber } from '../../utilities/number.utilities.ts';

// each mime type has: BodyMetadata[x], BodyMetadataInput[x], OneOfBodyMetadataInput

/**
 * What a request body can be declared as.
 */
export type BodyShapeMetadata = AnyOfShapesMetadata | OneOfShapeMetadata;

/**
 * Base metadata shared by all possible http request body properties.
 */
type BaseBodyMetadata = OmitStrict<BasePropertyMetadata, 'excludeFromChangeSets' | 'exclude'> & {
    /**
     * What the body is: a model, a list of models, or one of several shapes.
     */
    shape: BodyShapeMetadata,
    /**
     * The index at which the body parameter is provided in the controller method.
     */
    index: number,
    /**
     * The maximum size of the body without the files it may carry. `resolveMaxBodySize` adds the sizes
     * of its file and file array properties to it.
     */
    baseMaxSize: BigNumber
};

/**
 * Metadata of json http request body properties.
 */
export type JsonBodyMetadata = BaseBodyMetadata & {
    /**
     * The type of the request body: `MimeType.JSON` accepts every json type, one of the others only
     * itself, eg. `MimeType.JSON_SCIM`.
     */
    type: JsonMimeType
};

/**
 * Metadata of xml http request body properties.
 */
export type XmlBodyMetadata = BaseBodyMetadata & {
    /**
     * The type of the request body (xml).
     */
    type: MimeType.XML,
    /**
     * Whether the body is handed over as the document that arrived, a string, rather than read into a
     * model. A document that is not well formed is refused either way.
     */
    raw: boolean
};

/**
 * Metadata of form data http request body properties.
 */
export type FormDataBodyMetadata = BaseBodyMetadata & {
    /**
     * The type of the request body (form data).
     */
    type: MimeType.FORM_DATA,
    /**
     * The amount of ms after which the temporary file should be deleted from the file system.
     */
    cleanupAfterMs: number,
    /**
     * What this body may contain, where it differs from what the application allows.
     *
     * `maxSize` says how much a body may weigh; this says how many things it may be made of. They
     * bound different costs: bytes are what has to be read, and parts are what has to be held open
     * while reading them. Only the values named here are overridden - the rest come from
     * `ZIBRI_DI_TOKENS.FORM_DATA_LIMITS`, which is where an application states them once.
     */
    limits: Partial<FormDataLimits> | undefined
};

/**
 * Metadata of url encoded form http request body properties.
 */
export type FormUrlEncodedBodyMetadata = BaseBodyMetadata & {
    /**
     * The type of the request body (url encoded form).
     */
    type: MimeType.FORM_URL_ENCODED
};

/**
 * Metadata of stream http request body properties.
 */
export type StreamBodyMetadata = OmitStrict<BaseBodyMetadata, 'shape' | 'baseMaxSize'> & {
    /**
     * The type of the request body (octet stream).
     */
    type: MimeType.OCTET_STREAM,
    /**
     * The maximum size of the body.
     */
    maxSize: BigNumber
};

/**
 * Metadata of a http request body that has a shape: every kind but a stream.
 */
export type ShapedBodyMetadata = JsonBodyMetadata | XmlBodyMetadata | FormDataBodyMetadata | FormUrlEncodedBodyMetadata;

/**
 * Metadata for http request body properties.
 */
export type BodyMetadata = StreamBodyMetadata | ShapedBodyMetadata;

/**
 * Metadata Input for json http request body properties.
 */
export type JsonBodyMetadataInput = Partial<OmitStrict<JsonBodyMetadata, 'shape' | 'index' | 'baseMaxSize'>> & {
    /**
     * The maximum size of the body.
     */
    maxSize?: FileSize,
    /**
     * Whether the body is a list of the model rather than one of it.
     */
    isArray?: boolean,
    /**
     * Whether properties the model does not declare are allowed on the body.
     */
    allowAdditionalProperties?: boolean
};

/**
 * Metadata Input for xml http request body properties.
 */
// type is required: a body declared without one is read as json
export type XmlBodyMetadataInput = OmitStrict<JsonBodyMetadataInput, 'type'> & Pick<XmlBodyMetadata, 'type'>;

/**
 * Metadata Input for an xml http request body handed over as the document that arrived, such as one
 * whose signature has to be checked.
 */
export type RawXmlBodyMetadataInput = OmitStrict<XmlBodyMetadataInput, 'isArray' | 'allowAdditionalProperties'> & {
    /**
     * Hands the body over as a string.
     */
    raw: true
};

/**
 * Metadata Input for form data http request body properties.
 */
// type is required: a body declared without one is read as json
export type FormDataBodyMetadataInput = Partial<OmitStrict<FormDataBodyMetadata, 'shape' | 'index' | 'baseMaxSize' | 'type'>>
    & Pick<FormDataBodyMetadata, 'type'> & {
        /**
         * The base maximum size of the body.
         *
         * This is IN ADDITION to any file properties on the request body.
         */
        baseMaxSize?: FileSize,
        /**
         * Whether properties the model does not declare are allowed on the body.
         */
        allowAdditionalProperties?: boolean
    };

/**
 * Metadata Input for url encoded form http request body properties.
 */
// type is required: a body declared without one is read as json
export type FormUrlEncodedBodyMetadataInput = Partial<OmitStrict<FormUrlEncodedBodyMetadata, 'shape' | 'index' | 'baseMaxSize' | 'type'>>
    & Pick<FormUrlEncodedBodyMetadata, 'type'> & {
        /**
         * The maximum size of the body.
         */
        maxSize?: FileSize,
        /**
         * Whether properties the model does not declare are allowed on the body.
         */
        allowAdditionalProperties?: boolean
    };

/**
 * Metadata Input for stream http request body properties.
 */
// type is required: a body declared without one is read as json
export type StreamBodyMetadataInput = Partial<OmitStrict<StreamBodyMetadata, 'index' | 'maxSize' | 'type'>>
    & Pick<StreamBodyMetadata, 'type'> & {
        /**
         * The maximum size of the body.
         */
        maxSize?: FileSize
    };

/**
 * Metadata Input for http request body properties that are one model.
 */
export type BodyMetadataInput = JsonBodyMetadataInput
    | XmlBodyMetadataInput
    | FormDataBodyMetadataInput
    | FormUrlEncodedBodyMetadataInput
    | StreamBodyMetadataInput;

/**
 * A shape a json body can be one of.
 */
export type JsonBodyShapeMetadataInput = OneOfShapeMetadataInput<IncomingStringPropertyMetadataInput>;

/**
 * A shape a form data body can be one of. A form is made of named fields, so only a class describes one.
 */
export type FormDataBodyShapeMetadataInput = ObjectPropertyMetadataInput & Pick<ObjectPropertyMetadata, 'type'>;

/**
 * Metadata Input for json http request body properties that are one of several shapes.
 */
type JsonBodyOneOfMetadataInput = JsonBodyMetadataInput & {
    /**
     * The shapes the body can be. It becomes the first, in this order, that it fits.
     */
    shapes: JsonBodyShapeMetadataInput[]
};

/**
 * Metadata Input for xml http request bodies that are one of several shapes.
 */
type XmlBodyOneOfMetadataInput = XmlBodyMetadataInput & {
    /**
     * The shapes the body can be. It becomes the first, in this order, that it fits.
     */
    shapes: JsonBodyShapeMetadataInput[]
};

/**
 * Metadata Input for form data http request body properties that are one of several shapes.
 */
type FormDataBodyOneOfMetadataInput = FormDataBodyMetadataInput & {
    /**
     * The shapes the body can be. It becomes the first, in this order, that it fits.
     */
    shapes: FormDataBodyShapeMetadataInput[]
};

/**
 * Metadata Input for url encoded form http request body properties that are one of several shapes.
 */
type FormUrlEncodedBodyOneOfMetadataInput = FormUrlEncodedBodyMetadataInput & {
    /**
     * The shapes the body can be. It becomes the first, in this order, that it fits.
     */
    shapes: FormDataBodyShapeMetadataInput[]
};

/**
 * Metadata Input for stream http request body properties that are one of several shapes.
 */
type StreamBodyOneOfMetadataInput = StreamBodyMetadataInput;

/**
 * Metadata Input for http request body properties that are one of several shapes.
 */
export type OneOfBodyMetadataInput = JsonBodyOneOfMetadataInput
    | XmlBodyOneOfMetadataInput
    | FormDataBodyOneOfMetadataInput
    | FormUrlEncodedBodyOneOfMetadataInput
    | StreamBodyOneOfMetadataInput;

/**
 * Metadata Input for json http request bodies that are one model.
 */
type DeclaredJsonBodyInput = JsonBodyMetadataInput & {
    /**
     * The model class that defines the body properties structure.
     */
    modelClass: Newable<unknown>
};

/**
 * Metadata Input for xml http request bodies that are one model.
 */
type DeclaredXmlBodyInput = XmlBodyMetadataInput & {
    /**
     * The model class that defines the body properties structure.
     */
    modelClass: Newable<unknown>
};

/**
 * Metadata Input for form data http request bodies that are one model.
 */
type DeclaredFormDataBodyInput = FormDataBodyMetadataInput & {
    /**
     * The model class that defines the body properties structure.
     */
    modelClass: Newable<unknown>
};

/**
 * Metadata Input for url encoded form http request bodies that are one model.
 */
type DeclaredFormUrlEncodedBodyInput = FormUrlEncodedBodyMetadataInput & {
    /**
     * The model class that defines the body properties structure.
     */
    modelClass: Newable<unknown>
};

/**
 * Metadata Input for stream http request bodies that are one model.
 */
type DeclaredStreamBodyInput = StreamBodyMetadataInput;

/**
 * What a body can be declared from: one model, or several shapes.
 */
export type DeclaredBodyInput = DeclaredJsonBodyInput
    | DeclaredXmlBodyInput
    | DeclaredFormDataBodyInput
    | DeclaredFormUrlEncodedBodyInput
    | DeclaredStreamBodyInput
    | OneOfBodyMetadataInput;

/**
 * The response for the given response body type.
 */
export type BodyMetadataForType<M extends BodyMetadata['type']> = M extends MimeType.OCTET_STREAM
    ? StreamBodyMetadata
    : M extends MimeType.FORM_DATA
        ? FormDataBodyMetadata
        : M extends MimeType.FORM_URL_ENCODED
            ? FormUrlEncodedBodyMetadata
            : M extends JsonMimeType
                ? JsonBodyMetadata
                : M extends MimeType.XML
                    ? XmlBodyMetadata
                    : never;