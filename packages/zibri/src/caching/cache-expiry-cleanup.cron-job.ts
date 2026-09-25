import { type CacheServiceInterface } from './cache-service.interface';
import { CronExpression } from '../cron/cron-expression.utilities';
import { CronJob, InitialCronConfig } from '../cron/cron-job.model';
import { Inject } from '../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';

/**
 * Takes the values whose time to live has run out out of the caches.
 *
 * A cache answers with what is still valid, so an expired value is never served either way. What
 * this decides is when the room it takes goes back: without it, the entry sits in the budget until
 * somebody asks for that exact key again - and a key nobody asks for twice is the ordinary case, so
 * a cache would slowly fill up with values it can no longer use and evict live ones to make room.
 *
 * Deliberately `distributed: false`, for the same reason the invalidation job is: a local cache
 * lives in the memory of the process holding it, so every instance has its own to sweep. A shared
 * store is swept by all of them, which costs a little and is harmless - an entry that is already
 * gone is dropped once, whichever instance gets there first.
 */
export class CacheExpiryCleanupCronJob extends CronJob {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly initialConfig: InitialCronConfig = {
        name: 'Cache Expiry Cleanup',
        // rarely, because nothing is served wrong in the meantime - the only cost of waiting is
        // room, and reclaiming it a minute later than possible is not worth a scan a second
        cron: CronExpression.every(1, 'minutes').build(),
        runOnInit: false,
        distributed: false
    };

    constructor(
        @Inject(ZIBRI_DI_TOKENS.CACHE_SERVICE)
        private readonly cacheService: CacheServiceInterface
    ) {
        super();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onTick(): Promise<void> {
        await this.cacheService.removeExpiredValues();
    }
}