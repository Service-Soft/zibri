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
 * Interface for an event service.
 */
export interface EventServiceInterface<TEvents extends Record<string, unknown>> {
    /**
     * Emits an event of the given type and data.
     */
    emit: <K extends keyof TEvents>(type: K, data: TEvents[K], cleanupAfterMs?: number) => void | Promise<void>,
    /**
     * Subscribes to events of the given type with the given hook.
     *
     * Additional options can be provided, like eg. Retries or the id of the subscriber.
     * This needs to be unique.
     */
    subscribe: <K extends keyof TEvents>(
        type: K,
        hook: (value: Event<TEvents[K]>) => void | Promise<void>,
        options: EventSubscribeOptions
    ) => EventSubscriptionInterface | Promise<EventSubscriptionInterface>,
    /**
     * Subscribes to ALL events with the given hook.
     *
     * Additional options can be provided, like eg. Retries or the id of the subscriber.
     * This needs to be unique.
     */
    subscribeAll: (
        hook: (value: Event<TEvents[keyof TEvents]>) => void | Promise<void>,
        options: EventSubscribeOptions
    ) => EventSubscriptionInterface | Promise<EventSubscriptionInterface>
}