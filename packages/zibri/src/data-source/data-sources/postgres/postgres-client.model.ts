import { Readable } from 'node:stream';

/**
 * What a statement answers with, as the driver hands it over.
 */
export type PgQueryResult = {
    /**
     * The rows it read or returned.
     */
    rows: Record<string, unknown>[],
    /**
     * How many rows it touched.
     */
    rowCount: number | null
};

/**
 * The events of a driver connection the data source listens for.
 */
type PgClientEvents = ((event: 'error', listener: (error: Error) => void) => void)
    & ((event: 'notification', listener: (notification: {
        /**
         * The channel the message was sent on.
         */
        channel: string,
        /**
         * The message sent with it.
         */
        payload?: string
    }) => void) => void);

/**
 * The part of a driver connection the data source uses.
 *
 * Written down here because the driver ships no types, and narrowed to what is used: a dependency on
 * the rest is how this would break on an upgrade.
 */
export type PgClient = {
    /**
     * Runs a statement, or reads one through a cursor when given a stream.
     */
    query: ((sql: string, values?: unknown[]) => Promise<PgQueryResult>) & (<S extends Readable>(stream: S) => S),
    /**
     * Starts calling a listener for an event of the connection.
     */
    on: PgClientEvents,
    /**
     * Stops calling a listener that was added.
     */
    removeListener: PgClientEvents,
    /**
     * The process id the connection was given when it started, by the server or by a pooler.
     */
    processID: number | null,
    /**
     * The secret key that goes with it.
     */
    secretKey: number | null,
    /**
     * Where the connection was opened to.
     */
    connectionParameters: {
        /**
         * The host, or the directory of a unix socket.
         */
        host: string,
        /**
         * The port.
         */
        port: number
    }
};

/**
 * A connection taken out of a pool.
 */
export type PgPoolClient = PgClient & {
    /**
     * Hands it back to the pool, or ends it when given the error it failed with.
     */
    release: (error?: Error) => void
};

/**
 * A connection opened on its own, outside a pool.
 */
export type PgSessionClient = PgClient & {
    /**
     * Opens it.
     */
    connect: () => Promise<void>,
    /**
     * Closes it.
     */
    end: () => Promise<void>
};

/**
 * A pool of driver connections.
 */
export type PgPool = {
    /**
     * Takes a connection out of the pool, opening one when none is free and the pool may grow.
     */
    connect: () => Promise<PgPoolClient>,
    /**
     * Closes every connection, once each one handed out is back.
     */
    end: () => Promise<void>,
    /**
     * Starts calling a listener for a connection failing while it sits in the pool.
     */
    on: (event: 'error', listener: (error: Error) => void) => void
};

/**
 * The parts of the driver the data source uses as values.
 */
export type Pg = {
    /**
     * Builds a pool.
     */
    Pool: new (config: Record<string, unknown>) => PgPool,
    /**
     * Builds a connection of its own.
     */
    Client: new (config: Record<string, unknown>) => PgSessionClient
};

/**
 * What the driver fails a statement with, as far as the data source reads it.
 */
export type PgDatabaseError = Error & {
    /**
     * The sql state.
     */
    code?: string,
    /**
     * The constraint the statement broke.
     */
    constraint?: string,
    /**
     * What postgres adds to its message.
     */
    detail?: string,
    /**
     * The function of the server that raised it.
     */
    routine?: string
};