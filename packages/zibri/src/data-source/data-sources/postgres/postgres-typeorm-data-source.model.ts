import { ChildProcess, ChildProcessByStdio, spawn } from 'node:child_process';
import { PassThrough, Readable, Writable } from 'node:stream';

import { EntitySchemaColumnOptions, EntitySchemaIndexOptions, EntitySchemaRelationOptions, ColumnType, FindOperator, QueryBuilder, QueryRunner, TableColumn, ValueTransformer, DataSource as TODataSource, EntityMetadata as TOEntityMetadata, QueryFailedError as TOQueryFailedError } from 'typeorm';
import { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';
import { OnDeleteType } from 'typeorm/metadata/types/OnDeleteType.js';
import { OnUpdateType } from 'typeorm/metadata/types/OnUpdateType.js';

import { pgTypeParsers } from './pg-type-parsers.function';
import { PostgresColumnSql } from './postgres-column-sql.model';
import { PostgresValueConversionUtilities } from './postgres-value-conversion.utilities';
import { type AuthServiceInterface } from '../../../auth/auth-service.interface';
import { Inject } from '../../../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { BaseEntity } from '../../../entity/base-entity.model';
import { PropertyMetadata, RelationMetadata } from '../../../entity/decorators/property.decorator';
import { ArrayPropertyItemMetadata, ArrayPropertyMetadata } from '../../../entity/models/array-property-metadata.model';
import { isRelationMetadata } from '../../../entity/models/is-relation-metadata.function';
import { NumberFormat } from '../../../entity/models/number-property-metadata.model';
import { Relation } from '../../../entity/models/relation.enum';
import { coversEveryRow } from '../../../entity/models/unique-declaration.model';
import { InternalError } from '../../../error-handling/internal-error.model';
import { KeyGroups, keyGroupsOf } from '../../../global/model-registry/key-descriptor';
import { type LoggerInterface } from '../../../logging/logger.interface';
import { parseArray } from '../../../parsing/functions/parse-array.function';
import { parseObject } from '../../../parsing/functions/parse-object.function';
import { parseOneOf } from '../../../parsing/functions/parse-one-of.function';
import { toJsonValue } from '../../../parsing/functions/to-json-value.function';
import { ExcludeStrict } from '../../../types/exclude-strict.type';
import { Newable } from '../../../types/newable.type';
import { OmitStrict } from '../../../types/omit-strict.type';
import { MetadataUtilities } from '../../../utilities/metadata.utilities';
import { BigNumber } from '../../../utilities/number.utilities';
import { ObjectUtilities } from '../../../utilities/object.utilities';
import { hasOptionalPeer } from '../../../utilities/optional-peer.function';
import { PromiseUtilities } from '../../../utilities/promise.utilities';
import { readNumber } from '../../../utilities/read-number.function';
import { TypeOrmUtilities } from '../../../utilities/typeorm.utilities';
import { indexName, trigramIndexName, TRIGRAM_INDEX_PREFIX } from '../../index-name.function';
import { DataSourceOptions, ResolvedDataSourceOptions } from '../../models/data-source-options.model';
import { RefusedValue } from '../../models/refused-value.model';
import { ResolvedPropertyConversion } from '../../models/resolved-property-conversion.model';
import { DEFAULT_MIN_SIMILARITY, MinSimilarity } from '../../models/where/fuzzy-like.model';
import { FuzzySearchUtilities } from '../../models/where/fuzzy-search.utilities';
import { AnyNumber } from '../../models/where/number-where-filter.model';
import { MistypedStoredValue } from '../../stored-value-type-mismatch.error';
import { Transaction } from '../../transaction/transaction.model';
import { uniqueConstraintName } from '../../unique-constraint-name.function';
import { keyWhereToSql } from '../../where/key-where-to-sql.function';
import { DataSourceInitializationError } from '../data-source-initialization.error';
import { StartTransactionOptions } from '../data-source.interface';
import { QueryOptions, SqlDataSourceInterface } from '../sql-data-source.interface';
import { MergedRows, UpsertInput, UpsertSql, TypeOrmBaseDataSource, ToColumnMappableTypes } from '../typeorm-base-data-source.model';
import { PostgresTypeOrmWhereFilterConverter, TrigramSupport } from '../where-converter/postgres-typeorm-where-filter.converter';

/**
 * The postgres specific connection options of a data source.
 *
 * Typeorm's `synchronize` is deliberately not among them: whether the framework alters the schema is
 * said once, as `schemaManagement` on the data source, so there is no second place that can disagree
 * with it.
 */
export type PostgresOptions = OmitStrict<PostgresConnectionOptions, 'synchronize' | 'extra' | 'ssl'>
    & Pick<DataSourceOptions, 'maxBoundValuesPerStatement'>
    & {
        /**
         * Settings handed to the connection pool as they are, for what the driver accepts and typeorm
         * has no option of its own for.
         */
        extra?: Record<string, unknown>,
        /**
         * Whether the connection uses tls.
         *
         * `true` encrypts it and verifies the server's certificate against the system's certificate
         * authorities, an object passes node's tls options for anything else, such as your own ca or
         * a client certificate, and `false` connects unencrypted.
         *
         * The `PGSSLMODE` environment variable does not apply to the connection. It applies to the
         * client tools a backup runs, which use `require` when this is set and `disable` when it is
         * `false` while the environment names no mode.
         */
        ssl: NonNullable<PostgresConnectionOptions['ssl']>
    };

/**
 * How long a transaction may sit idle before postgres ends it, when it does not say for itself.
 *
 * What sets the floor is the longest gap between two statements of one transaction. The save hooks
 * run in that gap and hashing and encryption are the slow part of them, so a batch of rows encrypted
 * one by one can hold it for a moment, where an ordinary gap is a few hundred milliseconds at most.
 * This leaves an order of magnitude over that, and a transaction that knows it will wait longer
 * between two of its statements says so when it starts.
 */
const DEFAULT_TRANSACTION_IDLE_TIMEOUT_IN_MS: number = 10000;

/**
 * What a query runner holds once it has a connection.
 *
 * Written down here because typeorm's own `QueryRunner` does not declare it, and narrowed to the
 * one field this needs: the id of the server process on the other end, which is the only thing a
 * statement can be named by from outside the connection running it.
 */
type ConnectedQueryRunner = {
    /**
     * The connection, once the runner has one.
     */
    databaseConnection?: {
        /**
         * The id of the server process this connection is talking to.
         */
        processID?: number
    }
};

const DUMP_COMMAND: string = 'pg_dump';
const RESTORE_COMMAND: string = 'psql';
const DEFAULT_PORT: number = 5432;

/**
 * The sql state postgres reports a unique violation under.
 */
const UNIQUE_VIOLATION_SQL_STATE: string = '23505';

/**
 * The sql states postgres reports a value it could not read as the requested type under.
 *
 * Three of them because the datetime types answer separately from everything else, and separately
 * again for a value that parses but names no moment - "2020-13-45" is a different complaint than
 * "not a date" and the same problem to whoever wrote the row.
 */
const UNREADABLE_VALUE_SQL_STATES: string[] = ['22P02', '22007', '22008'];

/**
 * Finds the marker the where converter writes beside a cast, and what it says.
 */
const CAST_MARKER_PATTERN: RegExp = /\/\* zibri-json:(?<path>.+?):(?<type>number|date|boolean) \*\//g;

/**
 * Reads the value out of the complaint postgres made about it.
 *
 * Both shapes it uses quote the value last, which is the only part of the message worth repeating:
 * the type it failed to read as is already known from the marker, and said better there.
 */
const UNREADABLE_VALUE_PATTERN: RegExp = /"(?<value>[^"]*)"\s*$/;

/**
 * The declared type behind the column type postgres named in a complaint.
 *
 * Only used to choose between markers when a statement carries more than one cast, so not naming a
 * type is an answer here rather than a problem: the datetime states describe a value that parsed and
 * then said nothing sensible, and name no type while doing it.
 * @param message - The message the query failed with.
 * @returns The declared type, or undefined when the message names none.
 */
function declaredTypeOf(message: string): string | undefined {
    if (message.includes('for type numeric')) {
        return 'number';
    }
    if (message.includes('for type boolean')) {
        return 'boolean';
    }
    return message.includes('for type timestamp') ? 'date' : undefined;
}

/**
 * Clears the tables a dump is about to recreate, as the first statement of the restore.
 *
 * This is what `pg_dump --clean` would otherwise do, and the reason it does not: `--clean` drops
 * every object it dumped, and asking it for a schema makes the schema one of them. `DROP SCHEMA`
 * fails whenever an extension lives there, which is always - and it would be wrong even if it
 * succeeded, since the dumped tables default their ids to `uuid_generate_v4()`, an extension object
 * the schema would take with it. Dropping the schema an application stores its tables in is the same
 * over-reach as dumping the cluster an application stores its database in.
 *
 * Every ordinary table in the database and no other object kind, which is exactly what a dump of it
 * recreates. Tables belonging to an extension are left alone: they are recreated by the extension
 * rather than by the dump, and postgres refuses to drop them anyway.
 *
 * Runs inside psql's `--single-transaction`, so a restore that then fails takes the drops back with
 * it rather than leaving an empty database behind.
 */
const CLEAR_TABLES_SQL: string = `
DO $zibri$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT n.nspname AS schema_name, c.relname AS table_name
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind IN ('r', 'p')
            AND n.nspname NOT LIKE 'pg\\_%'
            AND n.nspname <> 'information_schema'
            AND NOT EXISTS (
                SELECT 1 FROM pg_catalog.pg_depend d
                WHERE d.objid = c.oid AND d.deptype = 'e'
            )
    LOOP
        EXECUTE format('DROP TABLE IF EXISTS %I.%I CASCADE', r.schema_name, r.table_name);
    END LOOP;
END
$zibri$;
`;

/**
 * Puts the clearing statement in front of the dump, as one stream.
 *
 * Prepended rather than run separately so that both halves are inside psql's single transaction.
 * Running the drops on the application's own connection first would commit them, and a restore that
 * then failed would have emptied the database instead of leaving it as it was.
 * @param backupData - The dump to restore.
 * @yields The clearing statement, then the dump.
 */
async function* withClearedTables(backupData: Readable): AsyncGenerator<string | Buffer> {
    yield CLEAR_TABLES_SQL;
    yield* backupData;
}

/**
 * Checks whether a postgres client tool can be started at all.
 *
 * `spawn` reports a missing binary as an `ENOENT` error event rather than by throwing, so asking it
 * to print its version is the whole check - it either starts or it does not.
 * @param command - The command to look for.
 * @returns True if the command could be started.
 */
async function commandExists(command: string): Promise<boolean> {
    return await new Promise<boolean>(resolve => {
        const child: ChildProcess = spawn(command, ['--version'], { stdio: 'ignore' });
        child.on('error', () => resolve(false));
        child.on('close', code => resolve(code === 0));
    });
}

/**
 * The similarity a connection searches from, as the server reports it.
 */
type SimilarityThresholdRow = {
    /**
     * The value of `pg_trgm.similarity_threshold`, as postgres writes every setting: text.
     */
    threshold: string
};

/**
 * Whether the trigram operator counts a similarity equal to its threshold as a match.
 */
type SimilarityProbeRow = {
    /**
     * What the operator answered about two values whose similarity is the threshold exactly.
     */
    inclusive: boolean
};

/**
 * A column that a trigram index covers.
 */
type TrigramIndexTarget = {
    /**
     * The table the index is on.
     */
    table: string,
    /**
     * The column whose trigrams it holds.
     */
    column: string
};

/**
 * Quotes a name for a statement.
 * @param name - The name of a table, a column or a collation.
 * @returns The name, quoted.
 */
function escapeIdentifier(name: string): string {
    return `"${name.replaceAll('"', '""')}"`;
}

/**
 * One index of a table, as postgres lists it.
 */
type IndexNameRow = {
    /**
     * The name the index was created with.
     */
    indexname: string
};

/**
 * One index of a table, as postgres lists it for keeping the declared ones.
 */
type StoredKeyRow = {
    /**
     * The name of the index, as postgres stores it.
     */
    name: string,
    /**
     * Whether it is complete. A concurrent build that failed leaves its index behind invalid.
     */
    valid: boolean,
    /**
     * Whether a unique constraint is enforced through it.
     */
    constraint: boolean
};

/**
 * The id of a row a merge moved, as text.
 */
type MovedRowId = {
    /**
     * The id.
     */
    id: string
};

/**
 * The sequence a primary column takes its values from.
 */
type SerialSequence = {
    /**
     * The name of the sequence, null when the column takes its values from none.
     */
    name: string | null
};

/**
 * Values more than one row holds, among the rows a unique covers.
 */
type DuplicateValuesRow = {
    /**
     * The values, as a json array.
     */
    values: string
};

/**
 * An index or unique an entity declares, as the statements that create it.
 */
type DeclaredKey = {
    /**
     * Its name.
     */
    name: string,
    /**
     * The properties it covers.
     */
    properties: string[],
    /**
     * Builds the index, concurrently.
     */
    build: string,
    /**
     * Makes a unique over every row a constraint, through the index once it is built.
     */
    constrain: string | undefined,
    /**
     * Finds values more than one row holds, for a unique.
     */
    duplicates: string | undefined
};

/**
 * Lists the indexes of a table in the current schema.
 */
const STORED_KEYS_SQL: string = `
    SELECT i.relname AS "name", x.indisvalid AS "valid", c.conname IS NOT NULL AS "constraint"
    FROM pg_index x
    JOIN pg_class i ON i.oid = x.indexrelid
    JOIN pg_class t ON t.oid = x.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    LEFT JOIN pg_constraint c ON c.conindid = x.indexrelid AND c.contype = 'u'
    WHERE n.nspname = current_schema() AND t.relname = $1
`;

/**
 * The longest name postgres keeps, in bytes. A longer one is cut to this when it is created.
 */
const MAX_IDENTIFIER_BYTES: number = 63;

/**
 * The name postgres stores for a given one.
 * @param name - The name.
 * @returns It, cut to what postgres keeps.
 */
function toStoredIdentifier(name: string): string {
    const bytes: Buffer = Buffer.from(name);
    return bytes.length <= MAX_IDENTIFIER_BYTES ? name : bytes.subarray(0, MAX_IDENTIFIER_BYTES).toString();
}

/**
 * A base postgres data source definition.
 */
export abstract class PostgresDataSource extends TypeOrmBaseDataSource<PostgresOptions> implements SqlDataSourceInterface {

    /**
     * The similarity from which this data source answers a search out of an index.
     *
     * The connection is told to use it, so it is the boundary rather than a guess about one: a
     * `fuzzyLike` asking for this or more is answered from the trigram index, and one asking for less
     * reads every row and says so. Lowering it puts looser searches on the index, and makes every
     * search that uses it match more rows before the similarity is checked.
     *
     * Not the similarity a filter asks for when the caller names none - that is
     * {@link DEFAULT_MIN_SIMILARITY} and belongs to the filter, so that one filter means one thing
     * whichever data source answers it.
     */
    protected readonly searchesFromSimilarity: MinSimilarity = DEFAULT_MIN_SIMILARITY;

    /**
     * What this server's trigram operator answers, as measured at boot.
     *
     * Kept, because it decides two things that have to agree: which searches are written so that an
     * index can serve them, and whether there is an operator class to create those indexes with at
     * all.
     */
    private trigramSupport: TrigramSupport = { threshold: undefined, thresholdIsInclusive: false };

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected whereFilterConverter: PostgresTypeOrmWhereFilterConverter | undefined;
    // eslint-disable-next-line jsdoc/require-jsdoc
    protected readonly type: 'postgres' = 'postgres';

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected readonly defaultColumnTypeMapping: Record<ToColumnMappableTypes, ColumnType> = {
        array: 'array',
        // what a javascript number is. A number property says which kind it holds and
        // `numberColumnType` answers for it; this is what the ones that name nothing else get
        number: 'double precision',
        string: 'varchar',
        object: 'jsonb',
        date: 'timestamptz',
        boolean: 'boolean',
        unknown: 'jsonb',
        file: 'bytea',
        oneOf: 'jsonb'
    };

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected readonly defaultOptions: ResolvedDataSourceOptions<Partial<OmitStrict<PostgresOptions, 'type' | 'entities'>>> = {
        // per process, and a deployment is many processes: what the database sees is this times the
        // number of replicas. Stock postgres accepts a hundred connections in total, so a default
        // generous enough to look safe on one machine is what takes the database down the first
        // time the deployment scales out - and the failure lands on every replica at once, not on
        // the one that grew.
        //
        // Twenty is what one instance can keep genuinely busy. Past roughly two to three times the
        // database's core count more connections make it slower rather than faster, because the
        // backends spend their time contending instead of working - which is why this is a limit
        // worth having and not merely a budget. A deployment that outgrows it wants a pooler in
        // front rather than a bigger number here, since the ceiling belongs to the server
        poolSize: 20,
        // the wire protocol counts a statement's values in sixteen bits, so this is the server's
        // ceiling rather than a setting of it
        maxBoundValuesPerStatement: 65535
    };

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * Combination of the default and user provided options, plus the parsers a result is read with.
     *
     * Merged into `extra` here rather than declared as a default one, because `extra` reaches the
     * driver's connection pool as it is: a consumer setting one of their own would replace the
     * parsers along with it, and a property that declares an exact decimal would start reading a
     * double instead without anything saying so.
     *
     * The connection also asks for the similarity a search is answered from, so that the boundary
     * between a search an index serves and one that reads every row is
     * {@link searchesFromSimilarity} rather than whatever this server was configured with. Asked for
     * on the connection rather than set on the server, so it covers what this application runs and
     * nothing else. Appended to whatever the consumer asked for, since the same string carries every
     * startup setting.
     */
    protected override get fullOptions(): ResolvedDataSourceOptions<OmitStrict<PostgresOptions, 'type' | 'entities'>> {
        const options: ResolvedDataSourceOptions<OmitStrict<PostgresOptions, 'type' | 'entities'>> = super.fullOptions;
        const extra: Record<string, unknown> = { ...options.extra } as Record<string, unknown>;
        const startupOptions: string = typeof extra['options'] === 'string' ? `${extra['options']} ` : '';
        return {
            ...options,
            extra: {
                ...extra,
                types: pgTypeParsers(),
                options: `${startupOptions}-c pg_trgm.similarity_threshold=${this.searchesFromSimilarity / 100}`
            }
        };
    }

    /**
     * The password of the separate backup role, if there is one.
     *
     * Only needed when backups run as somebody other than the application. A backup covers the
     * objects this data source owns, so the application's own credentials are enough by default and
     * are what is used when this is not set.
     */
    readonly rootPw: string | undefined;
    /**
     * The username of the separate backup role, if there is one.
     *
     * See {@link PostgresDataSource.rootPw}. Setting one without the other is refused at boot rather
     * than half applied.
     */
    readonly rootUsername: string | undefined;

    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.AUTH_SERVICE)
        authService: AuthServiceInterface
    ) {
        super(logger, authService);
    }

    override async init(): Promise<void> {
        await super.init();
        if (!this.ds) {
            throw new DataSourceInitializationError();
        }
        await this.warnAboutColumnsOrderedDifferently(this.ds);
        await this.warnAboutMissingTrigramIndexes(this.ds);
        this.validateQueryStream();
    }

    /**
     * Stops whatever statement the given connection is running.
     *
     * Asked of the server rather than of the client, and on a *different* connection: the one
     * running the statement is busy running it, so there is nothing on it to ask with until it is
     * done - which is the moment this would no longer be needed.
     *
     * The statement fails where it was issued, which is the point: a read that nobody is waiting for
     * any more stops occupying a worker, a plan and whatever it had locked. Refused quietly when
     * the connection has no backend to name, which is what an already finished statement looks like.
     * @param runner - The connection running the statement.
     */
    async cancelStatementOn(runner: QueryRunner): Promise<void> {
        // typeorm's own QueryRunner declares no connection, so the shape of what it is holding has
        // to be written down here. Narrow on purpose: the backend's own id is the whole of what
        // this needs, and reaching further into the driver's internals is how this breaks on an
        // upgrade
        const connected: ConnectedQueryRunner = runner as unknown as ConnectedQueryRunner;
        const backendId: number | undefined = connected.databaseConnection?.processID;
        if (backendId == undefined || !this.ds) {
            return;
        }
        await this.ds.query('SELECT pg_cancel_backend($1)', [backendId]);
    }

    override async startTransaction(options?: StartTransactionOptions): Promise<Transaction> {
        const transaction: Transaction = await super.startTransaction(options);
        const idleTimeoutInMs: number = options?.idleTimeoutInMs ?? DEFAULT_TRANSACTION_IDLE_TIMEOUT_IN_MS;
        if (!idleTimeoutInMs) {
            return transaction;
        }

        try {
            // postgres ends the transaction and takes its connection back itself, so nothing here
            // has to watch the clock. LOCAL, so it covers this transaction and reverts with it -
            // set on the connection instead it would outlive the transaction and apply to every
            // later user of that pooled connection, including queries in no transaction at all
            await TypeOrmUtilities.toTypeOrmTransaction(transaction)
                .queryRunner.query(`SET LOCAL idle_in_transaction_session_timeout = ${idleTimeoutInMs}`);
        }
        catch (error) {
            // the transaction is already open and holding a connection, so it cannot simply be
            // dropped here - the rollback is what hands that connection back
            await transaction.rollback();
            throw error;
        }
        return transaction;
    }

    /**
     * The collation every text column is created with, which is the order the application has.
     *
     * An icu collation rather than a libc one: icu is the same implementation `compareText` uses, so
     * the database and the process agree, and it is the same on every host while a libc locale
     * belongs to the operating system and moves with it. Deterministic, so equality stays equality
     * and `LIKE` keeps working.
     * @returns The name postgres creates for the default locale's icu collation.
     */
    protected get textCollation(): string {
        return `${inject(ZIBRI_DI_TOKENS.LOCALIZE_OPTIONS).defaultLocale}-x-icu`;
    }

    /**
     * Refuses a postgres that cannot order text the way the rest of the application does.
     *
     * Asked before anything is created, because the collation is part of every text column: without
     * it the first `CREATE TABLE` fails with postgres's own message about a collation that does not
     * exist, which says nothing about where the name came from. A server built without icu is the
     * one case, and there is no second-best order to fall back to - a filter comparing text in
     * process would answer one thing and the same filter in the database another.
     * @param dataSource - The initialized typeorm data source to query through.
     * @throws When the collation of the application's default locale is not one this server has.
     */
    private async validateTextCollation(dataSource: TODataSource): Promise<void> {
        const collation: string = this.textCollation;
        // eslint-disable-next-line cspell/spellchecker
        const known: unknown[] = await dataSource.query('SELECT 1 FROM pg_collation WHERE collname = $1', [collation]);
        if (known.length) {
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
     * Reports the text columns that are not ordered the way the rest of the application orders text.
     *
     * Read after the schema is set up rather than before, so that what it finds is what nothing here
     * is going to fix: a synchronizing data source has just written the collation onto its own
     * columns, while a schema owned by migrations or by somebody else keeps whatever it was created
     * with. Reported rather than raised, because the application is running correctly in every other
     * respect and the fix is a migration somebody has to write.
     * @param dataSource - The initialized typeorm data source to query through.
     */
    private async warnAboutColumnsOrderedDifferently(dataSource: TODataSource): Promise<void> {
        const collation: string = this.textCollation;
        const tables: string[] = dataSource.entityMetadatas.map(m => m.tableName);
        if (!tables.length) {
            return;
        }
        // eslint-disable-next-line jsdoc/require-jsdoc
        const differing: { table_name: string, column_name: string, collation_name: string }[] = await dataSource.query(
            'SELECT table_name, column_name, collation_name FROM information_schema.columns'
            + ' WHERE table_schema = current_schema() AND table_name = ANY($1)'
            + ' AND collation_name IS NOT NULL AND collation_name <> $2',
            [tables, collation]
        );
        if (!differing.length) {
            return;
        }
        this.logger.warn(
            `These columns are not ordered by "${collation}", so a filter or an order on them answers something else`
            + ' than the same filter or order does in process:'
            + differing.map(c => `\n- ${c.table_name}.${c.column_name} is "${c.collation_name}"`).join('')
        );
    }

    /**
     * Makes `fuzzyLike` usable, without making the right to install an extension a condition of
     * booting at all.
     *
     * Missing *and* not creatable is reported rather than raised: every other feature works without
     * it, so refusing to start would take the whole application down over one filter operator. The
     * warning names that operator, because it is the only thing that stops working.
     * @param dataSource - The initialized typeorm data source to query through.
     */
    private async installTrigramExtension(dataSource: TODataSource): Promise<void> {
        // no pg_extension lookup first: postgres answers IF NOT EXISTS for an installed extension
        // before it asks whether the role may create one, so a managed postgres that provisioned it
        // for a role with no rights boots on this statement alone. Held by the first case of
        // trigram-extension.evaluation.test.ts, which runs it as exactly that role
        try {
            await dataSource.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
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
     * Measures what this server's trigram operator answers, which decides which searches an index
     * can serve.
     *
     * `similarity(a, b) >= r` is nothing an index can answer and `a % b` is, but the operator takes
     * no argument: it asks for the server's own threshold. So a search can only add it where it lets
     * through everything the search wants, which needs the threshold, and at the boundary also needs
     * to know whether the operator includes it - postgres documents the operator as *greater than*
     * its threshold and implements it as greater or equal, and the two answers differ exactly for the
     * default search, whose similarity is the default threshold.
     *
     * Measured rather than read from either: two identical strings are similar to degree 1 exactly,
     * so with the threshold at 1 the operator is asked the one question that tells them apart. Inside
     * a transaction that is rolled back, so the setting cannot outlive the probe on a pooled
     * connection.
     * @param dataSource - The initialized typeorm data source to query through.
     * @returns What the operator answers for, with no threshold at all when pg_trgm is absent.
     */
    private async measureTrigramSupport(dataSource: TODataSource): Promise<TrigramSupport> {
        const absent: TrigramSupport = { threshold: undefined, thresholdIsInclusive: false };
        const runner: QueryRunner = dataSource.createQueryRunner();
        try {
            const settings: SimilarityThresholdRow[] = await runner.manager.query<SimilarityThresholdRow[]>(
                'SELECT current_setting($1) AS threshold',
                ['pg_trgm.similarity_threshold']
            );
            const threshold: number = Number(settings[0]?.threshold);
            if (Number.isNaN(threshold)) {
                return absent;
            }

            await runner.startTransaction();
            try {
                await runner.query('SET LOCAL pg_trgm.similarity_threshold = 1');
                const probe: SimilarityProbeRow[] = await runner.manager
                    .query<SimilarityProbeRow[]>('SELECT ($1 % $1) AS inclusive', ['zibri']);
                return { threshold, thresholdIsInclusive: probe[0]?.inclusive === true };
            }
            finally {
                await runner.rollbackTransaction();
            }
        }
        catch {
            // the setting and the operator both come from the extension, so anything unanswerable
            // here means it is not installed - which installTrigramExtension has already reported, and
            // without it fuzzyLike does not work at all
            return absent;
        }
        finally {
            await runner.release();
        }
    }

    /**
     * Reports a connection that kept a similarity other than the one it was asked for.
     *
     * The threshold travels in the startup settings of the connection, and something in front of the
     * server can drop those - a pooler handing out connections it opened itself, most of all. The
     * searches still answer the right rows, but the similarity a search has to reach before an index
     * answers it is no longer the one this framework documents, so it is named rather than left to be
     * measured.
     */
    private warnAboutAnotherSimilarityThreshold(): void {
        const asked: number = this.searchesFromSimilarity / 100;
        if (this.trigramSupport.threshold == undefined || this.trigramSupport.threshold === asked) {
            return;
        }
        this.logger.warn(
            `This data source asks its connections to search from a similarity of ${asked} and they report`
            + ` ${this.trigramSupport.threshold}, so something between it and the server is dropping the setting.`
            + ` A "fuzzyLike" now reads every row below a "minSimilarity" of ${this.trigramSupport.threshold * 100}`
            + ` rather than below ${this.searchesFromSimilarity}.`
        );
    }

    /**
     * The columns this data source keeps a trigram index over, as the entities declare them.
     * @param cls - The entity the schema is being built for.
     * @returns The property names whose values a `fuzzyLike` can be answered for.
     */
    private searchableColumnsOf<T extends BaseEntity>(cls: Newable<T>): string[] {
        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(cls);
        return ObjectUtilities.entries(properties)
            .filter(([, metadata]) => FuzzySearchUtilities.isSearchable(metadata))
            .map(([key]) => key);
    }

    /**
     * Every trigram index the entities of this data source ask for, by the name it is created with.
     * @param dataSource - The initialized typeorm data source, for the tables the entities map to.
     * @returns The index name of each one, against the table and column it covers.
     */
    private declaredTrigramIndexes(dataSource: TODataSource): Map<string, TrigramIndexTarget> {
        const res: Map<string, TrigramIndexTarget> = new Map();
        for (const metadata of dataSource.entityMetadatas) {
            // a many-to-many junction table is one of these too, and the orm builds it rather than an
            // entity declaring it, so its target is the name it was given instead of a class. It
            // holds two foreign keys and nothing anybody searches
            if (typeof metadata.target !== 'function') {
                continue;
            }
            for (const property of this.searchableColumnsOf(metadata.target as Newable<BaseEntity>)) {
                const column: string | undefined = metadata.findColumnWithPropertyName(property)?.databaseName;
                if (column == undefined) {
                    continue;
                }
                res.set(trigramIndexName(metadata.tableName, property), { table: metadata.tableName, column });
            }
        }
        return res;
    }

    /**
     * The trigram indexes this data source has already created, on the tables of its own entities.
     * @param dataSource - The initialized typeorm data source to query through.
     * @returns The name of every index it owns that the database currently has.
     */
    private async existingTrigramIndexes(dataSource: TODataSource): Promise<string[]> {
        const tables: string[] = dataSource.entityMetadatas.map(m => m.tableName);
        if (!tables.length) {
            return [];
        }
        const rows: IndexNameRow[] = await dataSource.query(
            'SELECT indexname FROM pg_indexes WHERE schemaname = current_schema()'
            + ' AND tablename = ANY($1) AND indexname LIKE $2',
            [tables, `${TRIGRAM_INDEX_PREFIX}%`]
        );
        return rows.map(r => r.indexname);
    }

    /**
     * Brings the trigram indexes in line with what the entities declare.
     *
     * The orm has no way to write `USING GIN (col gin_trgm_ops)` - its index options carry no access
     * method and no operator class - so these are created here instead, and declared to it as none of
     * its business so that it leaves them alone. Which means dropping them is this code's job too: a
     * property that stops being searchable leaves an index behind that nothing else would remove.
     * @param dataSource - The initialized typeorm data source to query through.
     */
    private async reconcileTrigramIndexes(dataSource: TODataSource): Promise<void> {
        if (this.trigramSupport.threshold == undefined) {
            // without the extension there is no operator class to create them with, and the warning
            // that says so has already been given
            return;
        }

        const declared: Map<string, TrigramIndexTarget> = this.declaredTrigramIndexes(dataSource);
        const existing: string[] = await this.existingTrigramIndexes(dataSource);

        const missing: [string, TrigramIndexTarget][] = [...declared.entries()]
            .filter(([name]) => !existing.includes(name));
        const abandoned: string[] = existing.filter(name => !declared.has(name));

        await PromiseUtilities.allChunked(missing, async ([name, { table, column }]) => {
            await dataSource.query(`CREATE INDEX IF NOT EXISTS "${name}" ON "${table}" USING GIN ("${column}" gin_trgm_ops)`);
        });
        await PromiseUtilities.allChunked(abandoned, async name => {
            await dataSource.query(`DROP INDEX IF EXISTS "${name}"`);
        });
    }

    /**
     * Reports the searchable columns that have no trigram index on a schema somebody outside the
     * application owns.
     *
     * The same shape as the collation warning, and for the same reason: with an outside owner in
     * charge of the schema, nothing here is going to add the index, and a `fuzzyLike` the framework
     * accepts because the property declares itself searchable would read the whole table. Under
     * migrations the data source keeps these itself, as it keeps every index an entity declares.
     * @param dataSource - The initialized typeorm data source to query through.
     */
    private async warnAboutMissingTrigramIndexes(dataSource: TODataSource): Promise<void> {
        if (this.schemaManagement !== 'external' || this.trigramSupport.threshold == undefined) {
            return;
        }
        const declared: Map<string, TrigramIndexTarget> = this.declaredTrigramIndexes(dataSource);
        const existing: string[] = await this.existingTrigramIndexes(dataSource);
        const missing: TrigramIndexTarget[] = [...declared.entries()]
            .filter(([name]) => !existing.includes(name))
            .map(([, target]) => target);
        if (!missing.length) {
            return;
        }
        this.logger.warn(
            'These columns are searchable with "fuzzyLike" and have no trigram index, so a search of them'
            + ' reads every row. Create one per column, as'
            + ' CREATE INDEX "name" ON "table" USING GIN ("column" gin_trgm_ops), or declare'
            + ' fuzzySearchable: false on the property:'
            + missing.map(c => `\n- ${c.table}.${c.column}, as "${trigramIndexName(c.table, c.column)}"`).join('')
        );
    }

    /**
     * Refuses a postgres data source that cannot open a cursor.
     *
     * `pg-query-stream` is what typeorm streams through, and it is an *optional* peer rather than a
     * plain one because a peer that is not optional is installed by every consumer of the framework
     * - including one whose only data source is valkey, which would be made to carry a postgres
     * driver's streaming support for nothing.
     *
     * Optional is about who installs it, not about whether it is needed. Declaring this data source
     * is declaring postgres, `stream` included, so a missing package is a boot failure here the same
     * way a missing `pg` is. The alternative is finding out from the nightly job that reads the table
     * too large to hold, which is the one call that cannot be retried by hand afterwards.
     *
     * Resolved rather than loaded, so an application that has it and never streams does not pay to
     * load it.
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

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected async schemaLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
        if (!this.ds) {
            throw new DataSourceInitializationError();
        }

        // one connection for the whole thing: an advisory lock belongs to the session that took it,
        // so unlocking from a different pooled connection would silently do nothing
        const runner: QueryRunner = this.createQueryRunner();
        await runner.connect();

        try {
            // fail rather than hang. Without this an instance stuck holding a lock blocks every
            // other one forever, with nothing in the logs to say what they are waiting for.
            await runner.query(`SET lock_timeout = ${inject(ZIBRI_DI_TOKENS.SCHEMA_LOCK_TIMEOUT_IN_MS)}`);
            // postgres identifies advisory locks by number, so the key is hashed into one rather
            // than every caller having to invent numbers that do not collide
            await runner.query('SELECT pg_advisory_lock(hashtext($1))', [key]);

            try {
                return await fn();
            }
            finally {
                await runner.query('SELECT pg_advisory_unlock(hashtext($1))', [key]);
            }
        }
        finally {
            await runner.release();
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected buildUpsertSql(input: UpsertInput): UpsertSql {
        // the select deciding which rows may be changed arrives with its placeholders numbered from
        // the first, so its parameters go first and everything this adds is numbered after them
        const params: unknown[] = [...input.reachable?.params ?? []];
        const param: (value: unknown) => string = value => {
            params.push(value);
            return `$${params.length}`;
        };
        const escape: (name: string) => string = name => `"${name.replaceAll('"', '""')}"`;
        const table: string = escape(input.tableName);
        const id: string = escape(input.idColumn);

        const columns: string = input.columns.map(c => escape(c)).join(', ');
        const values: string = input.rows
            .map(row => `(${row.values.map(v => v === 'default' ? 'DEFAULT' : param(v.value)).join(', ')})`)
            .join(', ');

        // one assignment per column any row changes, choosing each row's change by the id that row
        // was proposed with - which is what EXCLUDED carries for the insert that conflicted. A row
        // that leaves the column alone falls through to the value already stored. The stored value
        // is qualified with the table name, which is how postgres refers to the row that is already
        // there; unqualified would read the row being inserted instead
        const branches: [string, string][] = input.rows.flatMap(row => {
            const when: string = `WHEN ${param(row.id)} THEN`;
            return row.updates.map((u): [string, string] => {
                // an increment is added on its own branch rather than around the whole case, so
                // postgres reads its parameter as the column's own type
                const then: string = 'increment' in u ? `${table}.${escape(u.column)} + ${param(u.increment)}` : param(u.value);
                return [u.column, `${when} ${then}`];
            });
        });
        const updates: string = [...new Set(branches.map(([column]) => column))]
            .map(column => {
                const cases: string = branches
                    .filter(([c]) => c === column)
                    .map(([, branch]) => branch)
                    .join(' ');
                return `${escape(column)} = CASE EXCLUDED.${id} ${cases} ELSE ${table}.${escape(column)} END`;
            })
            .join(', ');

        // a constraint is named, an index has to be described. `ON CONSTRAINT` accepts only the
        // first, which is why a key covering part of a table used to be refused here: postgres
        // infers a partial index from the columns plus the predicate it was created with, and there
        // is no other way to point at one
        const conflict: string = 'constraintName' in input.conflict
            ? `ON CONSTRAINT ${escape(input.conflict.constraintName)}`
            : `(${input.conflict.columns.map(c => escape(c)).join(', ')}) WHERE ${input.conflict.predicate}`;

        // a conflicting row this excludes is locked and left as it is, and the statement returns
        // nothing for it - which is how the caller learns the identity is held by a row they may not
        // change. Qualified with the table name, which refers to the row that is already there
        const reachable: string[] = input.reachable == undefined
            ? []
            : [`WHERE ${table}.${id} IN (${input.reachable.sql})`];

        return {
            sql: [
                `INSERT INTO ${table} (${columns}) VALUES ${values}`,
                `ON CONFLICT ${conflict}`,
                `DO UPDATE SET ${updates}`,
                ...reachable,
                'RETURNING *'
            ].join(' '),
            params
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    violatedUniqueProperties(error: TOQueryFailedError): string[] | undefined {
        if (!('code' in error.driverError) || error.driverError.code !== UNIQUE_VIOLATION_SQL_STATE) {
            return undefined;
        }
        const detail: string = 'detail' in error.driverError && typeof error.driverError.detail === 'string'
            ? error.driverError.detail
            : '';

        // eg. "Key (email)=(someone@example.com) already exists."
        const columns: string | undefined = detail.split('Key (').at(1)
            ?.split(')=')
            .at(0);
        if (columns != undefined) {
            return columns.split(', ');
        }

        // a violation the server named without detailing it still names the declaration, which is
        // more use to whoever reads the error than saying nothing
        return [
            'constraint' in error.driverError && typeof error.driverError.constraint === 'string'
                ? error.driverError.constraint
                : 'unknown'
        ];
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    mistypedJsonValue(error: TOQueryFailedError, entityName: string): MistypedStoredValue | undefined {
        if (!('code' in error.driverError) || typeof error.driverError.code !== 'string'
            || !UNREADABLE_VALUE_SQL_STATES.includes(error.driverError.code)) {
            return undefined;
        }

        // the same sql states answer for a malformed uuid or a bad literal anywhere else in the
        // statement, so the marker is what makes this a json question rather than the state
        const markers: RegExpExecArray[] = [...error.query.matchAll(CAST_MARKER_PATTERN)];
        const marker: RegExpExecArray | undefined = markers.find(
            m => m.groups?.['type'] === declaredTypeOf(error.message)
        ) ?? markers.at(0);
        const path: string | undefined = marker?.groups?.['path'];
        const declaredType: string | undefined = marker?.groups?.['type'];
        if (path == undefined || declaredType == undefined) {
            return undefined;
        }

        // the column arrives quoted, because the marker is written before the statement knows which
        // column it is for and is filled in along with it. The entity goes in place of the name the
        // statement gave its table, which is the same thing to the database and not to whoever wrote
        // the model the rest of the path is spelled in
        const [, ...properties]: string[] = path.replaceAll('"', '').split('.');
        return {
            path: [entityName, ...properties].join('.'),
            declaredType,
            value: UNREADABLE_VALUE_PATTERN.exec(error.message)?.groups?.['value'] ?? error.message
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async validateBackupConfiguration(): Promise<void> {
        if (Boolean(this.rootUsername) !== Boolean(this.rootPw)) {
            throw new InternalError(
                'Invalid data source marked with @Backup: rootUsername and rootPw belong together.'
                + ' Set both to back up as a separate role, or neither to use the data source\'s own credentials.'
            );
        }

        const { host, database } = this.options;
        if (!host || !database || !this.backupUsername) {
            throw new InternalError(
                'Invalid data source marked with @Backup: host, database and username need to be resolvable'
            );
        }

        // the binaries are the dependency nobody remembers to put in the image, and the moment it is
        // discovered by accident is the moment a restore is needed. Boot is a cheaper place to find out
        for (const command of [DUMP_COMMAND, RESTORE_COMMAND]) {
            if (!await commandExists(command)) {
                throw new InternalError(
                    `Invalid data source marked with @Backup: "${command}" was not found on PATH.`
                    + ' Backups shell out to the postgres client tools, so they have to be installed in the runtime image.'
                );
            }
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    query<T extends BaseEntity>(entityClass: Newable<T>, options?: QueryOptions): QueryBuilder<T> {
        if (!this.ds) {
            throw new DataSourceInitializationError();
        }

        const alias: string = options?.alias ?? entityClass.name;
        if (options?.transaction) {
            return TypeOrmUtilities.toTypeOrmTransaction(options.transaction).queryRunner.manager.createQueryBuilder(entityClass, alias);
        }
        return this.ds.createQueryBuilder(entityClass, alias);
    }

    protected override async beforeMigrations(): Promise<void> {
        if (!this.ds) {
            throw new DataSourceInitializationError();
        }
        await this.validateTextCollation(this.ds);
        // before the schema is set up rather than after, because the trigram indexes that go on it
        // need the operator class this installs, and the converter needs to know what the operator
        // those indexes answer means on this server
        await this.installTrigramExtension(this.ds);
        this.trigramSupport = await this.measureTrigramSupport(this.ds);
        this.warnAboutAnotherSimilarityThreshold();
        this.whereFilterConverter = new PostgresTypeOrmWhereFilterConverter(this.ds, this.logger, this.trigramSupport);
    }

    protected override async afterSchemaSetup(): Promise<void> {
        if (!this.ds) {
            throw new DataSourceInitializationError();
        }
        await this.reconcileTrigramIndexes(this.ds);
    }

    protected override indicesOwnedBySelf<T extends BaseEntity>(cls: Newable<T>, tableName: string): EntitySchemaIndexOptions[] {
        return this.searchableColumnsOf(cls).map(column => ({
            name: trigramIndexName(tableName, column),
            columns: [column],
            synchronize: false
        }));
    }

    /**
     * The role backups run as - the separate one if configured, otherwise the application's own.
     * @returns The username to connect the client tools with.
     */
    private get backupUsername(): string | undefined {
        return this.rootUsername ?? this.options.username;
    }

    /**
     * Resolves the password for {@link backupUsername}.
     *
     * Typeorm accepts a function for `password`, so this may be a callback that fetches from a secret
     * store - which is exactly the setup that should not have to duplicate the value into a second
     * field just because backups exist.
     * @returns The password, or undefined if the connection does not use one.
     */
    private async backupPassword(): Promise<string | undefined> {
        if (this.rootPw != undefined) {
            return this.rootPw;
        }
        const password: PostgresOptions['password'] = this.options.password;
        return typeof password === 'function' ? await password() : password;
    }

    /**
     * Builds the environment the client tools are given.
     *
     * Deliberately not `process.env`. The dump child needs libpq's own variables and nothing else,
     * while the application's environment is where its jwt secret, encryption master keys and smtp
     * credentials live - none of which `pg_dump` reads, and all of which a subprocess environment is
     * a way to hand to whatever can read `/proc/<pid>/environ`.
     *
     * Every `PG*` variable already present is passed through, because that is how an operator
     * configures tls (`PGSSLMODE`, `PGSSLROOTCERT`) for a managed postgres, and losing them silently
     * would turn a verified connection into a refused one.
     *
     * Without one, the mode follows the connection's `ssl`. Libpq's own default is `prefer`, which
     * falls back to plaintext without saying so, so a backup would travel less protected than every
     * query does. `require` rather than a verifying mode for an enabled `ssl`, because verifying needs
     * a root certificate libpq reads from its own places rather than from the system's store - an
     * operator who has one says `verify-full` through the environment.
     * @param password - The password to pass, if there is one.
     * @returns The environment for the child process.
     */
    private clientEnvironment(password: string | undefined): NodeJS.ProcessEnv {
        const env: NodeJS.ProcessEnv = {};
        for (const key of ['PATH', 'LANG', 'LC_ALL', 'LC_MESSAGES']) {
            env[key] = process.env[key];
        }
        for (const key in process.env) {
            if (key.startsWith('PG')) {
                env[key] = process.env[key];
            }
        }
        env['PGSSLMODE'] ??= this.options.ssl === false ? 'disable' : 'require';
        if (password != undefined) {
            env['PGPASSWORD'] = password;
        }
        return env;
    }

    /**
     * The connection arguments both client tools take, in the form both of them accept.
     * @returns The host, port, user and database arguments.
     * @throws When the data source does not carry enough to address a database with.
     */
    private clientConnectionArgs(): string[] {
        const { host, port, database } = this.options;
        if (!host || !database || !this.backupUsername) {
            throw new InternalError(
                'Could not run a postgres client tool, missing host, database or username on the data source'
            );
        }
        // an omitted port means the postgres default, which is what the connection itself resolves it
        // to - naming it here rather than requiring it keeps the two pointed at the same server
        return [
            '-h',
            host,
            '-p',
            (port ?? DEFAULT_PORT).toString(),
            '-U',
            this.backupUsername,
            '-d',
            database
        ];
    }

    /**
     * Dumps this data source's schema, and nothing else on the server.
     *
     * `pg_dump` of the one database this data source addresses, rather than `pg_dumpall` of the
     * cluster it happens to live in. What that leaves out is the point.
     *
     * Roles: a cluster dump opens with `CREATE ROLE` and `ALTER ROLE ... PASSWORD '<verifier>'` for
     * every login role on the server. A backup artifact is copied, shipped off-host and kept for
     * years; it must not be a credential store.
     *
     * Other databases: everything else on the server, `template1` included, has nothing to do with
     * this application and is somebody else's data to lose.
     *
     * The `\connect` meta command: it overrides the database psql was pointed at, so a cluster dump
     * ignores the target it is restored into and writes to the name it remembers instead.
     *
     * The result is purely constructive - it carries no `DROP` of any kind. Removing what is already
     * there is the restore's job and is scoped there; an artifact that can be replayed by hand should
     * not be able to delete a database it was pointed at by mistake. It also keeps every extension
     * statement in the dump harmless, since `CREATE EXTENSION IF NOT EXISTS` on one that is already
     * installed is a no-op that asks for no privilege.
     *
     * `--no-owner`, `--no-acl` and `--no-comments` make the result restorable by whoever restores it,
     * rather than only by a cluster that still has the original roles in it. The trade is real and
     * worth stating: the backup carries schema and data, not the grants and comments around them.
     * @returns A stream of the dump, which fails rather than truncating if the dump does.
     */
    async createBackupData(): Promise<Readable> {
        const args: string[] = [
            ...this.clientConnectionArgs(),
            '--no-owner',
            '--no-acl',
            '--no-comments'
        ];

        const child: ChildProcessByStdio<null, Readable, null> = spawn(DUMP_COMMAND, args, {
            stdio: ['ignore', 'pipe', 'inherit'],
            env: this.clientEnvironment(await this.backupPassword())
        });

        const out: PassThrough = new PassThrough();
        child.stdout.pipe(out);
        child.on('error', error => {
            out.destroy(error);
        });
        child.on('exit', code => {
            if (code !== 0) {
                out.destroy(new InternalError(`${DUMP_COMMAND} exited with code ${code}`));
            }
            else {
                out.end();
            }
        });

        return out;
    }

    /**
     * Applies a dump produced by {@link createBackupData} to this data source's database.
     *
     * `ON_ERROR_STOP` and `--single-transaction` are what make the result mean something. Without
     * them psql reports each failed statement on stderr, carries on, and exits 0 - so a restore that
     * applied nothing is indistinguishable from one that worked, and whatever called it goes on to
     * serve traffic against a database it believes it just repaired. With them the restore either
     * lands whole or is rolled back and raised.
     *
     * The dump carries no `DROP`, so the restore clears the tables it is about to recreate itself -
     * see {@link CLEAR_TABLES_SQL} for why that is not left to `pg_dump --clean`.
     *
     * A restore replaces the objects it dumps, so the role running it has to own them. That is
     * ordinary ddl rights on this application's own tables, which is what created them - not
     * superuser, and not ownership of the schema or of any extension in it.
     * @param backupData - The dump to apply.
     */
    async restoreBackup(backupData: Readable): Promise<void> {
        const args: string[] = [
            ...this.clientConnectionArgs(),
            '--quiet',
            // psql's own name for "stop at the first error"; --single-transaction then rolls the
            // partial work back rather than leaving half a schema behind
            '--set',
            'ON_ERROR_STOP=1',
            '--single-transaction'
        ];

        const child: ChildProcessByStdio<Writable, null, null> = spawn(RESTORE_COMMAND, args, {
            stdio: ['pipe', 'inherit', 'inherit'],
            env: this.clientEnvironment(await this.backupPassword())
        });

        const input: Readable = Readable.from(withClearedTables(backupData));

        await new Promise<void>((resolve, reject) => {
            let settled: boolean = false;
            const settle: (error?: Error) => void = error => {
                if (settled) {
                    return;
                }
                settled = true;
                if (error) {
                    reject(error);
                    return;
                }
                resolve();
            };

            let stdinFailed: boolean = false;
            child.stdin.on('error', () => {
                // psql aborting on the first bad statement closes stdin while the dump is still being
                // written, which is an EPIPE on a stream nobody listens to for 'error' - an unhandled
                // stream error, so a dead process rather than a failed restore
                stdinFailed = true;
                input.destroy();
                backupData.destroy();
            });
            input.on('error', error => {
                // the premature close that our own destroy above provokes says nothing; psql's exit
                // code says why it stopped, so that is the one to wait for
                if (!stdinFailed) {
                    settle(error);
                }
            });
            input.pipe(child.stdin);

            child.on('error', settle);
            child.on('close', code => {
                settle(code === 0 ? undefined : new InternalError(`${RESTORE_COMMAND} exited with code ${code}`));
            });
        });
    }

    protected override validateOptions(options: OmitStrict<PostgresOptions, 'type' | 'entities'>): void {
        if (options.username === 'postgres' && options.password === 'password') {
            this.logger.warn(
                `The data source "${this.constructor.name}" uses the default credentials, you probably want to change that.`
            );
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected propertyToRelationOptions<T extends BaseEntity>(
        cls: Newable<T>,
        key: string,
        metadata: RelationMetadata<T>
    ): EntitySchemaRelationOptions {
        const thisHasRemove: boolean = this.hasCascadeFlag(metadata.cascade, 'remove');
        const thisHasUpdate: boolean = this.hasCascadeFlag(metadata.cascade, 'update');
        const thisHasInsert: boolean = this.hasCascadeFlag(metadata.cascade, 'insert');

        // the inverse property's cascade counts as well. Not necessarily a relation itself - a change
        // set entity's inverse is the plain id column its change sets carry - and its existence is
        // the data source service's to refuse, before any data source is initialized
        const targetClass: Newable<T> = metadata.target();
        const targetProps: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(targetClass);
        const inverse: PropertyMetadata | undefined = targetProps[metadata.inverseSide];
        const inverseCascade: RelationMetadata<BaseEntity>['cascade'] = isRelationMetadata(inverse) ? inverse.cascade : false;
        const inverseHasRemove: boolean = this.hasCascadeFlag(inverseCascade, 'remove');
        const inverseHasUpdate: boolean = this.hasCascadeFlag(inverseCascade, 'update');
        const inverseHasInsert: boolean = this.hasCascadeFlag(inverseCascade, 'insert');

        const onDelete: OnDeleteType | undefined = thisHasRemove || inverseHasRemove ? 'CASCADE' : undefined;
        const onUpdate: OnUpdateType | undefined = thisHasUpdate || inverseHasUpdate ? 'CASCADE' : undefined;
        const persistence: boolean = 'persistence' in metadata ? metadata.persistence : thisHasInsert || inverseHasInsert;
        const nullable: boolean = typeof metadata.required === 'boolean' ? !metadata.required : true;

        // eslint-disable-next-line typescript/typedef
        const shared = {
            inverseSide: metadata.inverseSide as string,
            onDelete,
            onUpdate,
            persistence,
            nullable
        } as const satisfies Partial<EntitySchemaRelationOptions>;

        switch (metadata.type) {
            case Relation.ONE_TO_MANY: {
                return {
                    ...metadata,
                    ...shared
                };
            }
            case Relation.HAS_ONE: {
                return {
                    ...metadata,
                    ...shared,
                    type: 'one-to-one'
                };
            }
            case Relation.MANY_TO_MANY: {
                if (metadata.joinTable == undefined) {
                    throw new InternalError(
                        `The property ${cls.name}.${key} needs to have "joinTable" set inside of the @Property.manyToMany() decorator.`
                    );
                }
                return {
                    ...metadata,
                    ...shared
                };
            }
            case Relation.BELONGS_TO_ONE: {
                if (metadata.joinColumn == undefined) {
                    throw new InternalError(
                        `The property ${cls.name}.${key} needs to have "joinColumn" set inside of the @Property.belongsToOne() decorator.`
                    );
                }
                return {
                    ...metadata,
                    ...shared,
                    type: 'one-to-one',
                    joinColumn: { name: metadata.joinColumn }
                };
            }
            case Relation.MANY_TO_ONE: {
                if (metadata.joinColumn == undefined) {
                    throw new InternalError(
                        `The property ${cls.name}.${key} needs to have "joinColumn" set inside of the @Property.manyToOne() decorator.`
                    );
                }
                return {
                    ...metadata,
                    ...shared,
                    joinColumn: { name: metadata.joinColumn }
                };
            }
        }
    }

    private hasCascadeFlag(c: RelationMetadata<BaseEntity>['cascade'], flag: 'remove' | 'update' | 'insert'): boolean {
        if (c === true) {
            return true;
        }
        if (Array.isArray(c)) {
            return c.includes(flag);
        }
        return false;
    }

    protected override numberColumnType(format: NumberFormat): ColumnType {
        switch (format) {
            case 'integer': {
                return 'integer';
            }
            case 'bigint': {
                return 'bigint';
            }
            // an exact decimal of any size, so no precision and scale: postgres reads a `numeric`
            // without them as "whatever the value needs", which is what the format promises
            case 'bignumber': {
                return 'numeric';
            }
            case 'number': {
                return this.fullColumnTypeMapping.number;
            }
        }
    }

    protected override async convertColumnInPlace(
        queryRunner: QueryRunner,
        tableName: string,
        current: TableColumn,
        changed: TableColumn,
        conversion: ResolvedPropertyConversion
    ): Promise<void> {
        const column: PostgresColumnSql = this.toColumnSql(queryRunner, current);
        const target: PostgresColumnSql = this.toColumnSql(queryRunner, changed);
        // because a column changed into text otherwise collates as the database does rather than as
        // the application does
        const collate: string = changed.collation == undefined ? '' : ` COLLATE ${escapeIdentifier(changed.collation)}`;
        await this.useExactFloatText(queryRunner);
        // the default goes first: it is of the old type, and the changed column declares its own
        await queryRunner.query(
            `ALTER TABLE ${escapeIdentifier(tableName)} ALTER COLUMN ${column.name} DROP DEFAULT,`
            + ` ALTER COLUMN ${column.name} TYPE ${target.type}${collate}`
            + ` USING ${PostgresValueConversionUtilities.resolveConvertedSql(column, target, conversion)}`
        );
    }

    protected override async findRefusedValues(
        queryRunner: QueryRunner,
        tableName: string,
        current: TableColumn,
        changed: TableColumn,
        conversion: ResolvedPropertyConversion
    ): Promise<RefusedValue[]> {
        const query: string | undefined = PostgresValueConversionUtilities.resolveRefusalsQuery(
            escapeIdentifier(tableName),
            this.toColumnSql(queryRunner, current),
            this.toColumnSql(queryRunner, changed),
            conversion
        );
        if (query == undefined) {
            return [];
        }
        await this.useExactFloatText(queryRunner);
        return await queryRunner.connection.query<RefusedValue[]>(query, [], queryRunner);
    }

    /**
     * Makes the migration's transaction write a double as the shortest text that reads back as it,
     * which is the decimal every conversion reads a double as.
     * @param queryRunner - The query runner of the migration's transaction.
     */
    private async useExactFloatText(queryRunner: QueryRunner): Promise<void> {
        // the server's default, set anyway because a session or a role can lower it, and then a
        // double is written rounded to fifteen digits
        await queryRunner.query('SET LOCAL extra_float_digits = 1');
    }

    /**
     * Describes a column for the statements that convert it.
     * @param queryRunner - The query runner of the migration's transaction.
     * @param column - The column.
     * @returns The column, quoted and with its full type.
     */
    private toColumnSql(queryRunner: QueryRunner, column: TableColumn): PostgresColumnSql {
        return { name: escapeIdentifier(column.name), stored: column, type: queryRunner.connection.driver.createFullType(column) };
    }

    protected override async renameDeclaredKeys(queryRunner: QueryRunner, currentTableName: string, tableName: string): Promise<void> {
        const prefixes: [string, string][] = [
            [uniqueConstraintName(currentTableName, []), uniqueConstraintName(tableName, [])],
            [indexName(currentTableName, []), indexName(tableName, [])],
            [trigramIndexName(currentTableName, ''), trigramIndexName(tableName, '')]
        ];
        const stored: StoredKeyRow[] = await queryRunner.connection.query<StoredKeyRow[]>(STORED_KEYS_SQL, [tableName], queryRunner);
        for (const key of stored) {
            const match: [string, string] | undefined = prefixes.find(([prefix]) => key.name.startsWith(prefix));
            if (match == undefined) {
                continue;
            }
            const [current, changed]: [string, string] = match;
            // a name postgres cut short comes out shorter than the one the entity declares, and then
            // keeping the declared ones builds that one and drops this - the same end, at the cost of
            // a build. Renaming the index renames the constraint enforced through it, too
            const renamed: string = toStoredIdentifier(`${changed}${key.name.slice(current.length)}`);
            await queryRunner.query(`ALTER INDEX ${escapeIdentifier(key.name)} RENAME TO ${escapeIdentifier(renamed)}`);
        }
    }

    protected override async mergeRows(queryRunner: QueryRunner, merge: MergedRows): Promise<void> {
        const current: string = escapeIdentifier(merge.currentTableName);
        const table: string = escapeIdentifier(merge.tableName);
        const columns: string = merge.columns.map(c => escapeIdentifier(c)).join(', ');
        const primary: string = escapeIdentifier(merge.primaryColumn);
        const sameAsStored: (unique: string[]) => string = unique => unique
            .map(c => `stored.${escapeIdentifier(c)} = ${current}.${escapeIdentifier(c)}`)
            .join(' AND ');
        // a condition unqualified both times: inside the subquery its columns are the stored row's,
        // outside it the merged one's
        const conflicts: string[] = [{ columns: [merge.primaryColumn], where: undefined }, ...merge.uniques].map(u => u.where == undefined
            ? `EXISTS (SELECT 1 FROM ${table} AS stored WHERE ${sameAsStored(u.columns)})`
            : `((${u.where}) AND EXISTS (SELECT 1 FROM ${table} AS stored WHERE ${sameAsStored(u.columns)} AND (${u.where})))`);
        const moved: MovedRowId[] = await queryRunner.connection.query<MovedRowId[]>(
            `INSERT INTO ${table} (${columns}) SELECT ${columns} FROM ${current}`
            + ` WHERE NOT (${conflicts.join(' OR ')}) RETURNING ${primary}::text AS "id"`,
            [],
            queryRunner
        );

        // a numeric id moved with its row is one the sequence of the table has not handed out yet, and
        // would hand out again. Looked up first rather than filtered in the same statement: postgres
        // plans the max even when no sequence is found, and there is no max of a uuid
        const [sequence]: SerialSequence[] = await queryRunner.connection.query<SerialSequence[]>(
            'SELECT pg_get_serial_sequence($1, $2) AS "name"',
            [table, merge.primaryColumn],
            queryRunner
        );
        if (sequence?.name != undefined) {
            await queryRunner.query(
                // eslint-disable-next-line cspell/spellchecker
                `SELECT setval($1, (SELECT max(${primary}) FROM ${table}))`,
                [sequence.name]
            );
        }

        const ids: string[] = moved.map(row => row.id);
        for (const joinTable of merge.joinTables) {
            // only the relations of rows that were moved, which is every row the relation names
            const ofMoved: string = joinTable.entityColumns.map(c => `${escapeIdentifier(c)}::text = ANY($1)`).join(' AND ');
            const into: string = joinTable.columns.map(([, c]) => escapeIdentifier(c)).join(', ');
            const from: string = joinTable.columns.map(([c]) => escapeIdentifier(c)).join(', ');
            await queryRunner.query(
                `INSERT INTO ${escapeIdentifier(joinTable.name)} (${into})`
                + ` SELECT ${from} FROM ${escapeIdentifier(joinTable.currentName)} WHERE ${ofMoved}`,
                [ids]
            );
        }
    }

    protected override async reconcileKeys(): Promise<boolean> {
        if (!this.ds) {
            throw new DataSourceInitializationError();
        }
        // a connection of its own, and no transaction on it: an index is built concurrently, which
        // cannot happen inside one - and is the point, since writes go on while it is built. The
        // instances still serving the previous version are writing the whole time
        const runner: QueryRunner = this.createQueryRunner();
        await runner.connect();
        try {
            let changed: boolean = false;
            for (const entity of this.entities) {
                changed = await this.reconcileKeysOf(runner, entity, this.ds.getMetadata(entity)) || changed;
            }
            return changed;
        }
        finally {
            await runner.release();
        }
    }

    /**
     * Makes the indexes and uniques of one entity's table match what it declares.
     * @param runner - The connection to build them on.
     * @param entity - The entity.
     * @param metadata - Its metadata, for the table and its columns.
     * @returns Whether anything was created or dropped.
     */
    private async reconcileKeysOf(runner: QueryRunner, entity: Newable<BaseEntity>, metadata: TOEntityMetadata): Promise<boolean> {
        const declared: DeclaredKey[] = this.resolveDeclaredKeys(entity, metadata);
        const stored: StoredKeyRow[] = await runner.connection.query<StoredKeyRow[]>(STORED_KEYS_SQL, [metadata.tableName], runner);
        const owned: StoredKeyRow[] = stored.filter(k => this.isDeclaredKeyName(k.name, metadata.tableName));

        // what a build that failed leaves behind: an index that enforces and serves nothing, and is
        // kept up on every write all the same
        for (const leftover of owned.filter(k => !k.valid)) {
            await runner.query(`DROP INDEX CONCURRENTLY IF EXISTS ${escapeIdentifier(leftover.name)}`);
        }
        const kept: Map<string, StoredKeyRow> = new Map(owned.filter(k => k.valid).map(k => [k.name, k]));
        const declaredNames: Set<string> = new Set(declared.map(k => toStoredIdentifier(k.name)));
        const missing: DeclaredKey[] = declared.filter(k => !kept.has(toStoredIdentifier(k.name)));
        const abandoned: StoredKeyRow[] = [...kept.values()].filter(k => !declaredNames.has(k.name));

        // created before anything is dropped, so that a unique whose name changed is enforced throughout
        for (const key of missing) {
            await this.createDeclaredKey(runner, entity, key);
        }
        // an index built before the constraint could take it over, by a boot that stopped in between
        for (const key of declared.filter(k => k.constrain != undefined && kept.get(toStoredIdentifier(k.name))?.constraint === false)) {
            await this.inShortLock(runner, key.constrain ?? '');
        }
        const table: string = escapeIdentifier(metadata.tableName);
        for (const key of abandoned) {
            await (key.constraint
                ? this.inShortLock(runner, `ALTER TABLE ${table} DROP CONSTRAINT ${escapeIdentifier(key.name)}`)
                : runner.query(`DROP INDEX CONCURRENTLY IF EXISTS ${escapeIdentifier(key.name)}`));
        }
        return missing.length > 0 || abandoned.length > 0;
    }

    /**
     * Builds the statements creating every index and unique an entity declares.
     * @param entity - The entity.
     * @param metadata - Its metadata, for the table and its columns.
     * @returns Each one, under the name the schema gives it.
     */
    private resolveDeclaredKeys(entity: Newable<BaseEntity>, metadata: TOEntityMetadata): DeclaredKey[] {
        const tableName: string = metadata.tableName;
        const table: string = escapeIdentifier(tableName);
        const columnsOf: (properties: string[]) => string[] = properties => properties
            .map(p => escapeIdentifier(metadata.findColumnWithPropertyName(p)?.databaseName ?? p));
        const groups: KeyGroups = keyGroupsOf(entity);
        const res: DeclaredKey[] = [];

        for (const unique of groups.uniques) {
            const columns: string[] = columnsOf(unique.properties);
            // the function the schema writes the condition with, so the name it hashes is the same
            const where: string | undefined = unique.where == undefined || coversEveryRow(unique.where)
                ? undefined
                : keyWhereToSql(entity, unique.where);
            const name: string = uniqueConstraintName(tableName, unique.properties, where);
            const quoted: string = escapeIdentifier(name);
            const list: string = columns.join(', ');
            // rows holding no value in one of the columns never conflict, which is how the index
            // itself counts them
            const valued: string = columns.map(c => `${c} IS NOT NULL`).join(' AND ');
            res.push({
                name,
                properties: unique.properties,
                build: `CREATE UNIQUE INDEX CONCURRENTLY ${quoted} ON ${table} (${list})${where == undefined ? '' : ' WHERE ' + where}`,
                constrain: where == undefined ? `ALTER TABLE ${table} ADD CONSTRAINT ${quoted} UNIQUE USING INDEX ${quoted}` : undefined,
                duplicates: `SELECT json_build_array(${list})::text AS "values" FROM ${table}`
                    + ` WHERE ${valued}${where == undefined ? '' : ' AND (' + where + ')'}`
                    + ` GROUP BY ${list} HAVING count(*) > 1 LIMIT 3`
            });
        }
        for (const index of groups.indexes) {
            const name: string = indexName(tableName, index);
            const build: string = `CREATE INDEX CONCURRENTLY ${escapeIdentifier(name)} ON ${table} (${columnsOf(index).join(', ')})`;
            res.push({ name, properties: index, build, constrain: undefined, duplicates: undefined });
        }
        // without the extension there is no operator class to build these with, and the warning that
        // says so has already been given
        if (this.trigramSupport.threshold != undefined) {
            for (const property of this.searchableColumnsOf(entity)) {
                const name: string = trigramIndexName(tableName, property);
                const build: string = `CREATE INDEX CONCURRENTLY ${escapeIdentifier(name)} ON ${table}`
                    + ` USING GIN (${columnsOf([property]).join('')} gin_trgm_ops)`;
                res.push({ name, properties: [property], build, constrain: undefined, duplicates: undefined });
            }
        }
        return res;
    }

    /**
     * Creates one declared index or unique over the rows already stored.
     * @param runner - The connection to build it on.
     * @param entity - The entity declaring it.
     * @param key - What it is.
     * @throws When stored rows break the unique, naming the values they share.
     */
    private async createDeclaredKey(runner: QueryRunner, entity: Newable<BaseEntity>, key: DeclaredKey): Promise<void> {
        // looked for first, so that the failure names the values rather than leaving that to the
        // build - which finds the first and says only that it did
        await this.validateNoDuplicates(runner, entity, key);
        try {
            await runner.query(key.build);
        }
        catch (error) {
            await runner.query(`DROP INDEX CONCURRENTLY IF EXISTS ${escapeIdentifier(key.name)}`);
            // a row written meanwhile can break a unique the stored rows kept a moment ago
            await this.validateNoDuplicates(runner, entity, key);
            throw error;
        }
        if (key.constrain != undefined) {
            await this.inShortLock(runner, key.constrain);
        }
    }

    /**
     * Refuses a unique that stored rows break.
     * @param runner - The connection to look on.
     * @param entity - The entity declaring it.
     * @param key - The unique. An index has nothing to look for.
     * @throws When stored rows hold the same values, naming them.
     */
    private async validateNoDuplicates(runner: QueryRunner, entity: Newable<BaseEntity>, key: DeclaredKey): Promise<void> {
        if (key.duplicates == undefined) {
            return;
        }
        const rows: DuplicateValuesRow[] = await runner.connection.query<DuplicateValuesRow[]>(key.duplicates, [], runner);
        if (!rows.length) {
            return;
        }
        throw new InternalError([
            `Cannot keep ${entity.name} unique by ${key.properties.join(', ')}:`,
            `the stored rows hold ${rows.map(r => r.values).join(', ')} more than once.`,
            'Remove the duplicates in a migration.'
        ]);
    }

    /**
     * Runs a statement that takes the whole table, giving up rather than waiting long for it.
     *
     * Every read and write of the table queues behind a statement waiting for that lock, so one that
     * waits on a long transaction stops the table for as long. The statements this runs are over as
     * soon as they hold it.
     * @param runner - The connection to run it on.
     * @param statement - The statement.
     */
    private async inShortLock(runner: QueryRunner, statement: string): Promise<void> {
        await runner.startTransaction();
        try {
            await runner.query(`SET LOCAL lock_timeout = ${inject(ZIBRI_DI_TOKENS.SCHEMA_LOCK_TIMEOUT_IN_MS)}`);
            await runner.query(statement);
            await runner.commitTransaction();
        }
        catch (error) {
            await runner.rollbackTransaction();
            throw error;
        }
    }

    /**
     * What a number is handed to the driver as.
     *
     * An exact decimal is the one kind the driver has no way to write: it is an object it does not
     * recognize, and what it makes of one of those is json - quotes included - which postgres does
     * not read as a number. So that one is handed over as text.
     *
     * Every other kind the driver already writes as itself, down to a whole number past what a
     * double holds, and stays what it is. Which keeps the value about to be written comparable with
     * the one that was read: text in place of a number differs from the number the row holds, and a
     * column that differs is a column written again on every save, touched or not.
     * @param value - The number to write.
     * @returns What the driver is given.
     */
    private toNumberColumnValue(value: AnyNumber | null | undefined): AnyNumber | string | null {
        if (value == undefined) {
            // eslint-disable-next-line unicorn/no-null
            return null;
        }
        // toFixed rather than toString, because bignumber.js writes an exponent past its configured
        // range and postgres reads "1e+25" as a numeric it cannot parse
        return value instanceof BigNumber ? value.toFixed() : value;
    }

    /**
     * Builds the value transformer for a number column.
     *
     * What comes back is text wherever the column holds more than a javascript number does - a whole
     * number past `Number.MAX_SAFE_INTEGER`, or a decimal with more digits than a double keeps - so
     * the format is what reads it into the type its property declares.
     * @param format - What kind of number the property holds.
     * @returns The value transformer to put on the column.
     */
    private numberColumnTransformer(format: NumberFormat): ValueTransformer {
        // typeorm applies the transformer to where filter values as well, by calling
        // FindOperator.transformValue. That method maps composite operators (And/Or) over their
        // children instead of recursing into them, so the children arrive here as FindOperators and
        // have to be transformed by hand. Without this, String(childOperator) would turn them into
        // "[object Object]" and every filter with multiple conditions on a number column would break.
        const transformer: ValueTransformer = {
            to: (v: AnyNumber | FindOperator<unknown> | null) => {
                if (v instanceof FindOperator) {
                    v.transformValue(transformer);
                    return v;
                }
                return this.toNumberColumnValue(v);
            },
            from: (v: string | number | null) => {
                if (v == undefined) {
                    return v;
                }
                return readNumber(v, format);
            }
        };
        return transformer;
    }

    /**
     * Builds the value transformer for an array of numbers.
     *
     * An array of numbers is an array of what one of them is stored as, so each element travels the
     * way a single one would. Without this the elements of a `bigint[]` come back as the text the
     * driver read them as, which is the one shape a bigint column exists to avoid.
     * @param format - What kind of number the items hold.
     * @returns The value transformer to put on the column.
     */
    private numberArrayColumnTransformer(format: NumberFormat): ValueTransformer {
        // a filter is given the elements one at a time rather than as the array the column holds,
        // because FindOperator.transformValue maps over a list of candidates instead of passing it on
        const transformer: ValueTransformer = {
            to: (v: AnyNumber | AnyNumber[] | FindOperator<unknown> | null) => {
                if (v instanceof FindOperator) {
                    v.transformValue(transformer);
                    return v;
                }
                return Array.isArray(v) ? v.map(element => this.toNumberColumnValue(element)) : this.toNumberColumnValue(v);
            },
            from: (v: string | number | (string | number)[] | null) => {
                if (v == undefined) {
                    return v;
                }
                return Array.isArray(v) ? v.map(element => readNumber(element, format)) : readNumber(v, format);
            }
        };
        return transformer;
    }

    /**
     * Builds the value transformer for a json column.
     *
     * A json column is the one place where a value is stored without a column saying what it is, so
     * the types json has no shape for - a date, a bigint, an exact decimal - travel as text and the
     * property is what reads them back. Which makes the two directions differ: writing needs nothing
     * but the value, while restoring needs the metadata that says what the text was.
     * @param restore - What turns what the driver parsed back into what the property declares.
     * A property that describes nothing about its contents passes undefined, and gets what json held.
     * @returns The value transformer to put on the column.
     */
    private jsonColumnTransformer(restore?: (value: unknown) => unknown): ValueTransformer {
        const transformer: ValueTransformer = {
            to: (v: unknown) => {
                if (v instanceof FindOperator) {
                    v.transformValue(transformer);
                    return v;
                }
                return toJsonValue(v);
            },
            from: (v: unknown) => restore == undefined || v == undefined ? v : restore(v)
        };
        return transformer;
    }

    /**
     * What the column itself defaults to, where the property declares something a column can hold.
     *
     * A `default` is applied by the application, so it may be a function of the row being written or
     * of the request making it - `() => new Date()`, or the id of whoever is logged in - and neither
     * of those is a value a column can be given. A constant is, and it is what answers for the
     * writes the application never sees: a data migration, a dba, another service against the same
     * database. So a constant becomes the column's default as well, and a function stays where it
     * already was, which is the only place it could run.
     * @param metadata - The property to read the declared default off.
     * @returns The default to declare on the column, or undefined when there is none to declare.
     */
    protected databaseDefaultFor(
        metadata: ExcludeStrict<PropertyMetadata, RelationMetadata<BaseEntity>>
    ): string | number | boolean | Date | undefined {
        if (!('default' in metadata) || typeof metadata.default === 'function') {
            return undefined;
        }
        return metadata.default;
    }

    /**
     * What column an array property needs.
     *
     * An array of objects, or of values of several shapes, is one json value rather than a list of
     * columns, so those are the arrays that are not stored as an array. Everything else becomes a real
     * array column, of whatever a single one of its items would have been stored as.
     * @param metadata - The property to build the column for.
     * @param nullable - Whether the column accepts no value.
     * @returns The options to declare the column with.
     */
    private arrayPropertyToColumnOptions(metadata: ArrayPropertyMetadata, nullable: boolean): EntitySchemaColumnOptions {
        // an array or an object has no `default` to declare in the first place, so there is nothing
        // here for `databaseDefaultFor` to find
        const items: ArrayPropertyItemMetadata = metadata.items;
        if (items.type === 'object' || items.type === 'oneOf') {
            return {
                nullable,
                ...metadata,
                type: this.fullColumnTypeMapping[items.type],
                default: undefined,
                transformer: this.jsonColumnTransformer(v => parseArray(v, items))
            };
        }
        return {
            nullable,
            ...metadata,
            type: items.type === 'number'
                ? this.numberColumnType(items.format)
                : this.fullColumnTypeMapping[items.type],
            array: true,
            default: undefined,
            transformer: items.type === 'number' ? this.numberArrayColumnTransformer(items.format) : undefined
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected propertyToColumnOptions(
        metadata: ExcludeStrict<PropertyMetadata, RelationMetadata<BaseEntity>>
    ): EntitySchemaColumnOptions {
        const nullable: boolean = typeof metadata.required === 'boolean' ? !metadata.required : true;
        const columnDefault: string | number | boolean | Date | undefined = this.databaseDefaultFor(metadata);
        switch (metadata.type) {
            case 'file':
            case 'boolean':
            case 'date': {
                return {
                    nullable,
                    ...metadata,
                    type: this.fullColumnTypeMapping[metadata.type],
                    default: columnDefault
                };
            }
            case 'object': {
                return {
                    nullable,
                    ...metadata,
                    type: this.fullColumnTypeMapping[metadata.type],
                    default: columnDefault,
                    transformer: this.jsonColumnTransformer(v => parseObject(v, metadata.cls()))
                };
            }
            case 'unknown': {
                return {
                    nullable,
                    ...metadata,
                    type: this.fullColumnTypeMapping[metadata.type],
                    default: columnDefault,
                    // no way back: a property that says nothing about what it holds leaves nothing
                    // to read a date or an exact decimal by, so what json held is what comes out
                    transformer: this.jsonColumnTransformer()
                };
            }
            case 'array': {
                return this.arrayPropertyToColumnOptions(metadata, nullable);
            }
            case 'oneOf': {
                return {
                    nullable,
                    ...metadata,
                    type: this.fullColumnTypeMapping[metadata.type],
                    default: undefined,
                    transformer: this.jsonColumnTransformer(v => parseOneOf(v, metadata))
                };
            }
            case 'number': {
                return {
                    nullable,
                    generated: metadata.primary ? 'increment' : undefined,
                    ...metadata,
                    type: this.numberColumnType(metadata.format),
                    default: columnDefault,
                    // the schema declares it as a named constraint instead, see the string case
                    unique: false,
                    transformer: this.numberColumnTransformer(metadata.format)
                };
            }
            case 'string': {
                const isUuid: boolean = metadata.format === 'uuid' || metadata.primary;
                return {
                    nullable,
                    generated: metadata.primary ? 'uuid' : undefined,
                    ...metadata,
                    type: isUuid ? 'uuid' : this.fullColumnTypeMapping[metadata.type],
                    // the order the application says text has, so that a query ordering or comparing
                    // this column answers what the same order and the same filter answer in process.
                    // A uuid is not text to postgres and cannot carry one
                    collation: isUuid ? undefined : this.textCollation,
                    length: metadata.maxLength,
                    enum: metadata.enum ? ObjectUtilities.values(metadata.enum) : undefined,
                    default: columnDefault,
                    // never here: a column unique among every row is a constraint the schema declares
                    // under the name an upsert and a migration refer to it by, and one unique among
                    // some of them is the partial index it declares. Written out because the spread
                    // above carries the property's own `unique`, which the orm would turn into a
                    // second constraint under a generated name
                    unique: false
                };
            }
        }
    }
}