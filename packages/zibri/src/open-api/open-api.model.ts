import { HttpStatus } from '../http/http-status.enum';
import { JsonMimeType } from '../http/json-mime-type.type';
import { MimeType } from '../http/mime-type.enum';
import { TranslatedString } from '../localization/models/translated-string.model';
import { Newable } from '../types/newable.type';

// The document types follow the oas31 model of openapi3-ts (MIT, Copyright (c) 2017-2022 Metadev,
// https://github.com/metadevpro/openapi3-ts), as types of our own: they are part of what an application
// imports, and a type imported from a package the application never installs is `any` there. Narrowed
// where the framework knows more: extensions are `unknown` rather than `any`, which a map of entries
// beside its extensions needed, so a map holds entries only.

/**
 * The fields of an object of an OpenAPI document whose names start with `x-`, which the specification
 * leaves to whoever writes the document.
 */
export type OpenApiSpecificationExtensions = {
    [extension: `x-${string}`]: unknown
};

/**
 * Alias for the root OpenAPI 3.1 document object.
 */
export type OpenApiDefinition = OpenApiSpecificationExtensions & {
    /**
     * The version of OpenAPI the document is written in, such as `3.1.0`.
     */
    openapi: string,
    /**
     * What the document describes.
     */
    info: OpenApiInfoObject,
    /**
     * Where a request is sent to.
     */
    servers?: OpenApiServerObject[],
    /**
     * The operations, by path.
     */
    paths?: OpenApiPaths,
    /**
     * The objects the document refers to.
     */
    components?: OpenApiComponentsObject,
    /**
     * How every operation is logged in to, unless it says otherwise.
     */
    security?: OpenApiSecurityRequirementObject[],
    /**
     * The tags the operations are grouped by, in the order they are shown.
     */
    tags?: OpenApiTagObject[],
    /**
     * Where more about the api is documented.
     */
    externalDocs?: OpenApiExternalDocumentationObject,
    /**
     * The requests the api sends on its own, by name.
     */
    webhooks?: OpenApiPaths
};

/**
 * What an OpenAPI document describes: its title, version and who to contact.
 */
export type OpenApiInfoObject = OpenApiSpecificationExtensions & {
    /**
     * The name of the api.
     */
    title: string,
    /**
     * What the api is for, in markdown.
     */
    description?: string,
    /**
     * A url of the terms of service.
     */
    termsOfService?: string,
    /**
     * Who to contact about the api.
     */
    contact?: OpenApiContactObject,
    /**
     * The license the api is offered under.
     */
    license?: OpenApiLicenseObject,
    /**
     * The version of the api, which is not that of OpenAPI.
     */
    version: string
};

/**
 * Who to contact about an api.
 */
export type OpenApiContactObject = OpenApiSpecificationExtensions & {
    /**
     * The name of the person or organization.
     */
    name?: string,
    /**
     * A url to contact them at.
     */
    url?: string,
    /**
     * An email address to contact them at.
     */
    email?: string
};

/**
 * The license an api is offered under.
 */
export type OpenApiLicenseObject = OpenApiSpecificationExtensions & {
    /**
     * The name of the license.
     */
    name: string,
    /**
     * The SPDX identifier of the license, such as `MIT`.
     */
    identifier?: string,
    /**
     * A url of the license.
     */
    url?: string
};

/**
 * The reusable objects of an OpenAPI document.
 */
export type OpenApiComponentsObject = OpenApiSpecificationExtensions & {
    /**
     * The schemas, by name.
     */
    schemas?: OpenApiSchemas,
    /**
     * The responses, by name.
     */
    responses?: Record<string, OpenApiResponseObject | OpenApiReferenceObject>,
    /**
     * The parameters, by name.
     */
    parameters?: Record<string, OpenApiParameterObject | OpenApiReferenceObject>,
    /**
     * The examples, by name.
     */
    examples?: Record<string, OpenApiExampleObject | OpenApiReferenceObject>,
    /**
     * The request bodies, by name.
     */
    requestBodies?: Record<string, OpenApiRequestBodyObject | OpenApiReferenceObject>,
    /**
     * The headers, by name.
     */
    headers?: Record<string, OpenApiHeaderObject | OpenApiReferenceObject>,
    /**
     * The ways to log in, by name.
     */
    securitySchemes?: Record<string, OpenApiSecuritySchemeObject | OpenApiReferenceObject>,
    /**
     * The links, by name.
     */
    links?: Record<string, OpenApiLinkObject | OpenApiReferenceObject>,
    /**
     * The callbacks, by name.
     */
    callbacks?: Record<string, OpenApiCallbackObject | OpenApiReferenceObject>,
    /**
     * The path items, by name.
     */
    pathItems?: Record<string, OpenApiPathItemObject | OpenApiReferenceObject>
};

/**
 * Collection of path items keyed by path string.
 */
export type OpenApiPaths = {
    [path: string]: OpenApiPathItemObject
};

/**
 * The operations of one path, by their http method.
 */
export type OpenApiPathItemObject = OpenApiSpecificationExtensions & {
    /**
     * A reference to a path item defined elsewhere.
     */
    $ref?: string,
    /**
     * What the operations of the path are, in short.
     */
    summary?: string,
    /**
     * What the operations of the path are, in markdown.
     */
    description?: string,
    /**
     * The operation of a GET request.
     */
    get?: OpenApiOperation,
    /**
     * The operation of a PUT request.
     */
    put?: OpenApiOperation,
    /**
     * The operation of a POST request.
     */
    post?: OpenApiOperation,
    /**
     * The operation of a DELETE request.
     */
    delete?: OpenApiOperation,
    /**
     * The operation of an OPTIONS request.
     */
    options?: OpenApiOperation,
    /**
     * The operation of a HEAD request.
     */
    head?: OpenApiOperation,
    /**
     * The operation of a PATCH request.
     */
    patch?: OpenApiOperation,
    /**
     * The operation of a TRACE request.
     */
    trace?: OpenApiOperation,
    /**
     * Where a request of the path is sent to, instead of the servers of the document.
     */
    servers?: OpenApiServerObject[],
    /**
     * The parameters every operation of the path takes.
     */
    parameters?: OpenApiParameter[]
};

/**
 * Represents an operation (get, post, etc.) under a path.
 */
export type OpenApiOperation = OpenApiSpecificationExtensions & {
    /**
     * The tags the operation is grouped under.
     */
    tags?: string[],
    /**
     * What the operation does, in short.
     */
    summary?: string,
    /**
     * What the operation does, in markdown.
     */
    description?: string,
    /**
     * Where more about the operation is documented.
     */
    externalDocs?: OpenApiExternalDocumentationObject,
    /**
     * A name of the operation, unique in the document.
     */
    operationId?: string,
    /**
     * The parameters the operation takes.
     */
    parameters?: OpenApiParameter[],
    /**
     * The body the operation takes.
     */
    requestBody?: OpenApiRequestBodyObject | OpenApiReferenceObject,
    /**
     * What the operation answers, by status.
     */
    responses?: OpenApiResponsesObject,
    /**
     * The requests the operation may send back, by name.
     */
    callbacks?: Record<string, OpenApiCallbackObject | OpenApiReferenceObject>,
    /**
     * Whether the operation is going to be removed.
     */
    deprecated?: boolean,
    /**
     * How the operation is logged in to, instead of the security of the document.
     */
    security?: OpenApiSecurityRequirementObject[],
    /**
     * Where a request of the operation is sent to, instead of the servers of its path.
     */
    servers?: OpenApiServerObject[],
    /**
     * The permission a user needs for the operation.
     */
    'x-permission'?: string,
    /**
     * The permission a user needs on the platform for the operation, whatever the tenant.
     */
    'x-platform-permission'?: string
};

/**
 * Where more about something is documented.
 */
export type OpenApiExternalDocumentationObject = OpenApiSpecificationExtensions & {
    /**
     * What is documented there, in markdown.
     */
    description?: string,
    /**
     * The url of the documentation.
     */
    url: string
};

/**
 * Parameter object or reference to one.
 */
export type OpenApiParameter = OpenApiParameterObject | OpenApiReferenceObject;

/**
 * The location of a parameter, like 'query', 'header' etc.
 */
export type OpenApiParameterLocation = 'query' | 'header' | 'path' | 'cookie';

/**
 * How a parameter's value is written, such as `form` for `a=1&a=2`.
 */
export type OpenApiParameterStyle = 'matrix' | 'label' | 'form' | 'simple' | 'spaceDelimited' | 'pipeDelimited' | 'deepObject';

/**
 * A header of a response, as opposed to a reference to one.
 */
export type OpenApiHeaderObject = OpenApiSpecificationExtensions & {
    /**
     * What the value is, in markdown.
     */
    description?: string,
    /**
     * Whether a value is required.
     */
    required?: boolean,
    /**
     * Whether it is going to be removed.
     */
    deprecated?: boolean,
    /**
     * Whether an empty value may be sent.
     */
    allowEmptyValue?: boolean,
    /**
     * How the value is written.
     */
    style?: OpenApiParameterStyle,
    /**
     * Whether a list or an object is written as one value per item.
     */
    explode?: boolean,
    /**
     * Whether characters reserved in urls are sent as they are.
     */
    allowReserved?: boolean,
    /**
     * The schema of the value.
     */
    schema?: OpenApiSchemaObject | OpenApiReferenceObject,
    /**
     * Examples of the value, by name.
     */
    examples?: Record<string, OpenApiExampleObject | OpenApiReferenceObject>,
    /**
     * An example of the value.
     */
    example?: unknown,
    /**
     * The value by media type, instead of a schema.
     */
    content?: OpenApiContentObject
};

/**
 * A parameter of an operation, as opposed to a reference to one.
 */
export type OpenApiParameterObject = OpenApiHeaderObject & {
    /**
     * The name of the parameter.
     */
    name: string,
    /**
     * Where the parameter is sent.
     */
    in: OpenApiParameterLocation
};

/**
 * Request body definition object.
 */
export type OpenApiRequestBodyObject = OpenApiSpecificationExtensions & {
    /**
     * What the body is, in markdown.
     */
    description?: string,
    /**
     * The body by media type.
     */
    content: OpenApiContentObject,
    /**
     * Whether a body is required.
     */
    required?: boolean
};

/**
 * Definition for a content object.
 */
export type OpenApiContentObject = {
    [mediaType: string]: OpenApiMediaTypeObject
};

/**
 * The content of one media type: its schema and its examples.
 */
export type OpenApiMediaTypeObject = OpenApiSpecificationExtensions & {
    /**
     * The schema of the content.
     */
    schema?: OpenApiSchemaObject | OpenApiReferenceObject,
    /**
     * Examples of the content, by name.
     */
    examples?: Record<string, OpenApiExampleObject | OpenApiReferenceObject>,
    /**
     * An example of the content.
     */
    example?: unknown,
    /**
     * How each property of a form or multipart body is written, by property.
     */
    encoding?: Record<string, OpenApiEncodingObject>
};

/**
 * How one property of a form or multipart body is written.
 */
export type OpenApiEncodingObject = OpenApiSpecificationExtensions & {
    /**
     * The media type of the property, such as `image/png`.
     */
    contentType?: string,
    /**
     * The headers of the part, by name.
     */
    headers?: Record<string, OpenApiHeaderObject | OpenApiReferenceObject>,
    /**
     * How the value is written.
     */
    style?: OpenApiParameterStyle,
    /**
     * Whether a list or an object is written as one value per item.
     */
    explode?: boolean,
    /**
     * Whether characters reserved in urls are sent as they are.
     */
    allowReserved?: boolean
};

/**
 * Definition for responses.
 */
export type OpenApiResponsesObject = {
    [status: string]: OpenApiResponseObject | OpenApiReferenceObject
};

/**
 * Definition for a single response.
 */
export type OpenApiResponseObject = OpenApiSpecificationExtensions & {
    /**
     * What the response is, in markdown.
     */
    description: string,
    /**
     * The headers of the response, by name.
     */
    headers?: Record<string, OpenApiHeaderObject | OpenApiReferenceObject>,
    /**
     * The body by media type.
     */
    content?: OpenApiContentObject,
    /**
     * The operations the response leads to, by name.
     */
    links?: Record<string, OpenApiLinkObject | OpenApiReferenceObject>
};

/**
 * A request the api may send back, by the expression of its url.
 */
export type OpenApiCallbackObject = {
    [expression: string]: OpenApiPathItemObject
};

/**
 * An example of a value.
 */
export type OpenApiExampleObject = OpenApiSpecificationExtensions & {
    /**
     * What the example is, in short.
     */
    summary?: string,
    /**
     * What the example is, in markdown.
     */
    description?: string,
    /**
     * The value.
     */
    value?: unknown,
    /**
     * A url of the value, instead of the value.
     */
    externalValue?: string
};

/**
 * An operation a response leads to, with what it is sent from the response.
 */
export type OpenApiLinkObject = OpenApiSpecificationExtensions & {
    /**
     * A reference to the operation.
     */
    operationRef?: string,
    /**
     * The `operationId` of the operation.
     */
    operationId?: string,
    /**
     * The parameters of the operation, by name: a value or an expression of one.
     */
    parameters?: Record<string, unknown>,
    /**
     * The body of the operation: a value or an expression of one.
     */
    requestBody?: unknown,
    /**
     * What the link is, in markdown.
     */
    description?: string,
    /**
     * Where a request of the operation is sent to.
     */
    server?: OpenApiServerObject
};

/**
 * Definition for a tag.
 */
export type OpenApiTagObject = OpenApiSpecificationExtensions & {
    /**
     * The name of the tag.
     */
    name: string,
    /**
     * What the tag groups, in markdown.
     */
    description?: string,
    /**
     * Where more about it is documented.
     */
    externalDocs?: OpenApiExternalDocumentationObject
};

/**
 * Reference definition object.
 */
export type OpenApiReferenceObject = {
    /**
     * Where the object referred to is, such as `#/components/schemas/Pet`.
     */
    $ref: string,
    /**
     * What it is, in short, instead of its own summary.
     */
    summary?: string,
    /**
     * What it is, in markdown, instead of its own description.
     */
    description?: string
};

/**
 * Whether the given value is a reference to a schema, not a schema itself.
 * @param value - The value to check.
 * @returns True when the value is a reference object.
 */
export function isOpenApiReferenceObject(value: unknown): value is OpenApiReferenceObject {
    return typeof value === 'object' && value != undefined && Object.hasOwn(value, '$ref');
}

/**
 * A type a schema allows, such as 'string' or 'null'.
 */
export type OpenApiSchemaObjectType = 'integer' | 'number' | 'string' | 'boolean' | 'object' | 'null' | 'array';

/**
 * Schema definition object.
 */
export type OpenApiSchemaObject = OpenApiSpecificationExtensions & {
    /**
     * A reference to a schema this one extends.
     */
    $ref?: string,
    /**
     * Which property tells the schemas of a `oneOf` or `anyOf` apart.
     */
    discriminator?: OpenApiDiscriminatorObject,
    /**
     * Whether the value is only answered with, never sent.
     */
    readOnly?: boolean,
    /**
     * Whether the value is only sent, never answered with.
     */
    writeOnly?: boolean,
    /**
     * How the value appears in xml.
     */
    xml?: OpenApiXmlObject,
    /**
     * Where more about the value is documented.
     */
    externalDocs?: OpenApiExternalDocumentationObject,
    /**
     * An example of the value.
     */
    example?: unknown,
    /**
     * Examples of the value.
     */
    examples?: unknown[],
    /**
     * Whether the value is going to be removed.
     */
    deprecated?: boolean,
    /**
     * The type of the value, or the types it may have.
     */
    type?: OpenApiSchemaObjectType | OpenApiSchemaObjectType[],
    /**
     * What the value's type holds, such as `int32`, `date-time`, `binary` or a format of the api's own.
     */
    format?: string,
    /**
     * Schemas the value matches all of.
     */
    allOf?: (OpenApiSchemaObject | OpenApiReferenceObject)[],
    /**
     * Schemas the value matches exactly one of.
     */
    oneOf?: (OpenApiSchemaObject | OpenApiReferenceObject)[],
    /**
     * Schemas the value matches at least one of.
     */
    anyOf?: (OpenApiSchemaObject | OpenApiReferenceObject)[],
    /**
     * A schema the value does not match.
     */
    not?: OpenApiSchemaObject | OpenApiReferenceObject,
    /**
     * The schema of each item of a list.
     */
    items?: OpenApiSchemaObject | OpenApiReferenceObject,
    /**
     * The schemas of the properties of an object, by property.
     */
    properties?: Record<string, OpenApiSchemaObject | OpenApiReferenceObject>,
    /**
     * The schema of the properties not named in `properties`, or whether there may be any.
     */
    additionalProperties?: OpenApiSchemaObject | OpenApiReferenceObject | boolean,
    /**
     * The schema of the names of the properties.
     */
    propertyNames?: OpenApiSchemaObject | OpenApiReferenceObject,
    /**
     * What the value is, in markdown.
     */
    description?: string,
    /**
     * The value taken when none is given.
     */
    default?: unknown,
    /**
     * The name the value is shown with.
     */
    title?: string,
    /**
     * A number the value is a multiple of.
     */
    multipleOf?: number,
    /**
     * The largest value allowed.
     */
    maximum?: number,
    /**
     * The one value allowed.
     */
    const?: unknown,
    /**
     * A number the value is less than.
     */
    exclusiveMaximum?: number,
    /**
     * The smallest value allowed.
     */
    minimum?: number,
    /**
     * A number the value is more than.
     */
    exclusiveMinimum?: number,
    /**
     * The most characters a string may have.
     */
    maxLength?: number,
    /**
     * The fewest characters a string may have.
     */
    minLength?: number,
    /**
     * A regular expression a string matches.
     */
    pattern?: string,
    /**
     * The most items a list may have.
     */
    maxItems?: number,
    /**
     * The fewest items a list may have.
     */
    minItems?: number,
    /**
     * Whether the items of a list are all different.
     */
    uniqueItems?: boolean,
    /**
     * The most properties an object may have.
     */
    maxProperties?: number,
    /**
     * The fewest properties an object may have.
     */
    minProperties?: number,
    /**
     * The properties an object has to have.
     */
    required?: string[],
    /**
     * The values allowed.
     */
    enum?: unknown[],
    /**
     * The schemas of the first items of a list, in order.
     */
    prefixItems?: (OpenApiSchemaObject | OpenApiReferenceObject)[],
    /**
     * The media type of what a string holds, such as `application/xml`.
     */
    contentMediaType?: string,
    /**
     * How a string encodes what it holds, such as `base64`.
     */
    contentEncoding?: string,
    /**
     * The schema of the document a string holds, of the media type `contentMediaType` names, such as an XML document.
     */
    contentSchema?: OpenApiSchemaObject | OpenApiReferenceObject
};

/**
 * Which property tells the schemas of a `oneOf` or `anyOf` apart.
 */
export type OpenApiDiscriminatorObject = {
    /**
     * The name of the property.
     */
    propertyName: string,
    /**
     * The schema each value of the property stands for, by value.
     */
    mapping?: Record<string, string>
};

/**
 * How a schema appears in xml: its element's name and namespace, or that it is an attribute.
 */
export type OpenApiXmlObject = OpenApiSpecificationExtensions & {
    /**
     * The name of the element or attribute.
     */
    name?: string,
    /**
     * The namespace of the element or attribute.
     */
    namespace?: string,
    /**
     * The prefix of the namespace.
     */
    prefix?: string,
    /**
     * Whether the value is written as an attribute. An element by default.
     */
    attribute?: boolean,
    /**
     * Whether the items of a list are inside an element of the list's own.
     */
    wrapped?: boolean
};

/**
 * Schema definitions.
 */
export type OpenApiSchemas = {
    [schema: string]: OpenApiSchemaObject | OpenApiReferenceObject
};

/**
 * The kinds of security scheme of OpenAPI 3.1.
 */
export type OpenApiSecuritySchemeType = 'apiKey' | 'http' | 'mutualTLS' | 'oauth2' | 'openIdConnect';

/**
 * Security scheme definition object.
 */
export type OpenApiSecuritySchemeObject = OpenApiSpecificationExtensions & {
    /**
     * The kind of the scheme.
     */
    type: OpenApiSecuritySchemeType,
    /**
     * What the scheme is, in markdown.
     */
    description?: string,
    /**
     * The name of the header, query parameter or cookie of an `apiKey` scheme.
     */
    name?: string,
    /**
     * Where an `apiKey` scheme sends its key: `query`, `header` or `cookie`.
     */
    in?: string,
    /**
     * The http authorization scheme of an `http` scheme, such as `bearer`.
     */
    scheme?: string,
    /**
     * What a bearer token of an `http` scheme is, such as `JWT`.
     */
    bearerFormat?: string,
    /**
     * The flows of an `oauth2` scheme.
     */
    flows?: OpenApiOAuthFlowsObject,
    /**
     * The url of the OpenID Connect discovery document of an `openIdConnect` scheme.
     */
    openIdConnectUrl?: string
};

/**
 * The flows of an `oauth2` scheme, by the grant they use.
 */
export type OpenApiOAuthFlowsObject = OpenApiSpecificationExtensions & {
    /**
     * The implicit flow.
     */
    implicit?: OpenApiOAuthFlowObject,
    /**
     * The resource owner password flow.
     */
    password?: OpenApiOAuthFlowObject,
    /**
     * The client credentials flow.
     */
    clientCredentials?: OpenApiOAuthFlowObject,
    /**
     * The authorization code flow.
     */
    authorizationCode?: OpenApiOAuthFlowObject
};

/**
 * One flow of an `oauth2` scheme.
 */
export type OpenApiOAuthFlowObject = OpenApiSpecificationExtensions & {
    /**
     * The url a user authorizes at.
     */
    authorizationUrl?: string,
    /**
     * The url a token is requested from.
     */
    tokenUrl?: string,
    /**
     * The url a token is refreshed at.
     */
    refreshUrl?: string,
    /**
     * The description of each scope, by scope.
     */
    scopes: Record<string, string>
};

/**
 * Security requirement mapping.
 */
export type OpenApiSecurityRequirementObject = {
    [scheme: string]: string[]
};

/**
 * A server the document names, which a request is sent to.
 */
export type OpenApiServerObject = OpenApiSpecificationExtensions & {
    /**
     * The url of the server, which may hold variables in braces, such as `https://{region}.example.com`.
     */
    url: string,
    /**
     * What the server is.
     */
    description?: TranslatedString,
    /**
     * The variables of the url, by name.
     */
    variables?: Record<string, OpenApiServerVariableObject>
};

/**
 * A variable of the url of a server.
 */
export type OpenApiServerVariableObject = OpenApiSpecificationExtensions & {
    /**
     * The values allowed.
     */
    enum?: string[],
    /**
     * The value taken when none is chosen.
     */
    default: string,
    /**
     * What the variable is, in markdown.
     */
    description?: string
};

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
     * Whether this response was added automatically by the framework, not declared by the
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
     * Whether this response was added automatically by the framework (such as by \@RateLimited), not
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
     * Whether this response was added automatically by the framework, not declared by the
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
     * Whether this response was added automatically by the framework, not declared by the
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
     * Whether this response was added automatically by the framework, not declared by the
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
     * Whether this response was added automatically by the framework, not declared by the
     * developer. Used to distinguish auto-generated documentation from legitimate ones when checking for missing
     * response data.
     */
    implicit?: boolean
};

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