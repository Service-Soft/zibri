import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { BackupEntity } from '../../backup/backup-entity.model';
import { BACKUP_FORMAT_VERSION } from '../../backup/backup-format';
import { BackupResourceEntity } from '../../backup/backup-resource-entity.model';
import { BackupService } from '../../backup/backup.service';
import { Backup } from '../../backup/decorators/backup-resource.decorator';
import { BackupTransport } from '../../backup/decorators/backup-transport.decorator';
import { BaseFsBackupTransport } from '../../backup/transports/fs.backup-transport';
import { PostgresDataSource, PostgresOptions } from '../../data-source/data-sources/postgres/postgres-typeorm-data-source.model';
import { DataSource } from '../../data-source/decorators/data-source.decorator';
import { SchemaManagement } from '../../data-source/models/schema-management.model';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { Newable } from '../../types/newable.type';
import { OmitStrict } from '../../types/omit-strict.type';
import { FsPath, FsUtilities } from '../../utilities/fs.utilities';
import { JsonUtilities } from '../../utilities/json.utilities';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { zibriVersion } from '../../versioning/zibri-version.function';
import { testFileFolder } from '../constants';
import { defaultTestServerEntities } from '../test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../test-server/start-test-server.function';

/**
 * Executable form of evaluation/01-data-layer.md C6.
 *
 * A file of its own for the reason `schema-management.evaluation.test.ts` is: `@DataSource` and
 * `@Backup` both register into the static `GlobalRegistry` when the decorator runs, and nothing
 * takes them back out.
 *
 * Every expectation here describes the fixed behavior, so the whole file is red until the finding is
 * closed - including the two that would otherwise be controls. That is unavoidable here: the finding
 * is partly *that the data source refuses to boot without root credentials*, so the fixture cannot
 * declare them without conceding the thing being asserted. Once the file is green, the restore case
 * is the control - it is what says the dump is still a working backup rather than merely a
 * well-behaved file.
 */

const backupFolder: FsPath = FsUtilities.getPath(testFileFolder, 'evaluation-backups');

/**
 * A second place every backup is written to, so that what each transport received can be compared.
 */
const secondBackupFolder: FsPath = FsUtilities.getPath(testFileFolder, 'evaluation-backups-second');

@Entity({ allowOrphan: true })
class EvalBackupItem extends BaseEntity {
    @Property.string()
    value!: string;
}

@BackupTransport()
class EvalFsBackupTransport extends BaseFsBackupTransport {
    override readonly name: string = 'eval-fs-backup-transport';
    protected override readonly backupBasePath: FsPath = backupFolder;
}

@BackupTransport()
class EvalFsBackupTransportSecond extends BaseFsBackupTransport {
    override readonly name: string = 'eval-fs-backup-transport-second';
    protected override readonly backupBasePath: FsPath = secondBackupFolder;
}

/**
 * Declares no `rootUsername` and no `rootPw`, which is the point.
 *
 * A backup of one application's database is a read of objects that application owns. Requiring the
 * cluster superuser to take it means the credential sits in the app's configuration, in its process
 * environment and in every crash dump, for the lifetime of the deployment.
 */
@DataSource()
@Backup({
    transports: [
        EvalFsBackupTransport,
        EvalFsBackupTransportSecond
    ]
})
class EvalBackupDataSource extends PostgresDataSource {

    override options: OmitStrict<PostgresOptions, 'type' | 'entities'> = {
        host: 'localhost',
        username: 'postgres',
        password: 'password',
        database: 'db'
    };

    entities: Newable<BaseEntity>[] = [
        ...defaultTestServerEntities,
        EvalBackupItem,
        BackupEntity,
        BackupResourceEntity
    ];

    schemaManagement: SchemaManagement = 'synchronize';
}

let server: StartedTestServer | undefined;
let backupService: BackupService;
let itemRepository: Repository<EvalBackupItem>;
let backupRepository: Repository<BackupEntity>;
let resourceRepository: Repository<BackupResourceEntity>;

/**
 * Reads back the bytes a backup actually wrote, through the transport's own layout.
 *
 * The assertions below are about the artifact rather than about the call that produced it: what
 * leaves the process and lands in whatever the transport writes to is the thing an attacker with
 * read access to a backup bucket gets.
 * @param backupName - The name the backup was created under.
 * @returns The stored dump as text.
 */
async function readStoredDump(backupName: string): Promise<string> {
    return await FsUtilities.readFile(
        FsUtilities.getPath(backupFolder, backupName, EvalBackupDataSource.name)
    );
}

beforeAll(async () => {
    await FsUtilities.rm(backupFolder);
    await FsUtilities.rm(secondBackupFolder);
    server = await startTestServer({ dataSources: [EvalBackupDataSource] });
    itemRepository = inject(repositoryTokenFor(EvalBackupItem));
    backupRepository = inject(repositoryTokenFor(BackupEntity));
    resourceRepository = inject(repositoryTokenFor(BackupResourceEntity));
    backupService = inject(BackupService);
}, 90000);

afterAll(async () => {
    // guarded so a failed beforeAll reports the real cause instead of a shutdown TypeError
    await server?.shutdown();
}, 30000);

describe('evaluation/01-data-layer C6 - a backup is this application\'s database, not the cluster', () => {

    it('takes a backup from a data source that was never given root credentials', async () => {
        await itemRepository.create({ value: 'kept' });

        await backupService.createBackup({ name: 'no-root-credentials' });

        expect(await FsUtilities.exists(
            FsUtilities.getPath(backupFolder, 'no-root-credentials', EvalBackupDataSource.name)
        )).toBe(true);
    }, 60000);

    it('writes a dump that carries no role definitions and no password hashes', async () => {
        await backupService.createBackup({ name: 'no-roles' });

        const dump: string = await readStoredDump('no-roles');

        // pg_dumpall opens with the cluster's roles, and `ALTER ROLE ... PASSWORD` carries the
        // SCRAM verifier of every login role on the server - the superuser's included. A backup
        // artifact is copied, shipped off-host and kept for years; it must not be a credential store
        expect(dump).not.toMatch(/CREATE ROLE/);
        expect(dump).not.toMatch(/ALTER ROLE/);
        expect(dump).not.toMatch(/SCRAM-SHA-256/);
    }, 60000);

    it('writes a dump of this data source\'s database and nothing else', async () => {
        await backupService.createBackup({ name: 'one-database' });

        const dump: string = await readStoredDump('one-database');

        // not vacuous: the application's own table has to be in there
        expect(dump).toMatch(/CREATE TABLE .*eval_backup_item/);

        // `\connect` is what makes a cluster dump a cluster dump. It also silently overrides the
        // database psql was pointed at, so restoring into a differently named target writes to the
        // name the dump remembers instead
        expect(dump).not.toMatch(/\\connect/);
        expect(dump).not.toMatch(/template1/);
        expect(dump).not.toMatch(/CREATE DATABASE/);
    }, 60000);

    it('writes an artifact that cannot destroy anything by itself', async () => {
        await backupService.createBackup({ name: 'no-drops' });

        const dump: string = await readStoredDump('no-drops');

        // a file holding a `DROP` per table is a loaded gun once it is copied somewhere: replaying it
        // against the wrong database empties that one. Removing what is already there is the
        // restore's decision, taken against the target it was actually pointed at
        expect(dump).not.toMatch(/^DROP /m);
    }, 60000);

    it('restores the rows the dump was taken with', async () => {
        await itemRepository.deleteAll({});
        await itemRepository.create({ value: 'restore-me' });

        await backupService.createBackup({ name: 'round-trip' });
        await itemRepository.deleteAll({});
        expect(await itemRepository.findAll()).toHaveLength(0);

        const [backup]: BackupEntity[] = await backupRepository.findAll({
            where: { name: 'round-trip' },
            relations: ['resources']
        });
        assert(backup, 'the backup was not created');
        await backupService.restore(backup);

        expect((await itemRepository.findAll()).map(i => i.value)).toEqual(['restore-me']);
    }, 60000);

    it('rejects a restore whose statements did not apply', async () => {
        const dataSource: EvalBackupDataSource = inject(EvalBackupDataSource);

        // psql reports the error on stderr and still exits 0, so a restore that applied nothing at
        // all is indistinguishable from one that worked. Whatever called it goes on to serve traffic
        // against a database it believes it just repaired
        await expect(dataSource.restoreBackup(Readable.from(['SELECT no_such_function_exists();\n'])))
            .rejects.toThrow();
    }, 60000);

    it('rejects, rather than crashing the process, when the restore ends before the data is written', async () => {
        const dataSource: EvalBackupDataSource = inject(EvalBackupDataSource);

        // a fatal first statement followed by more than a pipe buffer holds: the child is gone while
        // the source stream is still writing, and an EPIPE on a stdin nobody listens to for 'error'
        // is an unhandled stream error, which is a dead process rather than a failed restore
        const stream: Readable = Readable.from([
            'SELECT no_such_function_exists();\n',
            ...Array.from({ length: 2000 }, (_, i) => `SELECT ${i};\n`)
        ]);

        await expect(dataSource.restoreBackup(stream)).rejects.toThrow();
    }, 60000);

    // The container's application role is the superuser, so the tests above prove the *requirement*
    // for root credentials is gone, not that a least-privilege role suffices. Proving that needs a
    // second role created with neither SUPERUSER nor CREATEROLE and a data source connecting as it,
    // and the two privileges it does still need - reading every object it dumps, and owning every
    // object a `--clean` restore replaces - stated as the contract rather than discovered.
    it.todo('takes and restores a backup as a role with neither SUPERUSER nor CREATEROLE');

    // `env: { ...process.env, PGPASSWORD }` hands the dump child every secret the application holds -
    // jwt secret, encryption master keys, smtp credentials - none of which libpq reads. Observing it
    // from outside needs a stub `pg_dump` earlier on PATH that prints its own environment.
    it.todo('gives the dump child only the connection variables libpq reads');
});

describe('evaluation/04-infrastructure-subsystems 5.4 - a backup must be checkable before it is trusted', () => {

    it('records what it wrote, so there is something to check a restore against', async () => {
        await backupService.createBackup({ name: 'measured' });

        const [backup]: BackupEntity[] = await backupRepository.findAll({
            where: { name: 'measured' },
            relations: ['resources']
        });
        assert(backup, 'the backup was not created');
        const [resource]: BackupResourceEntity[] = backup.resources;
        assert(resource, 'the backup recorded no resource');

        // `size` and `completed` were declared on the entity and written by nothing, so every row
        // said a backup of unknown length had never finished - including the ones that had
        const stored: string = await readStoredDump('measured');
        expect(resource.completed).toBe(true);
        expect(resource.size).toBe(Buffer.byteLength(stored));
        expect(resource.checksum).toBe(
            createHash('sha256')
                .update(stored)
                .digest('hex')
        );
    }, 60000);

    it('records the shape it was written in, and refuses one it does not know', async () => {
        await backupService.createBackup({ name: 'format-checked' });

        const [backup]: BackupEntity[] = await backupRepository.findAll({
            where: { name: 'format-checked' },
            relations: ['resources']
        });
        assert(backup, 'the backup was not created');
        expect(backup.formatVersion).toBe(BACKUP_FORMAT_VERSION);

        // an archive from a build that writes a shape this one has never seen - a downgrade, or one
        // instance restoring what a newer one wrote. Read as though it were this shape, the fields a
        // restore trusts are whatever happens to line up, and what it does with them lands on a
        // database
        await backupRepository.updateById(backup.id, { formatVersion: BACKUP_FORMAT_VERSION + 1 });
        const [newer]: BackupEntity[] = await backupRepository.findAll({
            where: { name: 'format-checked' },
            relations: ['resources']
        });
        assert(newer, 'the backup disappeared');

        await expect(backupService.restore(newer)).rejects.toThrow(/is written in backup format/);
    }, 60000);

    it('leaves a stored record in a shape it does not know alone, rather than reading it as this one', async () => {
        await backupService.createBackup({ name: 'from-the-future' });
        // the record as some later build wrote it: this one knows the field that says which shape it
        // is, and nothing else about it.
        //
        // In both transports, because a sync asks each of them and one readable copy is enough to
        // rebuild the entity - which is the behavior that should hold, and would hide this one
        const fromTheFuture: string = JsonUtilities.stringify({
            id: UUIDUtilities.generate(),
            name: 'from-the-future',
            formatVersion: BACKUP_FORMAT_VERSION + 1
        });
        for (const folder of [backupFolder, secondBackupFolder]) {
            await FsUtilities.updateFile(
                FsUtilities.getPath(folder, 'from-the-future', 'metadata.json'),
                fromTheFuture,
                'replace'
            );
        }
        await backupRepository.deleteAll({ name: 'from-the-future' });

        await backupService.syncBackupEntities();

        // read as though it were this shape, the fields a restore trusts would be whatever happened
        // to line up - and a backup whose resources it cannot see is one it would restore as empty
        expect(await backupRepository.findAll({ where: { name: 'from-the-future' } })).toEqual([]);
    }, 60000);

    it('records which version of the framework took it', async () => {
        await backupService.createBackup({ name: 'versioned' });

        const [backup]: BackupEntity[] = await backupRepository.findAll({ where: { name: 'versioned' } });
        assert(backup, 'the backup was not created');

        // a backup outlives the releases either side of it, so what wrote one is part of what it is:
        // it is what lets a later version decide whether it can read an archive at all, rather than
        // finding out while restoring it
        expect(backup.zibriVersion).toBe(zibriVersion());
        expect(await FsUtilities.readFile(FsUtilities.getPath(backupFolder, 'versioned', 'metadata.json')))
            .toContain(zibriVersion());
    }, 60000);

    it('refuses to restore a resource that was never finished', async () => {
        await itemRepository.deleteAll({});
        await itemRepository.create({ value: 'untouched' });
        await backupService.createBackup({ name: 'interrupted' });

        const [backup]: BackupEntity[] = await backupRepository.findAll({
            where: { name: 'interrupted' },
            relations: ['resources']
        });
        assert(backup, 'the backup was not created');
        const [resource]: BackupResourceEntity[] = backup.resources;
        assert(resource, 'the backup recorded no resource');

        // what a process killed part way through leaves behind: the row exists because it is written
        // before the data, and nothing ever marked it finished. `completed` was declared for exactly
        // this and set by nothing, so every backup looked like this one
        await resourceRepository.updateById(resource.id, { completed: false });
        const [interrupted]: BackupEntity[] = await backupRepository.findAll({
            where: { name: 'interrupted' },
            relations: ['resources']
        });
        assert(interrupted, 'the backup disappeared');

        await expect(backupService.restore(interrupted)).rejects.toThrow(/was never finished/);
        expect((await itemRepository.findAll()).map(i => i.value)).toEqual(['untouched']);
    }, 60000);

    it('writes that record beside the data, so a restore has it when the database does not', async () => {
        await backupService.createBackup({ name: 'self-describing' });

        const [backup]: BackupEntity[] = await backupRepository.findAll({
            where: { name: 'self-describing' },
            relations: ['resources']
        });
        assert(backup, 'the backup was not created');
        const [resource]: BackupResourceEntity[] = backup.resources;
        assert(resource?.checksum, 'the backup recorded no checksum');

        // the copy a restore has when the database holding the other one is the thing being
        // restored - which is the case a backup exists for. Written before the data rather than
        // after, this file could only ever hold the state the backup started in
        const metadata: string = await FsUtilities.readFile(
            FsUtilities.getPath(backupFolder, 'self-describing', 'metadata.json')
        );
        expect(metadata).toContain(resource.checksum);
        expect(metadata).toContain(`"size":${resource.size}`);
    }, 60000);

    it('refuses to restore an archive that is not the one it recorded', async () => {
        await itemRepository.deleteAll({});
        await itemRepository.create({ value: 'still-here' });
        await backupService.createBackup({ name: 'damaged' });

        const [backup]: BackupEntity[] = await backupRepository.findAll({
            where: { name: 'damaged' },
            relations: ['resources']
        });
        assert(backup, 'the backup was not created');

        // truncated where it is stored, which is what a write killed part way through or a storage
        // fault leaves behind. Nothing about the file says so: a backup is opaque bytes, and its
        // name and its place in the folder are exactly as they were
        const path: FsPath = FsUtilities.getPath(backupFolder, 'damaged', EvalBackupDataSource.name);
        const whole: string = await FsUtilities.readFile(path);
        await FsUtilities.updateFile(path, whole.slice(0, Math.floor(whole.length / 2)), 'replace');

        await expect(backupService.restore(backup)).rejects.toThrow(/is not the data backup "damaged" recorded/);

        // and it refused before applying any of it, which is what makes this different from a
        // restore that fails halfway through
        expect((await itemRepository.findAll()).map(i => i.value)).toEqual(['still-here']);
    }, 60000);

    it('restores an archive that is the one it recorded', async () => {
        await itemRepository.deleteAll({});
        await itemRepository.create({ value: 'verified' });
        await backupService.createBackup({ name: 'intact' });
        await itemRepository.deleteAll({});

        const [backup]: BackupEntity[] = await backupRepository.findAll({
            where: { name: 'intact' },
            relations: ['resources']
        });
        assert(backup, 'the backup was not created');

        // the control: checking must not turn into refusing the backups that are fine
        await backupService.restore(backup);

        expect((await itemRepository.findAll()).map(i => i.value)).toEqual(['verified']);
    }, 60000);

    it('gives every transport the whole archive rather than a share of it', async () => {
        await backupService.createBackup({ name: 'two-transports' });

        const first: string = await readStoredDump('two-transports');
        const second: string = await FsUtilities.readFile(
            FsUtilities.getPath(secondBackupFolder, 'two-transports', EvalBackupDataSource.name)
        );

        // a stream is consumable once. Handed to both transports, they raced over its chunks and
        // whichever lost wrote an archive with holes in it - silently, because a backup nobody reads
        // until the day they need it is a backup nobody notices is short
        expect(second).toBe(first);
        // not vacuous: both hold a whole dump rather than both holding nothing
        expect(first).toMatch(/CREATE TABLE .*eval_backup_item/);
    }, 60000);
});