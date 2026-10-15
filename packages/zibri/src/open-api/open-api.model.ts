import type { oas31 } from 'openapi3-ts';

import { HttpStatus } from '../http/http-status.enum';
import { JsonMimeType } from '../http/json-mime-type.type';
import { MimeType } from '../http/mime-type.enum';
import { Newable } from '../types/newable.type';
import { OmitStrict } from '../types/omit-strict.type';

/**
 * Alias for the root OpenAPI 3.1 document object.
 */
export type OpenApiDefinition = OmitStrict<oas31.OpenAPIObject, 'components'> & {
    // eslint-disable-next-line jsdoc/require-jsdoc
    components?: OpenApiComponentsObject
};

/**
 * The reusable objects of an OpenAPI document.
 */
export type OpenApiComponentsObject = OmitStrict<oas31.ComponentsObject, 'securitySchemes'> & {
    // eslint-disable-next-line jsdoc/require-jsdoc
    securitySchemes?: Record<string, OpenApiSecuritySchemeObject | OpenApiReferenceObject>
};

/**
 * Collection of path items keyed by path string.
 */
export type OpenApiPaths = oas31.PathsObject;

/**
 * Represents an operation (get, post, etc.) under a path.
 */
export type OpenApiOperation = oas31.OperationObject;

/**
 * Parameter object or reference to one.
 */
export type OpenApiParameter = oas31.ParameterObject | oas31.ReferenceObject;

/**
 * Request body definition object.
 */
export type OpenApiRequestBodyObject = oas31.RequestBodyObject;

/**
 * Schema definition object.
 */
export type OpenApiSchemaObject = oas31.SchemaObject;

/**
 * How a schema appears in xml: its element's name and namespace, or that it is an attribute.
 */
export type OpenApiXmlObject = oas31.XmlObject;

/**
 * Reference definition object.
 */
export type OpenApiReferenceObject = oas31.ReferenceObject;

/**
 * Whether the given value is a reference to a schema rather than a schema.
 * @param value - The value to check.
 * @returns True when the value is a reference object.
 */
export function isOpenApiReferenceObject(value: unknown): value is OpenApiReferenceObject {
    // our own rather than openapi3-ts's: that package is only a devDependency, so this file may
    // import nothing from it but types
    return typeof value === 'object' && value != undefined && Object.hasOwn(value, '$ref');
}

/**
 * Schema definitions.
 */
export type OpenApiSchemas = {
    [schema: string]: OpenApiSchemaObject | OpenApiReferenceObject
};

/**
 * Security scheme definition object.
 */
export type OpenApiSecuritySchemeObject = OmitStrict<oas31.SecuritySchemeObject, 'type'> & {
    // eslint-disable-next-line jsdoc/require-jsdoc
    type: OpenApiSecuritySchemeType
};

/**
 * The kinds of security scheme of OpenAPI 3.1.
 */
// mutualTLS is one of them since 3.1.0, but openapi3-ts's oas31 leaves it out (its oas32 has it)
export type OpenApiSecuritySchemeType = oas31.SecuritySchemeType | 'mutualTLS';

/**
 * Security requirement mapping.
 */
export type OpenApiSecurityRequirementObject = oas31.SecurityRequirementObject;

/**
 * Descriptor for a file response in OpenAPI:
 * - type: 'file'
 * - optional HTTP status, description, and mimeType(s).
 */
export type FileOpenApiResponse = {
    /**
     * Constant identifier for a file response.
     */
    type: 'file',
    /**
     * HTTP status code to use for the file response.
     */
    status?: HttpStatus,
    /**
     * Human-readable description of the file response.
     */
    description?: string,
    /**
     * Allowed MIME type(s) for the file response ('all' for any or one/multiple specific types).
     */
    mimeType?: 'all' | MimeType | MimeType[],
    /**
     * Whether this response was added automatically by the framework rather than explicitly declared by the
     * developer. Used to distinguish auto-generated documentation from legitimate ones when checking for missing
     * response data.
     */
    implicit?: boolean
};

/**
 * Descriptor for a JSON response in OpenAPI:
 * - type: 'json'
 * - optional HTTP status, description
 * - cls: constructor for response payload mapping
 * - isArray: indicates array payload.
 */
export type JsonOpenApiResponse = {
    /**
     * Constant identifier for a JSON response.
     */
    type: 'json',
    /**
     * HTTP status code to use for the JSON response.
     */
    status?: HttpStatus,
    /**
     * Human-readable description of the JSON response.
     */
    description?: string,
    /**
     * Constructor function to map the JSON payload to a class instance, or a function answering it for
     * a class that is only known once the application has started. A function answering undefined names
     * no class.
     */
    cls?: Newable<unknown> | (() => Newable<unknown> | undefined),
    /**
     * If true, indicates the response payload is an array of items.
     */
    isArray?: boolean,
    /**
     * The formats the response can be written in, in the order they are preferred. The request's `Accept` header
     * picks one, and the first is taken when it accepts several or names none. Defaults to json.
     *
     * Xml is written as the document `cls` describes, with `cls` as its root element, so it needs a `cls` and a
     * response that is not an array. Any other format is written as json, with its own type, eg.
     * `MimeType.JSON_SCIM`. The json and empty responses of a route name the same formats, which is checked
     * at startup.
     */
    mimeTypes?: (JsonMimeType | MimeType.XML)[],
    /**
     * Whether this response was added automatically by the framework (such as by \@RateLimited) rather than
     * explicitly declared by the developer. Used to distinguish auto-generated documentation from legitimate ones
     * when checking for missing response data.
     */
    implicit?: boolean
};

/**
 * Descriptor for a response without a body:
 * - type: 'empty'
 * - optional HTTP status, description and the formats the route answers in.
 */
export type EmptyOpenApiResponse = {
    /**
     * Constant identifier for an empty response.
     */
    type: 'empty',
    /**
     * HTTP status code to use for the empty response.
     */
    status?: HttpStatus,
    /**
     * Human-readable description of the empty response.
     */
    description?: string,
    /**
     * The formats the route answers in. An empty response has no body in any of them, so this defaults to json
     * and xml; the json responses of the same route name the same formats, which is checked at startup.
     */
    mimeTypes?: (JsonMimeType | MimeType.XML)[],
    /**
     * Whether this response was added automatically by the framework rather than explicitly declared by the
     * developer. Used to distinguish auto-generated documentation from legitimate ones when checking for missing
     * response data.
     */
    implicit?: boolean
};

/**
 * Descriptor for an error response:
 * - type: 'error'
 * - optional HTTP status and description.
 */
export type ErrorOpenApiResponse = {
    /**
     * Constant identifier for an error response.
     */
    type: 'error',
    /**
     * HTTP status code to use for the error response.
     */
    status?: HttpStatus,
    /**
     * Human-readable description of the error.
     */
    description?: string,
    /**
     * Whether this response was added automatically by the framework rather than explicitly declared by the
     * developer. Used to distinguish auto-generated documentation from legitimate ones when checking for missing
     * response data.
     */
    implicit?: boolean
};

/**
 * Descriptor for an HTML response:
 * - type: 'html'
 * - optional HTTP status and description.
 */
export type HtmlOpenApiResponse = {
    /**
     * Constant identifier for an HTML response.
     */
    type: 'html',
    /**
     * HTTP status code to use for the HTML response.
     */
    status?: HttpStatus,
    /**
     * Human-readable description of the HTML response.
     */
    description?: string,
    /**
     * Whether this response was added automatically by the framework rather than explicitly declared by the
     * developer. Used to distinguish auto-generated documentation from legitimate ones when checking for missing
     * response data.
     */
    implicit?: boolean
};

/**
 * The statuses a redirect can be answered with.
 */
export type RedirectHttpStatus = HttpStatus.FOUND | HttpStatus.SEE_OTHER | HttpStatus.TEMPORARY_REDIRECT;

/**
 * Descriptor for a redirect response:
 * - type: 'redirect'
 * - the status, and an optional description.
 */
export type RedirectOpenApiResponse = {
    /**
     * Constant identifier for a redirect response.
     */
    type: 'redirect',
    /**
     * HTTP status code to use for the redirect.
     */
    status: RedirectHttpStatus,
    /**
     * Human-readable description of the redirect.
     */
    description?: string,
    /**
     * Whether this response was added automatically by the framework rather than explicitly declared by the
     * developer. Used to distinguish auto-generated documentation from legitimate ones when checking for missing
     * response data.
     */
    implicit?: boolean
};

/**
 * Definition for a single response.
 */
export type OpenApiResponseObject = oas31.ResponseObject;

/**
 * Definition for responses.
 */
export type OpenApiResponsesObject = oas31.ResponsesObject;

/**
 * Definition for a tag.
 */
export type OpenApiTagObject = oas31.TagObject;

/**
 * The location of a parameter, like 'query', 'header' etc.
 */
export type OpenApiParameterLocation = oas31.ParameterLocation;

/**
 * Definition for a content object.
 */
export type OpenApiContentObject = oas31.ContentObject;

/**
 * Union of all supported OpenAPI response descriptors.
 */
export type OpenApiResponse
    = | JsonOpenApiResponse
        | EmptyOpenApiResponse
        | HtmlOpenApiResponse
        | RedirectOpenApiResponse
        | ErrorOpenApiResponse
        | FileOpenApiResponse;