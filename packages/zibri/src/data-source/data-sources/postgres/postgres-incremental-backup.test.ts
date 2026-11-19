import assert from 'node:assert';
import { Readable } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { BackupDataOptionsTestUtilities } from '../../../__testing__/backup/backup-data-options-test.utilities';
import { testFileFolder, TestTimeouts } from '../../../__testing__/constants';
import { queryPostgres } from '../../../__testing__/query-postgres.function';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { BackupEntity } from '../../../backup/backup-entity.model';
import { BackupResourceEntity } from '../../../backup/backup-resource-entity.model';
import { BackupServiceInterface } from '../../../backup/backup-service.interface';
import { Backup } from '../../../backup/decorators/backup-resource.decorator';
import { BackupTransport } from '../../../backup/decorators/backup-transport.decorator';
import { IncrementalBackupData } from '../../../backup/incremental-backup-data.model';
import { FsBackupTransport } from '../../../backup/transports/fs.backup-transport';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { BaseEntity } from '../../../entity/base-entity.model';
import { Newable } from '../../../types/newable.type';
import { FsPath, FsUtilities } from '../../../utilities/fs.utilities';
import { UUIDUtilities } from '../../../utilities/uuid.utilities';
import { DataSource } from '../../decorators/data-source.decorator';
import { SchemaManagement } from '../../models/schema-management.model';
import { RepositoryClass } from '../../repository/repository-class.type';
import { Transaction } from '../../transaction/transaction.model';
import { PostgresBackupScope } from './postgres-backup-scope.model';
import { PostgresDataSource, PostgresOptions } from './postgres-data-source.model';
import { PostgresPooler } from './postgres-pooler.model';

/**
 * Backups of postgres reading only what changed, through logical decoding, restored to exactly what the
 * database held: written by hand in SQL as much as through repositories, so that nothing is seen only
 * because the framework wrote it.
 */

const backupFolder: FsPath = FsUtilities.getPath(testFileFolder, `postgres-incremental-${UUIDUtilities.generate()}`);

/**
 * The tables of the suite, each read the way the data source decides for it.
 */
const TABLES: string[] = ['parent', 'child', 'audit', 'loose', 'scratch', 'swept'];

@BackupTransport()
class IncrementalPostgresTransport extends FsBackupTransport {
    constructor() {
        super('incremental-postgres-transport', backupFolder);
    }
}

@DataSource()
@Backup({ transports: [IncrementalPostgresTransport], encrypt: false })
class IncrementalPostgresDataSource extends PostgresDataSource {
    override backupScope: PostgresBackupScope = 'schema';
    override readonly incrementalRead: boolean = true;
    override options: PostgresOptions = {
        host: 'localhost',
        username: 'postgres',
        password: 'password',
        database: 'db',
        ssl: false
    };

    entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, BackupEntity, BackupResourceEntity];

    readonly repositories: RepositoryClass[] = defaultTestServerRepositories;

    schemaManagement: SchemaManagement = 'synchronize';

    readonly pooler: PostgresPooler = 'none';
}

function getDataSource(): IncrementalPostgresDataSource {
    return inject(IncrementalPostgresDataSource);
}

function getBackupService(): BackupServiceInterface {
    return inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);
}

async function runSql(sql: string, transaction?: Transaction): Promise<Record<string, unknown>[]> {
    return await queryPostgres(getDataSource(), sql, [], transaction);
}

async function takeBackup(name: string): Promise<BackupEntity> {
    return await getBackupService().waitForBackup(await getBackupService().queueBackup({ name }));
}

function getResource(backup: BackupEntity): BackupResourceEntity {
    const resource: BackupResourceEntity | undefined = backup.resources[0];
    assert(resource, 'the backup holds no resource');
    return resource;
}

/**
 * What the tables of the suite hold, each row as JSON in a stable order, and where the sequence of the
 * audit stands.
 * @returns The fingerprint.
 */
async function resolveFingerprint(): Promise<Record<string, unknown>> {
    const fingerprint: Record<string, unknown> = {};
    for (const table of TABLES) {
        const [row] = await runSql(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), '[]'::jsonb)::text AS "rows" FROM ${table} t`);
        fingerprint[table] = row?.['rows'];
    }
    const [sequence] = await runSql('SELECT last_value::text AS "value" FROM audit_id_seq');
    fingerprint['audit_id_seq'] = sequence?.['value'];
    return fingerprint;
}

async function readText(data: Readable): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of data) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
    return Buffer.concat(chunks).toString();
}

async function findZibriSlots(): Promise<string[]> {
    return (await runSql('SELECT slot_name AS "name" FROM pg_replication_slots WHERE slot_name LIKE \'zibri_backup_%\''))
        .map(r => String(r['name']));
}

let server: StartedTestServer | undefined;

beforeAll(async () => {
    await FsUtilities.rm(backupFolder);
    server = await startTestServer({ dataSources: [IncrementalPostgresDataSource] });
    // created before the first backup, so that each backup after it builds on the one before
    for (const statement of [
        'CREATE TABLE parent (id int PRIMARY KEY, label text, big text)',
        'CREATE TABLE child (id int PRIMARY KEY, parent_id int NOT NULL REFERENCES parent ON DELETE CASCADE)',
        'CREATE TABLE audit (id serial PRIMARY KEY, what text NOT NULL)',
        // writes a row of its own for every parent: applied again on restore, it would write it twice
        'CREATE FUNCTION audit_parent() RETURNS trigger LANGUAGE plpgsql AS $body$ BEGIN'
        + ' INSERT INTO audit (what) VALUES (\'parent \' || NEW.id); RETURN NEW; END $body$',
        'CREATE TRIGGER parent_audit AFTER INSERT ON parent FOR EACH ROW EXECUTE FUNCTION audit_parent()',
        // no primary key, so no replica identity: read in full every time
        'CREATE TABLE loose (value text)',
        // not in the WAL: read in full every time
        'CREATE UNLOGGED TABLE scratch (id int PRIMARY KEY, value text)',
        'CREATE TABLE swept (id int PRIMARY KEY)'
    ]) {
        await runSql(statement);
    }
}, TestTimeouts.postgres.start + 30000);

afterAll(async () => {
    await server?.shutdown();
    await FsUtilities.rm(backupFolder);
}, TestTimeouts.postgres.shutdown);

describe('a postgres backup reading only what changed', () => {
    it('restores each backup of a chain to exactly what the database held when it was taken', async () => {
        await runSql('INSERT INTO parent (id, label) VALUES (1, \'one\'), (2, \'two\'), (3, \'three\')');
        await runSql('INSERT INTO child (id, parent_id) VALUES (10, 1), (11, 1), (20, 2)');
        const first: BackupEntity = await takeBackup('chain-first');

        // a TOASTed value, which an update of another column of its row does not send
        await runSql('UPDATE parent SET big = (SELECT string_agg(md5(i::text), \'\') FROM generate_series(1, 4000) i) WHERE id = 2');
        await runSql('INSERT INTO parent (id, label) VALUES (4, \'four\')');
        // cascades to its children, whose deletes postgres writes itself
        await runSql('DELETE FROM parent WHERE id = 1');
        // a key changed
        await runSql('UPDATE parent SET id = 30 WHERE id = 3');
        await runSql('INSERT INTO loose (value) VALUES (\'a\'), (\'b\')');
        await runSql('INSERT INTO scratch (id, value) VALUES (1, \'unlogged\')');
        await runSql('INSERT INTO swept (id) SELECT generate_series(1, 5)');
        await runSql('TRUNCATE swept');
        const second: BackupEntity = await takeBackup('chain-second');
        const atSecond: Record<string, unknown> = await resolveFingerprint();

        await runSql('UPDATE parent SET label = \'two, again\' WHERE id = 2');
        await runSql('DELETE FROM loose WHERE value = \'a\'');
        await runSql('INSERT INTO swept (id) VALUES (7)');
        const third: BackupEntity = await takeBackup('chain-third');
        const atThird: Record<string, unknown> = await resolveFingerprint();

        expect(getResource(first).baseBackupId).toBeNull();
        expect(getResource(second).baseBackupId).toBe(first.id);
        expect(getResource(third).baseBackupId).toBe(second.id);

        await runSql('DELETE FROM parent');
        await runSql('INSERT INTO loose (value) VALUES (\'after\')');
        await getBackupService().restore(third);
        expect(await resolveFingerprint()).toStrictEqual(atThird);
        await getBackupService().restore(second);
        expect(await resolveFingerprint()).toStrictEqual(atSecond);
        // the trigger's own rows once each, not again for the parents restored
        expect(await runSql('SELECT what FROM audit ORDER BY id')).toStrictEqual([{ what: 'parent 1' }, { what: 'parent 2' }, { what: 'parent 3' }, { what: 'parent 4' }]);
    }, 180000);

    it('drops the slot when a restore replaces the data, and the next backup reads in full', async () => {
        const restored: BackupEntity = await takeBackup('drop-restored');
        expect(await findZibriSlots()).toHaveLength(1);

        await getBackupService().restore(restored);
        expect(await findZibriSlots()).toStrictEqual([]);
        expect(getResource(await takeBackup('drop-after')).baseBackupId).toBeNull();
    }, 120000);

    it('holds a write committed while the slot was being created in the backup in full, and in no change after it', async () => {
        await takeBackup('straddle-before');
        // a schema change, so that the next backup reads in full and creates its slot anew
        await runSql('ALTER TABLE swept ADD COLUMN note text');
        const transaction: Transaction = await getDataSource().startTransaction();
        await runSql('INSERT INTO swept (id) VALUES (100)', transaction);
        // the slot waits for the transaction running when it is created
        const full: Promise<BackupEntity> = takeBackup('straddle-full');
        await sleep(1500);
        await transaction.commit();
        const fullBackup: BackupEntity = await full;
        await runSql('INSERT INTO swept (id) VALUES (101)');
        const increment: BackupEntity = await takeBackup('straddle-increment');

        expect(getResource(fullBackup).baseBackupId).toBeNull();
        expect(getResource(increment).baseBackupId).toBe(fullBackup.id);
        await getBackupService().restore(increment);
        expect(await runSql('SELECT id FROM swept WHERE id >= 100 ORDER BY id')).toStrictEqual([{ id: 100 }, { id: 101 }]);
    }, 120000);

    it('reads in full after a schema change, and after the slot was dropped', async () => {
        await takeBackup('full-before');
        await runSql('ALTER TABLE loose ADD COLUMN extra text');
        expect(getResource(await takeBackup('full-after-schema-change')).baseBackupId).toBeNull();

        await server?.runAsSuperuser(IncrementalPostgresDataSource, ['SELECT pg_drop_replication_slot(slot_name) FROM pg_replication_slots WHERE slot_name LIKE \'zibri_backup_%\'']);
        expect(getResource(await takeBackup('full-after-slot-dropped')).baseBackupId).toBeNull();
    }, 120000);

    it('reads the same changes again while the backup that read them has not completed', async () => {
        const base: BackupEntity = await takeBackup('again-base');
        await runSql('INSERT INTO swept (id) VALUES (200)');
        const since: string | null | undefined = getResource(base).readCursor;
        assert(since != undefined, 'the backup recorded no cursor');

        const read: () => Promise<string> = async () => {
            const data: IncrementalBackupData = await getDataSource().createIncrementalBackupData(base, BackupDataOptionsTestUtilities.resolve(), since);
            expect(data.full).toBe(false);
            return await readText(data.data);
        };
        // contained rather than equal: the framework's own tables may change between the two reads
        expect(await read()).toContain('{"kind":"insert","table":"swept","row":{"columns":["id","note"],"values":["200",null]}}');
        expect(await read()).toContain('{"kind":"insert","table":"swept","row":{"columns":["id","note"],"values":["200",null]}}');
    }, 120000);

    it('fails a read of what changed when a backup completing meanwhile let the slot go of what it reads', async () => {
        const base: BackupEntity = await takeBackup('moved-on-base');
        await runSql('INSERT INTO swept (id) VALUES (300)');
        const since: string | null | undefined = getResource(base).readCursor;
        assert(since != undefined, 'the backup recorded no cursor');
        // checked against the slot now, and read only once its stream is
        const moved: IncrementalBackupData = await getDataSource().createIncrementalBackupData(base, BackupDataOptionsTestUtilities.resolve(), since);
        expect(moved.full).toBe(false);

        // a newer backup completes meanwhile, and moves the slot on past the insert
        const newer: IncrementalBackupData = await getDataSource().createIncrementalBackupData(base, BackupDataOptionsTestUtilities.resolve(), since);
        expect(await readText(newer.data)).toContain('{"kind":"insert","table":"swept","row":{"columns":["id","note"],"values":["300",null]}}');
        await getDataSource().confirmReadCursor(newer.cursor);

        await expect(readText(moved.data)).rejects.toThrow('let go of changes');
    }, 120000);

    it('restores what changed as it was, whatever the database writes values and reads strings as', async () => {
        await runSql('CREATE TABLE typed (id int PRIMARY KEY, ratio double precision, span interval, path text)');
        // what the dump of the backup in full records, and its script sets before the changes are applied
        await server?.runAsSuperuser(IncrementalPostgresDataSource, ['ALTER DATABASE db SET standard_conforming_strings = off']);
        let base: BackupEntity;
        let increment: BackupEntity;
        try {
            base = await takeBackup('typed-base');
            // what a connection writes values as unless it says otherwise
            await server?.runAsSuperuser(IncrementalPostgresDataSource, [
                'ALTER DATABASE db SET extra_float_digits = 0',
                'ALTER DATABASE db SET IntervalStyle = sql_standard'
            ]);
            // the backslashes built rather than written, which a connection reads differently as the setting is
            await runSql('INSERT INTO typed (id, ratio, span, path)'
                + ' VALUES (1, 0.1::float8 + 0.2::float8, interval \'-1 day +2 hours\', concat_ws(chr(92), \'C:\', \'new\', \'table\'))');
            increment = await takeBackup('typed-increment');
        }
        finally {
            await server?.runAsSuperuser(IncrementalPostgresDataSource, [
                'ALTER DATABASE db RESET standard_conforming_strings',
                'ALTER DATABASE db RESET extra_float_digits',
                'ALTER DATABASE db RESET IntervalStyle'
            ]);
        }
        expect(getResource(increment).baseBackupId).toBe(base.id);

        await runSql('DELETE FROM typed');
        await getBackupService().restore(increment);
        expect(await runSql('SELECT ratio = 0.1::float8 + 0.2::float8 AS "ratio",'
            + ' extract(day FROM span) = -1 AND extract(hour FROM span) = 2 AS "span",'
            + ' path = concat_ws(chr(92), \'C:\', \'new\', \'table\') AS "path" FROM typed')).toStrictEqual([{ ratio: true, span: true, path: true }]);
    }, 120000);

    // the decoded truncate names only the tables read through the changes: the ones read in full it named as
    // well were left out, and the truncate was refused on restore, failing this backup and every one after it
    it('restores a truncate that also named tables read in full referencing a table it cleared', async () => {
        await runSql('CREATE TABLE truncated (id int PRIMARY KEY)');
        // an identity generated always and no primary key, so both read in full; the second referencing the first
        await runSql('CREATE TABLE truncated_middle (id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY, truncated_id int NOT NULL REFERENCES truncated)');
        await runSql('CREATE TABLE truncated_leaf (middle_id int NOT NULL REFERENCES truncated_middle)');
        await runSql('INSERT INTO truncated VALUES (1)');
        await runSql('INSERT INTO truncated_middle (truncated_id) VALUES (1)');
        await runSql('INSERT INTO truncated_leaf SELECT id FROM truncated_middle');
        const base: BackupEntity = await takeBackup('truncate-base');

        await runSql('TRUNCATE truncated, truncated_middle, truncated_leaf');
        await runSql('INSERT INTO truncated VALUES (2)');
        const increment: BackupEntity = await takeBackup('truncate-increment');
        expect(getResource(increment).baseBackupId).toBe(base.id);

        await runSql('INSERT INTO truncated VALUES (3)');
        await getBackupService().restore(increment);
        expect(await runSql('SELECT id FROM truncated ORDER BY id')).toStrictEqual([{ id: 2 }]);
        expect(await runSql('SELECT (SELECT count(*) FROM truncated_middle)::int AS "middle", (SELECT count(*) FROM truncated_leaf)::int AS "leaf"'))
            .toStrictEqual([{ middle: 0, leaf: 0 }]);
    }, 120000);

    it('refuses to boot without what reading only what changed needs, naming it', async () => {
        await server?.runAsSuperuser(IncrementalPostgresDataSource, ['ALTER ROLE postgres NOREPLICATION']);
        try {
            await expect(getDataSource().validateBackupConfiguration()).rejects.toThrow('needs to be allowed to replicate');
        }
        finally {
            await server?.runAsSuperuser(IncrementalPostgresDataSource, ['ALTER ROLE postgres REPLICATION']);
        }
        // the server's settings come from the container's command line, which ALTER SYSTEM does not override
        await server?.runAsSuperuser(IncrementalPostgresDataSource, ['REVOKE SET ON PARAMETER session_replication_role FROM postgres']);
        try {
            await expect(getDataSource().validateBackupConfiguration()).rejects.toThrow('needs to be allowed to set session_replication_role');
        }
        finally {
            await server?.runAsSuperuser(IncrementalPostgresDataSource, ['GRANT SET ON PARAMETER session_replication_role TO postgres']);
        }
    }, 60000);

    // neither was checked: the application booted, and the first backup failed creating the publication, with
    // every attempt of every backup after it
    it('refuses to boot without CREATE on the database or owning the tables read through the changes, naming them', async () => {
        await server?.runAsSuperuser(IncrementalPostgresDataSource, ['CREATE ROLE incremental_owner NOLOGIN']);
        await runSql('CREATE TABLE owned_elsewhere (id int PRIMARY KEY)');
        await server?.runAsSuperuser(IncrementalPostgresDataSource, [
            'ALTER TABLE owned_elsewhere OWNER TO incremental_owner',
            // the owner of the database has CREATE on it whatever is granted
            'ALTER DATABASE db OWNER TO incremental_owner'
        ]);
        try {
            const validated: Promise<void> = getDataSource().validateBackupConfiguration();
            await expect(validated).rejects.toThrow('needs to have CREATE on the database');
            await expect(validated).rejects.toThrow('does not own "owned_elsewhere" of "incremental_owner"');
        }
        finally {
            await server?.runAsSuperuser(IncrementalPostgresDataSource, [
                'ALTER DATABASE db OWNER TO postgres',
                'DROP TABLE owned_elsewhere',
                'DROP ROLE incremental_owner'
            ]);
        }
        await expect(getDataSource().validateBackupConfiguration()).resolves.toBeUndefined();
    }, 60000);

    // the changes arrive in the encoding of the database and were read as UTF8: each character outside ASCII of
    // another encoding came back wrong in every backup reading only what changed, without an error
    it('refuses to boot on a database encoded in anything but UTF8, naming its encoding', async () => {
        await server?.runAsSuperuser(IncrementalPostgresDataSource, ['CREATE DATABASE latin1_db ENCODING \'LATIN1\' LC_COLLATE \'C\' LC_CTYPE \'C\' TEMPLATE template0 OWNER postgres']);
        const dataSource: IncrementalPostgresDataSource = getDataSource();
        const options: PostgresOptions = dataSource.options;
        // what backups connect to is read from the options each time they connect
        dataSource.options = { ...options, database: 'latin1_db' };
        try {
            await expect(dataSource.validateBackupConfiguration()).rejects.toThrow('needs to be encoded in UTF8, and is in LATIN1');
        }
        finally {
            dataSource.options = options;
            await server?.runAsSuperuser(IncrementalPostgresDataSource, ['DROP DATABASE latin1_db']);
        }
    }, 60000);
});