import { oas31 } from 'openapi3-ts';

export type OpenApiDefinition = oas31.OpenAPIObject;

export type OpenApiPaths = oas31.PathsObject;

export type OpenApiOperation = oas31.OperationObject;

export type OpenApiParameter = (oas31.ParameterObject | oas31.ReferenceObject);

export type OpenApiRequestBodyObject = oas31.RequestBodyObject;

export type OpenApiSchemaObject = oas31.SchemaObject;