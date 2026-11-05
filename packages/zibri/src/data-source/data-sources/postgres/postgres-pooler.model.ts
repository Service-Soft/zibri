import type { PostgresOptions } from './postgres-data-source.model';

/**
 * Where a postgres data source reaches the server directly, when its `options` point at a pooler.
 *
 * What differs from `options`: the host always, and the port, credentials, database or tls when the
 * pooler is addressed by others than the server.
 */
export type PostgresDirectConnection = {
    /**
     * The host of the server, or the directory of its unix socket.
     */
    host: string
} & Partial<Pick<PostgresOptions, 'port' | 'username' | 'password' | 'database' | 'ssl'>>;

/**
 * A pooler handing a connection to a client for one transaction at a time, such as PgBouncer in
 * transaction mode.
 */
export type PostgresTransactionPooler = {
    /**
     * Each transaction may run on another server connection.
     */
    mode: 'transaction',
    /**
     * Where the work that needs a server connection of its own goes: the lock around the schema setup,
     * listening for messages, and backups.
     */
    direct: PostgresDirectConnection
};

/**
 * What stands between a postgres data source and its server.
 *
 * - `'none'`: the data source connects to the server itself.
 * - `'session'`: a pooler handing a client one server connection for as long as it is connected,
 * such as PgBouncer in session mode. The data source works with it as with the server itself.
 * - a {@link PostgresTransactionPooler}: a pooler handing out a server connection per transaction.
 */
export type PostgresPooler = 'none' | 'session' | PostgresTransactionPooler;