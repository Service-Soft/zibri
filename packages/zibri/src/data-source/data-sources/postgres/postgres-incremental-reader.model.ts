import { createHash, randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';

import { PgOutputMessage, PgOutputRelation, PgOutputValue } from './pg-output-message.model';
import { PgOutputUtilities } from './pg-output.utilities';
import { PostgresBackupReadProgress } from './postgres-backup-read-progress.model';
import { type PostgresBackupRunner } from './postgres-backup.runner';
import { PostgresChangeRow } from './postgres-change-line.model';
import { POSTGRES_CHANGE_FORMAT_VERSION, PostgresChangeSqlUtilities } from './postgres-change-sql.utilities';
import { Pg, PgQueryResult, PgSessionClient } from './postgres-client.model';
import { type PostgresDataSource } from './postgres-data-source.model';
import { PostgresReadCursor } from './postgres-read-cursor.model';
import { PostgresSqlUtilities } from './postgres-sql.utilities';
import { type IncrementalBackupData } from '../../../backup/incremental-backup-data.model';
import { InternalError } from '../../../error-handling/internal-error.model';
import { type LoggerInterface } from '../../../logging/logger.interface';
import { JsonUtilities } from '../../../utilities/json.utilities';
import { MetadataUtilities } from '../../../utilities/metadata.utilities';
import { Ms } from '../../../utilities/ms';
import { optionalPeer } from '../../../utilities/optional-peer.function';

/**
 * The oldest postgres whose replication slots can be kept from holding back the WAL without end, by
 * `max_slot_wal_keep_size`.
 */
const MIN_SERVER_VERSION_NUM: number = 130000;

/**
 * From which postgres a role can be granted the setting of `session_replication_role` without being a superuser.
 */
const PARAMETER_PRIVILEGE_VERSION_NUM: number = 150000;

/**
 * How many replication slots a data source reading only what changed takes at most: its own, and the
 * temporary one each backup of what changed takes its snapshot from.
 */
const SLOTS_TAKEN: number = 2;

/**
 * How many rows of a table read in full go in one line.
 */
const ROWS_PER_LINE: number = 500;

/**
 * How often creating a slot that still waits for the transactions running when it started says so,
 * naming them.
 */
const SLOT_WAIT_REPORT_IN_MS: number = 10 * Ms.SECOND;

/**
 * How the connections reading values write them as text, in a shape that reads back the same under any
 * setting.
 */
const VALUE_OUTPUT_SETTINGS: string = '-c DateStyle=ISO -c IntervalStyle=postgres -c extra_float_digits=3';

/**
 * Builds a stream of rows read through a cursor.
 */
type PgQueryStream = new (sql: string, values: unknown[]) => Readable;

/**
 * What a slot created over a replication connection answers.
 */
type CreatedSlot = {
    /**
     * The WAL position from which the slot holds every transaction committing.
     */
    consistentPoint: string,
    /**
     * The snapshot the connection exports, which holds every transaction committed before it.
     */
    snapshot: string
};

/**
 * The names a data source's slot and publication go by.
 */
type IncrementalReadNames = {
    /**
     * The name of the replication slot.
     */
    slot: string,
    /**
     * The name of the publication.
     */
    publication: string
};

/**
 * How a table a backup covers is read: through the publication, or in full every time.
 */
type ReadTables = {
    /**
     * The tables read through the publication.
     */
    published: string[],
    /**
     * The tables read in full every time.
     */
    readInFull: string[]
};

// logical decoding rather than the other two ways there are. A physical backup (base backup and WAL) is
// restored by replacing the data directory of a stopped server, which neither the application's container
// nor a managed database allows, and it covers the whole cluster, so no schema of its own and no tenant.
// A journal the repositories write cannot be exact: raw statements, ON DELETE CASCADE, triggers,
// migrations and other clients write past them. The slot sees every committed row change, whoever made it
/**
 * Reads only what changed in a postgres data source since an earlier backup, through logical decoding:
 * a replication slot of its own holding every change of the tables its publication lists.
 */
export class PostgresIncrementalReader {
    constructor(
        private readonly dataSource: PostgresDataSource,
        private readonly runner: PostgresBackupRunner,
        private readonly logger: LoggerInterface
    ) {}

    /**
     * Validates that the server and the role backups run as can read only what changed, and restore it.
     * @throws When one of them cannot, naming everything that needs to change.
     */
    async validateConfiguration(): Promise<void> {
        const { slot } = await this.resolveNames();
        const schema: string = await this.runner.resolveSchemaName();
        await this.withClient(async client => {
            const [version] = (await client.query('SHOW server_version_num')).rows;
            const versionNum: number = Number(version?.['server_version_num']);
            if (versionNum < MIN_SERVER_VERSION_NUM) {
                throw new InternalError(
                    'Invalid data source marked with @Backup: incrementalRead needs to run against Postgres 13 or later,'
                    + ` and the server is ${versionNum}.`
                );
            }
            const parameterPrivilege: boolean = versionNum >= PARAMETER_PRIVILEGE_VERSION_NUM;
            const [row] = (await client.query(
                'SELECT current_user AS "user", current_database() AS "database", current_setting(\'wal_level\') AS "walLevel",'
                + ' current_setting(\'server_encoding\') AS "encoding",'
                + ' pg_catalog.has_database_privilege(current_database(), \'CREATE\') AS "createsInDatabase",'
                + ' current_setting(\'max_replication_slots\')::int AS "maxSlots",'
                + ' current_setting(\'max_slot_wal_keep_size\') AS "keepSize",'
                + ' r.rolsuper AS "superuser", r.rolreplication AS "replication",'
                + ' CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = \'rds_replication\')'
                + ' THEN pg_catalog.pg_has_role(current_user, \'rds_replication\', \'member\') ELSE false END AS "rdsReplication",'
                + ' (SELECT count(*) FROM pg_catalog.pg_replication_slots WHERE slot_name <> $1)::int AS "otherSlots",'
                + (parameterPrivilege
                    ? ' pg_catalog.has_parameter_privilege(current_user, \'session_replication_role\', \'SET\') AS "setsReplicationRole"'
                    : ' false AS "setsReplicationRole"')
                + ' FROM pg_catalog.pg_roles r WHERE r.rolname = current_user',
                [slot]
            )).rows;
            const user: string = String(row?.['user']);
            const superuser: boolean = row?.['superuser'] === true;
            const problems: string[] = [];
            if (row?.['walLevel'] !== 'logical') {
                problems.push(
                    `wal_level needs to be logical, and is ${String(row?.['walLevel'])}:`
                    + ' set it in the server\'s configuration and restart it,'
                    + ' or set the parameter of a managed database, such as rds.logical_replication on RDS.'
                );
            }
            // the changes arrive in the encoding of the database, where the rows a query reads are converted to
            // the connection's: each character outside ASCII of another one was read wrongly, without an error
            // postgres names the encoding UTF8, which the setting is compared with as it is written
            // eslint-disable-next-line unicorn/text-encoding-identifier-case
            if (row?.['encoding'] !== 'UTF8') {
                problems.push(
                    `The database needs to be encoded in UTF8, and is in ${String(row?.['encoding'])}:`
                    + ' create it anew with ENCODING \'UTF8\''
                    + ' and move the data over, or back it up without incrementalRead.'
                );
            }
            if (row?.['keepSize'] === '-1') {
                problems.push(
                    'max_slot_wal_keep_size needs to be set,'
                    + ' which bounds what a replication slot nobody reads anymore holds back of the WAL.'
                );
            }
            if (!superuser && row?.['replication'] !== true && row?.['rdsReplication'] !== true) {
                problems.push(
                    `The role backups run as, "${user}", needs to be allowed to replicate:`
                    + ` ALTER ROLE "${user}" REPLICATION, or GRANT rds_replication on RDS.`
                );
            }
            if (!superuser && row?.['setsReplicationRole'] !== true) {
                problems.push(parameterPrivilege
                    ? `The role backups run as, "${user}", needs to be allowed to set session_replication_role,`
                    + ' which a restore applies changes under:'
                    + ` GRANT SET ON PARAMETER session_replication_role TO "${user}".`
                    : `The role backups run as, "${user}", needs to be a superuser on Postgres 13 and 14 to set session_replication_role,`
                        + ' which a restore applies changes under.');
            }
            const free: number = Number(row?.['maxSlots']) - Number(row?.['otherSlots']);
            if (free < SLOTS_TAKEN) {
                problems.push(
                    `max_replication_slots needs to leave ${SLOTS_TAKEN} replication slots for the data source, and leaves ${free}.`
                );
            }
            // what creating the publication takes, which the first backup does, and failed there with every
            // attempt of every backup, the application having booted
            if (row?.['createsInDatabase'] !== true) {
                problems.push(
                    `The role backups run as, "${user}", needs to have CREATE on the database, which the publication of the tables`
                    + ` read through the changes is created with: GRANT CREATE ON DATABASE "${String(row?.['database'])}" TO "${user}".`
                );
            }
            // of the tables there are now: one created later by anything but the application's own schema is
            // named by the error of the backup that fails on it
            const { published } = await this.resolveReadTables(client, schema, undefined);
            const notOwned: Record<string, unknown>[] = (await client.query(
                'SELECT c.relname AS "name", pg_catalog.pg_get_userbyid(c.relowner) AS "owner"'
                + ' FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace'
                + ' WHERE n.nspname = $1 AND c.relname = ANY($2) AND NOT pg_catalog.pg_has_role(current_user, c.relowner, \'USAGE\')'
                + ' ORDER BY c.relname',
                [schema, published]
            )).rows;
            if (notOwned.length) {
                const owners: string[] = [...new Set(notOwned.map(t => `"${String(t['owner'])}"`))];
                const notOwnedTables: string = notOwned.map(t => `"${String(t['name'])}" of "${String(t['owner'])}"`).join(', ');
                problems.push(
                    `The role backups run as, "${user}", needs to own the tables read through the changes, or be a member of the role`
                    + ` owning them, and does not own ${notOwnedTables}:`
                    + ` ALTER TABLE … OWNER TO "${user}" for each, or GRANT ${owners.join(', ')} TO "${user}".`
                );
            }
            if (problems.length) {
                throw new InternalError(['Invalid data source marked with @Backup, which reads only what changed:', ...problems]);
            }
        });
    }

    /**
     * Drops the slot and the publication of a data source that read only what changed before and no longer
     * does, which would otherwise hold back the WAL.
     */
    async dropLeftovers(): Promise<void> {
        const { slot, publication } = await this.resolveNames();
        const [found] = await this.dataSource.runStatement({
            sql: 'SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_replication_slots WHERE slot_name = :slot) AS "slot",'
                + ' EXISTS (SELECT 1 FROM pg_catalog.pg_publication WHERE pubname = :publication) AS "publication"',
            parameters: { slot, publication }
        });
        if (found?.['slot'] !== true && found?.['publication'] !== true) {
            return;
        }
        await this.withClient(async client => {
            await this.dropSlot(client, slot);
            await client.query(`DROP PUBLICATION IF EXISTS ${PostgresSqlUtilities.escapeIdentifier(publication)}`);
        });
        this.logger.info(
            `Dropped the replication slot and publication "${slot}",`
            + ` since "${this.dataSource.constructor.name}" no longer reads only what changed.`
        );
    }

    /**
     * Reads for a backup: what changed since the cursor, or in full when there is none or it cannot be
     * read on from.
     * @param chunked - Whether the backup cuts the data into chunks.
     * @param since - The cursor of the backup this one builds on, or undefined.
     * @param progress - Where the read notes the step it is at, until its data is read.
     * @returns The data, whether it is in full, and the cursor the next backup reads on from.
     */
    async read(chunked: boolean, since: string | undefined, progress: PostgresBackupReadProgress): Promise<IncrementalBackupData> {
        const cursor: PostgresReadCursor | undefined = since == undefined ? undefined : this.parseCursor(since);
        const changes: IncrementalBackupData | undefined = cursor == undefined ? undefined : await this.readChanges(cursor, progress);
        return changes ?? await this.readFull(chunked, progress);
    }

    /**
     * Lets the slot go of what a completed backup holds.
     * @param cursor - The cursor that backup was handed back.
     */
    async confirm(cursor: string): Promise<void> {
        const read: PostgresReadCursor | undefined = this.parseCursor(cursor);
        const { slot } = await this.resolveNames();
        if (read?.slot !== slot) {
            return;
        }
        // only forward: a backup completing after a newer one changes nothing
        await this.withClient(async client => await client.query(
            'SELECT pg_catalog.pg_replication_slot_advance(slot_name, $2::pg_lsn) FROM pg_catalog.pg_replication_slots'
            + ' WHERE slot_name = $1 AND confirmed_flush_lsn < $2::pg_lsn',
            [slot, read.lsn]
        ));
    }

    /**
     * Drops the slot, after which the next backup reads in full.
     */
    async forget(): Promise<void> {
        const { slot } = await this.resolveNames();
        await this.withClient(async client => await this.dropSlot(client, slot));
    }

    /**
     * Reads in full: sets the tables of the publication, creates the slot, and dumps at the snapshot it
     * exports, so that every change after the dump is in the slot and none before it.
     * @param chunked - Whether the backup cuts the dump into chunks.
     * @param progress - Where the read notes the step it is at.
     * @returns The dump, and the cursor the next backup reads on from.
     */
    private async readFull(chunked: boolean, progress: PostgresBackupReadProgress): Promise<IncrementalBackupData> {
        const { slot, publication } = await this.resolveNames();
        const schema: string = await this.runner.resolveSchemaName();
        progress.step = 'setting up the publication';
        await this.withClient(async client => {
            await this.dropSlot(client, slot);
            const { published } = await this.resolveReadTables(client, schema, undefined);
            await client.query(`DROP PUBLICATION IF EXISTS ${PostgresSqlUtilities.escapeIdentifier(publication)}`);
            try {
                const publishedTables: string = published
                    .map(t => `${PostgresSqlUtilities.escapeIdentifier(schema)}.${PostgresSqlUtilities.escapeIdentifier(t)}`)
                    .join(', ');
                const forTables: string = published.length ? ` FOR TABLE ${publishedTables}` : '';
                await client.query(`CREATE PUBLICATION ${PostgresSqlUtilities.escapeIdentifier(publication)}${forTables}`);
            }
            catch (error) {
                throw new InternalError(
                    `Could not create the publication of "${this.dataSource.constructor.name}":`
                    + ' the role backups run as needs to own its tables'
                    + ' and to have CREATE on the database.',
                    { cause: error }
                );
            }
        });
        progress.step = 'creating the slot';
        const replication: PgSessionClient = await this.openClient(true);
        try {
            const created: CreatedSlot = await this.createSlot(replication, slot, false);
            progress.step = 'reading the schema hash';
            const schemaHash: string = await this.runner.resolveSchemaHash(created.snapshot);
            progress.step = 'dumping';
            const data: Readable = await this.runner.createBackupData(chunked, created.snapshot);
            // the exporting connection holds the snapshot for as long as the dump may still take it up
            this.endWith(data, replication);
            return { data, full: true, cursor: this.formatCursor({ slot, lsn: created.consistentPoint, schemaHash }) };
        }
        catch (error) {
            await replication.end();
            throw error;
        }
    }

    /**
     * Reads what changed since a cursor, up to the snapshot of a temporary slot, at which the tables read
     * in full and the sequences are read as well.
     * @param since - The cursor.
     * @param progress - Where the read notes the step it is at, until its data is read.
     * @returns What changed, or undefined when the slot cannot be read on from, or the schema changed since.
     */
    private async readChanges(since: PostgresReadCursor, progress: PostgresBackupReadProgress): Promise<IncrementalBackupData | undefined> {
        const { slot } = await this.resolveNames();
        if (since.slot !== slot) {
            return undefined;
        }
        progress.step = 'checking the slot';
        const [state] = await this.withClient(async client => (await client.query(
            'SELECT confirmed_flush_lsn::text AS "confirmed", wal_status AS "walStatus"'
            + ' FROM pg_catalog.pg_replication_slots WHERE slot_name = $1',
            [slot]
        )).rows);
        // a slot that let go of what is after the cursor, or lost the WAL holding it, cannot say what changed.
        // The position is read as text, so it is a string or null
        if (state == undefined || state['walStatus'] === 'lost' || typeof state['confirmed'] !== 'string'
            || PgOutputUtilities.parseLsn(state['confirmed']) > PgOutputUtilities.parseLsn(since.lsn)) {
            return undefined;
        }
        progress.step = 'creating a temporary slot';
        const replication: PgSessionClient = await this.openClient(true);
        try {
            // a name of its own per backup: two reading at once each take one
            const created: CreatedSlot = await this.createSlot(replication, `${slot}_${randomBytes(4).toString('hex')}`, true);
            progress.step = 'reading the schema hash';
            const schemaHash: string = await this.runner.resolveSchemaHash(created.snapshot);
            // the changes after a schema change apply to a schema the backup in full does not hold
            if (schemaHash !== since.schemaHash) {
                await replication.end();
                return undefined;
            }
            const data: Readable = Readable.from(this.handOver(this.resolveChangeLines(since, created, progress), progress));
            // read only once the backup reads it, which it waits for until then
            progress.step = 'handing over what changed';
            progress.waitsForReader = true;
            this.endWith(data, replication);
            return { data, full: false, cursor: this.formatCursor({ slot, lsn: created.consistentPoint, schemaHash }) };
        }
        catch (error) {
            await replication.end();
            throw error;
        }
    }

    /**
     * The lines of what changed: the decoded changes of every transaction committed from the cursor up to
     * the snapshot, then each table read in full and each sequence, at the snapshot.
     * @param since - The cursor.
     * @param upTo - The temporary slot, whose consistent point is where the changes end.
     * @param progress - Where the read notes the step it is at.
     * @yields The lines.
     */
    private async* resolveChangeLines(
        since: PostgresReadCursor,
        upTo: CreatedSlot,
        progress: PostgresBackupReadProgress
    ): AsyncGenerator<string> {
        const { slot, publication } = await this.resolveNames();
        const schema: string = await this.runner.resolveSchemaName();
        const from: bigint = PgOutputUtilities.parseLsn(since.lsn);
        const to: bigint = PgOutputUtilities.parseLsn(upTo.consistentPoint);
        const QueryStream: PgQueryStream = optionalPeer<PgQueryStream>('pg-query-stream', 'Streaming rows from postgres');
        progress.step = 'connecting to read what changed';
        const client: PgSessionClient = await this.openClient(false);
        try {
            yield PostgresChangeSqlUtilities.resolveLine({ kind: 'header', formatVersion: POSTGRES_CHANGE_FORMAT_VERSION });
            // before the changes are read, which take the connection until they end. The schema is the one
            // of the cursor, which the schema hash compared before
            progress.step = 'reading which tables read in full are referenced';
            const referencedBy: Map<string, string[]> = await this.resolveReferencesReadInFull(client, schema, publication);
            progress.step = 'reading what changed';
            const relations: Map<number, PgOutputRelation> = new Map();
            let included: boolean = false;
            const changes: Readable = client.query(new QueryStream(
                'SELECT data FROM pg_catalog.pg_logical_slot_peek_binary_changes('
                + '$1, NULL, NULL, \'proto_version\', \'1\', \'publication_names\', $2)',
                [slot, publication]
            ));
            try {
                for await (const row of changes) {
                    const message: PgOutputMessage = PgOutputUtilities.decode(this.resolveMessageBytes(row));
                    if (message.kind === 'relation') {
                        relations.set(message.relationId, message);
                        continue;
                    }
                    if (message.kind === 'begin') {
                        // what the slot still holds from before the cursor is in the backups before, and what
                        // commits from the snapshot on is in the next one
                        included = message.finalLsn >= from && message.finalLsn < to;
                        continue;
                    }
                    if (included) {
                        yield* this.resolveMessageLines(message, relations, referencedBy);
                    }
                }
            }
            finally {
                progress.step = 'ending the read of what changed';
                changes.destroy();
            }
            progress.step = 'checking the slot still held what changed';
            await this.validateSlotHolds(client, slot, since);
            progress.step = 'taking up the snapshot of the temporary slot';
            await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
            await client.query(`SET TRANSACTION SNAPSHOT '${upTo.snapshot.replaceAll('\'', '\'\'')}'`);
            const { readInFull } = await this.resolveReadTables(client, schema, publication);
            for (const table of readInFull) {
                progress.step = `reading the table "${table}" in full`;
                yield* this.resolveTableLines(client, QueryStream, schema, table);
            }
            progress.step = 'reading the sequences';
            yield* this.resolveSequenceLines(client, schema);
            await client.query('COMMIT');
            progress.step = 'done';
        }
        finally {
            await client.end();
        }
    }

    /**
     * Hands lines on, noting while one waits for the backup to take it: a read that waits there is held up by what
     * reads it, rather than by the server.
     * @param lines - The lines.
     * @param progress - Where the read notes that it waits.
     * @yields The lines.
     */
    private async* handOver(lines: AsyncIterable<string>, progress: PostgresBackupReadProgress): AsyncGenerator<string> {
        progress.waitsForReader = false;
        for await (const line of lines) {
            progress.waitsForReader = true;
            yield line;
            progress.waitsForReader = false;
        }
    }

    /**
     * Validates that the slot still held every change after the cursor when its changes were read.
     * @param client - The connection.
     * @param slot - The slot.
     * @param since - The cursor.
     * @throws When it let go of some of them, or is gone.
     */
    private async validateSlotHolds(client: PgSessionClient, slot: string, since: PostgresReadCursor): Promise<void> {
        // the slot was checked before the changes were read, and a backup completing in between, which
        // takes no lease of the resource, moves it on: the read then starts there and leaves out what
        // committed before, while this backup still builds on the one of the cursor. The peek holds the
        // slot while it reads, which moving it on refuses meanwhile, and a slot only moves forward or is
        // created anew further on, so a read that started past the cursor shows here. Failing the read
        // fails the attempt, whose retry builds on the backup that moved the slot on
        const [state] = (await client.query(
            'SELECT confirmed_flush_lsn::text AS "confirmed" FROM pg_catalog.pg_replication_slots WHERE slot_name = $1',
            [slot]
        )).rows;
        // read as text, so a string or null
        if (
            typeof state?.['confirmed'] !== 'string'
            || PgOutputUtilities.parseLsn(state['confirmed']) > PgOutputUtilities.parseLsn(since.lsn)
        ) {
            throw new InternalError(
                `The replication slot "${slot}" let go of changes the backup of "${this.dataSource.constructor.name}"`
                + ' needs while they were read,'
                + ' since a newer backup completed meanwhile: the next attempt builds on that one.'
            );
        }
    }

    /**
     * The lines of one decoded change.
     * @param message - The change.
     * @param relations - The tables described so far, by id.
     * @param referencedBy - Of each table, the tables read in full that reference it.
     * @returns The lines.
     * @throws When a change names a table not described before it.
     */
    private resolveMessageLines(
        message: PgOutputMessage,
        relations: Map<number, PgOutputRelation>,
        referencedBy: Map<string, string[]>
    ): string[] {
        const relationOf: (id: number) => PgOutputRelation = id => {
            const relation: PgOutputRelation | undefined = relations.get(id);
            if (relation == undefined) {
                throw new InternalError(`A decoded change names the table ${id}, which no message described before it.`);
            }
            return relation;
        };
        switch (message.kind) {
            case 'insert': {
                const relation: PgOutputRelation = relationOf(message.relationId);
                return [
                    PostgresChangeSqlUtilities.resolveLine({
                        kind: 'insert',
                        table: relation.table,
                        row: this.resolveRow(relation, message.values, false)
                    })
                ];
            }
            case 'update': {
                const relation: PgOutputRelation = relationOf(message.relationId);
                return [
                    PostgresChangeSqlUtilities.resolveLine({
                        kind: 'update',
                        table: relation.table,
                        key: this.resolveRow(relation, message.oldValues ?? message.values, true),
                        row: this.resolveRow(relation, message.values, false)
                    })
                ];
            }
            case 'delete': {
                const relation: PgOutputRelation = relationOf(message.relationId);
                return [
                    PostgresChangeSqlUtilities.resolveLine({
                        kind: 'delete',
                        table: relation.table,
                        key: this.resolveRow(relation, message.oldValues, true)
                    })
                ];
            }
            case 'truncate': {
                const tables: string[] = message.relationIds.map(id => relationOf(id).table);
                return [
                    PostgresChangeSqlUtilities.resolveLine({
                        kind: 'truncate',
                        tables: message.cascade ? tables : this.resolveTruncatedTables(tables, referencedBy),
                        cascade: message.cascade,
                        restartIdentity: message.restartIdentity
                    })
                ];
            }
            case 'begin':
            case 'commit':
            case 'relation':
            case 'other': {
                return [];
            }
        }
    }

    /**
     * The tables a truncate that cascades to none clears, with each table read in full that references one
     * of them, and each that references one of those.
     *
     * The decoded truncate names only the tables read through the changes, and the ones read in full it
     * named as well are left out: a truncate without one referencing a table it clears is refused, where
     * the application's had it. Each is cleared and written anew at the end of the backup anyway.
     * @param tables - The tables the truncate names.
     * @param referencedBy - Of each table, the tables read in full that reference it.
     * @returns The tables.
     */
    private resolveTruncatedTables(tables: string[], referencedBy: Map<string, string[]>): string[] {
        const res: Set<string> = new Set(tables);
        // a set visits what is added to it while it is visited, which walks the references through each table added
        for (const table of res) {
            for (const referencing of referencedBy.get(table) ?? []) {
                res.add(referencing);
            }
        }
        return [...res];
    }

    /**
     * Of each table of the schema, the tables read in full that reference it.
     * @param client - The connection.
     * @param schema - The schema.
     * @param publication - The publication whose tables are the ones read through the changes.
     * @returns The tables, by the table they reference.
     */
    private async resolveReferencesReadInFull(
        client: PgSessionClient,
        schema: string,
        publication: string
    ): Promise<Map<string, string[]>> {
        const { readInFull } = await this.resolveReadTables(client, schema, publication);
        const result: PgQueryResult = await client.query(
            'SELECT DISTINCT referenced.relname AS "referenced", referencing.relname AS "referencing"'
            + ' FROM pg_catalog.pg_constraint k'
            + ' JOIN pg_catalog.pg_class referencing ON referencing.oid = k.conrelid'
            + ' JOIN pg_catalog.pg_class referenced ON referenced.oid = k.confrelid'
            + ' JOIN pg_catalog.pg_namespace n ON n.oid = referencing.relnamespace'
            + ' JOIN pg_catalog.pg_namespace rn ON rn.oid = referenced.relnamespace'
            + ' WHERE k.contype = \'f\' AND n.nspname = $1 AND rn.nspname = $1 AND referencing.relname = ANY($2)',
            [schema, readInFull]
        );
        const res: Map<string, string[]> = new Map();
        for (const row of result.rows) {
            const referenced: string = String(row['referenced']);
            res.set(referenced, [...res.get(referenced) ?? [], String(row['referencing'])]);
        }
        return res;
    }

    /**
     * The columns of a decoded row and their values: the key's, or every one sent.
     * @param relation - The table.
     * @param values - The row's values, one per column.
     * @param key - Whether only the replica identity is wanted.
     * @returns The row.
     */
    private resolveRow(relation: PgOutputRelation, values: PgOutputValue[], key: boolean): PostgresChangeRow {
        const row: PostgresChangeRow = { columns: [], values: [] };
        for (const [i, column] of relation.columns.entries()) {
            const value: PgOutputValue | undefined = values[i];
            // a TOASTed value an update left unchanged is not sent, and stays as it is
            if (value == undefined || value.kind === 'unchanged' || (key && !column.key)) {
                continue;
            }
            row.columns.push(column.name);
            row.values.push(value.kind === 'text' ? value.text : null);
        }
        return row;
    }

    /**
     * The lines of a table read in full: a clear, then its rows, at the snapshot of the transaction.
     * @param client - The connection, in the transaction.
     * @param QueryStream - What reads rows through a cursor.
     * @param schema - The schema.
     * @param table - The table.
     * @yields The lines.
     */
    private async* resolveTableLines(
        client: PgSessionClient,
        QueryStream: PgQueryStream,
        schema: string,
        table: string
    ): AsyncGenerator<string> {
        const qualified: string = `${PostgresSqlUtilities.escapeIdentifier(schema)}.${PostgresSqlUtilities.escapeIdentifier(table)}`;
        // without the generated ones, which postgres writes itself
        const columns: string[] = (await client.query(
            'SELECT attname AS "name" FROM pg_catalog.pg_attribute WHERE attrelid = $1::regclass AND attnum > 0 AND NOT attisdropped'
            + ' AND attgenerated = \'\' ORDER BY attnum',
            [qualified]
        )).rows.map(r => String(r['name']));
        yield PostgresChangeSqlUtilities.resolveLine({ kind: 'clear', table });
        if (!columns.length) {
            return;
        }
        const selected: string = columns.map((c, i) => `${PostgresSqlUtilities.escapeIdentifier(c)}::text AS "c${i}"`).join(', ');
        const rows: Readable = client.query(new QueryStream(`SELECT ${selected} FROM ${qualified}`, []));
        let values: (string | null)[][] = [];
        try {
            for await (const row of rows) {
                const read: unknown = row;
                const record: Record<string, unknown> = typeof read === 'object' && read != undefined
                    ? Object.fromEntries(Object.entries(read))
                    : {};
                values.push(columns.map((_, i) => {
                    const value: unknown = record[`c${i}`];
                    // each column is read as text, so a string or null
                    return typeof value === 'string' ? value : null;
                }));
                if (values.length >= ROWS_PER_LINE) {
                    yield PostgresChangeSqlUtilities.resolveLine({ kind: 'rows', table, columns, values });
                    values = [];
                }
            }
        }
        finally {
            rows.destroy();
        }
        if (values.length) {
            yield PostgresChangeSqlUtilities.resolveLine({ kind: 'rows', table, columns, values });
        }
    }

    /**
     * The lines of the sequences a backup covers, which logical decoding does not carry.
     * @param client - The connection.
     * @param schema - The schema.
     * @yields The lines.
     */
    private async* resolveSequenceLines(client: PgSessionClient, schema: string): AsyncGenerator<string> {
        const tables: string[] = await this.runner.resolveBackedUpTableNames(schema);
        // of a backup of the schema each of its sequences, of the entity tables the ones their columns own
        const sequences: string[] = (await client.query(
            'SELECT s.relname AS "name" FROM pg_catalog.pg_class s JOIN pg_catalog.pg_namespace n ON n.oid = s.relnamespace'
            + ' WHERE n.nspname = $1 AND s.relkind = \'S\' AND ($2::boolean OR EXISTS ('
            + ' SELECT 1 FROM pg_catalog.pg_depend d JOIN pg_catalog.pg_class t ON t.oid = d.refobjid'
            + ' WHERE d.classid = \'pg_catalog.pg_class\'::regclass AND d.objid = s.oid AND d.deptype IN (\'a\', \'i\')'
            + ' AND t.relname = ANY($3)))',
            [schema, this.dataSource.backupScope !== 'entity-tables', tables]
        )).rows.map(r => String(r['name']));
        for (const sequence of sequences) {
            const qualified: string = `${PostgresSqlUtilities.escapeIdentifier(schema)}.${PostgresSqlUtilities.escapeIdentifier(sequence)}`;
            const [row] = (await client.query(
                `SELECT last_value::text AS "lastValue", is_called AS "isCalled" FROM ${qualified}`
            )).rows;
            yield PostgresChangeSqlUtilities.resolveLine({
                kind: 'sequence',
                sequence,
                lastValue: String(row?.['lastValue']),
                isCalled: row?.['isCalled'] === true
            });
        }
    }

    /**
     * Resolves how each table a backup covers is read. Through the publication: a table postgres writes
     * every change of to the WAL, naming each row by a primary key or an index of its own, and whose
     * changes can be applied as statements. In full every time: an unlogged table, one without such a
     * replica identity, which postgres would refuse updates and deletes of once published, and one with a
     * column generated always as an identity, which an update cannot set.
     * @param client - The connection, as the role backups run as.
     * @param schema - The schema.
     * @param publication - The publication whose tables are the ones read through it, or undefined to
     * decide which tables are.
     * @returns The tables.
     */
    private async resolveReadTables(client: PgSessionClient, schema: string, publication: string | undefined): Promise<ReadTables> {
        const tables: string[] = await this.runner.resolveBackedUpTableNames(schema);
        const result: PgQueryResult = await client.query(
            'SELECT c.relname AS "name", c.relkind = \'p\' AS "partitioned",'
            + ' CASE WHEN $3::text IS NULL THEN c.relpersistence = \'p\''
            + ' AND ((c.relreplident = \'d\' AND EXISTS (SELECT 1 FROM pg_catalog.pg_index i WHERE i.indrelid = c.oid AND i.indisprimary))'
            + ' OR c.relreplident = \'i\')'
            + ' AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a'
            + ' WHERE a.attrelid = c.oid AND a.attidentity = \'a\' AND NOT a.attisdropped)'
            + ' ELSE EXISTS (SELECT 1 FROM pg_catalog.pg_publication_tables p'
            + ' WHERE p.pubname = $3::text AND p.schemaname = $1 AND p.tablename = c.relname)'
            + ' END AS "published"'
            + ' FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace'
            + ' WHERE n.nspname = $1 AND c.relname = ANY($2) ORDER BY c.relname',
            [schema, tables, publication ?? null]
        );
        // a partitioned table holds no rows of its own: its partitions are read, each as a table of its own
        const read: Record<string, unknown>[] = result.rows.filter(r => r['partitioned'] !== true);
        return {
            published: read.filter(r => r['published'] === true).map(r => String(r['name'])),
            readInFull: read.filter(r => r['published'] !== true).map(r => String(r['name']))
        };
    }

    private async createSlot(replication: PgSessionClient, name: string, temporary: boolean): Promise<CreatedSlot> {
        // waits for the transactions running at that moment to end, from which on the slot holds every change.
        // One left open holds the backup for as long, which is said, naming it, while it does
        const report: NodeJS.Timeout = setInterval(() => void this.reportSlotWait(name), SLOT_WAIT_REPORT_IN_MS);
        report.unref();
        let created: Record<string, unknown> | undefined;
        try {
            [created] = (await replication.query(
                `CREATE_REPLICATION_SLOT ${name}${temporary ? ' TEMPORARY' : ''} LOGICAL pgoutput EXPORT_SNAPSHOT`
            )).rows;
        }
        finally {
            clearInterval(report);
        }
        const row: Record<string, unknown> | undefined = created;
        if (typeof row?.['consistent_point'] !== 'string' || typeof row['snapshot_name'] !== 'string') {
            throw new InternalError(`Creating the replication slot "${name}" answered no snapshot.`);
        }
        return { consistentPoint: row['consistent_point'], snapshot: row['snapshot_name'] };
    }

    /**
     * Warns that creating a slot still waits, naming the transactions it waits for: those holding a
     * transaction id, which every one writing does.
     * @param name - The slot.
     */
    private async reportSlotWait(name: string): Promise<void> {
        try {
            const waitedFor: Record<string, unknown>[] = await this.withClient(async client => (await client.query(
                'SELECT pid, application_name AS "application", state,'
                + ' extract(epoch FROM now() - xact_start)::int AS "seconds", left(query, 200) AS "query"'
                + ' FROM pg_catalog.pg_stat_activity WHERE backend_xid IS NOT NULL AND pid <> pg_catalog.pg_backend_pid()'
                + ' ORDER BY xact_start'
            )).rows);
            const described: string = waitedFor
                .map(t => {
                    // an empty name, or none, is said as such
                    const application: unknown = t['application'];
                    const named: string = typeof application === 'string' && application !== '' ? application : 'no application';
                    return `pid ${String(t['pid'])} (${named}, ${String(t['state'])} for ${String(t['seconds'])} s): ${String(t['query'])}`;
                })
                .join('; ');
            this.logger.warn(
                `Creating the replication slot "${name}" of "${this.dataSource.constructor.name}"`
                + ' waits for the transactions running when it'
                + ` started to end: ${described || 'none is running now, so it waits for the server'}`
            );
        }
        catch (error) {
            this.logger.warn(
                `Could not tell what creating the replication slot "${name}" waits for: `
                + (error instanceof Error ? error.message : String(error))
            );
        }
    }

    private async dropSlot(client: PgSessionClient, slot: string): Promise<void> {
        await client.query(
            'SELECT pg_catalog.pg_drop_replication_slot(slot_name) FROM pg_catalog.pg_replication_slots WHERE slot_name = $1',
            [slot]
        );
    }

    /**
     * Ends a connection once a stream it serves is done, however that is.
     * @param data - The stream.
     * @param client - The connection.
     */
    private endWith(data: Readable, client: PgSessionClient): void {
        data.once('close', () => void this.endReplicationClient(client));
    }

    /**
     * Ends a replication connection, warning when that fails.
     * @param client - The connection.
     */
    private async endReplicationClient(client: PgSessionClient): Promise<void> {
        try {
            await client.end();
        }
        catch (error) {
            this.logger.warn(
                `Could not close a replication connection of "${this.dataSource.constructor.name}": `
                + (error instanceof Error ? error.message : String(error))
            );
        }
    }

    private resolveMessageBytes(row: unknown): Buffer {
        const data: unknown = typeof row === 'object' && row != undefined && 'data' in row ? row.data : undefined;
        if (!Buffer.isBuffer(data)) {
            throw new InternalError('A decoded change came back as something other than bytes.');
        }
        return data;
    }

    /**
     * The names of the data source's slot and publication: of its database, schema and resource, so that
     * two data sources on one server never share them, within what a slot's name may hold.
     * @returns The names.
     */
    private async resolveNames(): Promise<IncrementalReadNames> {
        const schema: string = await this.runner.resolveSchemaName();
        const resource: string = MetadataUtilities.getBackupResourceMetadata(this.dataSource)?.name ?? this.dataSource.constructor.name;
        const hash: string = createHash('sha256').update(`${this.dataSource.options.database ?? ''}\0${schema}\0${resource}`)
            .digest('hex');
        const name: string = `zibri_backup_${hash.slice(0, 24)}`;
        return { slot: name, publication: name };
    }

    private formatCursor(cursor: PostgresReadCursor): string {
        return JsonUtilities.stringify(cursor);
    }

    private parseCursor(cursor: string): PostgresReadCursor | undefined {
        try {
            const parsed: Partial<PostgresReadCursor> = JsonUtilities.parse<Partial<PostgresReadCursor>>(cursor);
            return typeof parsed.slot === 'string' && typeof parsed.lsn === 'string' && typeof parsed.schemaHash === 'string'
                ? { slot: parsed.slot, lsn: parsed.lsn, schemaHash: parsed.schemaHash }
                : undefined;
        }
        catch {
            // a cursor of another shape is one this build cannot read on from: the backup reads in full
            return undefined;
        }
    }

    private async withClient<T>(work: (client: PgSessionClient) => Promise<T>): Promise<T> {
        const client: PgSessionClient = await this.openClient(false);
        try {
            return await work(client);
        }
        finally {
            await client.end();
        }
    }

    private async openClient(replication: boolean): Promise<PgSessionClient> {
        const pg: Pg = optionalPeer<Pg>('pg', 'Talking to postgres');
        const config: Record<string, unknown> = await this.runner.resolveBackupConnectionConfig(replication);
        // the values of what changed are read as text, which these settings write: a role or database of
        // its own setting them otherwise writes dates a restore reads differently, and floats short of
        // their digits. The ones pg_dump sets itself
        const client: PgSessionClient = new pg.Client(replication ? config : { ...config, options: VALUE_OUTPUT_SETTINGS });
        // a connection the server ends while it waits says so as an event, which nothing listening for it
        // turns into a crash of the process. Whoever uses it learns from the next statement failing
        client.on('error', error => this.logger.error(new InternalError('A postgres backup connection failed.', { cause: error })));
        await client.connect();
        return client;
    }
}