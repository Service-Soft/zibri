import { ZibriApplication } from '../application';
import { Route } from '../routing';

/**
 * Interface for an asset service.
 */
export interface AssetServiceInterface {
    /**
     * The path of the assets.
     */
    readonly assetsPath: string,
    /**
     * The path of the assets which are also publicly registered on the online file explorer.
     */
    readonly publicAssetsPath: string,
    /**
     * The path of the email templates.
     */
    readonly emailTemplatePath: string,
    /**
     * The path of the page templates.
     */
    readonly pageTemplatePath: string,
    /**
     * The route under which the file explorer with the public assets is registered.
     */
    readonly assetsRoute: Route,

    /**
     * Attaches the service to the application.
     */
    // eslint-disable-next-line typescript/no-explicit-any
    attachTo: (app: ZibriApplication, ...params: any[]) => void
}