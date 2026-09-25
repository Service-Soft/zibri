import { type CacheServiceInterface } from './cache-service.interface';
import { CronExpression } from '../cron/cron-expression.utilities';
import { CronJob, InitialCronConfig } from '../cron/cron-job.model';
import { Inject } from '../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';

/**
 * Applies the cache invalidations other instances have published.
 *
 * A cache lives in the memory of the process holding it, so invalidating on the instance that
 * handled a write leaves every other instance answering with the old value until its ttl runs out.
 * A shared store solves that for a single tier cache - the values are on the server, so removing
 * them removes them for everybody - but not for the local tier of a multi tier cache, which is
 * local by definition. That tier is what this exists for.
 *
 * Deliberately `distributed: false`. Every instance has its own caches to clear, so every instance
 * has to run this; electing one would clear one instance's caches and leave the rest stale, which
 * is the very thing being fixed.
 */
export class CacheInvalidationCronJob extends CronJob {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly initialConfig: InitialCronConfig = {
        name: 'Cache Invalidation',
        // often, because the gap between a write and every instance agreeing about it is how long
        // users are served something that has already changed
        cron: CronExpression.every(2, 'seconds').build(),
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
        await this.cacheService.applyPendingInvalidations();
    }
}