/* eslint-disable cspell/spellchecker */
import { Readable } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';
import { ConnectionOptions } from 'node:tls';

import { pgTypeParsers } from './pg-type-parsers.function';
import { PostgresBackupScope } from './postgres-backup-scope.model';
import { PostgresBackupRunner } from './postgres-backup.runner';
import { Pg, PgClient, PgPool, PgPoolClient, PgQueryResult, PgSessionClient } from './postgres-client.model';
import { ListeningConnection, PostgresNotificationListener } from './postgres-notification-listener.model';
import { PostgresPooler, PostgresTransactionPooler } from './postgres-pooler.model';
import { PostgresQueryBuilder } from './postgres-query-builder.model';
import { PostgresRun, PostgresSchemaManager } from './postgres-schema-manager.model';
import { ColumnPropertyMetadata, PostgresColumnSettings, PostgresSchema } from './postgres-schema.model';
import { PostgresSqlUtilities, PostgresStatement } from './postgres-sql.utilities';
import { PostgresStatementErrorUtilities } from './postgres-statement-error.utilities';
import { PostgresKey, PostgresTable } from './postgres-table.model';
import { PostgresWhereFilterConverter, TrigramSupport } from './postgres-where-filter.converter';
import { sendPostgresCancelRequest } from './send-postgres-cancel-request.function';
import { type AuthServiceInterface } from '../../../auth/auth-service.interface';
import { AlsUtilities } from '../../../context/als.utilities';
import { OperationLimit } from '../../../context/operation-limit.model';
import { OperationLimitUtilities } from '../../../context/operation-limit.utilities';
import { Inject } from '../../../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { BaseEntity } from '../../../entity/base-entity.model';
import { ArrayPropertyItemMetadata } from '../../../entity/models/array-property-metadata.model';
import { NumberFormat } from '../../../entity/models/number-property-metadata.model';
import { coversEveryRow } from '../../../entity/models/unique-declaration.model';
import { InternalError } from '../../../error-handling/internal-error.model';
import { GlobalRegistry } from '../../../global/global-registry';
import { keyGroupsOf } from '../../../global/model-registry/key-descriptor';
import { type LoggerInterface } from '../../../logging/logger.interface';
import { Newable } from '../../../types/newable.type';
import { hasOptionalPeer, optionalPeer } from '../../../utilities/optional-peer.function';
import { PromiseUtilities } from '../../../utilities/promise.utilities';
import { PostgresRepositoryDriver } from '../../driver/postgres.repository-driver';
import { registerRepositoryProvidersFor } from '../../entity-ownership.function';
import { MigratedEntityUtilities } from '../../migration/migrated-entity.utilities';
import { MigrationEntity } from '../../migration/migration-entity.model';
import { MigrationRevertTarget } from '../../migration/migration-revert-target.model';
import { Migration } from '../../migration/migration.model';
import { recordKeyReconciliation, revertMigrationsAfter, runMigrations, runMigrationsAfterRestore } from '../../migration/run-migrations.function';
import { AddPropertyToEntityInput } from '../../models/add-property-to-entity-input.model';
import { ChangePropertyOfEntityInput } from '../../models/change-property-of-entity-input.model';
import { ColumnType } from '../../models/column-type.model';
import { CreateEntityInput } from '../../models/create-entity-input.model';
import { MergeEntityInput } from '../../models/merge-entity-input.model';
import { MigrationPropertyMetadata } from '../../models/migration-property-metadata.model';
import { RemoveEntityInput } from '../../models/remove-entity-input.model';
import { RemovePropertyFromEntityInput } from '../../models/remove-property-from-entity-input.model';
import { RemoveRelationFromEntityInput } from '../../models/remove-relation-from-entity-input.model';
import { RenameEntityInput } from '../../models/rename-entity-input.model';
import { SchemaManagement } from '../../models/schema-management.model';
import { DEFAULT_MIN_SIMILARITY, MinSimilarity } from '../../models/where/fuzzy-like.model';
import { QueryFailedError } from '../../query-failed.error';
import { Repository } from '../../repository/repository';
import { RepositoryClass } from '../../repository/repository-class.type';
import { RepositoryForUtilities } from '../../repository/repository-for.utilities';
import { PostgresTransaction } from '../../transaction/postgres-transaction.model';
import { RunInTransactionOptions } from '../../transaction/run-in-transaction-options.model';
import { TransactionAlreadyFinishedError } from '../../transaction/transaction-already-finished.error';
import { Transaction } from '../../transaction/transaction.model';
import { TransactionUtilities } from '../../transaction/transaction.utilities';
import { uniqueConstraintName } from '../../unique-constraint-name.function';
import { ValueConversionUtilities } from '../../value-conversion.utilities';
import { DataSourceInitializationError } from '../data-source-initialization.error';
import { DataSourceInterface, DEFAULT_TRANSACTION_IDLE_TIMEOUT_IN_MS, RepositoryTypeForEntity, SCHEMA_LOCK_KEY, StartTransactionOptions } from '../data-source.interface';
import { DataSourceSubscription, PubSubDataSourceInterface } from '../pub-sub-data-source.interface';
import { QueryBuilder, QueryOptions, SqlDataSourceInterface } from '../sql-data-source.interface';
import { ParameterizedSql } from '../where-converter/parameterized-sql.model';

/**
 * How a postgres data source connects to its server.
 */
export type PostgresOptions = {
    /**
     * The server, or the directory of its unix socket.
     */
    host?: string,
    /**
     * Its port. 5432 by default.
     */
    port?: number,
    /**
     * The role to connect as.
     */
    username?: string,
    /**
     * Its password, or a function resolving it, such as from a secret store.
     */
    password?: string | (() => string | Promise<string>),
    /**
     * The database to connect to.
     */
    database?: string,
    /**
     * The schema the tables are in. The first one of the role's search path by default.
     */
    schema?: string,
    /**
     * Whether the connection uses tls.
     *
     * `true` encrypts it and verifies the server's certificate against the system's certificate
     * authorities, an object passes node's tls options for anything else, such as your own ca or a
     * client certificate, and `false` connects unencrypted.
     *
     * The `PGSSLMODE` environment variable does not apply to the connection. It applies to the client
     * tools a backup runs, which use `require` when this is set and `disable` when it is `false` while
     * the environment names no mode.
     */
    ssl: boolean | ConnectionOptions,
    /**
     * The name the connections give the server, which it shows beside them.
     */
    applicationName?: string,
    /**
     * How many connections one instance holds at once. 20 by default.
     */
    poolSize?: number,
    /**
     * How long a call waits for a connection before it fails. 30 seconds by default.
     */
    connectTimeoutInMs?: number,
    /**
     * How many values one statement can bind. Defaults to what the database accepts.
     *
     * A write of more rows than one statement can take is split into several statements, each within
     * this, and runs inside one transaction.
     */
    maxBoundValuesPerStatement?: number,
    /**
     * Settings handed to the connection pool as they are, for what the driver accepts and the options
     * above have no field for.
     */
    extra?: Record<string, unknown>
};

/**
 * The kinds of property a column type is chosen for.
 */
type ColumnMappableType = ColumnPropertyMetadata['type'];

/**
 * A stream reading the rows of a statement through a cursor, as `pg-query-stream` builds one.
 */
type PgQueryStream = new (sql: string, values: unknown[]) => Readable;

/**
 * What stops the statements on a connection when the request they belong to ends first.
 */
type StatementWatch = {
    /**
     * The signal of the request.
     */
    signal: AbortSignal,
    /**
     * Stops what runs on the connection, once the signal fires.
     */
    onAbort: () => void,
    /**
     * How many statements on the connection are running or queued.
     */
    statements: number,
    /**
     * The cancel on its way to the server, once one was sent.
     */
    cancelling: Promise<void> | undefined
};

/**
 * How long an instance waits between two attempts at taking the schema lock, in milliseconds.
 */
const SCHEMA_LOCK_RETRY_IN_MS: number = 100;

/**
 * The number postgres identifies the advisory lock on a key by, in the schema the session's tables
 * are created in. Postgres identifies advisory locks by number, so the two are hashed into one.
 */
const ADVISORY_LOCK_ID_SQL: string = 'hashtext(coalesce(current_schema(), \'\') || \':\' || $1)';

/**
 * Sets the statement timeout for the rest of the current transaction, to the milliseconds in `$1`.
 */
const SET_LOCAL_STATEMENT_TIMEOUT_SQL: string = 'SELECT set_config(\'statement_timeout\', $1, true)';

/**
 * The largest payload `NOTIFY` carries, in bytes: it has to be shorter than 8000.
 */
const MAX_NOTIFY_PAYLOAD_BYTES: number = 7999;

/**
 * The longest name postgres keeps, in bytes.
 */
const MAX_IDENTIFIER_BYTES: number = 63;

/**
 * A base postgres data source definition.
 */
export abstract class PostgresDataSource implements SqlDataSourceInterface, PubSubDataSourceInterface {
    abstract readonly entities: Newable<BaseEntity>[];

    abstract readonly repositories: RepositoryClass[];

    // no default on purpose: there is no value that is safe to assume
    /**
     * Who is responsible for making the database match the entities. Required.
     */
    abstract readonly schemaManagement: SchemaManagement;

    /**
     * How the data source connects to its server.
     */
    abstract readonly options: PostgresOptions;

    /**
     * What stands between this data source and its server: nothing, a pooler in session mode, or a
     * pooler in transaction mode together with where the server itself is.
     */
    abstract readonly pooler: PostgresPooler;

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly migrations: Newable<Migration>[] = [];

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly migrationTimeoutInMs: number = 0;

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly maxMessageBytes: number | undefined = MAX_NOTIFY_PAYLOAD_BYTES;

    /**
     * The password of the separate backup role, if there is one.
     *
     * Only needed when backups run as somebody other than the application. A backup covers the
     * objects this data source owns, so the application's own credentials are enough by default.
     */
    readonly rootPw: string | undefined;

    /**
     * The username of the separate backup role, if there is one. Setting one without the other is
     * refused at boot.
     */
    readonly rootUsername: string | undefined;

    /**
     * What a backup of this data source covers, and so what a restore of it replaces. Has to be set
     * when the data source is marked with \@Backup.
     *
     * `'schema'` when the schema belongs to this application alone, so that what its migrations create
     * besides tables is backed up as well. `'entity-tables'` when anything else keeps tables in the
     * same schema.
     */
    readonly backupScope: PostgresBackupScope | undefined;

    /**
     * The similarity from which this data source answers a search out of an index.
     *
     * The connection is told to use it, so it is the boundary rather than a guess about one: a
     * `fuzzyLike` asking for this or more is answered from the trigram index, and one asking for less
     * reads every row and says so. Not the similarity a filter asks for when the caller names none -
     * that is {@link DEFAULT_MIN_SIMILARITY} and belongs to the filter.
     */
    protected readonly searchesFromSimilarity: MinSimilarity = DEFAULT_MIN_SIMILARITY;

    /**
     * How long one statement may take, in milliseconds, before the server stops it. 0 for no limit.
     *
     * Covers every statement this data source runs, inside a request or not. A call that needs longer,
     * or should give up sooner, says so with its own `timeoutInMs`, and a migration runs under
     * `migrationTimeoutInMs` instead.
     */
    protected readonly statementTimeoutInMs: number = 30000;

    /**
     * The column type a kind of property is stored as, over the defaults.
     */
    protected readonly columnTypeMapping: Partial<Record<ColumnMappableType, ColumnType>> = {};

    /**
     * The column type each kind of property is stored as by default.
     */
    protected readonly defaultColumnTypeMapping: Record<ColumnMappableType, ColumnType> = {
        // an array is stored as a list of what its items are, or as json
        array: 'jsonb',
        // what a javascript number is. A number property says which kind it holds and
        // `numberColumnType` answers for it; this is what the ones that name nothing else get
        number: 'double precision',
        string: 'character varying',
        object: 'jsonb',
        date: 'timestamp with time zone',
        boolean: 'boolean',
        unknown: 'jsonb',
        file: 'bytea',
        oneOf: 'jsonb'
    };

    private pool: PgPool | undefined;

    private schema: PostgresSchema | undefined;

    private converter: PostgresWhereFilterConverter | undefined;

    private manager: PostgresSchemaManager | undefined;

    /**
     * What this server's trigram operator answers, as measured at boot: it decides which searches are
     * written so that an index can serve them, and whether there is an operator class to create those
     * indexes with at all.
     */
    private trigramSupport: TrigramSupport = { threshold: undefined, thresholdIsInclusive: false };

    /**
     * The connection subscriptions listen on, once something subscribed.
     */
    private notificationListener: PostgresNotificationListener | undefined;

    private backupRunner: PostgresBackupRunner | undefined;

    /**
     * What stops a statement when the request it belongs to ends first, by connection: the
     * statements a connection runs at once are queued on it, and a cancel stops whichever of them the
     * server is running.
     */
    private readonly statementWatches: WeakMap<PgClient, StatementWatch> = new WeakMap();

    private readonly builtRepositories: Map<Newable<BaseEntity>, Repository<BaseEntity>> = new Map();

    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        protected readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.AUTH_SERVICE)
        protected readonly authService: AuthServiceInterface
    ) {}

    /**
     * The collation every text column is created with, which is the order the application has.
     *
     * An icu collation rather than a libc one: icu is the same implementation `compareText` uses, so
     * the database and the process agree, and it is the same on every host. Deterministic, so equality
     * stays equality and `LIKE` keeps working.
     * @returns The name postgres creates for the default locale's icu collation.
     */
    protected get textCollation(): string {
        return `${inject(ZIBRI_DI_TOKENS.LOCALIZE_OPTIONS).defaultLocale}-x-icu`;
    }

    /**
     * What the data source decides about the columns it creates.
     * @returns The settings.
     */
    protected get columnSettings(): PostgresColumnSettings {
        const mapping: Record<ColumnMappableType, ColumnType> = { ...this.defaultColumnTypeMapping, ...this.columnTypeMapping };
        return {
            resolveType: (metadata: ColumnPropertyMetadata | ArrayPropertyItemMetadata) => metadata.type === 'number'
                ? this.numberColumnType(metadata.format)
                : mapping[metadata.type],
            textCollation: this.textCollation,
            resolveDefault: metadata => this.databaseDefaultFor(metadata)
        };
    }

    /**
     * The column type a number property is stored as: the format decides how much of a number the
     * column has to hold, and a whole number, a large whole number and an exact decimal are three
     * different columns.
     * @param format - What kind of number the property holds.
     * @returns The column type to declare.
     */
    protected numberColumnType(format: NumberFormat): ColumnType {
        switch (format) {
            // the format takes every whole number a double holds exactly, which is past what a
            // postgres `integer` does: a time in milliseconds needs 41 bits
            case 'integer':
            case 'bigint': {
                return 'bigint';
            }
            // an exact decimal of any size: postgres reads a `numeric` without precision and scale as
            // "whatever the value needs", which is what the format promises
            case 'bignumber': {
                return 'numeric';
            }
            case 'number': {
                return this.columnTypeMapping.number ?? this.defaultColumnTypeMapping.number;
            }
        }
    }

    /**
     * What the column itself defaults to, where the property declares something a column can hold.
     *
     * A `default` is applied by the application, so it may be a function of the row being written or of
     * the request making it, and neither of those is a value a column can be given. A constant is, and
     * it is what answers for the writes the application never sees: a data migration, a dba, another
     * service against the same database.
     * @param metadata - The property to read the declared default off.
     * @returns The default to declare on the column, or undefined when there is none to declare.
     */
    protected databaseDefaultFor(metadata: ColumnPropertyMetadata): string | number | boolean | Date | undefined {
        if (!('default' in metadata) || typeof metadata.default === 'function') {
            return undefined;
        }
        return metadata.default;
    }

    /**
     * Runs before every statement this data source sends, `BEGIN` and `COMMIT` included.
     * @param statement - The statement.
     */
    // eslint-disable-next-line unusedImports/no-unused-vars
    protected onStatementSent(statement: string): void {
        // nothing by default
    }

    /**
     * Validates the options. Warns about the default credentials by default.
     * @param options - The options.
     */
    protected validateOptions(options: PostgresOptions): void | Promise<void> {
        if (options.username === 'postgres' && options.password === 'password') {
            this.logger.warn(`The data source "${this.constructor.name}" uses the default credentials, you probably want to change that.`);
        }
    }

    // ── lifecycle ───────────────────────────────────────────────

    // eslint-disable-next-line jsdoc/require-jsdoc
    async init(): Promise<void> {
        if (this.pool) {
            throw new InternalError('The data source has already been initialized.');
        }
        await this.validateOptions(this.options);
        this.validateSchemaManagement();
        registerRepositoryProvidersFor(this.constructor as Newable<DataSourceInterface>, this);

        // an entity listed twice is still one entity, as resolveEntityOwnership has it
        const entities: Newable<BaseEntity>[] = [...new Set(this.entities)];
        const schema: PostgresSchema = new PostgresSchema(entities, this.columnSettings);
        this.schema = schema;
        const pg: Pg = optionalPeer<Pg>('pg', 'Talking to postgres');
        const pool: PgPool = new pg.Pool(this.resolveConnectionConfig(this.options, true));
        // a connection that fails while it sits in the pool is dropped by the pool, which tells nobody
        pool.on('error', error => this.logger.error(new InternalError('A pooled postgres connection failed.', { cause: error })));
        this.pool = pool;

        await this.beforeMigrations();
        const manager: PostgresSchemaManager = new PostgresSchemaManager(
            schema,
            this.columnSettings,
            entities,
            this.trigramSupport,
            this.logger
        );
        this.manager = manager;
        // a command works on the schema as it is: one about migrations is what changes it
        if (GlobalRegistry.getAppData('runsCommand')) {
            return;
        }
        // Every instance of a deployment runs this same block on boot against the same database, so
        // the first instance sets the schema up under the lock and the rest find the work done. Under
        // the migration timeout: an index built over a large table, or a migration rewriting one, is the
        // work this block exists for
        await OperationLimitUtilities.runWithin(
            this.migrationTimeoutInMs,
            `Setting up the schema of "${this.constructor.name}"`,
            async () => await this.schemaLock(SCHEMA_LOCK_KEY, async () => {
                await this.runMigrations();
                await this.reconcileSchema();
            })
        );
        // read after the schema is set up, so that what it finds is what nothing here is going to fix
        await manager.warnAboutColumnsOrderedDifferently(this.bindRun(undefined), this.textCollation);
        if (this.schemaManagement === 'external') {
            await manager.warnAboutMissingTrigramIndexes(this.bindRun(undefined));
        }
        this.validateQueryStream();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async shutDown(): Promise<void> {
        // before the pool closes, which waits for every connection it handed out
        await this.notificationListener?.close();
        await this.pool?.end();
    }

    /**
     * Refuses a data source that names migrations as what manages its schema and then declares none:
     * with nothing synchronizing and nothing to migrate, no table is ever created.
     * @throws When migrations are named as the schema's owner and the data source has none.
     */
    private validateSchemaManagement(): void {
        if (this.schemaManagement !== 'migrations' || this.migrations.length) {
            return;
        }
        throw new InternalError(
            `The data source "${this.constructor.name}" declares schemaManagement: 'migrations' but has no migrations,`
            + ' so nothing would ever create its tables. Add the migrations, or declare'
            + ' schemaManagement: \'external\' if the schema is created outside this application.'
        );
    }

    /**
     * Checks what the server can do once the connection is open, before anything creates or changes
     * the schema, while there is still nothing written that would have to be undone.
     */
    private async beforeMigrations(): Promise<void> {
        const run: PostgresRun = this.bindRun(undefined);
        await this.validateTextCollation(run);
        // before the schema is set up rather than after, because the trigram indexes that go on it need
        // the operator class this installs, and the converter needs to know what the operator means here
        await this.installTrigramExtension(run);
        this.trigramSupport = await this.measureTrigramSupport();
        await this.validateConnectionSettings(run);
        await this.warnAboutAsciiOnlyWords(run);
        this.converter = new PostgresWhereFilterConverter(this.getSchema(), this.logger, this.trigramSupport);
    }

    /**
     * Brings the tables, and the indexes, uniques and checks the entities declare, in line with what
     * the entities declare. Runs once the migrations have, while the schema lock is held.
     * @throws When stored rows break a declared unique or check.
     */
    private async reconcileSchema(): Promise<void> {
        if (this.schemaManagement === 'external') {
            return;
        }
        const manager: PostgresSchemaManager = this.getManager();
        if (this.schemaManagement === 'synchronize') {
            await this.onSession(async run => await manager.synchronize(run));
        }
        // before the keys, which are built on the tables and would otherwise be what finds one missing
        if (this.schemaManagement === 'migrations') {
            await this.onSession(async run => await manager.validateTablesExist(run));
        }
        // a session of its own, and no transaction on it: an index is built concurrently, which cannot
        // happen inside one - and is the point, since writes go on while it is built
        const changed: boolean = await this.onSession(async (run, client, pooled) => {
            const limit: OperationLimit | undefined = AlsUtilities.findCurrentOperationLimit();
            const restore: (() => Promise<void>) | undefined = limit == undefined
                ? undefined
                : await this.limitStatementsOn(client, limit.timeoutInMs, false, pooled);
            try {
                // kept like the keys under migrations, which describe columns alone: synchronizing keeps
                // them with the rest of the schema
                const relationsChanged: boolean = this.schemaManagement === 'migrations' && await manager.reconcileRelations(run);
                return await manager.reconcileKeys(run) || relationsChanged;
            }
            finally {
                await restore?.();
            }
        });
        if (this.schemaManagement === 'migrations' && changed) {
            await recordKeyReconciliation(this.constructor as Newable<DataSourceInterface>);
        }
    }

    // ── repositories and transactions ───────────────────────────

    // eslint-disable-next-line jsdoc/require-jsdoc
    getRepository<T extends BaseEntity>(cls: Newable<T>): RepositoryTypeForEntity<T> {
        const schema: PostgresSchema = this.getSchema();
        return RepositoryForUtilities.resolveEntityRepository(
            this,
            cls,
            this.builtRepositories,
            this.logger,
            this.authService,
            () => new PostgresRepositoryDriver(cls, this, schema, this.getConverter(), this.resolveMaxBoundValues())
        );
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    query<T extends BaseEntity>(entityClass: Newable<T>, options?: QueryOptions): QueryBuilder {
        return new PostgresQueryBuilder(
            entityClass,
            options?.alias ?? entityClass.name,
            this.getSchema(),
            options?.transaction,
            async (statement, transaction) => await this.runStatement(statement, transaction)
        );
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async startTransaction(options?: StartTransactionOptions): Promise<Transaction> {
        const limit: OperationLimit | undefined = AlsUtilities.findCurrentOperationLimit();
        const client: PgPoolClient = await this.connectFromPool();
        const idleTimeoutInMs: number = options?.idleTimeoutInMs ?? DEFAULT_TRANSACTION_IDLE_TIMEOUT_IN_MS;
        // one round trip for all of it. LOCAL, so each setting covers this transaction and reverts with
        // it: set on the connection instead it would outlive the transaction and apply to every later
        // user of that pooled connection. Postgres ends an idle transaction and takes its connection
        // back itself, so nothing here has to watch the clock. Set when it is 0 as well, since that
        // means no limit, and left out the connection's own would apply - one the operator set for
        // the role or the database
        const isolation: string = options?.isolationLevel == undefined ? '' : ` ISOLATION LEVEL ${options.isolationLevel}`;
        const begin: string = [
            `BEGIN${isolation}`,
            `SET LOCAL idle_in_transaction_session_timeout = ${Math.trunc(idleTimeoutInMs)}`,
            // a transaction begun under a limit gives every statement in it the limit's time
            ...limit == undefined ? [] : [`SET LOCAL statement_timeout = ${Math.trunc(limit.timeoutInMs)}`]
        ].join('; ');
        try {
            await this.runOn(client, begin, []);
        }
        catch (error) {
            client.release(error instanceof Error ? error : undefined);
            throw error;
        }
        const transaction: PostgresTransaction = new PostgresTransaction(
            client,
            limit,
            async sql => await this.runOn(client, sql, []),
            // a serializable transaction can learn it lost only once it commits, which runOn resolves
            error => error
        );
        this.abandonWithItsConnection(transaction);
        return transaction;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async runInTransaction<R>(work: (transaction: Transaction) => Promise<R>, options: RunInTransactionOptions): Promise<R> {
        return await TransactionUtilities.runInTransaction(this, work, options);
    }

    /**
     * Ends a transaction once the server closes its connection, the way the idle timeout does: the
     * server rolls it back and closes the connection, and nothing tells the transaction - which then
     * stays open for everything waiting on its end.
     * @param transaction - The transaction, just started.
     */
    private abandonWithItsConnection(transaction: PostgresTransaction): void {
        const onError: (error: Error) => void = error => void this.abandon(transaction, error);
        transaction.client.on('error', onError);
        // the connection goes back to the pool for the next transaction, which listens for itself
        transaction.afterFinish(async () => {
            transaction.client.removeListener('error', onError);
            await Promise.resolve();
        });
    }

    private async abandon(transaction: PostgresTransaction, error: Error): Promise<void> {
        if (transaction.isFinished) {
            return;
        }
        this.logger.error(new InternalError(
            'The connection of a transaction that was not committed or rolled back was closed. It has been rolled back.',
            { cause: error }
        ));
        try {
            await transaction.abandon(error);
        }
        catch (finishError) {
            // runs on the connection's event rather than under a caller, so there is nowhere to throw to
            this.logger.error(finishError instanceof Error ? finishError : new InternalError(String(finishError)));
        }
    }

    // ── statements ──────────────────────────────────────────────

    /**
     * Runs one statement, in a transaction or on a connection of the pool, with the time the current
     * limit gives it.
     * @param statement - The statement, with named placeholders.
     * @param transaction - The transaction to run it in.
     * @param entityClass - The entity it reads or writes, which a broken unique or check is named by.
     * @returns The rows it read or returned.
     */
    async runStatement(
        statement: ParameterizedSql,
        transaction?: Transaction,
        entityClass?: Newable<BaseEntity>
    ): Promise<Record<string, unknown>[]> {
        return await this.runPositional(PostgresSqlUtilities.toStatement(statement), transaction, entityClass);
    }

    /**
     * Runs one statement with positional placeholders, as `runStatement` does.
     * @param statement - The statement, with `$1` style placeholders.
     * @param statement.sql - The sql of the statement.
     * @param statement.values - What its placeholders bind, in order.
     * @param transaction - The transaction to run it in.
     * @param entityClass - The entity it reads or writes, which a broken unique or check is named by.
     * @returns The rows it read or returned.
     */
    private async runPositional(
        { sql, values }: PostgresStatement,
        transaction: Transaction | undefined,
        entityClass: Newable<BaseEntity> | undefined
    ): Promise<Record<string, unknown>[]> {
        const limit: OperationLimit | undefined = AlsUtilities.findCurrentOperationLimit();
        if (transaction != undefined) {
            const held: PostgresTransaction = this.toPostgresTransaction(transaction);
            // a transaction begun under this same limit already holds it, for every statement in it
            return limit == undefined || held.limit === limit
                ? await this.runOn(held.client, sql, values, entityClass)
                : await this.whileLimited(
                    held.client,
                    limit,
                    true,
                    true,
                    async () => await this.runOn(held.client, sql, values, entityClass)
                );
        }
        const client: PgPoolClient = await this.connectFromPool();
        let failed: unknown;
        try {
            return limit == undefined
                ? await this.runOn(client, sql, values, entityClass)
                : await this.whileLimited(client, limit, false, true, async () => await this.runOn(client, sql, values, entityClass));
        }
        catch (error) {
            failed = error;
            throw error;
        }
        finally {
            // a connection that failed itself, rather than a statement on it, is not handed out again
            client.release(
                failed instanceof Error
                && !(failed instanceof QueryFailedError)
                && PostgresStatementErrorUtilities.findField(failed, 'code') == undefined
                    ? failed
                    : undefined
            );
        }
    }

    /**
     * Reads the rows of a statement through a cursor, so that only a bounded part of them is held at
     * once, and stopping early stops the reading.
     * @param statement - The statement.
     * @param transaction - The transaction to read in, or undefined for a connection of its own.
     * @yields The rows.
     */
    async* streamStatement(statement: ParameterizedSql, transaction?: Transaction): AsyncIterable<Record<string, unknown>> {
        const QueryStream: PgQueryStream = optionalPeer<PgQueryStream>('pg-query-stream', 'Streaming rows from postgres');
        const { sql, values }: PostgresStatement = PostgresSqlUtilities.toStatement(statement);
        const own: PgPoolClient | undefined = transaction == undefined ? await this.connectFromPool() : undefined;
        const client: PgClient = own ?? this.toPostgresTransaction(transaction).client;
        this.onStatementSent(sql);
        const stream: Readable = client.query(new QueryStream(sql, values));
        try {
            for await (const row of stream) {
                yield row;
            }
        }
        finally {
            // a caller that stopped early leaves the cursor open, and the connection it reads through
            stream.destroy();
            own?.release();
        }
    }

    /**
     * Runs one statement on a connection, stopping it when the request it belongs to ends first.
     *
     * The cancel is asked of the server on a different connection, since the one running the statement
     * is busy running it. A statement stopped inside a transaction takes the transaction with it, which
     * is what it is for: the request it belonged to has been answered.
     * @param client - The connection.
     * @param sql - The statement, with positional placeholders.
     * @param values - What it binds.
     * @param entityClass - The entity it reads or writes, which a broken unique or check is named by.
     * @returns The rows it read or returned.
     */
    private async runOn(
        client: PgClient,
        sql: string,
        values: unknown[],
        entityClass?: Newable<BaseEntity>
    ): Promise<Record<string, unknown>[]> {
        this.onStatementSent(sql);
        const signal: AbortSignal | undefined = AlsUtilities.findCurrentSignal();
        // an ended request's own cancel is a statement as well, and must not wait on itself
        const watched: boolean = signal != undefined && !signal.aborted;
        if (signal != undefined && watched) {
            this.watchStatement(client, signal);
        }
        try {
            const result: PgQueryResult | PgQueryResult[] = await (values.length ? client.query(sql, values) : client.query(sql));
            // several statements sent as one answer one result each, of which the last is the answer
            const last: PgQueryResult | undefined = [result].flat().at(-1);
            return last?.rows ?? [];
        }
        catch (error) {
            throw PostgresStatementErrorUtilities.resolveError(error, { sql, values }, entityClass, () => this.getManager());
        }
        finally {
            if (watched) {
                await this.unwatchStatement(client);
            }
        }
    }

    private watchStatement(client: PgClient, signal: AbortSignal): void {
        const watching: StatementWatch | undefined = this.statementWatches.get(client);
        if (watching != undefined) {
            watching.statements++;
            return;
        }
        const watch: StatementWatch = {
            signal,
            onAbort: () => {
                watch.cancelling = this.cancelStatementOn(client);
            },
            statements: 1,
            cancelling: undefined
        };
        signal.addEventListener('abort', watch.onAbort, { once: true });
        this.statementWatches.set(client, watch);
    }

    private async unwatchStatement(client: PgClient): Promise<void> {
        const watch: StatementWatch | undefined = this.statementWatches.get(client);
        if (watch == undefined || --watch.statements > 0) {
            return;
        }
        this.statementWatches.delete(client);
        watch.signal.removeEventListener('abort', watch.onAbort);
        // a failed cancel is not this statement's failure to report: it has either stopped or finished
        await watch.cancelling?.catch(() => undefined);
    }

    /**
     * Asks the server a connection was opened to, or the pooler in front of it, to stop the statement
     * the connection is running. Refused quietly when the connection has no backend to name.
     * @param client - The connection running the statement.
     */
    private async cancelStatementOn(client: PgClient): Promise<void> {
        if (client.processID == undefined || client.secretKey == undefined) {
            return;
        }
        await sendPostgresCancelRequest({
            host: client.connectionParameters.host,
            port: client.connectionParameters.port,
            processId: client.processID,
            secretKey: client.secretKey
        });
    }

    /**
     * Gives the statements on a connection the given time limit, until the returned function puts back
     * the one they had. Inside a transaction the limit holds for the transaction at most, so a
     * connection that goes back to the pool never carries it to somebody else's statements.
     * @param client - The connection.
     * @param timeoutInMs - The limit.
     * @param inTransaction - Whether the connection holds a transaction.
     * @param pooled - Whether the connection is one of the pool's, rather than a session of its own.
     * @returns What puts the limit back.
     */
    private async limitStatementsOn(
        client: PgClient,
        timeoutInMs: number,
        inTransaction: boolean,
        pooled: boolean
    ): Promise<() => Promise<void>> {
        const value: string = String(timeoutInMs);
        if (!inTransaction && pooled && this.transactionPooler != undefined) {
            // what is set outside a transaction stays with the server connection the pooler picked for
            // that one statement. A transaction of its own keeps the limit and the statements together,
            // and ends both with it - committed, so a statement that wrote stays written
            await this.runOn(client, 'BEGIN', []);
            await this.runOn(client, SET_LOCAL_STATEMENT_TIMEOUT_SQL, [value]);
            return async () => {
                await this.runOn(client, 'COMMIT', []);
            };
        }
        if (!inTransaction) {
            await this.runOn(client, 'SELECT set_config(\'statement_timeout\', $1, false)', [value]);
            // back to what the connection started with, which is this data source's own timeout
            return async () => {
                await this.runOn(client, 'RESET statement_timeout', []);
            };
        }
        // read rather than reset, because the transaction may itself have been begun under a limit
        const [previous] = await this.runOn(client, 'SELECT current_setting(\'statement_timeout\') AS timeout', []);
        // current_setting is text
        const previousTimeout: unknown = previous?.['timeout'];
        await this.runOn(client, SET_LOCAL_STATEMENT_TIMEOUT_SQL, [value]);
        return async () => {
            await this.runOn(client, SET_LOCAL_STATEMENT_TIMEOUT_SQL, [typeof previousTimeout === 'string' ? previousTimeout : value]);
        };
    }

    private async whileLimited<R>(
        client: PgClient,
        limit: OperationLimit,
        inTransaction: boolean,
        pooled: boolean,
        work: () => Promise<R>
    ): Promise<R> {
        const restore: () => Promise<void> = await this.limitStatementsOn(client, limit.timeoutInMs, inTransaction, pooled);
        let failed: boolean = false;
        try {
            return await work();
        }
        catch (error) {
            failed = true;
            throw error;
        }
        finally {
            // a failed statement inside a transaction leaves nothing to put back into: the transaction
            // refuses every statement until it is rolled back, which takes the limit with it
            await (failed ? restore().catch(() => undefined) : restore());
        }
    }

    /**
     * Takes a connection from the pool, and stops waiting for one once the request or the work this
     * runs in has run out of time.
     * @returns The connection.
     * @throws What the request or the work was abandoned with, when that comes first.
     */
    private async connectFromPool(): Promise<PgPoolClient> {
        if (!this.pool) {
            throw new DataSourceInitializationError();
        }
        const connecting: Promise<PgPoolClient> = this.pool.connect();
        try {
            return await PromiseUtilities.withSignal(connecting, AlsUtilities.findCurrentSignal());
        }
        catch (error) {
            // the pool still hands a connection over once one comes free, and nobody is waiting for it
            // eslint-disable-next-line promise/prefer-await-to-then
            void connecting.then(client => client.release(), () => undefined);
            throw error;
        }
    }

    /**
     * Binds running a statement to a transaction, or to a connection of the pool per statement.
     * @param transaction - The transaction, if there is one.
     * @returns What runs a statement.
     */
    private bindRun(transaction: Transaction | undefined): PostgresRun {
        // positional already, so handed over as it is: turning the placeholders into named ones and
        // back would take a `$1` inside a literal, such as a default the DDL writes, for one of them
        return async (sql, values = []) => await this.runPositional({ sql, values }, transaction, undefined);
    }

    /**
     * Runs work on a connection that keeps what is set on it until the work is done: a connection of the
     * pool, unless the pool is a transaction pooler's, behind which the work gets a session of its own.
     * @param work - The work, given what runs a statement on the connection.
     * @returns What the work returned.
     */
    private async onSession<T>(work: (run: PostgresRun, client: PgClient, pooled: boolean) => Promise<T>): Promise<T> {
        if (this.transactionPooler == undefined) {
            const client: PgPoolClient = await this.connectFromPool();
            try {
                return await work(async (sql, values = []) => await this.runOn(client, sql, values), client, true);
            }
            finally {
                client.release();
            }
        }
        const session: PgSessionClient = await this.openSession();
        try {
            return await work(async (sql, values = []) => await this.runOn(session, sql, values), session, false);
        }
        finally {
            await session.end();
        }
    }

    /**
     * Opens a connection to the server that is a session of its own, outside the pool, which the caller
     * ends once done with it. Behind a transaction pooler it goes to the server directly, because what
     * it is for - a lock held for a while, a channel listened on, a setting kept across statements -
     * belongs to one server connection.
     * @returns The connection, open.
     */
    private async openSession(): Promise<PgSessionClient> {
        const pg: Pg = optionalPeer<Pg>('pg', 'Talking to postgres');
        const session: PgSessionClient = new pg.Client(
            this.resolveConnectionConfig({ ...this.options, ...this.transactionPooler?.direct }, false)
        );
        // a connection the server ends while it waits between statements says so as an event, which
        // nothing listening for it turns into a crash of the process. Whoever uses it learns from the
        // next statement failing
        session.on('error', error => this.logger.error(new InternalError('A postgres session connection failed.', { cause: error })));
        await session.connect();
        return session;
    }

    /**
     * The connection settings the driver is given.
     *
     * The connection asks for the statement timeout and the similarity a search is answered from, so
     * that they are this data source's rather than whatever the server was configured with - in the
     * startup settings, appended to whatever the options ask for. Behind a transaction pooler neither
     * travels: the pooler refuses startup settings, and a connection carries what its role carries,
     * see {@link resolveRoleSettingsSql}.
     * @param options - Where and how to connect.
     * @param pooled - Whether the settings are for the pool, rather than for a session of its own.
     * @returns The settings.
     */
    protected resolveConnectionConfig(options: PostgresOptions, pooled: boolean): Record<string, unknown> {
        const extra: Record<string, unknown> = { ...options.extra };
        const startup: string[] = typeof extra['options'] === 'string' ? [extra['options']] : [];
        const behindTransactionPooler: boolean = pooled && this.transactionPooler != undefined;
        if (!behindTransactionPooler) {
            startup.push(
                `-c pg_trgm.similarity_threshold=${this.searchesFromSimilarity / 100}`,
                `-c statement_timeout=${this.statementTimeoutInMs}`
            );
            if (options.schema != undefined) {
                startup.push(`-c search_path=${options.schema.replaceAll(/([\s\\])/g, '\\$1')}`);
            }
        }
        return {
            host: options.host,
            port: options.port,
            user: options.username,
            password: options.password,
            database: options.database,
            ssl: options.ssl,

            application_name: options.applicationName,
            // per process, and a deployment is many processes: what the database sees is this times the
            // number of replicas. Twenty is what one instance can keep genuinely busy; a deployment that
            // outgrows it wants a pooler in front rather than a bigger number here
            max: pooled ? options.poolSize ?? 20 : 1,
            // how long a call waits for a connection before it fails, rather than forever behind a pool
            // held by something stuck
            connectionTimeoutMillis: options.connectTimeoutInMs ?? 30000,
            ...extra,
            types: pgTypeParsers(),
            ...startup.length ? { options: startup.join(' ') } : {}
        };
    }

    private resolveMaxBoundValues(): number {
        // the wire protocol counts a statement's values in sixteen bits
        return this.options.maxBoundValuesPerStatement ?? 65535;
    }

    /**
     * The pooler handing out a server connection per transaction, when this data source is behind one.
     * @returns The pooler, or undefined when every connection is a session of its own.
     */
    private get transactionPooler(): PostgresTransactionPooler | undefined {
        return typeof this.pooler === 'object' ? this.pooler : undefined;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected async schemaLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
        // a session of its own, outside the pool, and closed once the setup is done: holding a pooled
        // one for the whole setup left a pool of one with nothing for the migrations to run on, and what
        // the lock sets on its session would have gone back to the pool with it
        const session: PgSessionClient = await this.openSession();
        try {
            await this.acquireAdvisoryLock(session, key);
            try {
                return await fn();
            }
            finally {
                await this.runOn(session, `SELECT pg_advisory_unlock(${ADVISORY_LOCK_ID_SQL})`, [key]);
            }
        }
        finally {
            // closing the session also lets go of the lock, should the unlock above not have run
            await session.end();
        }
    }

    /**
     * Takes an advisory lock on a session, asking for it until it is free or waiting stops being
     * reasonable.
     * @param session - The session that holds the lock once it is taken.
     * @param key - What to lock.
     * @throws When the lock was not free within the schema lock timeout: another instance is still
     * holding it.
     */
    private async acquireAdvisoryLock(session: PgSessionClient, key: string): Promise<void> {
        // asked for again rather than waited for in one statement: a statement holds a snapshot for as
        // long as it waits, and an index built concurrently waits for every older snapshot to be gone.
        // The instance holding the lock builds those, so it waited for the instances waiting for it,
        // which postgres does not see as a deadlock - the instance holding it waits in the application
        const timeoutInMs: number = inject(ZIBRI_DI_TOKENS.SCHEMA_LOCK_TIMEOUT_IN_MS);
        const deadline: number = Date.now() + timeoutInMs;
        for (;;) {
            // within the schema, since that is what the setup guards: advisory locks are one per
            // database, and an application in a schema of its own waited for every other one setting
            // its schema up. A schema the role cannot use is none, which only serializes more
            const [row] = await this.runOn(session, `SELECT pg_try_advisory_lock(${ADVISORY_LOCK_ID_SQL}) AS "taken"`, [key]);
            if (row?.['taken'] === true) {
                return;
            }
            if (Date.now() > deadline) {
                throw new InternalError(
                    `Could not acquire the lock "${key}" within ${timeoutInMs}ms - another instance is still holding it`
                );
            }
            await sleep(SCHEMA_LOCK_RETRY_IN_MS);
        }
    }

    private toPostgresTransaction(transaction: Transaction | undefined): PostgresTransaction {
        if (!(transaction instanceof PostgresTransaction)) {
            throw new InternalError('The provided transaction does not belong to a postgres data source.');
        }
        // its connection went back to the pool as it ended, and a statement sent on it now would run
        // on whatever somebody else took it for
        if (transaction.isFinished) {
            throw new TransactionAlreadyFinishedError();
        }
        return transaction;
    }

    private getSchema(): PostgresSchema {
        if (!this.schema) {
            throw new DataSourceInitializationError();
        }
        return this.schema;
    }

    private getConverter(): PostgresWhereFilterConverter {
        if (!this.converter) {
            throw new DataSourceInitializationError();
        }
        return this.converter;
    }

    private getManager(): PostgresSchemaManager {
        if (!this.manager) {
            throw new DataSourceInitializationError();
        }
        return this.manager;
    }

    // ── migrations ──────────────────────────────────────────────

    // eslint-disable-next-line jsdoc/require-jsdoc
    async runMigrations(): Promise<void> {
        await this.createMigrationTableIfNotExists();
        await runMigrations(this.constructor as Newable<DataSourceInterface>, this.migrations, this.logger);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async revertMigrationsAfter(target: MigrationRevertTarget): Promise<void> {
        await this.createMigrationTableIfNotExists();
        await revertMigrationsAfter(this.constructor as Newable<DataSourceInterface>, this.migrations, this.logger, target);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async addPropertyToEntity<T extends BaseEntity>({ entity, property, transaction }: AddPropertyToEntityInput<T>): Promise<void> {
        await this.getManager().addProperty(
            this.bindRun(transaction),
            MigratedEntityUtilities.resolveTableName(entity),
            String(property.name),
            property
        );
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async changePropertyOfEntity<T extends BaseEntity, C extends MigrationPropertyMetadata, M extends MigrationPropertyMetadata>(
        input: ChangePropertyOfEntityInput<T, C, M>
    ): Promise<void> {
        await this.getManager().changeProperty(
            this.bindRun(input.transaction),
            MigratedEntityUtilities.resolveTableName(input.entity),
            ValueConversionUtilities.resolveConversion(input),
            input.currentProperty,
            input.property
        );
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async removePropertyFromEntity<T extends BaseEntity>(input: RemovePropertyFromEntityInput<T>): Promise<void> {
        await this.getManager().removeProperty(
            this.bindRun(input.transaction),
            MigratedEntityUtilities.resolveTableName(input.entity),
            String(input.propertyKey)
        );
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async renameEntity<T extends BaseEntity>({ entity, currentTableName, transaction }: RenameEntityInput<T>): Promise<void> {
        await this.getManager().renameEntity(
            this.bindRun(transaction),
            MigratedEntityUtilities.resolveMovedEntity(entity, currentTableName, this.entities),
            currentTableName
        );
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async mergeEntity<T extends BaseEntity>({ entity, currentTableName, transaction }: MergeEntityInput<T>): Promise<void> {
        await this.getManager().mergeEntity(
            this.bindRun(transaction),
            MigratedEntityUtilities.resolveMovedEntity(entity, currentTableName, this.entities),
            currentTableName
        );
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async createEntity<T extends BaseEntity>({ entity, transaction, properties }: CreateEntityInput<T>): Promise<void> {
        await this.getManager().createEntity(
            this.bindRun(transaction),
            MigratedEntityUtilities.resolveEntityClass(entity, this.entities),
            properties
        );
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async removeRelationFromEntity<T extends BaseEntity>(
        { entity, relation, transaction }: RemoveRelationFromEntityInput<T>
    ): Promise<void> {
        await this.getManager().removeJoinTable(
            this.bindRun(transaction),
            MigratedEntityUtilities.resolveTableName(entity),
            String(relation.name),
            MigratedEntityUtilities.resolveTableName(relation.target),
            relation.inverseSide
        );
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async removeEntity<T extends BaseEntity>({ entity, transaction }: RemoveEntityInput<T>): Promise<void> {
        await this.getManager().removeEntity(this.bindRun(transaction), MigratedEntityUtilities.resolveTableName(entity));
    }

    /**
     * Creates the table the migrations are recorded in, when it is not there yet, with the uniques it
     * declares: the migrations run before anything else keeps them.
     */
    private async createMigrationTableIfNotExists(): Promise<void> {
        const schema: PostgresSchema = this.entities.includes(MigrationEntity)
            ? this.getSchema()
            : new PostgresSchema([MigrationEntity], this.columnSettings);
        const table: PostgresTable = schema.getTable(MigrationEntity);
        // the uniques it declares over every row are created with it, under the names the schema keeps
        // them by - columns alone would leave out every constraint the entity declares
        const uniques: PostgresKey[] = keyGroupsOf(MigrationEntity).uniques
            .filter(u => coversEveryRow(u.where))
            .map(u => ({
                name: uniqueConstraintName(table.name, u.properties),
                columns: u.properties.map(p => schema.getColumn(MigrationEntity, p).name)
            }));
        await this.onSession(async (run, client, pooled) => {
            // outside a transaction, so nothing else gives this connection the schema setup's limit
            const limit: OperationLimit | undefined = AlsUtilities.findCurrentOperationLimit();
            const restore: (() => Promise<void>) | undefined = limit == undefined
                ? undefined
                : await this.limitStatementsOn(client, limit.timeoutInMs, false, pooled);
            try {
                // with everything it declares when it is one of the entities, which reconciling the keys
                // would otherwise build later, concurrently. When it is not, nothing reconciles its keys
                // and it gets the uniques the migrations rely on
                await (this.entities.includes(MigrationEntity)
                    ? this.getManager().createEntityTableIfNotExists(run, MigrationEntity)
                    : this.getManager().createTable(run, { ...table, uniques: [...table.uniques, ...uniques] }, true));
            }
            finally {
                await restore?.();
            }
        });
    }

    // ── backups ─────────────────────────────────────────────────

    /**
     * Replaces what this data source stores with a backup of it, and brings what the backup holds in
     * line with this version of the app: every migration the backup has not recorded runs, and the
     * indexes and uniques are made to match what the entities declare, before the restore is done.
     * @param backupData - The data BackupResourceInterface.createBackupData produced.
     * @throws When the backup was taken by a newer version of the app, when a migration fails, or when
     * the restored rows break a declared unique or check.
     */
    async restoreBackup(backupData: Readable): Promise<void> {
        // the whole of it under the lock, so that an instance starting meanwhile neither migrates the
        // schema while it is replaced nor finds it replaced and not yet migrated
        await this.schemaLock(SCHEMA_LOCK_KEY, async () => {
            await this.resolveBackupRunner().applyBackup(backupData);
            // under the migration timeout, as booting is, and only once the backup is in place
            await OperationLimitUtilities.runWithin(
                this.migrationTimeoutInMs,
                `Setting up the restored schema of "${this.constructor.name}"`,
                async () => {
                    await this.createMigrationTableIfNotExists();
                    await runMigrationsAfterRestore(this.constructor as Newable<DataSourceInterface>, this.migrations, this.logger);
                    await this.reconcileSchema();
                }
            );
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async validateBackupConfiguration(): Promise<void> {
        await this.resolveBackupRunner().validateConfiguration();
    }

    /**
     * Dumps the schema this data source works in, or only the tables of its entities in it when
     * {@link backupScope} says so, and nothing else on the server: not other schemas, which are
     * another application's tables; not roles, whose password verifiers a backup artifact must not
     * carry; not other databases; and no `\connect`, which would ignore the target it is restored into.
     *
     * The result carries no `DROP` of any kind: removing what is already there is the restore's job and
     * is scoped there. Who owns each of the schema's objects, and the grants and comments on them, are
     * part of it. Written as an archive, so that a restore can leave out what the schema itself
     * carries, which belongs to whoever owns the schema.
     * @returns A stream of the dump, which fails when the dump fails.
     */
    async createBackupData(): Promise<Readable> {
        return await this.resolveBackupRunner().createBackupData();
    }

    /**
     * Resolves what makes and restores the backups of this data source, built on first use.
     * @returns The runner.
     */
    private resolveBackupRunner(): PostgresBackupRunner {
        this.backupRunner ??= new PostgresBackupRunner(this, () => this.getSchema());
        return this.backupRunner;
    }

    // ── publishing ──────────────────────────────────────────────

    // eslint-disable-next-line jsdoc/require-jsdoc
    async publish(channel: string, message: string): Promise<void> {
        const bytes: number = Buffer.byteLength(message);
        if (bytes > MAX_NOTIFY_PAYLOAD_BYTES) {
            throw new InternalError(
                `Cannot publish a message of ${bytes} bytes on "${channel}": postgres carries at most ${MAX_NOTIFY_PAYLOAD_BYTES}.`
            );
        }
        // outside any transaction, so it is delivered now rather than with a commit
        await this.runStatement({
            sql: 'SELECT pg_notify(:channel, :message)',
            parameters: { channel: this.resolveChannelName(channel), message }
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async subscribe(channel: string, onMessage: (message: string) => void): Promise<DataSourceSubscription> {
        this.notificationListener ??= new PostgresNotificationListener(async () => await this.obtainListeningConnection(), this.logger);
        return await this.notificationListener.subscribe(this.resolveChannelName(channel), onMessage);
    }

    /**
     * Takes a connection out of the pool to listen on, or behind a transaction pooler, a session of its
     * own: a channel is listened on by one server connection, which the pooler would hand to somebody
     * else after the statement that started listening.
     * @returns The connection, and how to hand it back.
     */
    private async obtainListeningConnection(): Promise<ListeningConnection> {
        if (this.transactionPooler == undefined) {
            const client: PgPoolClient = await this.connectFromPool();
            return {
                client,
                release: async () => {
                    client.release();
                    await Promise.resolve();
                }
            };
        }
        // one per time the listener connects, and ended with it: the listener connects again only after
        // the one it had failed, and the session that failed is no use to listen on (round-2 02 §S3)
        const session: PgSessionClient = await this.openSession();
        return { client: session, release: async () => await session.end() };
    }

    /**
     * The name a channel has on this server: under the schema when the data source names one, so two
     * applications sharing a database in schemas of their own do not hear each other.
     * @param channel - The channel.
     * @returns The name.
     * @throws When the name is longer than postgres keeps.
     */
    private resolveChannelName(channel: string): string {
        const name: string = this.options.schema == undefined ? channel : `${this.options.schema}.${channel}`;
        if (Buffer.byteLength(name) > MAX_IDENTIFIER_BYTES) {
            throw new InternalError(`The channel "${name}" is longer than the ${MAX_IDENTIFIER_BYTES} bytes postgres keeps of a name.`);
        }
        return name;
    }

    // ── what the server can do ──────────────────────────────────

    /**
     * Resolves the statements that give the role this data source connects as the settings it asks its
     * connections for. Behind a transaction pooler a connection carries what its role carries, so these
     * are run once, by the role itself or by anybody allowed to alter it.
     * @returns The statements.
     */
    resolveRoleSettingsSql(): string[] {
        const username: string | undefined = this.transactionPooler?.direct.username ?? this.options.username;
        const role: string = username == undefined ? 'CURRENT_USER' : PostgresSqlUtilities.escapeIdentifier(username);
        return [
            `ALTER ROLE ${role} SET statement_timeout = ${this.statementTimeoutInMs}`,
            `ALTER ROLE ${role} SET pg_trgm.similarity_threshold = ${this.searchesFromSimilarity / 100}`
        ];
    }

    /**
     * Refuses a postgres that cannot order text the way the rest of the application does: without the
     * collation the first `CREATE TABLE` fails with a message that says nothing about where the name
     * came from, and there is no second-best order to fall back to.
     * @param run - Runs a statement.
     * @throws When the collation of the application's default locale is not one this server has.
     */
    private async validateTextCollation(run: PostgresRun): Promise<void> {
        const collation: string = this.textCollation;
        if ((await run('SELECT 1 FROM pg_collation WHERE collname = $1', [collation])).length) {
            return;
        }
        throw new InternalError([
            `The postgres server has no collation "${collation}", so it cannot order text the way this application does.`,
            'Its text columns are created with the collation of the default locale of'
            + ' ZIBRI_DI_TOKENS.LOCALIZE_OPTIONS, and postgres creates one per icu locale when it is built with icu.',
            'Either use a server built with icu, or set a default locale whose collation this one has.'
        ]);
    }

    /**
     * Makes `fuzzyLike` usable, without making the right to install an extension a condition of booting.
     * Missing and not creatable is reported rather than raised: every other feature works without it.
     * @param run - Runs a statement.
     */
    private async installTrigramExtension(run: PostgresRun): Promise<void> {
        // no pg_extension lookup first: postgres answers IF NOT EXISTS for an installed extension before
        // it asks whether the role may create one, so a managed postgres that provisioned it for a role
        // with no rights boots on this statement alone
        try {
            await run('CREATE EXTENSION IF NOT EXISTS pg_trgm');
        }
        catch (error) {
            this.logger.warn(
                'Could not install the postgres extension "pg_trgm", so the "fuzzyLike" filter will not work'
                + ' on this data source. Ask a role that may create extensions to run'
                + ' "CREATE EXTENSION pg_trgm" once. Everything else works without it.',
                { error }
            );
        }
    }

    /**
     * Measures what this server's trigram operator answers, which decides which searches an index can
     * serve: `a % b` asks for the server's threshold, and postgres documents the operator as greater
     * than it and implements it as greater or equal. Measured rather than read from either, inside a
     * transaction that is rolled back, so the setting cannot outlive the probe on a pooled connection.
     * @returns What the operator answers for, with no threshold at all when pg_trgm is absent.
     */
    private async measureTrigramSupport(): Promise<TrigramSupport> {
        const absent: TrigramSupport = { threshold: undefined, thresholdIsInclusive: false };
        try {
            return await this.onSession(async run => {
                const [setting] = await run('SELECT current_setting($1) AS threshold', ['pg_trgm.similarity_threshold']);
                const threshold: number = Number(setting?.['threshold']);
                if (Number.isNaN(threshold)) {
                    return absent;
                }
                await run('BEGIN');
                try {
                    await run('SET LOCAL pg_trgm.similarity_threshold = 1');
                    const [probe] = await run('SELECT ($1 % $1) AS inclusive', ['zibri']);
                    return { threshold, thresholdIsInclusive: probe?.['inclusive'] === true };
                }
                finally {
                    await run('ROLLBACK');
                }
            });
        }
        catch {
            // the setting and the operator both come from the extension, so anything unanswerable here
            // means it is not installed - which installTrigramExtension has already reported
            return absent;
        }
    }

    /**
     * Refuses connections that do not have the statement timeout and the search similarity this data
     * source asks for: something between it and the server can drop the startup settings, and behind a
     * transaction pooler they are the role's, which nobody may have set yet.
     * @param run - Runs a statement.
     * @throws {InternalError} When a connection reports another value than the one asked for.
     */
    private async validateConnectionSettings(run: PostgresRun): Promise<void> {
        const [row] = await run('SELECT setting FROM pg_settings WHERE name = \'statement_timeout\'');
        const statementTimeoutInMs: number = Number(row?.['setting']);
        const similarity: number = this.searchesFromSimilarity / 100;
        const threshold: number | undefined = this.trigramSupport.threshold;
        if (statementTimeoutInMs === this.statementTimeoutInMs && (threshold == undefined || threshold === similarity)) {
            return;
        }
        const reported: string = `a statement timeout of ${statementTimeoutInMs} ms and a search similarity of ${threshold ?? 'none'}`;
        const asked: string = `a statement timeout of ${this.statementTimeoutInMs} ms and a search similarity of ${similarity}`;
        throw new InternalError(this.transactionPooler == undefined
            ? [
                `The data source "${this.constructor.name}" asks its connections for ${asked}, and they report ${reported}.`,
                'Something between it and the server drops the settings a connection starts with. A pooler in transaction mode is'
                + ' declared with "pooler: { mode: \'transaction\', direct }".'
            ]
            : [
                `The data source "${this.constructor.name}" is behind a transaction pooler, where a connection carries what its role`
                + ` carries. It asks for ${asked}, and its connections report ${reported}.`,
                `Run, once: ${this.resolveRoleSettingsSql().join('; ')}. Connections the pooler opened before keep what they had until`
                + ' they are opened again.'
            ]);
    }

    /**
     * Reports a database whose character type counts only ascii as a letter: the trigram extension then
     * reads "müller" as the words "m" and "ller", where every store that compares in process reads one.
     * @param run - Runs a statement.
     */
    private async warnAboutAsciiOnlyWords(run: PostgresRun): Promise<void> {
        if (this.trigramSupport.threshold == undefined) {
            return;
        }
        const [row] = await run(
            'SELECT similarity($1, $1) AS similarity, datctype AS ctype FROM pg_database WHERE datname = current_database()',
            ['ü']
        );
        if (row == undefined || Number(row['similarity']) === 1) {
            return;
        }
        this.logger.warn(
            `This database's character type is "${String(row['ctype'])}", which counts only ascii as a letter. A "fuzzyLike"`
            + ' and an order by similarity read "müller" as the words "m" and "ller" here and as one word on'
            + ' every other data source, so the two can find different rows. Create the database with a utf-8'
            + ' character type, such as "en_US.utf8", to have them agree.'
        );
    }

    /**
     * Refuses a postgres data source that cannot open a cursor. `pg-query-stream` is an optional peer
     * because a peer that is not optional is installed by every consumer of the framework, and declaring
     * this data source is declaring postgres, `stream` included. Resolved rather than loaded, so an
     * application that never streams does not pay to load it.
     * @throws When the package is not installed.
     */
    private validateQueryStream(): void {
        if (hasOptionalPeer('pg-query-stream')) {
            return;
        }
        throw new InternalError([
            `The data source "${this.constructor.name}" needs the optional peer dependency "pg-query-stream",`
            + ' which is not installed. It is what a cursor is opened through, so without it `stream()` cannot read a'
            + ' table that does not fit in memory.',
            'Run "npm i pg-query-stream" to fix it.'
        ]);
    }
}