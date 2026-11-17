import { Readable } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';

import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';

import { PostgresBackupScope } from './postgres-backup-scope.model';
import { PostgresDataSource, PostgresOptions } from './postgres-data-source.model';
import { PostgresPooler } from './postgres-pooler.model';
import { BackupDataOptionsTestUtilities } from '../../../__testing__/backup/backup-data-options-test.utilities';
import { testFileFolder, TestTimeouts } from '../../../__testing__/constants';
import { queryPostgres } from '../../../__testing__/query-postgres.function';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { waitUntil } from '../../../__testing__/wait-until.function';
import { BackupEntity } from '../../../backup/backup-entity.model';
import { BackupResourceEntity } from '../../../backup/backup-resource-entity.model';
import { BackupServiceInterface } from '../../../backup/backup-service.interface';
import { BackupStatus } from '../../../backup/backup-status.enum';
import { Backup } from '../../../backup/decorators/backup-resource.decorator';
import { BackupTransport } from '../../../backup/decorators/backup-transport.decorator';
import { IncrementalBackupData } from '../../../backup/incremental-backup-data.model';
import { FsBackupTransport } from '../../../backup/transports/fs.backup-transport';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { defineProvider } from '../../../di/models/di-provider.model';
import { BaseEntity } from '../../../entity/base-entity.model';
import { LoggerInterface } from '../../../logging/logger.interface';
import { Newable } from '../../../types/newable.type';
import { FsPath, FsUtilities } from '../../../utilities/fs.utilities';
import { UUIDUtilities } from '../../../utilities/uuid.utilities';
import { DataSource } from '../../decorators/data-source.decorator';
import { SchemaManagement } from '../../models/schema-management.model';
import { RepositoryClass } from '../../repository/repository-class.type';
import { Transaction } from '../../transaction/transaction.model';

/**
 * Reading the data of postgres for a backup that takes long says where it stands every interval: the step it is at,
 * whether it waits for the backup to read on, and what each busy connection to the database waits for, naming who
 * holds a lock one waits for. Backups of CI waited until their case ran out of time, with nothing in the log that
 * said what held them.
 */

const backupFolder: FsPath = FsUtilities.getPath(testFileFolder, `postgres-backup-read-reports-${UUIDUtilities.generate()}`);

/**
 * How often a backup waiting for a lock says so.
 */
const REPORT_INTERVAL_IN_MS: number = 300;

@BackupTransport()
class ReadReportsTransport extends FsBackupTransport {
    constructor() {
        super('read-reports-transport', backupFolder);
    }
}

@DataSource()
@Backup({ transports: [ReadReportsTransport], encrypt: false })
class ReadReportsPostgresDataSource extends PostgresDataSource {
    override backupScope: PostgresBackupScope = 'schema';
    // what a backup reads in full first sets up, where the case on CI waited
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

function getDataSource(): ReadReportsPostgresDataSource {
    return inject(ReadReportsPostgresDataSource);
}

function getBackupService(): BackupServiceInterface {
    return inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);
}

let server: StartedTestServer | undefined;

beforeAll(async () => {
    await FsUtilities.rm(backupFolder);
    server = await startTestServer({
        dataSources: [ReadReportsPostgresDataSource],
        providers: [
            ...defaultTestServerProviders,
            defineProvider({ token: ZIBRI_DI_TOKENS.WAIT_REPORT_INTERVAL_IN_MS, useValue: REPORT_INTERVAL_IN_MS })
        ]
    });
    await queryPostgres(getDataSource(), 'CREATE TABLE held (id int PRIMARY KEY)');
}, TestTimeouts.postgres.start);

afterAll(async () => {
    await server?.shutdown();
    await FsUtilities.rm(backupFolder);
}, TestTimeouts.postgres.shutdown);

/**
 * Spies on the warnings of the logger, for what reading the data of the suite's data source says.
 * @returns The reports so far, and what ends the spying.
 */
function spyOnReports(): { findReports: () => string[], restore: () => void } {
    const logger: LoggerInterface = inject(ZIBRI_DI_TOKENS.LOGGER);
    const warn: jest.SpiedFunction<LoggerInterface['warn']> = jest.spyOn(logger, 'warn');
    return {
        findReports: () => warn.mock.calls.map(([message]) => message).filter(m => m.includes('Reading the data of "ReadReportsPostgresDataSource"')),
        restore: () => warn.mockRestore()
    };
}

describe('a postgres backup reading for long', () => {
    it('says the step it is at, which connection holds the lock it waits for, and completes once it is let go of', async () => {
        const { findReports, restore } = spyOnReports();
        const transaction: Transaction = await getDataSource().startTransaction();
        try {
            const [holder] = await queryPostgres(getDataSource(), 'SELECT pg_backend_pid() AS "pid"', [], transaction);
            // what the backup needs every table of its scope for, held by a transaction that does not end. Taken
            // last, since a connection idle in its transaction is named with the statement it ran last
            await queryPostgres(getDataSource(), 'LOCK TABLE held IN ACCESS EXCLUSIVE MODE', [], transaction);
            const backup: Promise<BackupEntity> = getBackupService().waitForBackup(await getBackupService().queueBackup({ name: 'held-back' }));
            const heldBy: string = `held by pid ${String(holder?.['pid'])}`;

            await waitUntil(() => findReports().some(r => r.includes(heldBy)), 8000);
            await transaction.commit();

            expect((await backup).status).toBe(BackupStatus.COMPLETED);
            expect(findReports().find(r => r.includes(heldBy))).toMatch(new RegExp(
                'setting up the publication: .*waiting for Lock relation\\): CREATE PUBLICATION.*'
                + `${heldBy} \\(no application, idle in transaction for \\d+ s\\): LOCK TABLE held IN ACCESS EXCLUSIVE MODE`
            ));
        }
        finally {
            if (!transaction.isFinished) {
                await transaction.rollback();
            }
            restore();
        }
    }, 60000);

    // a read held up by what reads its data, rather than by the server, which no connection then tells
    it('says it waits for the backup to read on while nothing reads what changed', async () => {
        const base: BackupEntity = await getBackupService().waitForBackup(await getBackupService().queueBackup({ name: 'handed-over-base' }));
        const since: string | null | undefined = base.resources[0]?.readCursor;
        const { findReports, restore } = spyOnReports();
        const read: IncrementalBackupData = await getDataSource().createIncrementalBackupData(base, BackupDataOptionsTestUtilities.resolve(), since ?? undefined);
        try {
            expect(read.full).toBe(false);
            await waitUntil(() => findReports().some(r => r.includes('handing over what changed, waiting for the backup to read on')), 8000);
        }
        finally {
            // which ends its connection to the server
            await new Promise<void>(resolve => {
                read.data.once('close', () => resolve());
                read.data.destroy();
            });
            restore();
        }
    }, 60000);

    // data nobody read to its end or closed kept checking for as long as the process ran, and kept the data source
    // reachable meanwhile. Last, since it shuts the application down
    it('stops checking once the data source shut down, of data nobody read as well', async () => {
        const logger: LoggerInterface = inject(ZIBRI_DI_TOKENS.LOGGER);
        const warn: jest.SpiedFunction<LoggerInterface['warn']> = jest.spyOn(logger, 'warn');
        // a check after the shutdown finds the server stopped, and says it could not tell
        const findReports: () => string[] = () => warn.mock.calls.map(([message]) => message)
            .filter(m => m.includes('Reading the data of "ReadReportsPostgresDataSource"'));
        // nothing reads it. A dump this small fits in what the stream and the pipe hold, so the dump ends and leaves
        // the server while the stream stays open
        const data: Readable = await getDataSource().createBackupData();
        data.on('error', () => undefined);
        try {
            await waitUntil(
                async () => !(await queryPostgres(getDataSource(), 'SELECT 1 FROM pg_stat_activity WHERE application_name = \'pg_dump\'')).length,
                8000,
                () => 'pg_dump still runs, so the dump is larger than what the stream and the pipe hold unread'
            );
            expect(data.closed).toBe(false);
            // what a read held up on this side of the server is told by: nothing the server does for it
            await waitUntil(() => findReports().some(r => r.includes('dumping: no connection to its database is busy')), 8000);

            // the server stops with the application
            const started: StartedTestServer | undefined = server;
            server = undefined;
            await started?.shutdown();
            warn.mockClear();
            await sleep(REPORT_INTERVAL_IN_MS * 3);

            expect(findReports()).toEqual([]);
        }
        finally {
            data.destroy();
            warn.mockRestore();
        }
    }, 60000);
});