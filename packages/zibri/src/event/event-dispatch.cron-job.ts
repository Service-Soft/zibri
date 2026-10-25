import { type EventServiceInterface } from './event-service.interface';
import { Event } from './event.model';
import { CronExpression } from '../cron/cron-expression.utilities';
import { InitialCronConfig } from '../cron/cron-job.model';
import { Inject } from '../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { BaseEntity } from '../entity/base-entity.model';
import { PollingCronJob } from '../polling/polling-cron-job.model';
import { WAKE_UP_TOPICS } from '../polling/wake-up-topics';
import { Newable } from '../types/newable.type';

/**
 * Hands unfinished events back to this instance's subscribers.
 *
 * Emitting an event only reaches subscribers in the process that emitted it. This picks up the
 * events whose instance died halfway through, so an event survives a restart and is retried.
 *
 * Deliberately `distributed: false`. Every instance polls, so any of them can take over abandoned
 * work; which one actually runs a given subscriber is decided by the claim in EventService, not by
 * electing a single poller. Electing one would make recovery depend on that instance being alive
 * and having the subscriber registered.
 *
 * Keeps no row, for the same reason: every instance runs it for itself, so a row would only say
 * that some instance polled.
 */
export class EventDispatchCronJob extends PollingCronJob {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly initialConfig: InitialCronConfig = {
        name: 'Event Dispatch',
        cron: CronExpression.every(5, 'seconds').build(),
        // the emitting instance already delivers in process, so a boot time sweep would only
        // duplicate work the claim would then reject anyway
        runOnInit: false,
        distributed: false,
        syncToDataSource: false
    };

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected readonly wakeUpTopic: string = WAKE_UP_TOPICS.EVENTS;

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected readonly polledEntity: Newable<BaseEntity> = Event;

    /**
     * When this instance last pushed the expiry of its subscribers forward.
     */
    private refreshedAtMs: number = 0;

    constructor(
        @Inject(ZIBRI_DI_TOKENS.EVENT_SERVICE)
        private readonly eventService: EventServiceInterface
    ) {
        super();
    }

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * Due for the events, or to keep this instance's subscribers on record: a registration that is
     * not refreshed within its lifetime lapses, and its events are settled without it.
     */
    protected override get isDue(): boolean {
        return super.isDue || this.isRefreshDue;
    }

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * Whether a third of a registration's lifetime has passed since the last refresh, which leaves
     * two more chances before it lapses.
     */
    private get isRefreshDue(): boolean {
        return Date.now() - this.refreshedAtMs >= inject(ZIBRI_DI_TOKENS.EVENT_SUBSCRIBER_REGISTRATION_TTL_IN_MS) / 3;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected async poll(): Promise<boolean> {
        // before dispatching, so this instance's subscribers are still on record when the events it
        // is about to hand out are reconciled against them
        if (this.isRefreshDue) {
            await this.eventService.refreshSubscriberRegistrations();
            this.refreshedAtMs = Date.now();
        }
        return await this.eventService.dispatchPending();
    }
}