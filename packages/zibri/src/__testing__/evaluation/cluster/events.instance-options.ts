import { ClusterMark, clusterInstanceId, defaultClusterProviders, StartTestServerOptions } from 'zibri-testing';

import { Repository } from '../../../data-source/repository/repository';
import { InjectRepository } from '../../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { defineProvider } from '../../../di/models/di-provider.model';
import { type EventServiceInterface } from '../../../event/event-service.interface';
import { Event } from '../../../event/event.model';
import { type OnAppStart } from '../../../global/on-app-start.interface';
import { Controller } from '../../../routing/decorators/controller.decorator';
import { Post } from '../../../routing/decorators/post.decorator';

/**
 * What every instance of the event cluster boots with.
 *
 * Every replica runs identical code: the same subscriber under the same id, and any of them can
 * emit. Like every instance options module, this is imported by the parent as well, so nothing at
 * the top level may assume it is running inside an instance.
 */

declare module '../../../event/event-service.interface' {
    /**
     * The event this cluster deals in, declared the way an application declares its own.
     */
    interface ZibriEventMap {
        /**
         * Carries nothing: what this cluster observes is which replica ran the hook, which the
         * replicas write down themselves.
         */

        clusterEvent: {}
    }
}

/**
 * The event this cluster deals in.
 */
const eventType: 'clusterEvent' = 'clusterEvent';

/**
 * How long the hook pretends to work for, in milliseconds.
 *
 * Long enough that the parent can see the event was claimed and still kill the replica before it
 * finishes. That gap is the whole point: it is the pod dying halfway through sending the mail.
 */
const fastHookWorkInMs: number = 2000;

/**
 * How long the hook takes once the parent asks for slow hooks.
 *
 * Longer than the claim is held for. The claim is taken once and never renewed, and finishing never
 * checks that it is still ours, so a hook that legitimately runs this long has its claim collected
 * as abandoned while it is still working. Nothing about this is a misconfiguration: the default
 * lease is a minute and the default hook timeout is thirty seconds per attempt, so three attempts
 * already reach ninety.
 *
 * Comfortably more than the lease rather than barely more, because the takeover happens on a poll:
 * the gap between the claim going stale and the hook finishing has to hold several dispatch
 * intervals, or whether the bug is observed comes down to where the poll happens to land.
 */
export const slowHookWorkInMs: number = 16000;

/**
 * How long the hook currently takes. Per process, so the parent has to ask every instance.
 */
let hookWorkInMs: number = fastHookWorkInMs;

/**
 * How long a claim on an event is held before another instance may take it over.
 *
 * Far below the framework default of a minute, because this test cannot be faster than the claim it
 * waits to expire. It still has to exceed hookWorkInMs, or a healthy instance would lose the claim
 * while it is legitimately still working - which is the same trade-off a real deployment makes.
 */
export const eventLeaseInMs: number = 5000;

/**
 * The one subscriber, as the docs describe one.
 *
 * Shared across every replica rather than made unique per instance, because it identifies a
 * logical subscriber and not a process - EventSubscriberRun is a ledger keyed by exactly this. A
 * per replica id would mean a welcome mail per replica, which is the thing that must not happen.
 */
const subscriberId: string = 'cluster-recorder';

/**
 * Registers the subscriber and records what it did with each event.
 */
class ClusterEventRecorder implements OnAppStart {
    constructor(
        @InjectRepository(ClusterMark)
        private readonly markRepository: Repository<ClusterMark>
    ) {}

    /**
     * Subscribes once the instance is up.
     */
    async onAppStart(): Promise<void> {
        const instanceId: string = clusterInstanceId();
        const eventService: EventServiceInterface = inject(ZIBRI_DI_TOKENS.EVENT_SERVICE);

        await eventService.subscribe(
            eventType,
            async (event: Event<unknown>) => {
                // written before the work, so the parent knows which replica took it and can kill
                // that one while the hook is still running
                await this.markRepository.create({
                    instanceId,
                    kind: 'event-claimed',
                    tag: event.id,
                    at: new Date()
                });

                await new Promise<void>(resolve => {
                    setTimeout(resolve, hookWorkInMs);
                });

                // the side effect a subscriber exists for - the mail that has to go out exactly
                // once, no matter which replica survives to send it
                await this.markRepository.create({
                    instanceId,
                    kind: 'event-done',
                    tag: event.id,
                    at: new Date()
                });
            },
            // more than one attempt, so the test does not depend on a fix that happens to reprocess
            // on the first try
            { subscriberId, attempts: 3 }
        );
    }
}

/**
 * Lets the parent pick which instance emits.
 */
@Controller('/cluster-events')
class ClusterEventController {
    /**
     * Emits one event from this instance.
     */
    @Post('/emit')
    async emit(): Promise<void> {
        const eventService: EventServiceInterface = inject(ZIBRI_DI_TOKENS.EVENT_SERVICE);
        await eventService.emit(eventType, {});
    }

    /**
     * Makes this instance take longer over a hook than its claim on the event is held for.
     *
     * A real deployment does not have an endpoint for this, it has a subscriber that calls something
     * slow. The parent has to call this on every instance, because each one is its own process.
     */
    @Post('/slow-hooks')
    slowHooks(): void {
        hookWorkInMs = slowHookWorkInMs;
    }
}

const options: StartTestServerOptions = {
    controllers: [ClusterEventController],
    // spread rather than replaced: providers is the same field startTestServer takes, where what is
    // passed is what is used, so the real cron and multithreading services have to be kept here
    providers: [
        ...defaultClusterProviders,
        defineProvider({ token: ClusterEventRecorder, useClass: ClusterEventRecorder }),
        defineProvider({ token: ZIBRI_DI_TOKENS.EVENT_EXECUTION_LEASE_IN_MS, useFactory: () => eventLeaseInMs })
    ]
};

export default options;