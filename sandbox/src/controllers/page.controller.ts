import { AssetServiceInterface, Controller, Get, GlobalRegistry, HtmlResponse, inject, PreactUtilities, Response, TreeNode, ZIBRI_DI_TOKENS } from 'zibri';

import { AssetsPage } from '../templates/pages/assets';
import { HomePage } from '../templates/pages/home';

@Controller('/')
export class PageController {

    @Response.html()
    @Get()
    async index(): Promise<HtmlResponse> {
        const html: string = await PreactUtilities.renderPage(HomePage, { appName: GlobalRegistry.getAppData('name') ?? '' });
        return HtmlResponse.fromString(html);
    }

    @Response.html()
    @Get('/assets')
    async assets(): Promise<HtmlResponse> {
        const assetService: AssetServiceInterface = inject(ZIBRI_DI_TOKENS.ASSET_SERVICE);
        const nodes: TreeNode[] = await assetService.buildFileTree();
        const html: string = await PreactUtilities.renderPage(AssetsPage, { nodes });
        return HtmlResponse.fromString(html);
    }
}