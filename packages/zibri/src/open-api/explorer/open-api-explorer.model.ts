import { AsyncApiDefinition } from '../../async-api/async-api.model';
import { TsxComponent } from '../../tsx/tsx-component.model';
import { OpenApiDefinition } from '../open-api.model';

/**
 * One version of the application, as the explorer offers it.
 */
export type OpenApiExplorerVersion = {
    /**
     * The version, such as `1.0.0`.
     */
    value: string,
    /**
     * What the explorer calls it: the version, and when it was in use.
     */
    name: string,
    /**
     * Where the explorer shows the document of this version.
     */
    url: string,
    /**
     * Where the OpenAPI document of this version is served as json.
     */
    documentUrl: string,
    /**
     * Where the AsyncAPI document of this version is served as json.
     */
    asyncApiDocumentUrl: string
};

/**
 * The props the explorer page is rendered with.
 */
export type OpenApiExplorerProps = {
    /**
     * The name of the application.
     */
    appName: string,
    /**
     * Where the public assets are served, such as `/assets`.
     */
    assetsRoute: string,
    /**
     * Every version of the application, the latest first.
     */
    versions: OpenApiExplorerVersion[],
    /**
     * The version the page shows.
     */
    version: OpenApiExplorerVersion,
    /**
     * The OpenAPI document of that version: its HTTP routes.
     */
    definition: OpenApiDefinition,
    /**
     * The AsyncAPI document of that version: its websocket events.
     */
    asyncApiDefinition: AsyncApiDefinition,
    /**
     * The header a request names its version in, see `ZIBRI_DI_TOKENS.VERSION_HEADER`.
     */
    versionHeader: string
};

/**
 * A page component rendering the OpenAPI explorer, provided under `ZIBRI_DI_TOKENS.OPEN_API_EXPLORER_TEMPLATE`.
 */
export type OpenApiExplorerTemplate = TsxComponent<OpenApiExplorerProps>;
