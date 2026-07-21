import { TreeNode } from './asset.service';
import { Route } from '../routing/controller-route-configuration.model';
import { FsPath } from '../utilities/fs.utilities';

/**
 * Interface for an asset service.
 */
export interface AssetServiceInterface {
    /**
     * The path of the assets.
     */
    readonly assetsPath: FsPath,
    /**
     * The path of the assets which are also publicly registered on the online file explorer.
     */
    readonly publicAssetsPath: FsPath,
    /**
     * The path of the component templates.
     */
    readonly componentTemplatePath: FsPath,
    /**
     * The route under which the file explorer with the public assets is registered.
     */
    readonly assetsRoute: Route,
    /**
     * Builds a file tree.
     */
    buildFileTree: () => TreeNode[] | Promise<TreeNode[]>
}