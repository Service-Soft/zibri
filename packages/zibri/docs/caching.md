# Caching
Caching in Zibri is based on first creating a cache class and then using that class with the help of decorators.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `CacheInvalidation` | entity | How instances tell each other about an invalidation. Must be registered in a data source |
| `ZIBRI_DI_TOKENS.CACHE_INVALIDATION_RETENTION_IN_MS` | DI token | How long those rows are kept. Defaults to one minute |
| `Cache` | decorator | Registers a class as a cache |
| `Cached` | decorator | Reads from (and fills) a cache around a method |
| `CacheDelete` | decorator | Deletes a cache entry after a method runs |
| `CacheInvalidate` | decorator | Invalidates cache entries after a method runs |
| `CacheWrite` | decorator | Writes through a cache around a method |
| `WriteThroughReadThroughCache` | class | Cache base class combining write-through and read-through strategies |
| `MultiTierCache` | class | Combines multiple caches into tiers, checked in order |
| `InMemoryCacheStore` | class | In-memory cache store implementation |
| `ValKeyCacheStore` | class | Cache store shared by every instance of an app |
| `CacheExpiryCleanupCronJob` | cron job | Gives back the room values whose time to live has run out were holding. Registered for you |
| `CacheServiceInterface` | interface | Service tracking the registered caches |
| `ZIBRI_DI_TOKENS.CACHE_SERVICE` | DI token | Injects `CacheServiceInterface` |
| `ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT` | DI token | Injects the current request context, usable eg. for cache keys |

## Usage
### Defining a cache
Zibri provides caches for all combinations of write and read strategies.

```ts
// src/caching/static-pages.cache.ts
import { Cache, Cached, CacheServiceInterface, Controller, Get, GlobalRegistry, HtmlResponse, HttpRequestContext, Inject, inject, InMemoryCacheStore, LoggerInterface, MetricsServiceInterface, MultiTierCache, Response, TsxUtilities, ValKeyCacheStore, WebsocketRequestContext, WriteThroughReadThroughCache, ZIBRI_DI_TOKENS, ZIBRI_REQUEST_CONTEXT_TOKENS } from 'zibri';

import { CacheDbDataSource } from '../data-sources';
import { FastCache, SlowCache } from './tiers';
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
```

### Using a cache
As you can see, the above uses a really simple in memory cache store. Zibri also ships a `ValKeyCacheStore`, which shares the cache between all instances of an app. It takes the `ValKeyDataSource` whose connection it should use:

```ts
const sharedStore: ValKeyCacheStore<string, HtmlResponse> = new ValKeyCacheStore(
    inject(CacheDbDataSource),
    { model: HtmlResponse, maxEntries: 5000 }
);
```

`model` says what the store holds, and it is required rather than optional. A store outside the
process writes json and reads json back, and json carries neither a `Date` nor a `bigint` nor an
exact decimal — each goes out as text and comes back as text, with nothing saying what the text
stood for. Naming the class lets the store read a value back the same way a request body is read, so
a cached entity comes back with the types it was cached with.

Pass `'plain'` when there is no shape to read — a number, a string, a plain object of them:

```ts
const counterStore: ValKeyCacheStore<string, number> = new ValKeyCacheStore(
    inject(CacheDbDataSource),
    { model: 'plain' }
);
```

The `InMemoryCacheStore` takes no `model`, because it never serializes: it hands back the object it
was given.

A model has to be a class whose instances say what they are, because a class itself does not survive
json — the values come back and the prototype does not, so `instanceof` answers no for a value that
merely went into a shared store and came back. Saying it in a property instead is what keeps that
answerable:

```ts
// src/models/invoice.model.ts
import { BaseEntity, BigNumber, Entity, Property, SelfDescribing } from 'zibri';

@Entity()
export class Invoice extends BaseEntity implements SelfDescribing {
    @Property.string({ exclude: true })
    readonly className: 'Invoice' = 'Invoice';

    @Property.number({ format: 'bignumber' })
    total!: BigNumber;

    @Property.date()
    issuedAt!: Date;
}
```

`exclude` keeps it wiring rather than part of what a caller is answered with. With it declared, an
`Invoice` read out of a shared cache still has a `BigNumber` for its total and a `Date` for its
date, and anything asking what it is still gets an answer.

Both stores hold at most `maxEntries` entries and at most `maxBytes` of them, and go past either limit by removing entries the configured `removeOnOverflow` strategy picks. You can of course still provide your own store instead.

To use your cache, you can use the provided decorators on whichever method that should be cached:

```ts
// src/controllers/page.controller.ts
@Controller('/')
export class PageController {
    @Cached(StaticPagesCache, () => {
        // if you only have a single locale configured you could also just use 'index' here.
        const ctx: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
        return ctx?.get(ZIBRI_REQUEST_CONTEXT_TOKENS.CURRENT_LOCALE) + 'index';
    })
    @Response.html()
    @Get()
    async index(): Promise<HtmlResponse> {
        const html: string = TsxUtilities.renderPage(HomePage, { appName: GlobalRegistry.getAppData('name') ?? '' });
        return HtmlResponse.fromString(html);
    }
}
```

Other decorators include:
- CacheDelete
- CacheInvalidate
- CacheWrite

#### What a key may be

A key provider can return a string or an object — `{ userId, tenantId }` built from the arguments is
an ordinary key. Keys are compared by what they contain rather than by identity, so a provider
building a fresh object on every call finds what the previous call stored, and two call sites
building the same key find each other's entries even when they write the properties in a different
order.

Array order is kept, because it carries meaning: a key holding `['name', 'createdAt']` is a different
key from one holding `['createdAt', 'name']`, so a cached sort is never served for another one.

#### One call per key at a time

When several callers miss the same key at once, the first one runs the method and the rest wait for
its result instead of running their own. That holds for every cache, multi tier ones included, and it
is what keeps a popular key expiring from reaching the origin as a burst rather than as one call.

It coalesces within one instance. Two replicas missing the same key at the same moment are two calls
— what they share is the store, so the second sees the value once the first has written it.

### Expiry and the size budget

A time to live decides how long a value stays usable, and a cache answers with what is still usable: a value whose time has run out is reported as a miss and taken out of the store, so the next caller gets a fresh one. Reading it is not what keeps it — an expired value gives up its place immediately, and the entries eviction protects are the ones still being used.

Room comes back on its own, too. `CacheExpiryCleanupCronJob` is registered for you as soon as your app has a cache, and takes the values whose time has run out out of every cache once a minute. Without it a value that nobody asks for a second time would go on taking up room until something else needed the space, and `cache_size` would count entries that can no longer answer anything. `cache_expired_evictions_total` counts what leaves for having expired, labelled by cache.

The byte budget means the same thing on every instance. Writing a value and removing one each happen in a single step, so instances writing the same key at the same time agree about how much the store holds, and `maxBytes` stays the size the cache actually keeps rather than a number that drifts away from it.

### Multi Tier Caches
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

### Running more than one instance

Invalidating a tag takes effect on **every** instance, not just the one that handled the request.

That matters most for the arrangement multi-tier exists for: a fast in-memory L1 over a shared `ValKeyCacheStore` L2. Invalidating clears the L2 for everybody, but each instance's L1 is in its own memory and no store choice changes that — being local is what L1 *is*. Without a way to tell the other instances, they would keep answering with the old value for the full TTL: a permissions change that does not take effect, a price that stays wrong on two pods out of three.

So `invalidateTags` does two things: it clears this instance's caches immediately, then records a `CacheInvalidation` row that every other instance picks up and applies to its own.

**`CacheInvalidation` must be registered in a data source** whenever your app has any cache, the same as any other entity. If it is missing, startup fails with a `MissingEntitiesError` naming it.

Two consequences worth knowing:

- **Invalidation is eventually consistent across a deployment.** The instance handling the write is never stale; the others catch up within a couple of seconds. If you need an immediately consistent read after a write, read it on a path that is not cached.
- Rows are a notification, not a record. They are deleted once older than `ZIBRI_DI_TOKENS.CACHE_INVALIDATION_RETENTION_IN_MS` (one minute by default), which is comfortably longer than any instance needs to notice them. An instance that was down for longer starts with empty local caches anyway.

A single-tier cache on `ValKeyCacheStore` is already coherent without any of this — the values live on the server, so removing them removes them for everyone. The mechanism costs it nothing, and means an in-memory single-tier cache is coherent too.

## See also
- [Replication](./replication.md) — keeping a local cache tier coherent across instances
- [Request context](./request-context.md) — `CURRENT_REQUEST_CONTEXT`, used above to build a per-locale cache key
- [Metrics](./metrics.md) — cache hit/miss metrics on the built-in dashboard
