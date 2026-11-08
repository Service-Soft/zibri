import { OpenApiHeaderObject, OpenApiParameterObject, OpenApiRequestBodyObject, OpenApiResponseObject } from '../open-api.model';

/**
 * The methods an OpenAPI path can hold an operation for.
 */
export type OpenApiExplorerMethod = 'get' | 'put' | 'post' | 'delete' | 'options' | 'head' | 'patch' | 'trace';

/**
 * One response an operation documents.
 */
export type OpenApiExplorerResponse = {
    /**
     * The status, such as `200`, or `default`.
     */
    status: string,
    /**
     * The response, its reference resolved.
     */
    response: OpenApiResponseObject,
    /**
     * The headers of the response, their references resolved.
     */
    headers: OpenApiExplorerHeader[]
};

/**
 * One header of a response.
 */
export type OpenApiExplorerHeader = {
    /**
     * The name of the header.
     */
    name: string,
    /**
     * The header, its reference resolved.
     */
    header: OpenApiHeaderObject
};

/**
 * One operation of an OpenAPI document, its references resolved, as the explorer shows it.
 */
export type OpenApiExplorerOperation = {
    /**
     * An id of the operation, unique in its tag, that an element can carry.
     */
    id: string,
    /**
     * The method of the operation.
     */
    method: OpenApiExplorerMethod,
    /**
     * The path of the operation, such as `/items/{id}`.
     */
    path: string,
    /**
     * The summary of the operation.
     */
    summary: string | undefined,
    /**
     * The description of the operation.
     */
    description: string | undefined,
    /**
     * Whether the operation is deprecated.
     */
    deprecated: boolean,
    /**
     * The parameters of the operation and of its path, the operation's own taking the place of the path's.
     */
    parameters: OpenApiParameterObject[],
    /**
     * The request body of the operation.
     */
    requestBody: OpenApiRequestBodyObject | undefined,
    /**
     * The responses of the operation, by status.
     */
    responses: OpenApiExplorerResponse[],
    /**
     * The names of the security schemes the operation accepts, any one of which is enough. Empty for an operation
     * that answers anonymous callers.
     */
    securitySchemes: string[],
    /**
     * The permissions the operation requires, from `x-permission` and `x-platform-permission`.
     */
    permissions: string[]
};

/**
 * The operations of one tag.
 */
export type OpenApiExplorerTag = {
    /**
     * The name of the tag, or `default` for the operations that have none.
     */
    name: string,
    /**
     * The description of the tag.
     */
    description: string | undefined,
    /**
     * The operations of the tag, in the order of the document.
     */
    operations: OpenApiExplorerOperation[]
};
