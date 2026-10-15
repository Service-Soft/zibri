import { createAnyOfShapesMetadata } from '../entity/decorators/property.decorator';
import { FileSize, fileSizeToBytes } from '../entity/models/file-property-metadata.model';
import { ObjectPropertyMetadata } from '../entity/models/object-property-metadata.model';
import { InternalError } from '../error-handling/internal-error.model';
import { MimeType } from '../http/mime-type.enum';
import { ExcludeStrict } from '../types/exclude-strict.type';
import { isNewable, Newable } from '../types/newable.type';
import { Ms } from '../utilities/ms';
import { BodyMetadata, BodyShapeMetadata, FormDataBodyMetadataInput, FormUrlEncodedBodyMetadataInput, JsonBodyMetadata, JsonBodyMetadataInput, JsonBodyShapeMetadataInput, StreamBodyMetadataInput, XmlBodyMetadata, XmlBodyMetadataInput } from './decorators/body-metadata.model';

/**
 * What a body may weigh, besides its files, when the declaration does not say.
 */
const DEFAULT_BASE_MAX_SIZE: FileSize = '100kb';

// eslint-disable-next-line jsdoc/require-jsdoc
type BaseBodyDeclaration = { modelClass: Newable<unknown> | (() => Newable<unknown>) } | { shapes: JsonBodyShapeMetadataInput[] };

/**
 * A json body, declared by a model or several shapes.
 */
type JsonBodyDeclaration = BaseBodyDeclaration & JsonBodyMetadataInput;

/**
 * An xml body, declared by a model or several shapes.
 */
type XmlBodyDeclaration = BaseBodyDeclaration & XmlBodyMetadataInput;

/**
 * A form data body, declared by a model or several shapes.
 */
type FormDataBodyDeclaration = BaseBodyDeclaration & FormDataBodyMetadataInput;

/**
 * A url encoded form body, declared by a model or several shapes.
 */
type FormUrlEncodedBodyDeclaration = BaseBodyDeclaration & FormUrlEncodedBodyMetadataInput;

/**
 * A stream body, declared by a model or several shapes.
 */
type StreamBodyDeclaration = StreamBodyMetadataInput;

/**
 * Anything a body is declared from, by a decorator, a route registered on the router or the http client.
 *
 * Looser than each of those inputs on purpose: the http client names the kind of body as a type
 * parameter, which none of the stricter inputs can be told apart by.
 */
export type BodyDeclaration = JsonBodyDeclaration
    | XmlBodyDeclaration
    | FormDataBodyDeclaration
    | FormUrlEncodedBodyDeclaration
    | StreamBodyDeclaration;

/**
 * A body declared as text that describes a structure: json or xml.
 */
export type StructuredBodyDeclaration = JsonBodyDeclaration | XmlBodyDeclaration;

/**
 * Fills in everything a body's metadata needs that the caller did not state.
 *
 * Built per kind rather than spread over one set of defaults: `cleanupAfterMs` and `limits` belong
 * to a form data body and mean nothing on a json one, and `baseMaxSize` is an input that resolves
 * into `maxSize` rather than a field of its own.
 *
 * Internal, and in a file of its own so that it stays that way: `body.decorator.ts` is re-exported
 * whole, and this is the framework filling in its own defaults rather than something a consumer
 * calls. Shared by the decorators, by a route registered on the router directly and by the http
 * client, which is what keeps them from answering differently about the same body.
 * @param input - What the caller stated about the body.
 * @param index - The position of the body parameter in the controller method.
 * @returns The complete metadata for the kind of body the options name.
 * @throws When the declaration describes a body that cannot be read.
 */
export function resolveBodyMetadata(input: BodyDeclaration, index: number): BodyMetadata {
    // json by default
    input.type ??= MimeType.JSON;

    switch (input.type) {
        case MimeType.JSON:
        case MimeType.JSON_LD:
        case MimeType.JSON_SCIM:
        case MimeType.XML: {
            return resolveStructuredBodyMetadata(input, index);
        }
        case MimeType.FORM_DATA: {
            const shape: BodyShapeMetadata = resolveBodyShape(input);
            return {
                index,
                shape,
                required: input.required ?? true,
                description: input.description,
                baseMaxSize: fileSizeToBytes(input.baseMaxSize ?? DEFAULT_BASE_MAX_SIZE),
                type: MimeType.FORM_DATA,
                cleanupAfterMs: input.cleanupAfterMs ?? Ms.DAY,
                limits: input.limits
            };
        }
        case MimeType.FORM_URL_ENCODED: {
            const shape: BodyShapeMetadata = resolveBodyShape(input);
            return {
                type: MimeType.FORM_URL_ENCODED,
                index,
                shape,
                required: input.required ?? true,
                description: input.description,
                baseMaxSize: fileSizeToBytes(input.maxSize ?? DEFAULT_BASE_MAX_SIZE)
            };
        }
        case MimeType.OCTET_STREAM: {
            return {
                type: MimeType.OCTET_STREAM,
                index,
                required: input.required ?? true,
                description: input.description,
                maxSize: fileSizeToBytes(input.maxSize ?? '10mb')
            };
        }
    }
}

/**
 * Fills in everything a json or xml body's metadata needs that the caller did not state.
 *
 * Of its own for the websocket body, which can only be one of those two.
 * @param input - What the caller stated about the body.
 * @param index - The position of the body parameter in the controller method.
 * @returns The complete metadata of the body.
 */
export function resolveStructuredBodyMetadata(
    input: StructuredBodyDeclaration,
    index: number
): JsonBodyMetadata | XmlBodyMetadata {
    const shape: BodyShapeMetadata = resolveBodyShape(input);
    return {
        type: input.type ?? MimeType.JSON,
        index,
        shape,
        required: input.required ?? true,
        description: input.description,
        baseMaxSize: fileSizeToBytes(input.maxSize ?? DEFAULT_BASE_MAX_SIZE)
    };
}

/**
 * The one shape a body declaration describes.
 * @param input - What the caller stated about the body.
 * @returns The shape.
 * @throws When a form body is declared as something other than a class, or several classes.
 */
function resolveBodyShape(input: ExcludeStrict<BodyDeclaration, StreamBodyDeclaration>): BodyShapeMetadata {
    // json by default
    input.type ??= MimeType.JSON;

    switch (input.type) {
        case MimeType.JSON:
        case MimeType.JSON_LD:
        case MimeType.JSON_SCIM:
        case MimeType.XML: {
            if ('shapes' in input) {
                return createAnyOfShapesMetadata(input.shapes, 'body');
            }

            const model: ObjectPropertyMetadata = {
                type: 'object',
                cls: toClassResolver(input.modelClass),
                allowAdditionalProperties: input.allowAdditionalProperties ?? false,
                required: true,
                description: undefined,
                exclude: false,
                excludeFromChangeSets: false
            };
            if (input.isArray !== true) {
                return model;
            }
            return {
                type: 'array',
                items: model,
                totalMaxSize: '100kb',
                required: true,
                description: undefined,
                exclude: false,
                excludeFromChangeSets: false
            };
        }
        case MimeType.FORM_DATA:
        case MimeType.FORM_URL_ENCODED: {
            if ('shapes' in input) {
                if (input.shapes.some(shape => shape.type !== 'object')) {
                    const kind: string = input.type === MimeType.FORM_DATA ? 'form data' : 'url encoded form';
                    throw new InternalError([
                        `body: Each shape of a ${kind} body has to be a class.`,
                        'A form is made of named fields, which only a class describes.'
                    ]);
                }
                return createAnyOfShapesMetadata(input.shapes, 'body');
            }

            const model: ObjectPropertyMetadata = {
                type: 'object',
                cls: toClassResolver(input.modelClass),
                allowAdditionalProperties: input.allowAdditionalProperties ?? false,
                required: true,
                description: undefined,
                exclude: false,
                excludeFromChangeSets: false
            };
            return model;
        }
    }
}

/**
 * The model of a body as property metadata reads it: a function answering the class.
 * @param modelClass - The class, or a function answering it.
 * @returns The function.
 */
function toClassResolver(modelClass: Newable<unknown> | (() => Newable<unknown>)): () => Newable<unknown> {
    return isNewable(modelClass) ? () => modelClass : modelClass;
}