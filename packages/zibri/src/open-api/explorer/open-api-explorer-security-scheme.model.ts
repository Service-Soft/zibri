import { OpenApiSecuritySchemeObject } from '../open-api.model';

/**
 * A security scheme of an OpenAPI document, its reference resolved, under its name.
 */
export type OpenApiExplorerSecurityScheme = {
    /**
     * The name of the scheme in `components.securitySchemes`.
     */
    name: string,
    /**
     * The scheme.
     */
    scheme: OpenApiSecuritySchemeObject
};
