import { AssetService, Route } from 'zibri';

import { BASE_PATH } from '../base-path';

// the stylesheet, the favicon and the images of the pages, below the path the site is published at
export class DocsAssetService extends AssetService {
    override readonly assetsRoute: Route = `${BASE_PATH}/assets`;
}