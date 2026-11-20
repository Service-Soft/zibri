import { Readable } from 'node:stream';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { first, firstValueFrom } from 'rxjs';
import { InMemoryDataSource } from 'zibri-testing';

import { testFileFolder, TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { DataSource } from '../data-source/decorators/data-source.decorator';
import { RepositoryClass } from '../data-source/repository/repository-class.type';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { defineProvider } from '../di/models/di-provider.model';
import { BaseEntity } from '../entity/base-entity.model';
import { Newable } from '../types/newable.type';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';
import { UUIDUtilities } from '../utilities/uuid.utilities';
import { BackupEntity } from './backup-entity.model';
import { BackupResourceEntity } from './backup-resource-entity.model';
import { BackupResourceInterface } from './backup-resource.interface';
import { BackupServiceInterface } from './backup-service.interface';
import { Backup } from './decorators/backup-resource.decorator';
import { BackupTransport } from './decorators/backup-transport.decorator';
import { BaseFsBackupTransport } from './transports/base-fs.backup-transport';
import { FsBackupTransport } from './transports/fs.backup-transport';

/**
 * What becomes of the data a resource handed over when the staging folder cannot be written: whatever
 * produces it, such as a dump and the connection it reads through, is to end with the attempt.
 */

const rootFolder: FsPath = FsUtilities.getPath(testFileFolder, `backups-staging-not-writable-${UUIDUtilities.generate()}`);
const chunksFolder: FsPath = FsUtilities.getPath(rootFolder, 'chunks');
const wholeFolder: FsPath = FsUtilities.getPath(rootFolder, 'whole');
// a file, once the test wrote it, so that no folder can be made inside it
const blockingFile: FsPath = FsUtilities.getPath(rootFolder, 'blocked');
const stagingFolder: FsPath = FsUtilities.getPath(blockingFile, 'staging');

@BackupTransport()
class ChunksFsBackupTransport extends FsBackupTransport {
    constructor() {
        super('staging-not-writable-chunks-transport', chunksFolder);
    }
}

/**
 * A transport of v1 alone, which takes a resource in one piece.
 */
@BackupTransport()
// eslint-disable-next-line typescript/no-deprecated -- a transport of 3.0, which 3.x keeps until 4.0
class WholeFsBackupTransport extends BaseFsBackupTransport {
    override readonly name: string = 'staging-not-writable-whole-transport';
    override readonly versions: readonly 'v1'[] = ['v1'];
    protected override readonly backupBasePath: FsPath = wholeFolder;
}

@DataSource()
class StagingNotWritableDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, BackupEntity, BackupResourceEntity];
    override readonly repositories: RepositoryClass[] = defaultTestServerRepositories;
}

/**
 * Data without an end, as a dump of more than a reader buffers ahead is to whoever stops reading it.
 * @yields 64 KiB at a time.
 */
function* produceEndlessly(): Generator<Buffer> {
    while (true) {
        yield Buffer.alloc(64 * 1024);
    }
}

/**
 * A resource that keeps the data it handed over, so that what became of it can be told.
 */
abstract class HandingOverStore implements BackupResourceInterface {
    handedOver: Readable | undefined;

    createBackupData(): Readable {
        this.handedOver = Readable.from(produceEndlessly());
        return this.handedOver;
    }

    async restoreBackup(): Promise<void> {
        await Promise.resolve();
    }

    validateBackupConfiguration(): void {
        // holds everything it needs
    }
}

@Backup({ transports: [ChunksFsBackupTransport], encrypt: false })
class ChunkedStore extends HandingOverStore {}

@Backup({ transports: [WholeFsBackupTransport], encrypt: false })
class WholeStore extends HandingOverStore {}

let server: StartedTestServer | undefined;

beforeAll(async () => {
    await FsUtilities.rm(rootFolder);
    server = await startTestServer({
        dataSources: [StagingNotWritableDataSource],
        providers: [
            ...defaultTestServerProviders,
            defineProvider({ token: ZIBRI_DI_TOKENS.BACKUP_TEMP_FOLDER, useValue: stagingFolder }),
            defineProvider({ token: ZIBRI_DI_TOKENS.BACKUP_MAX_ATTEMPTS, useValue: 1 }),
            // both resources at once, so that the one stored in one piece is tried although the other one failed
            defineProvider({ token: ZIBRI_DI_TOKENS.BACKUP_MAX_CONCURRENT_RESOURCES, useValue: 2 })
        ]
    });
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
    await FsUtilities.rm(rootFolder);
}, TestTimeouts.inMemory.shutdown);

describe('BackupService - a staging folder that cannot be written', () => {
    // the data was left as it was handed over: of postgres a pg_dump and the connection holding its snapshot, which
    // nothing read and nothing ended, one more with every attempt
    it('ends the data each resource handed over, stored as chunks or in one piece', async () => {
        const backupService: BackupServiceInterface = inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);
        // whatever the application made of the folder while it started
        await FsUtilities.rm(blockingFile);
        await FsUtilities.createFile(blockingFile, '');

        const queued: BackupEntity = await backupService.queueBackup({ name: 'staging-not-writable' });
        await expect(backupService.waitForBackup(queued)).rejects.toThrow('staging-not-writable');
        // the pass storing the other resource, which may end after the backup failed
        await firstValueFrom(backupService.isCreatingBackup.pipe(first(creating => !creating)));

        expect({
            chunked: inject(ChunkedStore).handedOver?.destroyed,
            whole: inject(WholeStore).handedOver?.destroyed
        }).toStrictEqual({ chunked: true, whole: true });
    }, 20000);
});