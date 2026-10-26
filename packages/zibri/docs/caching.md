# Caching
A cache keeps what a method returned, so a repeated call is answered without running the method again. You define a cache as a class, and apply it to methods with decorators.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `CacheInvalidation` | entity | How instances tell each other about an invalidation |
| `ZIBRI_DI_TOKENS.CACHE_INVALIDATION_RETENTION_IN_MS` | DI token | How long those rows are kept. Defaults to one minute |
| `CacheInvalidationCronJob` | cron job | Applies the invalidations other instances published to the caches of this one. Registered for you |
| `Cache` | decorator | Registers a class as a cache |
| `Cached` | decorator | Reads from (and fills) a cache around a method |
| `CacheDelete` | decorator | Deletes a cache entry after a method runs |
| `CacheInvalidate` | decorator | Invalidates cache entries after a method runs |
| `CacheWrite` | decorator | Writes through a cache around a method |
| `CacheOperation` | enum | The operations of a cache: `WRAP`, `WRITE`, `DELETE` and `INVALIDATE` |
| `CacheInterface`, `AnyCache`, `isCache` | interface, type, function | What a cache implements, any cache, and the check whether a value is one |
| `WriteThroughReadThroughCache` | class | Cache base class combining write-through and read-through strategies |
| `WriteAroundReadThroughCache`, `WriteBehindReadThroughCache`, `WriteInvalidateReadThroughArgsOnlyCache`, `WriteInvalidateReadThroughWithResultCache` | class, class, class, class | Cache base classes that read through the cache and, on a write, bypass it, fill it after answering, or delete the entry keyed by the arguments or by the result |
| `WriteThroughReadAsideCache`, `WriteAroundReadAsideCache`, `WriteBehindReadAsideCache`, `WriteInvalidateReadAsideArgsOnlyCache`, `WriteInvalidateReadAsideWithResultCache` | class, class, class, class, class | Cache base classes whose reads check the cache without filling it, and whose writes fill it, bypass it, fill it after answering, or delete the entry keyed by the arguments or by the result |
| `CacheWrapOptions`, `CacheWrapWriteOptionsWithResult`, `CacheWrapWriteOptionsArgsOnly`, `CacheWrapDeleteOptions`, `CacheWrapInvalidateOptions`, `CacheSetDirectOptions` | type, type, type, type, type, type | The options of a read, of a write with or without its result, of a delete, of an invalidation, and of a value set directly |
| `CacheKeyProvider`, `ResultCacheKeyProvider`, `CacheTtlProvider`, `ResultCacheTtlProvider`, `CacheTagsProvider`, `ResultCacheTagsProvider` | type, type, type, type, type, type | The key, time to live and tags of an entry, from the arguments of a method or from its result and arguments |
| `OnInvalidationFailure` | type | What a cache does when an invalidation fails: `'bestEffort'` or `'throw'`. Defaults to `'bestEffort'` |
| `CacheTagMatcher`, `matchesTag`, `matchesAnyTag` | type, function, function | A tag as a string, a regular expression or a function, and the checks whether it matches a tag or any of several |
| `MultiTierCache` | class | Combines multiple caches into tiers, checked in order |
| `MultiWrapOptions`, `MultiWrapWriteOptions` | type, type | The options of a read and of a write through a `MultiTierCache`, per tier |
| `CacheStoreInterface`, `CacheStoreConfig`, `RemoveOnOverflowStrategy` | interface, type, type | What a cache store implements, its `maxEntries` and `maxBytes`, and which entry it removes on overflow: the least or most recently used, the least frequently used, or the first in |
| `CachedValue` | class | An entry of a store: the value, its tags, when it was created and when it expires |
| `InMemoryCacheStore` | class | In-memory cache store implementation |
| `Bytes` | class | Sizes in bytes, such as `5 * Bytes.MB`, for a store's `maxBytes` |
| `DoublyLinkedList`, `LinkedListNode` | class, class | A list that removes any node and moves one to its end at constant cost, the order an in-memory store evicts in |
| `ValKeyCacheStore` | class | Cache store shared by every instance of an app |
| `ValKeyCacheStoreConfig`, `CacheModel` | type, type | What a `ValKeyCacheStore` is built with. Its `model` is the class the values are read back as, or `'plain'` for values without one, and is required |
| `CacheExpiryCleanupCronJob` | cron job | Gives back the room held by values whose time to live has run out. Registered for you |
| `cacheKeyOf` | function | The value a store keys an entry by, holding the active [tenant](./glossary.md#tenant) |
| `SelfDescribing` | type | A value that names its class in a `className` property, so a shared store can read it back as that class |
| `CacheServiceInterface` | interface | Service tracking the registered caches |
| `CacheService` | class | The default `CacheServiceInterface`. Replaceable through `ZIBRI_DI_TOKENS.CACHE_SERVICE` |
| `ZIBRI_DI_TOKENS.CACHE_SERVICE` | DI token | Injects `CacheServiceInterface` |
| `ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT` | DI token | Injects the current request context, for building cache keys for example |

## Defining a cache
There is a cache base class for every combination of a write strategy and a read strategy.

```ts
// src/caching/static-pages.cache.ts
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
The cache above keeps its values in an `InMemoryCacheStore`, inside the process. A `ValKeyCacheStore` shares the cache between all instances of an application. It takes the `ValKeyDataSource` whose connection it uses:

```ts
// src/caching/static-pages.store.ts
import { HtmlResponse, inject, ValKeyCacheStore } from 'zibri';

import { CacheDbDataSource } from '../data-sources';

const sharedStore: ValKeyCacheStore<string, HtmlResponse> = new ValKeyCacheStore(
    inject(CacheDbDataSource),
    { model: HtmlResponse, maxEntries: 5000 }
);
```

`model` is required, and says what the store holds. The store reads a value back the way a request
body is read, so a cached entity comes back with the types it was cached with, a `Date`, a `bigint`
and an exact decimal included.

Pass `'plain'` for a value with no shape to read, such as a number, a string or a plain object of them:

```ts
// src/caching/counter.store.ts
import { inject, ValKeyCacheStore } from 'zibri';

import { CacheDbDataSource } from '../data-sources';

const counterStore: ValKeyCacheStore<string, number> = new ValKeyCacheStore(
    inject(CacheDbDataSource),
    { model: 'plain' }
);
```

`InMemoryCacheStore` takes no `model`. It never serializes, and hands back the object it was given.

A value read back from a shared store has lost the prototype of its class, so `instanceof` answers
no for it. A model therefore implements `SelfDescribing`: its instances name their class in a
property.

```ts
// src/models/invoice.model.ts
import { BaseTenantEntity, BigNumber, Entity, Property, SelfDescribing } from 'zibri';

@Entity()
export class Invoice extends BaseTenantEntity() implements SelfDescribing {
    @Property.string({ exclude: true })
    readonly className: 'Invoice' = 'Invoice';

    @Property.number({ format: 'bignumber' })
    total!: BigNumber;

    @Property.date()
    issuedAt!: Date;
}
```

`exclude` keeps `className` out of what a caller is answered with. An `Invoice` read out of a shared
cache has a `BigNumber` for its total, a `Date` for its date, and a `className` that says what it is.

Both stores hold at most `maxEntries` entries and at most `maxBytes` of them. Past either limit, they remove the entries the configured `removeOnOverflow` strategy picks. You can also provide a store of your own.

Apply your cache with the decorators, on the method to cache:

```ts
// src/controllers/page.controller.ts
import { Cached, Controller, Get, GlobalRegistry, HtmlResponse, HttpRequestContext, inject, Response, TsxUtilities, WebsocketRequestContext, ZIBRI_DI_TOKENS, ZIBRI_REQUEST_CONTEXT_TOKENS } from 'zibri';

import { StaticPagesCache } from '../caching/static-pages.cache';
import { HomePage } from '../templates/pages/home';

@Controller('/')
export class PageController {
    @Cached(StaticPagesCache, () => {
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

The key holds the locale, so each locale gets its own page. With a single locale, `'index'` is key enough.

The other decorators are:
- `CacheDelete`
- `CacheInvalidate`
- `CacheWrite`

### What a key may be

A key provider returns a string or an object. `{ userId, tenantId }` built from the arguments is an
ordinary key. Keys are compared by what they contain, not by identity. A provider that builds a
fresh object on every call finds what the previous call stored, and two call sites that build the
same key find each other's entries, in whatever order they write the properties.

Array order counts: a key holding `['name', 'createdAt']` is a different key from one holding
`['createdAt', 'name']`, so a cached sort is never served for another sort.

A key holds the [tenant](./tenancy.md#work-outside-a-request) active while it is used, so each tenant
reads and fills its own entries under the same key. A tag invalidates its entries in every tenant.
To invalidate the entries of one tenant only, put the tenant id in the tag.

A store of your own keys each entry by what `cacheKeyOf(key)` returns. Both stores Zibri ships
compare keys that way.

### One call per key at a time

When several callers miss the same key at once, the first one runs the method and the rest wait for
its result. That holds for every cache, multi tier ones included. A popular key that expires reaches
the origin as one call, not as a burst.

This holds within one instance. Two instances missing the same key at the same moment make two
calls. They share the store, so either one sees the value once the other has written it.

## Expiry and the size budget

A time to live decides how long a value stays usable. A value whose time has run out is reported as a miss and taken out of the store, so the next caller gets a fresh one. Reading an expired value does not keep it: it gives up its place at once, and eviction protects the entries that are still in use.

`CacheExpiryCleanupCronJob` is registered for you once your application has a cache. Once a minute it takes the values whose time has run out out of every cache, so a value nobody asks for again gives its room back, and `cache_size` counts only entries that can still answer. `cache_expired_evictions_total` counts what leaves for having expired, labeled by cache.

The byte budget means the same thing on every instance. Instances writing the same key at the same time agree on how much the store holds, so `maxBytes` is the size the cache keeps.

## Combining caches into tiers
A `MultiTierCache` checks its caches in order, fastest first. With an in-memory cache over a cache on a `ValKeyCacheStore`, a call is answered from memory when it can be, from the shared store otherwise, and runs the method only when neither holds the value. A hit in a slower tier fills the faster ones, and running the method fills every tier.

```ts
// src/caching/task-count.cache.ts
import { Cache, CacheServiceInterface, Inject, LoggerInterface, MetricsServiceInterface, MultiTierCache, ZIBRI_DI_TOKENS } from 'zibri';

import { FastCache, SlowCache } from './tiers';

@Cache()
export class TaskCountCache extends MultiTierCache<string, number, [FastCache, SlowCache]> {
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
        super('TaskCountCache', [fast, slow]);
    }
}
```

## Running more than one instance

Invalidating a tag takes effect on every instance, not only the one that handled the request.

`invalidateTags` clears the caches of this instance at once, then records a `CacheInvalidation` row that every other instance picks up and applies to its own caches. An in-memory cache, on its own or as the fast tier over a shared `ValKeyCacheStore`, is cleared on every instance.

> [!NOTE]
> Invalidation is eventually consistent across a deployment. The instance handling the write is
> never stale, and the others catch up within a couple of seconds. For a read that has to see a
> write at once, read on a path that is not cached.

`CacheInvalidation` rows are deleted once they are older than `ZIBRI_DI_TOKENS.CACHE_INVALIDATION_RETENTION_IN_MS`, one minute by default. An instance that was down for longer starts with empty local caches.

A cache on `ValKeyCacheStore` alone keeps its values on the server, so removing them removes them for every instance.

## Keeping your own memory coherent

Keep something else in memory coherent the same way, such as rows read once into a lookup table. Register a listener for a tag in `onAppInit`, and invalidate the tag whenever the rows change. The listener runs at once on the instance that invalidated, and within a couple of seconds on every other one. Registering needs `CacheInvalidation` declared in a data source. The roles of an application are kept this way, see [roles and permissions](./roles-and-permissions.md#roles).

A listener takes a tag, a regular expression or a function that says which tags it listens for. It is handed the tag that was invalidated, for example to forget only the part of what it keeps that the tag names: `tag => tag.startsWith('prices:')` listens for `prices:<shop>` of every shop.

```ts
// src/services/price-list.service.ts
import { CacheServiceInterface, inject, Injectable, OnAppInit, ZIBRI_DI_TOKENS, ZibriApplication } from 'zibri';

@Injectable()
export class PriceList implements OnAppInit {
    private prices: Map<string, number> = new Map();

    onAppInit(app: ZibriApplication): void {
        const cacheService: CacheServiceInterface = inject(ZIBRI_DI_TOKENS.CACHE_SERVICE);
        cacheService.registerInvalidationListener(app, PriceList.name, 'prices', async () => await this.readPrices());
    }

    async updatePrice(product: string, price: number): Promise<void> {
        // write the row, then tell every instance
        await inject(ZIBRI_DI_TOKENS.CACHE_SERVICE).invalidateTags(['prices']);
    }

    private async readPrices(): Promise<void> {
        // read the rows again into this.prices
    }
}
```

## Requirements
Your data source declares these entities:

| Entity | Needed when |
|---|---|
| `CacheInvalidation` | A cache is registered, or the application has roles |

How large each table grows, and what deletes its rows, is in [framework tables](./framework-tables.md).

## See also
- [Replication](./replication.md) — keeping a local cache tier coherent across instances
- [Request context](./request-context.md) — `CURRENT_REQUEST_CONTEXT`, used above to build a per-locale cache key
- [Metrics](./metrics.md) — cache hit/miss metrics on the built-in dashboard
