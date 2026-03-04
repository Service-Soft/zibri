import { ZibriApplication } from '../application';
import { TreeNode } from './asset.service';
import { Route } from '../routing/controller-route-configuration.model';
import { Path } from '../utilities/fs.utilities';

/**
 * Interface for an asset service.
 */
export interface AssetServiceInterface {
    /**
     * The path of the assets.
     */
    readonly assetsPath: Path,
    /**
     * The path of the assets which are also publicly registered on the online file explorer.
     */
    readonly publicAssetsPath: Path,
    /**
     * The path of the email templates.
     */
    readonly emailTemplatePath: Path,
    /**
     * The path of the page templates.
     */
    readonly pageTemplatePath: Path,
    /**
     * The path of the component templates.
     */
    readonly componentTemplatePath: Path,
    /**
     * The route under which the file explorer with the public assets is registered.
     */
    readonly assetsRoute: Route,
    /**
     * Attaches the service to the application.
     */
    // eslint-disable-next-line typescript/no-explicit-any
    attachTo: (app: ZibriApplication, ...params: any[]) => void | Promise<void>,
    /**
     * Builds a file tree.
     */
    buildFileTree: () => TreeNode[] | Promise<TreeNode[]>
}