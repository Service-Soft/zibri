import { createContext, OpenApiExplorerSchemaSource, RenderContext } from 'zibri';

/**
 * The document the explorer shows, OpenAPI or AsyncAPI, for the components that resolve its schemas.
 */
export const ExplorerDefinition: RenderContext<OpenApiExplorerSchemaSource> = createContext<OpenApiExplorerSchemaSource>({});

/**
 * What the user entered for each security scheme, by the name of the scheme.
 */
export const ExplorerCredentials: RenderContext<Record<string, string>> = createContext<Record<string, string>>({});

/**
 * The url of the server a request is sent to. Empty for the application itself.
 */
export const ExplorerServer: RenderContext<string> = createContext('');