import { filter, Subject, Subscription } from 'rxjs';

import { EventCleanupCronJob } from './event-cleanup.cron-job';
import { EventDispatchCronJob } from './event-dispatch.cron-job';
import { EventProcessingError } from './event-processing.error';
import { EventServiceInterface, EventSubscribeOptions, EventSubscriptionInterface, ZibriEventMap } from './event-service.interface';
import { ALL_EVENTS_TYPE, EventSubscriberRegistration, EventSubscriberRegistrationCreateData } from './event-subscriber-registration.model';
import { EventSubscriberRun, EventSubscriberRunCreateData, EventSubscriberRunStatus } from './event-subscriber-run.model';
import { Event, EventCreateData, EventStatus } from './event.model';
import { ZibriApplication } from '../application/application';
import { Repository } from '../data-source/repository/repository';
import { InjectRepository } from '../di/decorators/inject-repository.decorator';
import { Inject } from '../di/decorators/inject.decorator';
import { Injectable } from '../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { InternalError } from '../error-handling/internal-error.model';
import { AfterAppShutdown } from '../global/after-app-shutdown.interface';
import { OnAppInit } from '../global/on-app-init.interface';
import { type LeaseServiceInterface } from '../leases/lease-service.interface';
import { errorToLoggedError } from '../logging/error-to-logged-error.function';
import { LoggedError } from '../logging/logged-error.model';
import { type LoggerInterface } from '../logging/logger.interface';
import { Ms } from '../utilities/ms';
import { PromiseUtilities } from '../utilities/promise.utilities';
import { validateEntitiesRegistered } from '../utilities/validate-entities-registered.function';

/**
 * Names the grant on one subscriber's work on one event.
 *
 * Per subscriber rather than per event, because every subscriber owes its own run - and prefixed,
 * since the lease key space is shared with everything else that takes a grant.
 * @param eventId - The event being handled.
 * @param subscriberId - The subscriber that would run.
 * @returns The lease key.
 */
function claimKeyFor(eventId: string, subscriberId: string): string {
    return `event:${eventId}:${subscriberId}`;
}

/**
 * The result for subscribing to an event.
 */
export class EventSubscription implements EventSubscriptionInterface {
    constructor(
        readonly id: string,
        readonly rxSub: Subscription,
        readonly unsubscribe: () => void
    ) {}
}

/**
 * Default implementation of the event service.
 */
@Injectable({ register: 'onUse' })
export class EventService implements EventServiceInterface, OnAppInit, AfterAppShutdown {
    /**
     * The rxjs subject of the event.
     */
    protected readonly eventSubject: Subject<Event<ZibriEventMap[keyof ZibriEventMap]>> = new Subject();
    /**
     * The subscribers for each event type, under the type's name.
     *
     * Keyed by name rather than by `keyof ZibriEventMap`, because the map is empty until an
     * application merges into it - and the framework's own build is the one compilation where
     * nothing has, so a record keyed on it is `Record<never, …>` there and no key can be read from
     * it. The name is also what an `Event` row carries, so the in-memory index and the stored event
     * agree on what a type is.
     */
    protected readonly subscriptionForEvent: Map<string, Set<EventSubscription>> = new Map();
    /**
     * The subscribers that listen to all events.
     */
    protected readonly subscriptionsForAll: Set<EventSubscription> = new Set();
    /**
     * How many hooks this instance is running right now.
     *
     * Counted rather than queued, because the queue already exists: an event that is not dispatched
     * now is a row that still owes a run, and the dispatch poll offers it again.
     */
    protected runningHooks: number = 0;

    constructor(
        @InjectRepository(Event)
        protected readonly eventRepository: Repository<
            Event<ZibriEventMap[keyof ZibriEventMap]>,
            EventCreateData<ZibriEventMap[keyof ZibriEventMap]>
        >,
        @InjectRepository(EventSubscriberRun)
        protected readonly eventSubscriberRunRepository: Repository<
            EventSubscriberRun<ZibriEventMap[keyof ZibriEventMap]>,
            EventSubscriberRunCreateData<ZibriEventMap[keyof ZibriEventMap]>
        >,
        @InjectRepository(EventSubscriberRegistration)
        protected readonly eventSubscriberRegistrationRepository: Repository<
            EventSubscriberRegistration,
            EventSubscriberRegistrationCreateData
        >,
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        protected readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.LEASE_SERVICE)
        protected readonly leaseService: LeaseServiceInterface
    ) { }

    // eslint-disable-next-line jsdoc/require-jsdoc
    onAppInit(app: ZibriApplication): void {
        validateEntitiesRegistered('EventService', app, Event, EventSubscriberRun, EventSubscriberRegistration);
        if (!app.options.cronJobs.includes(EventCleanupCronJob)) {
            app.options.cronJobs.push(EventCleanupCronJob);
        }
        if (!app.options.cronJobs.includes(EventDispatchCronJob)) {
            app.options.cronJobs.push(EventDispatchCronJob);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    afterAppShutdown(): void {
        // We unsubscribe on the internal rxjs subscription here
        // => emit calls happening now will create the correct events
        for (const subscriber of this.subscriptionsForAll) {
            subscriber.rxSub.unsubscribe();
        }
        for (const subscriber of [...this.subscriptionForEvent.values()].flatMap(s => [...s])) {
            subscriber.rxSub.unsubscribe();
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async emit<K extends keyof ZibriEventMap>(type: K, data: ZibriEventMap[K], cleanupAfterMs: number = Ms.DAY): Promise<void> {
        const event: Event<ZibriEventMap[keyof ZibriEventMap]> = await this.eventRepository.create({
            type: String(type),
            // every subscriber in the deployment, not the ones this process happens to host. A
            // snapshot of the local set would silently exclude a subscriber that lives on other
            // replicas, and nothing downstream could tell the difference between "did not subscribe"
            // and "was not visible from here"
            subscriberIds: await this.liveSubscriberIdsFor(String(type)),
            cleanupAt: new Date(Date.now() + cleanupAfterMs),
            data
        });
        this.eventSubject.next({ ...event, eventSubscriberRuns: [] });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async subscribe<K extends keyof ZibriEventMap>(
        type: K,
        hook: (value: Event<ZibriEventMap[K]>, signal: AbortSignal) => void | Promise<void>,
        options: EventSubscribeOptions
    ): Promise<EventSubscription> {
        const existingAllEventSubscription: EventSubscription | undefined = this.findSubscriptionById(options.subscriberId);
        if (existingAllEventSubscription) {
            throw new InternalError(
                `Can't subscribe to event: The subscriberId ${options.subscriberId} is already subscribed to all events`
            );
        }
        const typeName: string = String(type);
        const existingEventSubscription: EventSubscription | undefined = this.findSubscriptionForEventById(
            typeName,
            options.subscriberId
        );
        if (existingEventSubscription) {
            this.logger.warn(
                `The subscriberId ${options.subscriberId} is already subscribed to this event, returning the existing subscription`
            );
            return existingEventSubscription;
        }

        const rxSub: Subscription = this.eventSubject
            .pipe(
                // finished, not merely present: a run row exists from the moment the work is
                // claimed, so skipping on its existence would mean an expired claim is never
                // retried by anyone
                filter(e => e.type === typeName && this.owesRun(e, options.subscriberId))
            )
            .subscribe(e => this.runHookSafely(hook, e as Event<ZibriEventMap[K]>, options));
        const subscriber: EventSubscription = new EventSubscription(
            options.subscriberId,
            rxSub,
            () => {
                this.subscriptionForEvent.get(typeName)?.delete(subscriber);
                rxSub.unsubscribe();
            }
        );

        const subscribers: Set<EventSubscription> = this.subscriptionForEvent.get(typeName) ?? new Set();
        subscribers.add(subscriber);
        this.subscriptionForEvent.set(typeName, subscribers);
        // written before returning rather than on the next heartbeat, so an emit that happens
        // immediately after this resolves already counts the subscriber
        await this.registerSubscriber(options.subscriberId, typeName);
        return subscriber;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async subscribeAll(
        hook: (value: Event<ZibriEventMap[keyof ZibriEventMap]>, signal: AbortSignal) => void | Promise<void>,
        options: EventSubscribeOptions
    ): Promise<EventSubscription> {
        const existingEventSubscriptionTypes: string[] = [];
        for (const type of this.subscriptionForEvent.keys()) {
            if (this.findSubscriptionForEventById(type, options.subscriberId)) {
                existingEventSubscriptionTypes.push(type);
            }
        }
        if (existingEventSubscriptionTypes.length) {
            throw new InternalError(
                [
                    `Can't subscribe to all events: The subscriberId ${options.subscriberId} is already subscribed to the events:`,
                    ...existingEventSubscriptionTypes.map(t => `    - ${t}`)
                ]
            );
        }

        const existingAllEventSubscription: EventSubscription | undefined = this.findSubscriptionById(options.subscriberId);
        if (existingAllEventSubscription) {
            this.logger.warn(
                `The subscriberId ${options.subscriberId} is already subscribed to all events, returning the existing subscription`
            );
            return existingAllEventSubscription;
        }

        const rxSub: Subscription = this.eventSubject
            .pipe(filter(e => this.owesRun(e, options.subscriberId)))
            .subscribe(e => this.runHookSafely(hook, e, options));
        const subscription: EventSubscription = new EventSubscription(
            options.subscriberId,
            rxSub,
            () => {
                this.subscriptionsForAll.delete(subscription);
                rxSub.unsubscribe();
            }
        );
        this.subscriptionsForAll.add(subscription);
        await this.registerSubscriber(options.subscriberId, ALL_EVENTS_TYPE);
        return subscription;
    }

    /**
     * Records that this subscriber exists, for every instance rather than just this one.
     *
     * An upsert on the pair, because replicas hosting the same subscriber are copies of it: whichever
     * gets there first creates the row and the rest push its expiry forward. The row is the
     * subscriber, not the process, so it survives any one of them going away.
     * @param subscriberId - The subscriber to record.
     * @param eventType - The type it takes, or ALL_EVENTS_TYPE when it takes every event.
     */
    protected async registerSubscriber(subscriberId: string, eventType: string): Promise<void> {
        const expiresAt: Date = new Date(Date.now() + inject(ZIBRI_DI_TOKENS.EVENT_SUBSCRIBER_REGISTRATION_TTL_IN_MS));
        await this.eventSubscriberRegistrationRepository.upsert(
            { subscriberId, eventType },
            { subscriberId, eventType, expiresAt },
            { expiresAt: { set: expiresAt } }
        );
    }

    /**
     * Pushes the expiry of every subscriber this instance hosts forward, and clears lapsed ones.
     *
     * Driven by the dispatch poll rather than by its own job, because both answer the same question -
     * what is still out there - and a second timer would only add a way for the two to disagree.
     *
     * A registration lapses only when no instance hosting that subscriber is left to refresh it, at
     * which point it stops holding events open. Until then a subscriber whose replicas are briefly
     * down keeps its events unfinished, which is what lets them be picked up when it returns.
     */
    async refreshSubscriberRegistrations(): Promise<void> {
        const local: [string, string][] = [
            ...[...this.subscriptionForEvent.entries()]
                .flatMap(([type, subs]) => [...subs].map((s): [string, string] => [s.id, type])),
            ...[...this.subscriptionsForAll].map((s): [string, string] => [s.id, ALL_EVENTS_TYPE])
        ];

        for (const [subscriberId, eventType] of local) {
            await this.registerSubscriber(subscriberId, eventType);
        }
        await this.eventSubscriberRegistrationRepository.deleteAll({ expiresAt: { before: new Date() } });
    }

    /**
     * The subscribers that owe an event of this type a run, anywhere in the deployment.
     *
     * Lapsed registrations are left out: a subscriber nothing hosts any more must not keep events
     * unfinished forever, and one that comes back re-registers before it could receive anything.
     * @param type - The event type.
     * @returns The subscriber ids, deduplicated.
     */
    protected async liveSubscriberIdsFor(type: string): Promise<string[]> {
        const registrations: EventSubscriberRegistration[] = await this.eventSubscriberRegistrationRepository.findAll({
            where: { eventType: { oneOf: [type, ALL_EVENTS_TYPE] }, expiresAt: { after: new Date() } }
        });
        return [...new Set(registrations.map(r => r.subscriberId))];
    }

    /**
     * Runs the hook without ever handing a rejected promise back to rxjs.
     *
     * An rxjs subscriber cannot await anything, so the promise runHook returns has no caller. Left
     * discarded with `void`, a rejection anywhere inside it became an unhandled rejection, and node
     * ends the process for those - a single slow subscriber was enough to take a healthy replica
     * down that way.
     * @param hook - The hook to run.
     * @param event - The event to run the hook on.
     * @param options - Additional options like the subscriberId, attempts etc.
     */
    protected runHookSafely<K extends keyof ZibriEventMap>(
        hook: (value: Event<ZibriEventMap[K]>, signal: AbortSignal) => void | Promise<void>,
        event: Event<ZibriEventMap[K]>,
        options: EventSubscribeOptions
    ): void {
        // an emit hands the event to every subscriber at once and returns, so nothing between the
        // caller and the hook can slow down. A burst of emits used to become a burst of exactly that
        // many hooks, each holding a timeout timer, a claim being renewed and rows to write.
        //
        // Refusing to start is the whole of the backpressure, and it is only allowed to be because
        // the work is not this promise: the event is a row that still owes this subscriber a run,
        // and EventDispatchCronJob offers it again. So a hook that does not start here is late
        // rather than lost - which is the same reason a queued thread job may be left for another
        // instance.
        if (this.runningHooks >= inject(ZIBRI_DI_TOKENS.EVENT_MAX_CONCURRENT_HOOKS)) {
            this.logger.debug(
                `Not dispatching event ${event.id} to subscriber "${options.subscriberId}" yet:`
                + ` ${this.runningHooks} hooks are already running. It stays queued.`
            );
            return;
        }

        void this.runHookCounted(hook, event, options);
    }

    /**
     * Runs the hook, counting it while it runs and never rejecting.
     *
     * An rxjs subscriber cannot await anything, so this promise has no caller. Left discarded, a
     * rejection anywhere inside it became an unhandled rejection, and node ends the process for
     * those - a single slow subscriber was enough to take a healthy replica down that way.
     * @param hook - The hook to run.
     * @param event - The event to run the hook on.
     * @param options - Additional options like the subscriberId, attempts etc.
     */
    private async runHookCounted<K extends keyof ZibriEventMap>(
        hook: (value: Event<ZibriEventMap[K]>, signal: AbortSignal) => void | Promise<void>,
        event: Event<ZibriEventMap[K]>,
        options: EventSubscribeOptions
    ): Promise<void> {
        this.runningHooks++;
        try {
            await this.runHook(hook, event, options);
        }
        catch (error) {
            this.logger.error(
                new InternalError(`Dispatching event ${event.id} to subscriber "${options.subscriberId}" failed`, {
                    cause: error
                })
            );
        }
        finally {
            this.runningHooks--;
        }
    }

    /**
     * Runs the given hook with the given event and options.
     * @param hook - The hook to run.
     * @param event - The event to run the hook on.
     * @param options - Additional options like the subscriberId, attempts etc.
     */
    protected async runHook<K extends keyof ZibriEventMap>(
        hook: (value: Event<ZibriEventMap[K]>, signal: AbortSignal) => void | Promise<void>,
        event: Event<ZibriEventMap[K]>,
        options: EventSubscribeOptions
    ): Promise<void> {
        // claim before doing anything. The same subscriber runs on every replica, and all of them
        // reach this point for the same event - without a claim a welcome mail goes out once per
        // pod. Losing the race is the normal outcome everywhere but one, not an error, so the
        // undefined this returns then is deliberately not looked at.
        //
        // The grant is renewed underneath for as long as the hook runs, and covers one attempt: the
        // attempts after it are separate dispatches, each claiming the work again.
        //
        // 'retain' rather than 'release', because the grant is not only the exclusion but the thing
        // that stops a replica arriving a moment later from running the same subscriber again -
        // handing it back the instant the hook returns would reopen exactly the window the ledger
        // row is written to close. It is also why a retry never happens sooner than the lease
        // lapses, whatever the backoff works out to.
        await this.leaseService.withLease(
            {
                key: claimKeyFor(event.id, options.subscriberId),
                leaseInMs: inject(ZIBRI_DI_TOKENS.EVENT_EXECUTION_LEASE_IN_MS),
                onCompletion: 'retain'
            },
            async () => {
                let error: InternalError | undefined = undefined;
                try {
                    await PromiseUtilities.withTimeout((signal) => hook(event, signal), options.timeout ?? Ms.SECOND * 30);
                }
                catch (_error) {
                    error = new InternalError(`Running hook for event ${event.id} failed`, { cause: _error });
                }
                await this.recordResult(event, options, error);
            }
        );
    }

    /**
     * Writes down how the attempt ended, and settles the event when nothing is owed any more.
     *
     * Written while the grant is still held on purpose. The row is what tells every future reader
     * where this subscriber stands with this event, and a grant that expired between the hook
     * returning and this landing would let another replica start the whole thing again.
     *
     * Guarded, because none of it is the subscriber's code and a failure here used to end the
     * process. That is worth logging and never worth dying over - the grant is retained either way,
     * so a write that failed means the attempt is repeated once the grant lapses rather than never
     * recorded at all.
     * @param event - The event that was handled.
     * @param options - The subscriber's options, for its id and how many attempts it gets.
     * @param error - What the hook failed with, if it did.
     */
    private async recordResult<K extends keyof ZibriEventMap>(
        event: Event<ZibriEventMap[K]>,
        options: EventSubscribeOptions,
        error: InternalError | undefined
    ): Promise<void> {
        const subscriberId: string = options.subscriberId;
        try {
            // the count lives on the row because the attempts are spread across polls and restarts,
            // so the process running this one has no way of knowing it is the third
            const previous: EventSubscriberRun<unknown> | undefined = await this.eventSubscriberRunRepository.findOne({
                where: { eventId: event.id, subscriberId },
                required: false
            });
            const attempts: number = (previous?.attempts ?? 0) + 1;
            const hasAttemptsLeft: boolean = attempts < (options.attempts ?? 1);
            const status: EventSubscriberRunStatus = error == undefined
                ? EventSubscriberRunStatus.SUCCEEDED
                : hasAttemptsLeft ? EventSubscriberRunStatus.PENDING_RETRY : EventSubscriberRunStatus.FAILED;
            // eslint-disable-next-line unicorn/no-null
            const loggedError: LoggedError | null = error == undefined ? null : errorToLoggedError(error);
            const nextRetryAt: Date | null = status === EventSubscriberRunStatus.PENDING_RETRY
                ? new Date(Date.now() + this.retryDelayFor(attempts))
                // null and not undefined, because this clears a column that a previous attempt
                // filled - the driver passes the value straight into the statement, where undefined
                // is a dialect's guess and null is the value being asked for
                // eslint-disable-next-line unicorn/no-null
                : null;

            if (error != undefined) {
                // EventProcessingError means the subscriber gave up, which is what the docs promise
                // it means - a failure with attempts left is worth knowing about but is not that
                if (status === EventSubscriberRunStatus.FAILED) {
                    this.logger.error(new EventProcessingError(event, subscriberId, error));
                }
                else {
                    this.logger.warn(
                        `Attempt ${attempts} at event ${event.id} for subscriber "${subscriberId}" failed,`
                        + ` retrying after ${nextRetryAt?.toISOString()}`
                    );
                }
            }

            await this.eventSubscriberRunRepository.upsert(
                { eventId: event.id, subscriberId },
                {
                    eventId: event.id,
                    subscriberId,
                    status,
                    attempts,
                    error: loggedError,
                    nextRetryAt,
                    finishedAt: new Date()
                },
                {
                    status: { set: status },
                    attempts: { set: attempts },
                    // set rather than left alone, so it always describes the ending the status names
                    error: { set: loggedError },
                    nextRetryAt: { set: nextRetryAt },
                    finishedAt: { set: new Date() }
                }
            );

            if (status === EventSubscriberRunStatus.PENDING_RETRY) {
                // still owed, so the event stays where it is and the next poll offers it again
                return;
            }
            await this.settleEvent(event);
        }
        catch (_error) {
            this.logger.error(
                new InternalError(
                    `Could not record the result of event ${event.id} for subscriber "${subscriberId}"`,
                    { cause: _error }
                )
            );
        }
    }

    /**
     * How long to wait before the next attempt at an event.
     *
     * Doubling from the configured base: the first retry waits it out once, the second twice as
     * long. No jitter, because the lease already decides which replica runs an event - what a spread
     * would buy here is between *events* that failed together, which is the unbounded fan out in
     * evaluation/04 2.5 rather than this.
     * @param attempts - How many attempts have been spent, the failed one included.
     * @returns The delay in milliseconds.
     */
    private retryDelayFor(attempts: number): number {
        return inject(ZIBRI_DI_TOKENS.EVENT_RETRY_DELAY_IN_MS) * (2 ** (attempts - 1));
    }

    /**
     * Moves the event out of CREATED once no subscriber owes it anything.
     * @param event - The event to settle.
     */
    private async settleEvent<K extends keyof ZibriEventMap>(event: Event<ZibriEventMap[K]>): Promise<void> {
        const settled: EventStatus | undefined = await this.settledStatusOf(event);
        if (settled == undefined) {
            return;
        }
        await this.eventRepository.updateById(event.id, { status: settled });
    }

    /**
     * Hands every unfinished event back to the local subscribers so they can try to claim it.
     *
     * Emitting only reaches subscribers in the emitting process, so without this an event whose
     * instance died is never picked up by anyone. Every instance polls, and the claim decides who
     * actually runs - which is why the cron job driving this is deliberately not distributed.
     */
    async dispatchPending(): Promise<void> {
        // CREATED and not "anything but FINISHED": a FAILED event is settled, and offering it again
        // would be retrying subscribers that already gave up.
        //
        // Only as many as this instance could dispatch, because a backlog is exactly what this
        // reads: taking all of it would load every pending event and its runs into memory to offer
        // work that mostly will not be started. The rest is read by the next poll - and read from
        // the front, because the entity orders by `createdAt` ascending by default, without which a
        // backlog under continuous emission would have a head that never gets read.
        const events: Event<ZibriEventMap[keyof ZibriEventMap]>[] = await this.eventRepository.findAll({
            where: { status: EventStatus.CREATED },
            relations: ['eventSubscriberRuns'],
            take: inject(ZIBRI_DI_TOKENS.EVENT_MAX_CONCURRENT_HOOKS)
        });

        // chunked rather than serial, because each event is independent - and chunked rather than
        // all at once, because this is exactly the path a backlog arrives on: an instance that died
        // holding work leaves every one of its events here at the same time, and a fan out the size
        // of that backlog would be the recovery hurting more than the outage.
        await PromiseUtilities.allChunked(events, async event => {
            // an event is finished when nobody still owes it a run, and that can become true without
            // anything happening to the event: the last instance hosting a subscriber goes away and
            // its registration lapses. Nothing else would notice - a subscriber that already ran is
            // filtered out before its hook, so the check that runs after a hook never runs again -
            // and the event would sit unfinished for good, never reaching the cleanup job.
            const settled: EventStatus | undefined = await this.settledStatusOf(event);
            if (settled != undefined) {
                await this.eventRepository.updateById(event.id, { status: settled });
                return;
            }
            this.eventSubject.next(event);
        });
    }

    /**
     * What the event has settled as, or undefined while a subscriber still owes it something.
     *
     * A run that is `PENDING_RETRY` is deliberately not an ending: the whole point of the state is
     * that the work is still owed, so an event carrying one keeps its place in the poll.
     * @param event - The event to judge.
     * @returns FINISHED when every subscriber succeeded, FAILED when the ones that are done include
     * one that gave up, and undefined while anything is still outstanding.
     */
    private async settledStatusOf<K extends keyof ZibriEventMap>(event: Event<ZibriEventMap[K]>): Promise<EventStatus | undefined> {
        const runs: EventSubscriberRun<unknown>[] = await this.eventSubscriberRunRepository.findAll({
            where: { event: { where: { id: event.id } } }
        });
        const endedById: Map<string, EventSubscriberRunStatus> = new Map(
            runs
                .filter(r => r.status !== EventSubscriberRunStatus.PENDING_RETRY)
                .map(r => [r.subscriberId, r.status])
        );
        // deployment wide, like the snapshot it is compared against. Reading the local set here was
        // the other half of 1.4b: the emitter counted only the subscribers it hosted, so the moment
        // its own were done it declared the event finished and the ones on other replicas - which
        // the dispatch poll only offers while an event is unfinished - never got it.
        const liveSubscriberIds: string[] = await this.liveSubscriberIdsFor(event.type);
        const owedBy: string[] = event.subscriberIds.filter(id => liveSubscriberIds.includes(id));

        if (owedBy.some(id => !endedById.has(id))) {
            return undefined;
        }
        return owedBy.every(id => endedById.get(id) === EventSubscriberRunStatus.SUCCEEDED)
            ? EventStatus.FINISHED
            : EventStatus.FAILED;
    }

    /**
     * Whether the given subscriber still owes this event a run right now.
     *
     * Reads the runs carried on the event rather than the table, because this gates every dispatch
     * and the poll that produces them has just loaded the relation. A subscriber that gave up owes
     * nothing, which is what stops a failed event being retried forever.
     * @param event - The event to check.
     * @param subscriberId - The subscriber to check for.
     * @returns Whether the hook should run.
     */
    private owesRun(event: Event<ZibriEventMap[keyof ZibriEventMap]>, subscriberId: string): boolean {
        const run: EventSubscriberRun<unknown> | undefined = event.eventSubscriberRuns
            .find(r => r.subscriberId === subscriberId);
        if (run == undefined) {
            return true;
        }
        if (run.status !== EventSubscriberRunStatus.PENDING_RETRY) {
            return false;
        }
        return (run.nextRetryAt?.getTime() ?? 0) <= Date.now();
    }

    private findSubscriptionForEventById(event: string, subscriberId: string): EventSubscription | undefined {
        const subscribers: EventSubscription[] = [...this.subscriptionForEvent.get(event) ?? []];
        return subscribers.find(s => s.id === subscriberId);
    }

    private findSubscriptionById(subscriberId: string): EventSubscription | undefined {
        const subscribers: EventSubscription[] = [...this.subscriptionsForAll];
        return subscribers.find(s => s.id === subscriberId);
    }
}