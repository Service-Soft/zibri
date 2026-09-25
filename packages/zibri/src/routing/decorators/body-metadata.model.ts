import { BasePropertyMetadata } from '../../entity/models/base-property-metadata.model';
import { FileSize } from '../../entity/models/file-property-metadata.model';
import { ObjectPropertyMetadata, ObjectPropertyMetadataInput } from '../../entity/models/object-property-metadata.model';
import { AnyOfShapesMetadata, OneOfShapeMetadata, OneOfShapeMetadataInput } from '../../entity/models/one-of-property-metadata.model';
import { MimeType } from '../../http/mime-type.enum';
import { FormDataLimits } from '../../parsing/form-data/form-data-limits.model';
import { Newable } from '../../types/newable.type';
import { OmitStrict } from '../../types/omit-strict.type';
import { BigNumber } from '../../utilities/number.utilities';

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
     * The maximum size of the body.
     * Is calculated by adding the base max size and any sizes of file or file array properties on the body model.
     */
    maxSize: BigNumber
};

/**
 * Metadata of json http request body properties.
 */
export type JsonBodyMetadata = BaseBodyMetadata & {
    /**
     * The type of the request body (json).
     */
    type: MimeType.JSON
};

/**
 * Metadata of xml http request body properties.
 */
export type XmlBodyMetadata = BaseBodyMetadata & {
    /**
     * The type of the request body (xml).
     */
    type: MimeType.XML
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
 *
 */
export type StreamBodyMetadata = OmitStrict<BaseBodyMetadata, 'shape'> & {
    /**
     *
     */
    type: MimeType.OCTET_STREAM
};

/**
 * Metadata for http request body properties.
 */
export type BodyMetadata = StreamBodyMetadata | JsonBodyMetadata | XmlBodyMetadata | FormDataBodyMetadata;

/**
 *
 */
export type JsonBodyMetadataInput = Partial<OmitStrict<JsonBodyMetadata, 'shape' | 'index' | 'maxSize'>> & {
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
 *
 */
// type is required: a body declared without one is read as json
export type FormDataBodyMetadataInput = Partial<OmitStrict<FormDataBodyMetadata, 'shape' | 'index' | 'maxSize' | 'type'>>
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
 *
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
export type BodyMetadataInput = JsonBodyMetadataInput | XmlBodyMetadataInput | FormDataBodyMetadataInput | StreamBodyMetadataInput;

/**
 * A shape a json body can be one of.
 */
export type JsonBodyShapeMetadataInput = OneOfShapeMetadataInput;

/**
 * A shape a form data body can be one of. A form is made of named fields, so only a class describes one.
 */
export type FormDataBodyShapeMetadataInput = ObjectPropertyMetadataInput & Pick<ObjectPropertyMetadata, 'type'>;

/**
 *
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
 *
 */
type FormDataBodyOneOfMetadataInput = FormDataBodyMetadataInput & {
    /**
     * The shapes the body can be. It becomes the first, in this order, that it fits.
     */
    shapes: FormDataBodyShapeMetadataInput[]
};

/**
 *
 */
type StreamBodyOneOfMetadataInput = StreamBodyMetadataInput;

/**
 * Metadata Input for http request body properties that are one of several shapes.
 */
export type OneOfBodyMetadataInput = JsonBodyOneOfMetadataInput
    | XmlBodyOneOfMetadataInput
    | FormDataBodyOneOfMetadataInput
    | StreamBodyOneOfMetadataInput;

/**
 *
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
 *
 */
type DeclaredFormDataBodyInput = FormDataBodyMetadataInput & {
    /**
     * The model class that defines the body properties structure.
     */
    modelClass: Newable<unknown>
};

/**
 *
 */
type DeclaredStreamBodyInput = StreamBodyMetadataInput;

/**
 * What a body can be declared from: one model, or several shapes.
 */
export type DeclaredBodyInput = DeclaredJsonBodyInput
    | DeclaredXmlBodyInput
    | DeclaredFormDataBodyInput
    | DeclaredStreamBodyInput
    | OneOfBodyMetadataInput;

/**
 * The response for the given response body type.
 */
export type BodyMetadataForType<M extends BodyMetadata['type']> = M extends MimeType.OCTET_STREAM
    ? StreamBodyMetadata
    : M extends MimeType.FORM_DATA
        ? FormDataBodyMetadata
        : M extends MimeType.JSON
            ? JsonBodyMetadata
            : M extends MimeType.XML
                ? XmlBodyMetadata
                : never;