import { AssetServiceInterface, Cache, Cached, CacheServiceInterface, Controller, Get, GlobalRegistry, HtmlResponse, Inject, inject, InMemoryCacheStore, LoggerInterface, MetricsServiceInterface, PreactUtilities, Response, TreeNode, WriteThroughReadThroughCache, ZIBRI_DI_TOKENS } from 'zibri';

import { AssetsPage } from '../templates/pages/assets';
import { HomePage } from '../templates/pages/home';

@Cache()
export class StaticPagesCache extends WriteThroughReadThroughCache<string, HtmlResponse, 'StaticPagesCache'> {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        protected readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.CACHE_SERVICE)
        protected readonly cacheService: CacheServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE)
        protected readonly metricsService: MetricsServiceInterface
    ) {
        super('StaticPagesCache', new InMemoryCacheStore(), []);
    }
}

@Controller('/', { versions: 'all' })
export class PageController {

    @Cached(StaticPagesCache, () => 'index')
    @Response.html()
    @Get()
    async index(): Promise<HtmlResponse> {
        const html: string = await PreactUtilities.renderPage(HomePage, { appName: GlobalRegistry.getAppData('name') ?? '' });
        return HtmlResponse.fromString(html);
    }

    @Cached(StaticPagesCache, () => 'assets')
    @Response.html()
    @Get('/assets')
    async assets(): Promise<HtmlResponse> {
        const assetService: AssetServiceInterface = inject(ZIBRI_DI_TOKENS.ASSET_SERVICE);
        const nodes: TreeNode[] = await assetService.buildFileTree();
        const html: string = await PreactUtilities.renderPage(AssetsPage, { nodes });
        return HtmlResponse.fromString(html);
    }
}