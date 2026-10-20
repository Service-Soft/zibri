import { type EventServiceInterface } from './event-service.interface.ts';
import { CronExpression } from '../cron/cron-expression.utilities.ts';
import { CronJob, InitialCronConfig } from '../cron/cron-job.model.ts';
import { Inject } from '../di/decorators/inject.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default.ts';

/**
 * Hands unfinished events back to this instance's subscribers.
 *
 * Emitting an event only reaches subscribers in the process that emitted it. Without this, an event
 * whose instance died halfway through is never picked up by anyone: the row stays in the data
 * source, unfinished, and the mail it stood for is simply never sent. Docs/events.md promises the
 * opposite - that events survive restarts and are retried.
 *
 * Deliberately `distributed: false`. Every instance polls, so any of them can take over abandoned
 * work; which one actually runs a given subscriber is decided by the claim in EventService, not by
 * electing a single poller. Electing one would make recovery depend on that instance being alive
 * and having the subscriber registered.
 */
export class EventDispatchCronJob extends CronJob {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    readonly initialConfig: InitialCronConfig = {
        name: 'Event Dispatch',
        cron: CronExpression.every(5, 'seconds').build(),
        // the emitting instance already delivers in process, so a boot time sweep would only
        // duplicate work the claim would then reject anyway
        runOnInit: false,
        distributed: false
    };

    constructor(
        @Inject(ZIBRI_DI_TOKENS.EVENT_SERVICE)
        private readonly eventService: EventServiceInterface
    ) {
        super();
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async onTick(): Promise<void> {
        // before dispatching, so this instance's subscribers are still on record when the events it
        // is about to hand out are reconciled against them
        await this.eventService.refreshSubscriberRegistrations();
        await this.eventService.dispatchPending();
    }
}