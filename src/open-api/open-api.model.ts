import { oas31 } from 'openapi3-ts';

import { HttpStatus, MimeType } from '../http';
import { Newable } from '../types';

export type OpenApiDefinition = oas31.OpenAPIObject;

export type OpenApiPaths = oas31.PathsObject;

export type OpenApiOperation = oas31.OperationObject;

export type OpenApiParameter = (oas31.ParameterObject | oas31.ReferenceObject);

export type OpenApiRequestBodyObject = oas31.RequestBodyObject;

export type OpenApiSchemaObject = oas31.SchemaObject;

export type OpenApiSecuritySchemeObject = oas31.SecuritySchemeObject;

export type OpenApiSecurityRequirementObject = oas31.SecurityRequirementObject;

export type FileOpenApiResponse = {
    type: 'file',
    status?: HttpStatus,
    description?: string,
    mimeType?: 'all' | MimeType | MimeType[]
};

export type DefaultOpenApiResponse = {
    type: 'default',
    status?: HttpStatus,
    description?: string,
    cls?: Newable<unknown>,
    isArray?: boolean
};

export type OpenApiResponse = DefaultOpenApiResponse | FileOpenApiResponse;