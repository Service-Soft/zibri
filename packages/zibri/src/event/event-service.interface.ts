import { type EventReplayOptions } from './event-replay-options.model';
import { Event } from './event.model';

/**
 * Options for subscribing to events.
 */
export type EventSubscribeOptions = {
    /**
     * The id of the subscriber that wants to subscribe.
     *
     * Needs to be unique and should stay consistent to survive power cycles.
     */
    subscriberId: string,
    /**
     * The amount of attempts. Defaults to 1.
     */
    attempts?: number,
    /**
     * The timeout in which the hook should finish. Defaults to 30 seconds.
     */
    timeout?: number
};

/**
 * The result of subscribing to an event.
 */
export type EventSubscriptionInterface = {
    /**
     * Unsubscribes from the event.
     */
    unsubscribe: () => void
};

/**
 * What this application emits, as event type to payload.
 *
 * Empty here. An application fills it in through declaration merging, once, wherever it likes.
 *
 * ```ts
 * declare module 'zibri' {
 *     interface ZibriEventMap {
 *         userCreated: { userId: string }
 *     }
 * }
 * ```
 *
 * An interface rather than a type parameter on the service, because a DI token carries one type and
 * hands every consumer that same type. A parameter has to be instantiated at the token, which can
 * only name the widest map there is, so every consumer gets that one and none of them can narrow it
 * back. Declaring the map in one place is what lets `emit` refuse an event nobody declared, and
 * `subscribe` hand a hook the payload belonging to the type it named.
 */
// eslint-disable-next-line typescript/no-empty-interface
export interface ZibriEventMap {}

/**
 * Interface for an event service.
 */
export interface EventServiceInterface {
    /**
     * Hands every unfinished event back to this instance's subscribers so they can try to claim it.
     *
     * What makes an event survive the instance that emitted it: emitting only reaches subscribers
     * in the emitting process, so an event whose instance died would otherwise never be picked up.
     */
    dispatchPending: () => Promise<void>,
    /**
     * Records that this instance's subscribers still exist, and clears registrations that have
     * lapsed.
     *
     * Emitting and finishing both have to know which subscribers exist across the whole deployment
     * rather than in one process, which means the set has to be written down somewhere every
     * instance can read. This is what keeps that current: a subscriber stops counting only once no
     * instance hosting it is left to say otherwise.
     */
    refreshSubscriberRegistrations: () => Promise<void>,
    /**
     * Offers the failed runs the options select to their subscribers again, each with all of its
     * attempts, and puts their events back among the ones still owed.
     *
     * A run whose subscriber no instance hosts any more stays failed.
     * @returns How many runs are offered again.
     */
    replayFailed: (options: EventReplayOptions) => Promise<number>,
    /**
     * Emits an event of the given type and data.
     */
    emit: <K extends keyof ZibriEventMap>(type: K, data: ZibriEventMap[K], cleanupAfterMs?: number) => void | Promise<void>,
    /**
     * Subscribes to events of the given type with the given hook.
     *
     * Additional options can be provided, like eg. Retries or the id of the subscriber.
     * This needs to be unique.
     */
    subscribe: <K extends keyof ZibriEventMap>(
        type: K,
        hook: (value: Event<ZibriEventMap[K]>) => void | Promise<void>,
        options: EventSubscribeOptions
    ) => EventSubscriptionInterface | Promise<EventSubscriptionInterface>,
    /**
     * Subscribes to ALL events with the given hook.
     *
     * Additional options can be provided, like eg. Retries or the id of the subscriber.
     * This needs to be unique.
     */
    subscribeAll: (
        hook: (value: Event<ZibriEventMap[keyof ZibriEventMap]>) => void | Promise<void>,
        options: EventSubscribeOptions
    ) => EventSubscriptionInterface | Promise<EventSubscriptionInterface>
}