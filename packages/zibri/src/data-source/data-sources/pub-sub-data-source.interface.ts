/**
 * A subscription that can be ended again.
 */
export type DataSourceSubscription = {
    /**
     * Stops delivering messages and releases whatever the subscription holds open.
     */
    unsubscribe: () => Promise<void>
};

/**
 * A data source that can carry messages between the instances of a deployment.
 *
 * Separate from DataSourceInterface, and optional, because it is a different kind of capability:
 * locking is needed to boot safely at all, publishing is only needed by features that have to tell
 * the other instances something. A data source that cannot do it is perfectly usable, it just
 * cannot back those features.
 *
 * Unlike the lock this is fan out, not mutual exclusion: every subscriber gets every message, and
 * nothing is claimed.
 */
export interface PubSubDataSourceInterface {
    /**
     * Sends a message to every instance subscribed to the channel, including this one.
     * @param channel - The channel to publish on.
     * @param message - The payload.
     */
    publish: (channel: string, message: string) => Promise<void>,
    /**
     * Starts delivering the messages published on the channel to the given handler.
     * @param channel - The channel to listen on.
     * @param onMessage - Called for every message, including ones this instance published.
     * @returns The subscription, so it can be ended.
     */
    subscribe: (channel: string, onMessage: (message: string) => void) => Promise<DataSourceSubscription>
}

/**
 * Checks whether the given value can carry messages between instances.
 * @param value - The value to check.
 * @returns True when it implements {@link PubSubDataSourceInterface}.
 */
export function isPubSubDataSource(value: unknown): value is PubSubDataSourceInterface {
    if (typeof value !== 'object' || value == undefined) {
        return false;
    }
    return 'publish' in value && typeof value.publish === 'function'
        && 'subscribe' in value && typeof value.subscribe === 'function';
}