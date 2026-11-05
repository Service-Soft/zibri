import { setTimeout as sleep } from 'node:timers/promises';

import { InternalError } from '../../../error-handling/internal-error.model';
import { type LoggerInterface } from '../../../logging/logger.interface';
import { Ms } from '../../../utilities/ms';
import { DataSourceSubscription } from '../pub-sub-data-source.interface';

/**
 * How long to wait before listening again on a new connection, once the old one failed.
 */
const RECONNECT_DELAY_IN_MS: number = Ms.SECOND;

/**
 * One notification, as the driver hands it over.
 */
type PgNotification = {
    /**
     * The channel it was sent on.
     */
    channel: string,
    /**
     * What was sent, if anything.
     */
    payload?: string
};

/**
 * The events of a driver connection that listening needs.
 */
type PgListeningEvents = ((event: 'notification', listener: (notification: PgNotification) => void) => void)
    & ((event: 'error', listener: (error: Error) => void) => void);

/**
 * The part of a driver connection that listening needs.
 */
type PgListeningClient = {
    /**
     * Runs a statement.
     */
    query: (sql: string) => Promise<unknown>,
    /**
     * Starts calling a listener for every notification the connection receives, or for its failure.
     */
    on: PgListeningEvents,
    /**
     * Stops calling a listener that was added.
     */
    removeListener: PgListeningEvents
};

/**
 * A connection taken out of the pool for listening, and how to hand it back.
 */
export type ListeningConnection = {
    /**
     * The connection.
     */
    client: PgListeningClient,
    /**
     * Hands it back. A connection that failed has been discarded already, and handing it back does
     * nothing.
     */
    release: () => Promise<void>
};

/**
 * A listening connection, with the two listeners this added to it.
 */
type HeldConnection = ListeningConnection & {
    /**
     * Hands a notification on.
     */
    onNotification: (notification: PgNotification) => void,
    /**
     * Listens again elsewhere when the connection fails.
     */
    onError: (error: Error) => void
};

/**
 * Holds the one connection a postgres data source listens for notifications on, and hands each of
 * them to whoever subscribed to its channel.
 *
 * One connection for every channel rather than one per subscription, because a listening connection
 * is a connection the pool cannot hand out, and every instance of a deployment holds its own.
 */
export class PostgresNotificationListener {
    private readonly handlers: Map<string, Set<(message: string) => void>> = new Map();

    private connection: Promise<HeldConnection> | undefined;

    private readonly closing: AbortController = new AbortController();

    constructor(
        private readonly obtainConnection: () => Promise<ListeningConnection>,
        private readonly logger: LoggerInterface
    ) {}

    /**
     * Starts handing the notifications of a channel to the given handler.
     * @param channel - The channel, as postgres names it.
     * @param onMessage - Called with the payload of every notification on it.
     * @returns The subscription, so it can be ended.
     */
    async subscribe(channel: string, onMessage: (message: string) => void): Promise<DataSourceSubscription> {
        const connection: HeldConnection = await this.resolveConnection();
        const handlers: Set<(message: string) => void> = this.handlers.get(channel) ?? new Set();
        if (!handlers.size) {
            this.handlers.set(channel, handlers);
            await connection.client.query(`LISTEN ${quoteIdentifier(channel)}`);
        }
        handlers.add(onMessage);

        return {
            unsubscribe: async () => {
                handlers.delete(onMessage);
                if (handlers.size || this.handlers.get(channel) !== handlers) {
                    return;
                }
                this.handlers.delete(channel);
                if (this.handlers.size) {
                    await connection.client.query(`UNLISTEN ${quoteIdentifier(channel)}`);
                    return;
                }
                // nothing listens any more, so the pool gets its connection back: a data source being
                // closed waits for every connection it handed out
                await this.release();
            }
        };
    }

    /**
     * Stops listening for good, and hands the connection back.
     */
    async close(): Promise<void> {
        this.closing.abort();
        this.handlers.clear();
        await this.release();
    }

    /**
     * The listening connection, taken out of the pool the first time it is needed.
     * @returns The connection.
     */
    private async resolveConnection(): Promise<HeldConnection> {
        if (this.closing.signal.aborted) {
            throw new InternalError('cannot listen for notifications on a data source that is shutting down');
        }
        this.connection ??= this.connect();
        try {
            return await this.connection;
        }
        catch (error) {
            this.connection = undefined;
            throw error;
        }
    }

    /**
     * Takes a connection out of the pool and has it hand every notification on.
     * @returns The connection.
     */
    private async connect(): Promise<HeldConnection> {
        const taken: ListeningConnection = await this.obtainConnection();
        const held: HeldConnection = {
            ...taken,
            onNotification: notification => this.deliver(notification),
            onError: error => void this.reconnectAfter(held, error)
        };
        held.client.on('notification', held.onNotification);
        held.client.on('error', held.onError);
        return held;
    }

    /**
     * Hands one notification to the handlers of its channel.
     * @param notification - The notification.
     */
    private deliver(notification: PgNotification): void {
        for (const handler of this.handlers.get(notification.channel) ?? []) {
            handler(notification.payload ?? '');
        }
    }

    /**
     * Listens again on a new connection, once the one listening failed.
     *
     * What was sent while there was none is not delivered: a channel is fan out, not a queue, and
     * whatever uses one keeps the state it is about somewhere it can read again.
     * @param failed - The connection that failed.
     * @param error - What it failed with.
     */
    private async reconnectAfter(failed: HeldConnection, error: Error): Promise<void> {
        this.detach(failed);
        await failed.release();
        this.connection = undefined;
        if (this.closing.signal.aborted) {
            return;
        }
        this.logger.error(new InternalError('the connection listening for postgres notifications failed, listening again', {
            cause: error
        }));

        while (!this.closing.signal.aborted && this.handlers.size) {
            try {
                await sleep(RECONNECT_DELAY_IN_MS, undefined, { signal: this.closing.signal });
                const connection: HeldConnection = await this.resolveConnection();
                for (const channel of this.handlers.keys()) {
                    await connection.client.query(`LISTEN ${quoteIdentifier(channel)}`);
                }
                return;
            }
            catch (retryError) {
                if (!this.closing.signal.aborted) {
                    this.logger.warn('could not listen for postgres notifications again yet, retrying', { error: retryError });
                }
            }
        }
    }

    /**
     * Hands the listening connection back to the pool, if there is one.
     */
    private async release(): Promise<void> {
        const connection: Promise<HeldConnection> | undefined = this.connection;
        this.connection = undefined;
        if (connection == undefined) {
            return;
        }
        let held: HeldConnection;
        try {
            held = await connection;
        }
        catch {
            // never connected, so there is nothing to hand back
            return;
        }
        this.detach(held);
        try {
            // a connection handed back still listening would deliver to whoever takes it next
            await held.client.query('UNLISTEN *');
        }
        catch (error) {
            this.logger.warn('could not stop listening for postgres notifications cleanly', { error });
        }
        finally {
            await held.release();
        }
    }

    /**
     * Removes the listeners this added, and only those: the pool watches its idle connections for
     * failures with listeners of its own.
     * @param held - The connection.
     */
    private detach(held: HeldConnection): void {
        held.client.removeListener('notification', held.onNotification);
        held.client.removeListener('error', held.onError);
    }
}

/**
 * Writes a channel name as postgres reads an identifier, keeping its case and its dots.
 * @param channel - The channel.
 * @returns The quoted identifier.
 */
function quoteIdentifier(channel: string): string {
    return `"${channel.replaceAll('"', '""')}"`;
}