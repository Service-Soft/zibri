import { oas31 } from 'openapi3-ts';

import { HttpStatus } from '../http/http-status.enum';
import { MimeType } from '../http/mime-type.enum';
import { Newable } from '../types/newable.type';

/**
 * Alias for the root OpenAPI 3.1 document object.
 */
export type OpenApiDefinition = oas31.OpenAPIObject;

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
 * Reference definition object.
 */
export type OpenApiReferenceObject = oas31.ReferenceObject;

/**
 * Schema definitions.
 */
export type OpenApiSchemas = {
    [schema: string]: OpenApiSchemaObject | OpenApiReferenceObject
};

/**
 * Security scheme definition object.
 */
export type OpenApiSecuritySchemeObject = oas31.SecuritySchemeObject;

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
     * Constructor function to map the JSON payload to a class instance.
     */
    cls?: Newable<unknown>,
    /**
     * If true, indicates the response payload is an array of items.
     */
    isArray?: boolean,
    /**
     * Whether this response was added automatically by the framework (such as by \@RateLimited) rather than
     * explicitly declared by the developer. Used to distinguish auto-generated documentation from legitimate ones
     * when checking for missing response data.
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
        | HtmlOpenApiResponse
        | ErrorOpenApiResponse
        | FileOpenApiResponse;