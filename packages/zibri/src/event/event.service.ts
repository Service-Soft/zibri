import { filter, Subject, Subscription } from 'rxjs';

import { EventCleanupCronJob } from './event-cleanup.cron-job';
import { EventDispatchCronJob } from './event-dispatch.cron-job';
import { EventProcessingError } from './event-processing.error';
import { type EventReplayOptions } from './event-replay-options.model';
import { EventHook, EventServiceInterface, EventSubscribeOptions, EventSubscriptionInterface, ZibriEventMap } from './event-service.interface';
import { ALL_EVENTS_TYPE, EventSubscriberRegistration, EventSubscriberRegistrationCreateData } from './event-subscriber-registration.model';
import { EventSubscriberRun, EventSubscriberRunCreateData, EventSubscriberRunStatus } from './event-subscriber-run.model';
import { Event, EventCreateData, EventStatus } from './event.model';
import { ZibriApplication } from '../application/application';
import { DataSourceInterface } from '../data-source/data-sources/data-source.interface';
import { DataSourceSubscription, isPubSubDataSource } from '../data-source/data-sources/pub-sub-data-source.interface';
import { WhereFilter } from '../data-source/models/where/where-filter.model';
import { Repository } from '../data-source/repository/repository';
import { type RepositoryTransaction } from '../data-source/transaction/repository-transaction.type';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { Inject } from '../di/decorators/inject.decorator';
import { Injectable } from '../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { InternalError } from '../error-handling/internal-error.model';
import { AfterAppShutdown } from '../global/after-app-shutdown.interface';
import { OnAppInit } from '../global/on-app-init.interface';
import { type LoggerInterface } from '../logging/logger.interface';
import { type GaugeInterface } from '../metrics/gauge.interface';
import { type MetricsServiceInterface } from '../metrics/metrics-service.interface';
import { type WakeUpServiceInterface } from '../polling/wake-up-service.interface';
import { WAKE_UP_TOPICS } from '../polling/wake-up-topics';
import { QueueDefinition } from '../queue/queue-definition.model';
import { QueueUtilities } from '../queue/queue.utilities';
import { QueuedWorkOutcome } from '../queue/queued-work-outcome.model';
import { type TenantServiceInterface } from '../tenancy/tenant-service.interface';
import { Newable } from '../types/newable.type';
import { RunsOn } from '../types/runs-on.type';
import { Ms } from '../utilities/ms';
import { PromiseUtilities } from '../utilities/promise.utilities';
import { UUIDUtilities } from '../utilities/uuid.utilities';
import { validateEntitiesRegistered } from '../utilities/validate-entities-registered.function';

/**
 * The channel an emitted event is announced on to the subscribers on every instance.
 */
const EVERY_INSTANCE_CHANNEL: string = 'zibri.event-emitted';

/**
 * Where a run stands once an attempt ended so.
 */
const RUN_STATUS_OF: Record<QueuedWorkOutcome['kind'], EventSubscriberRunStatus> = {
    succeeded: EventSubscriberRunStatus.SUCCEEDED,
    retrying: EventSubscriberRunStatus.PENDING_RETRY,
    failed: EventSubscriberRunStatus.FAILED
};

/**
 * One subscriber's work on one event, as the queue of runs hands it to an attempt.
 */
type EventRunItem<T> = {
    /**
     * The event.
     */
    event: Event<T>,
    /**
     * How many attempts the subscriber spent on it.
     */
    attempts: number
};

/**
 * The result for subscribing to an event.
 */
export class EventSubscription implements EventSubscriptionInterface {
    constructor(
        readonly id: string,
        readonly rxSub: Subscription,
        readonly unsubscribe: () => void,
        readonly runsOn: RunsOn = 'oneInstance'
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
     * The events emitted anywhere in the deployment, for the subscribers every instance runs.
     *
     * Apart from `eventSubject`, which the dispatch poll hands unfinished events to again: a
     * subscriber every instance runs owes no run, so a polled event is one it already had.
     */
    protected readonly everyInstanceSubject: Subject<Event<ZibriEventMap[keyof ZibriEventMap]>> = new Subject();
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
    /**
     * Tells the announcements of this instance's own emits apart from those of the others.
     */
    private readonly instanceId: string = UUIDUtilities.generate();
    /**
     * The subscription to the announcements of emitted events, taken once a subscriber every
     * instance runs is subscribed.
     */
    private everyInstanceListening: Promise<DataSourceSubscription | undefined> | undefined;

    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        protected readonly logger: LoggerInterface
    ) { }

    // the three below are read when used rather than injected, so that an application without the
    // entities is told which ones to declare by onAppInit, instead of failing on a repository token
    // while this is built.
    //
    // The first two name the instantiation, because the class alone only says Event<unknown>. It is
    // checked rather than asserted - the generic constructor has to be assignable to it.

    /**
     * The repository of the stored events.
     * @returns The repository.
     */
    protected get eventRepository(): Repository<
        Event<ZibriEventMap[keyof ZibriEventMap]>,
        EventCreateData<ZibriEventMap[keyof ZibriEventMap]>
    > {
        return inject(repositoryTokenFor<Newable<Event<ZibriEventMap[keyof ZibriEventMap]>>>(Event));
    }

    /**
     * The repository of the runs each subscriber owes an event.
     * @returns The repository.
     */
    protected get eventSubscriberRunRepository(): Repository<
        EventSubscriberRun<ZibriEventMap[keyof ZibriEventMap]>,
        EventSubscriberRunCreateData<ZibriEventMap[keyof ZibriEventMap]>
    > {
        return inject(repositoryTokenFor<Newable<EventSubscriberRun<ZibriEventMap[keyof ZibriEventMap]>>>(EventSubscriberRun));
    }

    /**
     * Runs the work for an event in the tenant it was emitted in.
     * @returns The tenant service.
     */
    protected get tenantService(): TenantServiceInterface {
        return inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
    }

    /**
     * Tells the dispatch polls that an event is owed a run.
     * @returns The wake up service.
     */
    protected get wakeUpService(): WakeUpServiceInterface {
        return inject(ZIBRI_DI_TOKENS.WAKE_UP_SERVICE);
    }

    /**
     * The repository of the subscribers each instance has registered.
     * @returns The repository.
     */
    protected get eventSubscriberRegistrationRepository(): Repository<
        EventSubscriberRegistration,
        EventSubscriberRegistrationCreateData
    > {
        return inject(repositoryTokenFor(EventSubscriberRegistration));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    onAppInit(app: ZibriApplication): void {
        validateEntitiesRegistered('EventService', app, Event, EventSubscriberRun, EventSubscriberRegistration);
        if (inject(ZIBRI_DI_TOKENS.EVENT_FAILED_RETENTION_IN_MS) == undefined) {
            throw new InternalError([
                'The application has to provide ZIBRI_DI_TOKENS.EVENT_FAILED_RETENTION_IN_MS,',
                'with how long a failed event is kept (a number of milliseconds, or \'forever\').'
            ]);
        }
        if (!app.options.cronJobs.includes(EventCleanupCronJob)) {
            app.options.cronJobs.push(EventCleanupCronJob);
        }
        if (!app.options.cronJobs.includes(EventDispatchCronJob)) {
            app.options.cronJobs.push(EventDispatchCronJob);
        }
        const metricsService: MetricsServiceInterface = inject(ZIBRI_DI_TOKENS.METRICS_SERVICE);
        metricsService.addCollector({
            name: 'event queue',
            minIntervalInMs: 'dataSource',
            collect: async () => await this.collectQueueMetrics(metricsService)
        });
    }

    /**
     * Sets how many events are owed a run and how many failed, how long the oldest owed one has
     * waited, and how many runs wait for a retry or failed.
     * @param metricsService - Where the gauges are.
     */
    private async collectQueueMetrics(metricsService: MetricsServiceInterface): Promise<void> {
        // across tenants: the queue is the deployment's, as the dispatch poll reads it
        const [created, failed, [oldest], pendingRetry, failedRuns] = await Promise.all([
            this.eventRepository.count({ where: { status: EventStatus.CREATED }, acrossTenants: true }),
            this.eventRepository.count({ where: { status: EventStatus.FAILED }, acrossTenants: true }),
            this.eventRepository.findAll({ where: { status: EventStatus.CREATED }, limit: 1, acrossTenants: true }),
            this.eventSubscriberRunRepository.count({ where: { status: EventSubscriberRunStatus.PENDING_RETRY }, acrossTenants: true }),
            this.eventSubscriberRunRepository.count({ where: { status: EventSubscriberRunStatus.FAILED }, acrossTenants: true })
        ]);
        const depth: GaugeInterface = metricsService.getGauge('event_queue_depth', ['status']);
        depth.set({ status: EventStatus.CREATED }, created);
        depth.set({ status: EventStatus.FAILED }, failed);
        metricsService.getGauge('event_queue_oldest_age_seconds')
            .set({}, oldest == undefined ? 0 : (Date.now() - oldest.createdAt.getTime()) / Ms.SECOND);
        const runs: GaugeInterface = metricsService.getGauge('event_subscriber_runs', ['status']);
        runs.set({ status: EventSubscriberRunStatus.PENDING_RETRY }, pendingRetry);
        runs.set({ status: EventSubscriberRunStatus.FAILED }, failedRuns);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async afterAppShutdown(): Promise<void> {
        // We unsubscribe on the internal rxjs subscription here
        // => emit calls happening now will create the correct events
        for (const subscriber of this.subscriptionsForAll) {
            subscriber.rxSub.unsubscribe();
        }
        for (const subscriber of [...this.subscriptionForEvent.values()].flatMap(s => [...s])) {
            subscriber.rxSub.unsubscribe();
        }
        await (await this.everyInstanceListening)?.unsubscribe();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async emit<K extends keyof ZibriEventMap>(
        type: K,
        data: ZibriEventMap[K],
        cleanupAfterInMs: number = inject(ZIBRI_DI_TOKENS.EVENT_FINISHED_RETENTION_IN_MS)
    ): Promise<void> {
        const registrations: EventSubscriberRegistration[] = await this.findLiveRegistrations([String(type)]);
        const event: Event<ZibriEventMap[keyof ZibriEventMap]> = await this.eventRepository.create({
            type: String(type),
            // every subscriber in the deployment, not the ones this process happens to host. A
            // snapshot of the local set would silently exclude a subscriber that lives on other
            // replicas, and nothing downstream could tell the difference between "did not subscribe"
            // and "was not visible from here"
            subscriberIds: this.liveSubscriberIdsIn(registrations, String(type)),
            cleanupAt: new Date(Date.now() + cleanupAfterInMs),
            data
        });
        this.eventSubject.next({ ...event, eventSubscriberRuns: [] });
        this.everyInstanceSubject.next({ ...event, eventSubscriberRuns: [] });

        // only when a subscriber every instance runs exists somewhere, so an application without one
        // pays nothing for them on every emit
        const dataSource: DataSourceInterface = this.eventRepository.dataSource;
        if (isPubSubDataSource(dataSource) && registrations.some(r => r.runsOn === 'everyInstance')) {
            await dataSource.publish(EVERY_INSTANCE_CHANNEL, `${this.instanceId} ${event.id}`);
        }

        // the subscribers hosted here have it now. One hosted only elsewhere hears of it from the
        // poll there, which is told to look now rather than at its next pass
        const hostedHere: Set<string> = this.findHostedSubscriberIds(event.type);
        if (event.subscriberIds.some(id => !hostedHere.has(id))) {
            await this.wakeUpService.wake(dataSource, WAKE_UP_TOPICS.EVENTS);
        }
    }

    /**
     * The subscribers this instance hosts for a type.
     * @param type - The event type.
     * @returns Their ids.
     */
    private findHostedSubscriberIds(type: string): Set<string> {
        const hosted: EventSubscription[] = [...this.subscriptionForEvent.get(type) ?? [], ...this.subscriptionsForAll];
        return new Set(hosted.map(s => s.id));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async subscribe<K extends keyof ZibriEventMap>(
        type: K,
        hook: EventHook<ZibriEventMap[K]>,
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

        const runsOn: RunsOn = options.runsOn ?? 'oneInstance';
        const rxSub: Subscription = runsOn === 'everyInstance'
            ? this.everyInstanceSubject
                .pipe(filter(e => e.type === typeName))
                .subscribe(e => this.runEveryInstanceHookSafely(hook, e as Event<ZibriEventMap[K]>, options))
            : this.eventSubject
                .pipe(
                    // finished, not merely present: a run row is written after every attempt, a
                    // PENDING_RETRY one included, so skipping on its existence would mean a failed
                    // attempt is never retried by anyone
                    filter(e => e.type === typeName && this.owesRun(e, options.subscriberId))
                )
                .subscribe(e => this.runHookSafely(hook, e as Event<ZibriEventMap[K]>, options));
        const subscriber: EventSubscription = new EventSubscription(
            options.subscriberId,
            rxSub,
            () => {
                this.subscriptionForEvent.get(typeName)?.delete(subscriber);
                rxSub.unsubscribe();
            },
            runsOn
        );

        const subscribers: Set<EventSubscription> = this.subscriptionForEvent.get(typeName) ?? new Set();
        subscribers.add(subscriber);
        this.subscriptionForEvent.set(typeName, subscribers);
        if (runsOn === 'everyInstance') {
            await this.listenForEventsEmittedElsewhere();
        }
        // written before returning rather than on the next heartbeat, so an emit that happens
        // immediately after this resolves already counts the subscriber
        await this.registerSubscriber(options.subscriberId, typeName, runsOn);
        return subscriber;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async subscribeAll(
        hook: EventHook<ZibriEventMap[keyof ZibriEventMap]>,
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

        const runsOn: RunsOn = options.runsOn ?? 'oneInstance';
        const rxSub: Subscription = runsOn === 'everyInstance'
            ? this.everyInstanceSubject.subscribe(e => this.runEveryInstanceHookSafely(hook, e, options))
            : this.eventSubject
                .pipe(filter(e => this.owesRun(e, options.subscriberId)))
                .subscribe(e => this.runHookSafely(hook, e, options));
        const subscription: EventSubscription = new EventSubscription(
            options.subscriberId,
            rxSub,
            () => {
                this.subscriptionsForAll.delete(subscription);
                rxSub.unsubscribe();
            },
            runsOn
        );
        this.subscriptionsForAll.add(subscription);
        if (runsOn === 'everyInstance') {
            await this.listenForEventsEmittedElsewhere();
        }
        await this.registerSubscriber(options.subscriberId, ALL_EVENTS_TYPE, runsOn);
        return subscription;
    }

    /**
     * Hands the events other instances emit to the subscribers every instance runs, once.
     *
     * Through the data source's messages rather than the dispatch poll: such a subscriber owes the
     * event no run, so a poll offering unfinished events would never offer it one that finished
     * before it looked. Without messages between instances, each instance hears of its own emits only.
     */
    private async listenForEventsEmittedElsewhere(): Promise<void> {
        const dataSource: DataSourceInterface = this.eventRepository.dataSource;
        if (!isPubSubDataSource(dataSource)) {
            return;
        }
        this.everyInstanceListening ??= dataSource.subscribe(EVERY_INSTANCE_CHANNEL, message => {
            const [instanceId, eventId] = message.split(' ');
            if (instanceId === this.instanceId || eventId == undefined) {
                return;
            }
            // eslint-disable-next-line promise/prefer-await-to-then
            void this.eventRepository.findById(eventId, { acrossTenants: true, required: false }).then(
                event => {
                    if (event != undefined) {
                        this.everyInstanceSubject.next({ ...event, eventSubscriberRuns: [] });
                    }
                },
                // eslint-disable-next-line promise/prefer-await-to-callbacks
                error => this.logger.error(new InternalError(`Could not read event ${eventId} another instance emitted`, { cause: error }))
            );
        });
        await this.everyInstanceListening;
    }

    /**
     * Records that this subscriber exists, for every instance rather than just this one.
     *
     * An upsert on the pair, because replicas hosting the same subscriber are copies of it: whichever
     * gets there first creates the row and the rest push its expiry forward. The row is the
     * subscriber, not the process, so it survives any one of them going away.
     * @param subscriberId - The subscriber to record.
     * @param eventType - The type it takes, or ALL_EVENTS_TYPE when it takes every event.
     * @param runsOn - Whether every instance hosting it runs it.
     */
    protected async registerSubscriber(subscriberId: string, eventType: string, runsOn: RunsOn): Promise<void> {
        const expiresAt: Date = new Date(Date.now() + inject(ZIBRI_DI_TOKENS.EVENT_SUBSCRIBER_REGISTRATION_TTL_IN_MS));
        await this.eventSubscriberRegistrationRepository.upsert(
            { subscriberId, eventType },
            { subscriberId, eventType, runsOn, expiresAt },
            { expiresAt: { set: expiresAt }, runsOn: { set: runsOn } }
        );
    }

    // driven by the dispatch poll rather than by its own job, because both answer the same question -
    // what is still out there - and a second timer would only add a way for the two to disagree
    /**
     * Pushes the expiry of every subscriber this instance hosts forward, and clears lapsed ones.
     *
     * A registration lapses only when no instance hosting that subscriber is left to refresh it, at
     * which point it stops holding events open. Until then a subscriber whose replicas are briefly
     * down keeps its events unfinished, which is what lets them be picked up when it returns.
     */
    async refreshSubscriberRegistrations(): Promise<void> {
        const local: [EventSubscription, string][] = [
            ...[...this.subscriptionForEvent.entries()]
                .flatMap(([type, subs]) => [...subs].map((s): [EventSubscription, string] => [s, type])),
            ...[...this.subscriptionsForAll].map((s): [EventSubscription, string] => [s, ALL_EVENTS_TYPE])
        ];

        // one write for every subscriber this instance hosts, rather than a round trip each on every
        // poll. `subscribe` hands back the existing subscription for a pair it already has, so no
        // pair appears twice
        const expiresAt: Date = new Date(Date.now() + inject(ZIBRI_DI_TOKENS.EVENT_SUBSCRIBER_REGISTRATION_TTL_IN_MS));
        await this.eventSubscriberRegistrationRepository.upsertAll(
            ['subscriberId', 'eventType'],
            local.map(([subscription, eventType]) => ({
                create: { subscriberId: subscription.id, eventType, runsOn: subscription.runsOn, expiresAt },
                onConflict: { expiresAt: { set: expiresAt } }
            }))
        );
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
        return this.liveSubscriberIdsIn(await this.findLiveRegistrations([type]), type);
    }

    /**
     * The registrations that have not lapsed, of the given types and of every subscriber that takes
     * all events.
     * @param types - The event types.
     * @returns The registrations.
     */
    private async findLiveRegistrations(types: string[]): Promise<EventSubscriberRegistration[]> {
        return await this.eventSubscriberRegistrationRepository.findAll({
            where: { eventType: { oneOf: [...types, ALL_EVENTS_TYPE] }, expiresAt: { after: new Date() } }
        });
    }

    /**
     * The subscribers that owe an event of this type a run, out of registrations already read.
     * @param registrations - Live registrations, including the type's.
     * @param type - The event type.
     * @returns The subscriber ids, deduplicated. A subscriber every instance runs owes no run.
     */
    private liveSubscriberIdsIn(registrations: EventSubscriberRegistration[], type: string): string[] {
        const subscriberIds: string[] = registrations
            .filter(r => (r.eventType === type || r.eventType === ALL_EVENTS_TYPE) && r.runsOn !== 'everyInstance')
            .map(r => r.subscriberId);
        return [...new Set(subscriberIds)];
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
        hook: EventHook<ZibriEventMap[K]>,
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
            // and the poll here looks for it at its next pass, however long it has found nothing
            this.wakeUpService.wakeAt(WAKE_UP_TOPICS.EVENTS, new Date());
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
        hook: EventHook<ZibriEventMap[K]>,
        event: Event<ZibriEventMap[K]>,
        options: EventSubscribeOptions
    ): Promise<void> {
        this.runningHooks++;
        try {
            await this.runInTenantOf(event, async () => await this.runHook(hook, event, options));
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
     * Runs the hook of a subscriber every instance runs, once, without a claim or a run: what it
     * fails with is logged, and nothing is tried again.
     * @param hook - The hook to run.
     * @param event - The event to run the hook on.
     * @param options - The options of the subscriber.
     */
    private runEveryInstanceHookSafely<K extends keyof ZibriEventMap>(
        hook: EventHook<ZibriEventMap[K]>,
        event: Event<ZibriEventMap[K]>,
        options: EventSubscribeOptions
    ): void {
        const run: () => Promise<void> = async () => {
            this.runningHooks++;
            try {
                await this.runInTenantOf(event, async () => await PromiseUtilities.withTimeout(
                    async signal => await hook(event, signal, {
                        runId: `${event.id}:${options.subscriberId}`,
                        attempt: 1,
                        signal,
                        transaction: undefined
                    }),
                    options.timeoutInMs ?? inject(ZIBRI_DI_TOKENS.EVENT_HOOK_TIMEOUT_IN_MS)
                ));
            }
            catch (error) {
                this.logger.error(new EventProcessingError(
                    event,
                    options.subscriberId,
                    new InternalError(`Running hook for event ${event.id} failed`, { cause: error })
                ));
            }
            finally {
                this.runningHooks--;
            }
        };
        void run();
    }

    /**
     * Runs work in the tenant an event was emitted in.
     *
     * The poll hands out the events of every tenant from outside all of them, so a hook, the run it
     * records and the settling of the event would otherwise reach the rows of no tenant only.
     * @param event - The event the work is for.
     * @param work - The work.
     * @returns What the work returns.
     */
    private async runInTenantOf<R>(event: Event<unknown>, work: () => Promise<R>): Promise<R> {
        return event.tenantId == undefined ? await work() : await this.tenantService.runAs(event.tenantId, work);
    }

    /**
     * Runs the given hook with the given event and options, as an attempt of the subscriber's run.
     * @param hook - The hook to run.
     * @param event - The event to run the hook on.
     * @param options - Additional options like the subscriberId, attempts etc.
     */
    protected async runHook<K extends keyof ZibriEventMap>(
        hook: EventHook<ZibriEventMap[K]>,
        event: Event<ZibriEventMap[K]>,
        options: EventSubscribeOptions
    ): Promise<void> {
        // claimed before anything runs. The same subscriber runs on every replica, and all of them
        // reach this point for the same event - without a claim a welcome mail goes out once per
        // pod. Losing the race is the normal outcome everywhere but one, not an error.
        const previous: EventSubscriberRun<unknown> | undefined = event.eventSubscriberRuns
            .find(r => r.subscriberId === options.subscriberId);
        await QueueUtilities.runClaimed(this.resolveRunQueue(hook, options), { event, attempts: previous?.attempts ?? 0 });
    }

    /**
     * Resolves the queue of a subscriber's runs: how an attempt runs its hook, and how it is recorded.
     * @param hook - The hook of the subscriber.
     * @param options - The options of the subscriber.
     * @returns The queue.
     */
    private resolveRunQueue<K extends keyof ZibriEventMap>(
        hook: EventHook<ZibriEventMap[K]>,
        options: EventSubscribeOptions
    ): QueueDefinition<EventRunItem<ZibriEventMap[K]>> {
        const subscriberId: string = options.subscriberId;
        return {
            name: 'event',
            wakeUpTopic: WAKE_UP_TOPICS.EVENTS,
            leaseInMs: inject(ZIBRI_DI_TOKENS.EVENT_EXECUTION_LEASE_IN_MS),
            // 'retain' rather than 'release', because the grant is not only the exclusion but the
            // thing that stops a replica arriving a moment later from running the same subscriber
            // again - handing it back the instant the hook returns would reopen exactly the window
            // the ledger row is written to close. It is also why a retry never happens sooner than
            // the lease lapses, whatever the backoff works out to
            onCompletion: 'retain',
            claimedPer: 'item',
            // doubling from the configured base. No jitter, because the lease already decides which
            // replica runs an event - what a spread would buy here is between *events* that failed
            // together, which is a concern of the fan out rather than of this
            firstRetryDelayInMs: inject(ZIBRI_DI_TOKENS.EVENT_RETRY_DELAY_IN_MS),
            findRunId: item => `${item.event.id}:${subscriberId}`,
            // the count lives on the row because the attempts are spread across polls and restarts,
            // so the process running this one has no way of knowing it is the third
            refresh: async item => ({
                ...item,
                attempts: (await this.eventSubscriberRunRepository.findOne({
                    where: { eventId: item.event.id, subscriberId },
                    required: false
                }))?.attempts ?? 0
            }),
            findMaxAttempts: () => options.attempts ?? 1,
            findDelivery: () => options.delivery ?? 'atLeastOnce',
            // the hook's signal fires for the lost claim as it does for the timeout: from the hook's
            // side there is no difference, it has stopped being worth finishing
            run: async (item, run) => await PromiseUtilities.withTimeout(
                async signal => await hook(item.event, signal, { ...run, signal }),
                options.timeoutInMs ?? inject(ZIBRI_DI_TOKENS.EVENT_HOOK_TIMEOUT_IN_MS),
                run.signal
            ),
            record: async (item, outcome, transaction) => await this.recordResult(item.event, subscriberId, outcome, transaction),
            // EventProcessingError means the subscriber gave up, which is what the docs promise it
            // means - a failure with attempts left is worth knowing about but is not that
            resolveGiveUpError: (item, cause) => new EventProcessingError(
                item.event,
                subscriberId,
                new InternalError(`Running hook for event ${item.event.id} failed`, { cause })
            )
        };
    }

    /**
     * Writes down how an attempt ended, and settles the event when nothing is owed any more.
     *
     * Written while the grant is still held on purpose. The row is what tells every future reader
     * where this subscriber stands with this event, and a grant that expired between the hook
     * returning and this landing would let another replica start the whole thing again.
     * @param event - The event that was handled.
     * @param subscriberId - The subscriber.
     * @param outcome - How the attempt ended.
     * @param transaction - The transaction the attempt ran in, if it ran in one.
     */
    private async recordResult<K extends keyof ZibriEventMap>(
        event: Event<ZibriEventMap[K]>,
        subscriberId: string,
        outcome: QueuedWorkOutcome,
        transaction: RepositoryTransaction | undefined
    ): Promise<void> {
        const status: EventSubscriberRunStatus = RUN_STATUS_OF[outcome.kind];
        await this.eventSubscriberRunRepository.upsert(
            { eventId: event.id, subscriberId },
            {
                eventId: event.id,
                subscriberId,
                status,
                attempts: outcome.attempts,
                error: outcome.error,
                nextAttemptAt: outcome.nextAttemptAt,
                finishedAt: new Date()
            },
            {
                status: { set: status },
                attempts: { set: outcome.attempts },
                // set rather than left alone, so it always describes the ending the status names
                error: { set: outcome.error },
                nextAttemptAt: { set: outcome.nextAttemptAt },
                finishedAt: { set: new Date() }
            },
            { transaction }
        );

        // a run that is still owed leaves the event unsettled, and the poll offers it again when
        // the earliest run it owes is due. Read once for both, after the write above
        const runs: EventSubscriberRun<unknown>[] = await this.findRunsOf(event, transaction);
        const liveSubscriberIds: string[] = await this.liveSubscriberIdsFor(event.type);
        if (!await this.settleEvent(event, runs, liveSubscriberIds, transaction)) {
            await this.scheduleNextDispatch(event, runs, liveSubscriberIds, transaction);
        }
    }

    /**
     * The runs the subscribers of an event have recorded.
     * @param event - The event.
     * @param transaction - The transaction to read in, if any.
     * @returns The runs.
     */
    private async findRunsOf<K extends keyof ZibriEventMap>(
        event: Event<ZibriEventMap[K]>,
        transaction: RepositoryTransaction | undefined
    ): Promise<EventSubscriberRun<unknown>[]> {
        return await this.eventSubscriberRunRepository.findAll({
            where: { event: { where: { id: event.id } } },
            transaction
        });
    }

    /**
     * Moves the event's next dispatch to when the earliest run it still owes is due.
     *
     * Now, while a subscriber has not run at all. The earliest `nextAttemptAt`, while every
     * subscriber that still owes a run is waiting for its retry: the poll then leaves the event out
     * until that time, so a page of events waiting on long retries does not hold up the events behind
     * them - and this instance's poll is woken then, however long it has found nothing.
     * @param event - The event, which is not settled.
     * @param runs - The runs its subscribers recorded.
     * @param liveSubscriberIds - The subscribers of its type that have not lapsed.
     * @param transaction - The transaction to write in, if any.
     */
    private async scheduleNextDispatch<K extends keyof ZibriEventMap>(
        event: Event<ZibriEventMap[K]>,
        runs: EventSubscriberRun<unknown>[],
        liveSubscriberIds: string[],
        transaction: RepositoryTransaction | undefined
    ): Promise<void> {
        const dueAt: number[] = event.subscriberIds
            .filter(id => liveSubscriberIds.includes(id))
            .map(id => {
                const run: EventSubscriberRun<unknown> | undefined = runs.find(r => r.subscriberId === id);
                if (run == undefined) {
                    return Date.now();
                }
                if (run.status === EventSubscriberRunStatus.PENDING_RETRY) {
                    return run.nextAttemptAt == undefined ? Date.now() : new Date(run.nextAttemptAt).getTime();
                }
                return Number.POSITIVE_INFINITY;
            });
        const next: number = Math.min(...dueAt);
        // nothing due means nothing owed, which settleEvent decides and the poll settles if it was missed
        if (Number.isFinite(next)) {
            await this.eventRepository.updateById(event.id, { nextDispatchAt: new Date(next) }, { transaction });
            this.wakeUpService.wakeAt(WAKE_UP_TOPICS.EVENTS, new Date(next));
        }
    }

    /**
     * Moves the event out of CREATED once no subscriber owes it anything.
     * @param event - The event to settle.
     * @param runs - The runs its subscribers recorded.
     * @param liveSubscriberIds - The subscribers of its type that have not lapsed.
     * @param transaction - The transaction to write in, if any.
     * @returns Whether the event is settled.
     */
    private async settleEvent<K extends keyof ZibriEventMap>(
        event: Event<ZibriEventMap[K]>,
        runs: EventSubscriberRun<unknown>[],
        liveSubscriberIds: string[],
        transaction: RepositoryTransaction | undefined
    ): Promise<boolean> {
        const settled: EventStatus | undefined = this.settledStatusOf(event, runs, liveSubscriberIds);
        if (settled == undefined) {
            return false;
        }
        await this.eventRepository.updateById(event.id, { status: settled }, { transaction });
        if (settled === EventStatus.FINISHED) {
            return true;
        }
        // a replay can put a failed run back between the read above and this write, and its own
        // write of CREATED may land before this one - which would leave the event FAILED with a run
        // that is owed again, and the poll only offers CREATED events. Looked at after the write,
        // because a replay landing after this read also writes CREATED after this write
        const replayed: boolean = await this.eventSubscriberRunRepository.exists({
            where: { eventId: event.id, status: EventSubscriberRunStatus.PENDING_RETRY },
            transaction
        });
        if (!replayed) {
            return true;
        }
        await this.eventRepository.updateById(event.id, { status: EventStatus.CREATED }, { transaction });
        return false;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async replayFailed(options: EventReplayOptions): Promise<number> {
        const where: WhereFilter<EventSubscriberRun<ZibriEventMap[keyof ZibriEventMap]>> = {
            status: EventSubscriberRunStatus.FAILED
        };
        if (options.eventIds != undefined) {
            where.eventId = { oneOf: options.eventIds };
        }
        if (options.subscriberIds != undefined) {
            where.subscriberId = { oneOf: options.subscriberIds };
        }
        if (options.types != undefined) {
            where.event = { where: { type: { oneOf: options.types.map(String) } } };
        }
        const failed: EventSubscriberRun<ZibriEventMap[keyof ZibriEventMap]>[] = await this.eventSubscriberRunRepository.findAll({
            where,
            relations: ['event'],
            limit: 'all',
            acrossTenants: options.acrossTenants
        });
        if (!failed.length) {
            return 0;
        }

        // a run whose subscriber nothing hosts any more stays failed: the event it is put back on
        // would be settled without it by the next poll, as FINISHED when the others succeeded, and
        // the cleanup would then delete the only record of the failure
        const registrations: EventSubscriberRegistration[] = await this.eventSubscriberRegistrationRepository.findAll({
            where: { subscriberId: { oneOf: [...new Set(failed.map(r => r.subscriberId))] }, expiresAt: { after: new Date() } }
        });
        const liveRunIds: string[] = failed
            .filter(run => registrations.some(r => r.subscriberId === run.subscriberId
                && (r.eventType === run.event.type || r.eventType === ALL_EVENTS_TYPE)))
            .map(run => run.id);
        if (!liveRunIds.length) {
            return 0;
        }

        // still FAILED in the filter, so a replay running beside this one puts back each run once.
        // The error stays until the next attempt replaces it
        const replayed: EventSubscriberRun<ZibriEventMap[keyof ZibriEventMap]>[] = await this.eventSubscriberRunRepository.updateAll(
            { id: { oneOf: liveRunIds }, status: EventSubscriberRunStatus.FAILED },
            { status: EventSubscriberRunStatus.PENDING_RETRY, attempts: 0, nextAttemptAt: new Date() },
            { returnUpdated: true, acrossTenants: options.acrossTenants }
        );
        if (!replayed.length) {
            return 0;
        }
        // after the runs, for the reason settleEvent looks again after it writes FAILED. Whatever
        // the status, since an event with a subscriber still retrying is CREATED already - and due
        // now, whatever retry it was waiting for
        await this.eventRepository.updateAll(
            { id: { oneOf: [...new Set(replayed.map(r => r.eventId))] } },
            { status: EventStatus.CREATED, nextDispatchAt: new Date() },
            { acrossTenants: options.acrossTenants }
        );
        await this.wakeUpService.wake(this.eventRepository.dataSource, WAKE_UP_TOPICS.EVENTS);
        return replayed.length;
    }

    /**
     * Hands every unfinished event back to the local subscribers so they can try to claim it.
     *
     * Emitting only reaches subscribers in the emitting process, so without this an event whose
     * instance died is never picked up by anyone. Every instance polls, and the claim decides who
     * actually runs.
     * @returns Whether any event was due.
     */
    async dispatchPending(): Promise<boolean> {
        // CREATED and not "anything but FINISHED": a FAILED event is settled, and offering it again
        // would be retrying subscribers that already gave up.
        //
        // Only as many as this instance could dispatch, because a backlog is exactly what this
        // reads: taking all of it would load every pending event and its runs into memory to offer
        // work that mostly will not be started. The rest is read by the next poll - and read from
        // the front, because the entity orders by `createdAt` ascending by default, without which a
        // backlog under continuous emission would have a head that never gets read.
        //
        // Only the events that are due: one whose every owed run waits for a retry would otherwise
        // fill the page on every poll until that retry, and a page full of them is a poll that never
        // reaches the events behind them
        const events: Event<ZibriEventMap[keyof ZibriEventMap]>[] = await this.eventRepository.findAll({
            where: { status: EventStatus.CREATED, nextDispatchAt: { beforeOrOn: new Date() } },
            relations: ['eventSubscriberRuns'],
            limit: inject(ZIBRI_DI_TOKENS.EVENT_MAX_CONCURRENT_HOOKS),
            // the events of every tenant are owed the same, and each is then handled in its own
            acrossTenants: true
        });
        if (!events.length) {
            return false;
        }
        // once for the page rather than for every event on it: a backlog is what this reads, and
        // every instance reads it
        const registrations: EventSubscriberRegistration[] = await this.findLiveRegistrations([...new Set(events.map(e => e.type))]);

        // chunked rather than serial, because each event is independent - and chunked rather than
        // all at once, because this is exactly the path a backlog arrives on: an instance that died
        // holding work leaves every one of its events here at the same time, and a fan out the size
        // of that backlog would be the recovery hurting more than the outage.
        await PromiseUtilities.allChunked(events, async event => await this.runInTenantOf(event, async () => {
            // an event is finished when nobody still owes it a run, and that can become true without
            // anything happening to the event: the last instance hosting a subscriber goes away and
            // its registration lapses. Nothing else would notice - a subscriber that already ran is
            // filtered out before its hook, so the check that runs after a hook never runs again -
            // and the event would sit unfinished for good, never reaching the cleanup job.
            //
            // Judged on the runs the page was read with: one recorded since is the hook that
            // recorded it settling the event itself
            if (await this.settleEvent(event, event.eventSubscriberRuns, this.liveSubscriberIdsIn(registrations, event.type), undefined)) {
                return;
            }
            this.eventSubject.next(event);
        }));
        return true;
    }

    /**
     * What the event has settled as, or undefined while a subscriber still owes it something.
     *
     * A run that is `PENDING_RETRY` is deliberately not an ending: the whole point of the state is
     * that the work is still owed, so an event carrying one keeps its place in the poll.
     * @param event - The event to judge.
     * @param runs - The runs its subscribers recorded.
     * @param liveSubscriberIds - The subscribers of its type that have not lapsed.
     * @returns FINISHED when every subscriber succeeded, FAILED when the ones that are done include
     * one that gave up, and undefined while anything is still outstanding.
     */
    private settledStatusOf<K extends keyof ZibriEventMap>(
        event: Event<ZibriEventMap[K]>,
        runs: EventSubscriberRun<unknown>[],
        liveSubscriberIds: string[]
    ): EventStatus | undefined {
        const endedById: Map<string, EventSubscriberRunStatus> = new Map(
            runs
                .filter(r => r.status !== EventSubscriberRunStatus.PENDING_RETRY)
                .map(r => [r.subscriberId, r.status])
        );
        // the live subscribers are deployment wide, like the snapshot they are compared against.
        // Reading the local set here was the other half of 1.4b: the emitter counted only the
        // subscribers it hosted, so the moment its own were done it declared the event finished and
        // the ones on other replicas - which the dispatch poll only offers while an event is
        // unfinished - never got it.
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
        return run == undefined
            || (run.status === EventSubscriberRunStatus.PENDING_RETRY && (run.nextAttemptAt?.getTime() ?? 0) <= Date.now());
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