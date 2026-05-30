# Caching
Caching in Zibri is based on first creating a cache class and then using that class with the help of decorators.

## Defining a cache
Zibri provides caches for all combinations of write and read strategies.

```ts
import { Cache, CacheServiceInterface, HtmlResponse, Inject, InMemoryCacheStore, LoggerInterface, MetricsServiceInterface, WriteThroughReadThroughCache, ZIBRI_DI_TOKENS } from 'zibri';

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
```

## Using a cache
As you can see, the above uses a really simple in memory cache store. But you could also provide your own here, based eg. on redis.

To use your cache, you can use the provided decorators on whichever method that should be cached:

```ts
import { Cached, Get, GlobalRegistry, HtmlResponse, PreactUtilities, Response } from 'zibri';

import { HomePage } '../home';

@Cached(StaticPagesCache, () => 'index')
@Response.html()
@Get()
async index(): Promise<HtmlResponse> {
    const html: string = await PreactUtilities.renderPage(HomePage, { appName: GlobalRegistry.getAppData('name') ?? '' });
    return HtmlResponse.fromString(html);
}
```

Other decorators include:
- CacheDelete
- CacheInvalidate
- CacheWrite

## Multi Tier Caches
Multi Tier Caches are natively built into Zibri. They provide a clean way to define:<br>
Use the in memory cache if available. If it's not available: Look it up inside the redis cache. If that's also not available: Actually run the underlying method and fill all caches.

```ts
@Cache()
class TestMultiTierCache extends MultiTierCache<string, number, [FastCache, SlowCache]> {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        protected readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE)
        protected readonly metricsService: MetricsServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.CACHE_SERVICE)
        protected readonly cacheService: CacheServiceInterface,
        @Inject(FastCache)
        fast: FastCache,
        @Inject(SlowCache)
        slow: SlowCache
    ) {
        super('TestMulti', [fast, slow]);
    }
}
```