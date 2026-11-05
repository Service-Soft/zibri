import { CacheInvalidation } from './cache-invalidation.model';
import { type CacheServiceInterface } from './cache-service.interface';
import { CronExpression } from '../cron/cron-expression.utilities';
import { InitialCronConfig } from '../cron/cron-job.model';
import { Inject } from '../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { BaseEntity } from '../entity/base-entity.model';
import { PollingCronJob } from '../polling/polling-cron-job.model';
import { WAKE_UP_TOPICS } from '../polling/wake-up-topics';
import { Newable } from '../types/newable.type';

// Deliberately `runsOn: 'everyInstance'`. Every instance has its own caches to clear, so every instance
// has to run this; electing one would clear one instance's caches and leave the rest stale, which
// is the very thing being fixed. Keeps no row for the same reason.
/**
 * Applies the cache invalidations other instances have published.
 *
 * A cache lives in the memory of the process holding it, so invalidating on the instance that
 * handled a write leaves every other instance answering with the old value until its ttl runs out.
 * A shared store solves that for a single tier cache - the values are on the server, so removing
 * them removes them for everybody - but not for the local tier of a multi tier cache, which is
 * local by definition. That tier is what this exists for.
 *
 * Runs on every instance, and keeps no row.
 */
export class CacheInvalidationCronJob extends PollingCronJob {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly initialConfig: InitialCronConfig = {
        name: 'Cache Invalidation',
        // often, because the gap between a write and every instance agreeing about it is how long
        // users are served something that has already changed
        cron: CronExpression.every(2, 'seconds').build(),
        runOnInit: false,
        runsOn: 'everyInstance',
        syncToDataSource: false
    };

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected readonly wakeUpTopic: string = WAKE_UP_TOPICS.CACHE_INVALIDATIONS;

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected readonly polledEntity: Newable<BaseEntity> = CacheInvalidation;

    constructor(
        @Inject(ZIBRI_DI_TOKENS.CACHE_SERVICE)
        private readonly cacheService: CacheServiceInterface
    ) {
        super();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected async poll(): Promise<boolean> {
        await this.cacheService.applyPendingInvalidations();
        // one read applies everything published so far, so there is nothing left to look again for
        // until the next invalidation wakes it
        return false;
    }
}