import { filter, Subject, Subscription } from 'rxjs';

import { EventServiceInterface, EventSubscribeOptions, EventSubscriptionInterface } from './event-service.interface';
import { EventSubscriberRun, EventSubscriberRunCreateData } from './event-subscriber-run.model';
import { Event, EventCreateData, EventStatus } from './event.model';
import { ZibriApplication } from '../application';
import { EventCleanupCronJob } from './event-cleanup.cron-job';
import { EventProcessingError } from './event-processing.error';
import { Repository } from '../data-source/repository';
import { InjectRepository } from '../di/decorators/inject-repository.decorator';
import { Inject } from '../di/decorators/inject.decorator';
import { Injectable } from '../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { AfterAppShutdown } from '../global/after-app-shutdown.interface';
import { OnAppInit } from '../global/on-app-init.interface';
import { OnAppStart } from '../global/on-app-start.interface';
import { type LoggerInterface } from '../logging/logger.interface';
import { JsonUtilities } from '../utilities/json.utilities';
import { Ms } from '../utilities/ms';
import { ObjectUtilities } from '../utilities/object.utilities';
import { PromiseUtilities } from '../utilities/promise.utilities';
import { validateEntitiesRegistered } from '../utilities/validate-entities-registered.function';

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
export class EventService<TEvents extends Record<string, unknown>>
implements EventServiceInterface<TEvents>, OnAppInit, OnAppStart, AfterAppShutdown {
    /**
     * The rxjs subject of the event.
     */
    protected readonly eventSubject: Subject<Event<TEvents[keyof TEvents]>> = new Subject();
    /**
     * The subscribers for each event type.
     */
    protected readonly subscriptionForEvent: Record<
        keyof TEvents,
        Set<EventSubscription> | undefined
    > = {} as Record<keyof TEvents, Set<EventSubscription> | undefined>;
    /**
     * The subscribers that listen to all events.
     */
    protected readonly subscriptionsForAll: Set<EventSubscription> = new Set();

    constructor(
        @InjectRepository(Event)
        protected readonly eventRepository: Repository<Event<TEvents[keyof TEvents]>, EventCreateData<TEvents[keyof TEvents]>>,
        @InjectRepository(EventSubscriberRun)
        protected readonly eventSubscriberRunRepository: Repository<
            EventSubscriberRun<TEvents[keyof TEvents]>,
            EventSubscriberRunCreateData<TEvents[keyof TEvents]>
        >,
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        protected readonly logger: LoggerInterface
    ) { }

    // eslint-disable-next-line jsdoc/require-jsdoc
    onAppInit(app: ZibriApplication): void {
        validateEntitiesRegistered('EventService', app, Event, EventSubscriberRun);
        if (!app.options.cronJobs.includes(EventCleanupCronJob)) {
            app.options.cronJobs.push(EventCleanupCronJob);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onAppStart(): Promise<void> {
        const events: Event<TEvents[keyof TEvents]>[] = await this.eventRepository.findAll({
            where: { status: { not: EventStatus.FINISHED } },
            relations: ['eventSubscriberRuns']
        });

        for (const event of events) {
            if (await this.eventHasUnfinishedSubscriptions(event)) {
                this.eventSubject.next(event);
                continue;
            }

            await this.eventRepository.updateById(event.id, { status: EventStatus.FINISHED });
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    afterAppShutdown(): void {
        // We unsubscribe on the internal rxjs subscription here
        // => emit calls happening now will create the correct events
        for (const subscriber of this.subscriptionsForAll) {
            subscriber.rxSub.unsubscribe();
        }
        for (const subscriber of ObjectUtilities.values(this.subscriptionForEvent).flatMap(s => [...s ?? []])) {
            subscriber.rxSub.unsubscribe();
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async emit<K extends keyof TEvents>(type: K, data: TEvents[K], cleanupAfterMs: number = Ms.DAY): Promise<void> {
        const event: Event<TEvents[keyof TEvents]> = await this.eventRepository.create({
            type: String(type),
            subscriberIds: [...this.subscriptionForEvent[type] ?? [], ...this.subscriptionsForAll].map(d => d.id),
            cleanupAt: new Date(Date.now() + cleanupAfterMs),
            data
        });
        this.eventSubject.next({ ...event, eventSubscriberRuns: [] });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async subscribe<K extends keyof TEvents>(
        type: K,
        hook: (value: Event<TEvents[K]>, signal: AbortSignal) => void | Promise<void>,
        options: EventSubscribeOptions
    ): Promise<EventSubscription> {
        const existingAllEventSubscription: EventSubscription | undefined = this.findSubscriptionById(options.subscriberId);
        if (existingAllEventSubscription) {
            throw new Error(`Can't subscribe to event: The subscriberId ${options.subscriberId} is already subscribed to all events`);
        }
        const existingEventSubscription: EventSubscription | undefined = this.findSubscriptionForEventById(type, options.subscriberId);
        if (existingEventSubscription) {
            await this.logger.warn(
                `The subscriberId ${options.subscriberId} is already subscribed to this event, returning the existing subscription`
            );
            return existingEventSubscription;
        }

        const rxSub: Subscription = this.eventSubject
            .pipe(
                filter(e => e.type === type && !e.eventSubscriberRuns.some(r => r.subscriberId === options.subscriberId))
            )
            .subscribe(e => void this.runHook(hook, e as Event<TEvents[K]>, options));
        const subscriber: EventSubscription = new EventSubscription(
            options.subscriberId,
            rxSub,
            () => {
                this.subscriptionForEvent[type]?.delete(subscriber);
                rxSub.unsubscribe();
            }
        );

        this.subscriptionForEvent[type] ??= new Set();
        this.subscriptionForEvent[type].add(subscriber);
        return subscriber;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async subscribeAll(
        hook: (value: Event<TEvents[keyof TEvents]>, signal: AbortSignal) => void | Promise<void>,
        options: EventSubscribeOptions
    ): Promise<EventSubscription> {
        const existingEventSubscriptionTypes: string[] = [];
        for (const type of ObjectUtilities.keys(this.subscriptionForEvent)) {
            if (this.findSubscriptionForEventById(type, options.subscriberId)) {
                existingEventSubscriptionTypes.push(type);
            }
        }
        if (existingEventSubscriptionTypes.length) {
            throw new Error(
                [
                    `Can't subscribe to all events: The subscriberId ${options.subscriberId} is already subscribed to the events:`,
                    ...existingEventSubscriptionTypes.map(t => `    - ${t}`)
                ].join('\n')
            );
        }

        const existingAllEventSubscription: EventSubscription | undefined = this.findSubscriptionById(options.subscriberId);
        if (existingAllEventSubscription) {
            await this.logger.warn(
                `The subscriberId ${options.subscriberId} is already subscribed to all events, returning the existing subscription`
            );
            return existingAllEventSubscription;
        }

        const rxSub: Subscription = this.eventSubject
            .pipe(filter(e => !e.eventSubscriberRuns.some(r => r.subscriberId === options.subscriberId)))
            .subscribe(e => void this.runHook(hook, e, options));
        const subscription: EventSubscription = new EventSubscription(
            options.subscriberId,
            rxSub,
            () => {
                this.subscriptionsForAll.delete(subscription);
                rxSub.unsubscribe();
            }
        );
        this.subscriptionsForAll.add(subscription);
        return subscription;
    }

    /**
     * Runs the given hook with the given event and options.
     * @param hook - The hook to run.
     * @param event - The event to run the hook on.
     * @param options - Additional options like the subscriberId, attempts etc.
     */
    protected async runHook<K extends keyof TEvents>(
        hook: (value: Event<TEvents[K]>, signal: AbortSignal) => void | Promise<void>,
        event: Event<TEvents[K]>,
        options: EventSubscribeOptions
    ): Promise<void> {
        let error: Error | undefined = undefined;
        for (let i: number = 0; i < (options.attempts ?? 1); i++) {
            try {
                await PromiseUtilities.withTimeout((signal) => hook(event, signal), options.timeout ?? Ms.SECOND * 30);
                error = undefined;
                break;
            }
            catch (_error) {
                error = _error instanceof Error ? _error : new Error(JsonUtilities.stringify(_error));
            }
        }

        if (error) {
            await this.logger.error(new EventProcessingError(event, options.subscriberId, error));
        }

        await this.eventSubscriberRunRepository.create({
            event,
            subscriberId: options.subscriberId,
            error
        });
        if (await this.eventHasUnfinishedSubscriptions(event)) {
            return;
        }
        await this.eventRepository.updateById(event.id, { status: EventStatus.FINISHED });
    }

    private async eventHasUnfinishedSubscriptions<K extends keyof TEvents>(event: Event<TEvents[K]>): Promise<boolean> {
        const runs: EventSubscriberRun<unknown>[] = await this.eventSubscriberRunRepository.findAll({
            where: {
                event: { where: { id: event.id } }
            }
        });
        const ranSubscriberIds: string[] = runs.map(r => r.subscriberId);
        const allSubscriberIds: string[] = [...this.subscriptionForEvent[event.type] ?? [], ...this.subscriptionsForAll].map(d => d.id);
        return event.subscriberIds.some(id => allSubscriberIds.includes(id) && !ranSubscriberIds.includes(id));
    }

    private findSubscriptionForEventById(event: keyof TEvents, subscriberId: string): EventSubscription | undefined {
        const subscribers: EventSubscription[] = [...this.subscriptionForEvent[event] ?? []];
        return subscribers.find(s => s.id === subscriberId);
    }

    private findSubscriptionById(subscriberId: string): EventSubscription | undefined {
        const subscribers: EventSubscription[] = [...this.subscriptionsForAll];
        return subscribers.find(s => s.id === subscriberId);
    }
}