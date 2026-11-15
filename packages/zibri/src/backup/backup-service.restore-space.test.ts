import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { InMemoryDataSource } from 'zibri-testing';

import { BackupEntity } from './backup-entity.model';
import { BackupResourceEntity } from './backup-resource-entity.model';
import { BackupServiceInterface } from './backup-service.interface';
import { Backup } from './decorators/backup-resource.decorator';
import { BackupTransport } from './decorators/backup-transport.decorator';
import { NotEnoughRestoreSpaceError } from './not-enough-restore-space.error';
import { StagingUtilities } from './staging.utilities';
import { FsBackupTransport } from './transports/fs.backup-transport';
import { testFileFolder, TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { DataSource } from '../data-source/decorators/data-source.decorator';
import { MigrationEntity } from '../data-source/migration/migration-entity.model';
import { Repository } from '../data-source/repository/repository';
import { RepositoryClass } from '../data-source/repository/repository-class.type';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { BaseEntity } from '../entity/base-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { BadRequestError } from '../error-handling/errors/bad-request.error';
import { type LoggerInterface } from '../logging/logger.interface';
import { Newable } from '../types/newable.type';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';
import { UUIDUtilities } from '../utilities/uuid.utilities';

/**
 * Whether this instance's disk holds what a restore takes: told when a backup is taken, refused before a
 * restore fetches anything, told with what it needs when it runs out of space, and the ways to restore with
 * less room. The disk of the machine running the suite is far larger than any backup of it, so how much it
 * has free is what the cases set.
 */

const backupFolder: FsPath = FsUtilities.getPath(testFileFolder, `backups-restore-space-${UUIDUtilities.generate()}`);

@Entity({ tenant: 'shared', allowOrphan: true })
class SpaceNote extends BaseEntity {
    @Property.string()
    text!: string;
}

@Entity({ tenant: 'shared', allowOrphan: true })
class SpaceTask extends BaseEntity {
    @Property.string()
    title!: string;
}

@BackupTransport()
class SpaceFsBackupTransport extends FsBackupTransport {
    constructor() {
        super('space-fs-backup-transport', backupFolder);
    }
}

@DataSource()
@Backup({ transports: [SpaceFsBackupTransport], encrypt: false })
class SpaceNotesDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, SpaceNote, BackupEntity, BackupResourceEntity];
    override readonly repositories: RepositoryClass[] = defaultTestServerRepositories;
}

@DataSource()
@Backup({ transports: [SpaceFsBackupTransport], encrypt: false })
class SpaceTasksDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = [MigrationEntity, SpaceTask];
    override readonly repositories: RepositoryClass[] = [];
}

function getBackupService(): BackupServiceInterface {
    return inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);
}

function getNotes(): Repository<SpaceNote> {
    return inject(repositoryTokenFor(SpaceNote));
}

function getTasks(): Repository<SpaceTask> {
    return inject(repositoryTokenFor(SpaceTask));
}

async function takeBackup(): Promise<BackupEntity> {
    return await getBackupService().waitForBackup(await getBackupService().queueBackup({ name: `space-${UUIDUtilities.generate()}` }));
}

/**
 * What the notes and tasks say.
 * @returns The texts of the notes and the titles of the tasks, sorted.
 */
async function findHeld(): Promise<{ notes: string[], tasks: string[] }> {
    return {
        notes: (await getNotes().findAll({})).map(n => n.text).sort(),
        tasks: (await getTasks().findAll({})).map(t => t.title).sort()
    };
}

/**
 * Leaves the disk of the staging folder with the given bytes free, as far as the backup service can tell.
 * @param bytes - The bytes.
 */
function leaveFree(bytes: number): void {
    jest.spyOn(FsUtilities, 'resolveFreeBytes').mockResolvedValue(bytes);
}

/**
 * A disk that is full, as writing to it fails.
 * @returns The error.
 */
function resolveOutOfSpace(): Error {
    return Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' });
}

let server: StartedTestServer | undefined;

beforeAll(async () => {
    await FsUtilities.rm(backupFolder);
    server = await startTestServer({ dataSources: [SpaceNotesDataSource, SpaceTasksDataSource] });
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
    await FsUtilities.rm(backupFolder);
}, TestTimeouts.inMemory.shutdown);

beforeEach(async () => {
    await getNotes().deleteAll({});
    await getTasks().deleteAll({});
    await getNotes().create({ text: 'backed up' });
    await getTasks().create({ title: 'backed up' });
});

afterEach(() => {
    jest.restoreAllMocks();
});

/**
 * Writes over what the backup holds, so that what a restore changed shows.
 */
async function writeSince(): Promise<void> {
    await getNotes().create({ text: 'written since' });
    await getTasks().create({ title: 'written since' });
}

describe('BackupService - the room a restore takes on this instance\'s disk', () => {
    it('records of each resource what its data took as staged, which a restore of it takes about as well', async () => {
        const backup: BackupEntity = await takeBackup();

        for (const resource of backup.resources) {
            expect(resource.stagedSize).toBeGreaterThan(0);
        }
    }, 30000);

    it('refuses a restore the disk is too small for before it fetches anything, naming what it needs, what is free and what to do', async () => {
        const backup: BackupEntity = await takeBackup();
        await writeSince();
        leaveFree(1000);
        const fetched: jest.SpiedFunction<typeof StagingUtilities.stage> = jest.spyOn(StagingUtilities, 'stage');

        const refused: unknown = await getBackupService().restore(backup)
            .catch((error: unknown) => error);

        expect(refused).toBeInstanceOf(NotEnoughRestoreSpaceError);
        const message: string = (refused as Error).message;
        expect(message).toContain(`free in ${inject(ZIBRI_DI_TOKENS.BACKUP_TEMP_FOLDER)}`);
        expect(message).toContain('which has 1 KB free. Nothing was changed.');
        expect(message).toContain('"SpaceNotesDataSource"');
        expect(message).toContain('restore(backup, { resources: [\'SpaceNotesDataSource\'] })');
        expect(message).toContain('restore(backup, { putBack: false })');
        expect(message).toContain('restore(backup, { skipSpaceCheck: true })');
        expect(message).toContain('Downside:');
        expect(fetched).not.toHaveBeenCalled();
        expect(await findHeld()).toEqual({ notes: ['backed up', 'written since'], tasks: ['backed up', 'written since'] });
    }, 30000);

    it('goes on regardless when told to skip the check', async () => {
        const backup: BackupEntity = await takeBackup();
        await writeSince();
        leaveFree(1000);

        await getBackupService().restore(backup, { skipSpaceCheck: true });

        expect(await findHeld()).toEqual({ notes: ['backed up'], tasks: ['backed up'] });
    }, 30000);

    it('tells critically once a backup is taken that this instance could not restore it', async () => {
        leaveFree(1000);
        const critical: jest.SpiedFunction<LoggerInterface['critical']> = jest.spyOn(inject<LoggerInterface>(ZIBRI_DI_TOKENS.LOGGER), 'critical');

        const backup: BackupEntity = await takeBackup();

        expect(critical).toHaveBeenCalledWith(expect.objectContaining({
            message: expect.stringContaining(`This instance cannot restore backup "${backup.name}"`),
            cause: expect.any(NotEnoughRestoreSpaceError)
        }));
    }, 30000);

    it('tells nothing once a backup is taken that this instance can restore', async () => {
        const critical: jest.SpiedFunction<LoggerInterface['critical']> = jest.spyOn(inject<LoggerInterface>(ZIBRI_DI_TOKENS.LOGGER), 'critical');

        await takeBackup();

        expect(critical).not.toHaveBeenCalled();
    }, 30000);

    it('tells a disk that ran out of space while the backup was fetched with what it needs, and changes nothing', async () => {
        const backup: BackupEntity = await takeBackup();
        await writeSince();
        jest.spyOn(StagingUtilities, 'stage').mockRejectedValue(resolveOutOfSpace());
        jest.spyOn(StagingUtilities, 'write').mockRejectedValue(resolveOutOfSpace());

        const refused: unknown = await getBackupService().restore(backup)
            .catch((error: unknown) => error);

        expect(refused).toBeInstanceOf(NotEnoughRestoreSpaceError);
        expect((refused as Error).message).toContain('ran out of space');
        expect((refused as Error).message).toContain('before it changed anything');
        expect(await findHeld()).toEqual({ notes: ['backed up', 'written since'], tasks: ['backed up', 'written since'] });
    }, 30000);
});

describe('BackupService - restoring with less room', () => {
    it('restores the resources named alone, and leaves the others as they are', async () => {
        const backup: BackupEntity = await takeBackup();
        await writeSince();

        await getBackupService().restore(backup, { resources: ['SpaceTasksDataSource'] });

        expect(await findHeld()).toEqual({ notes: ['backed up', 'written since'], tasks: ['backed up'] });
    }, 30000);

    it('refuses naming a resource the backup does not hold', async () => {
        const backup: BackupEntity = await takeBackup();

        await expect(getBackupService().restore(backup, { resources: ['NoSuchDataSource'] })).rejects.toThrow(BadRequestError);
    }, 30000);

    it('takes no copy to put back without putBack', async () => {
        const backup: BackupEntity = await takeBackup();
        await writeSince();
        const copied: jest.SpiedFunction<SpaceNotesDataSource['createBackupData']> = jest.spyOn(SpaceNotesDataSource.prototype, 'createBackupData');

        await getBackupService().restore(backup, { putBack: false });

        expect(copied).not.toHaveBeenCalled();
        expect(await findHeld()).toEqual({ notes: ['backed up'], tasks: ['backed up'] });
    }, 30000);

    it('deletes what each resource holds before it applies the backup with deleteFirst, and keeps the rows a backup leaves out', async () => {
        const backup: BackupEntity = await takeBackup();
        await writeSince();
        // of both data sources, which have it of the class they extend
        const deleted: jest.SpiedFunction<InMemoryDataSource['deleteBackedUpData']> = jest.spyOn(InMemoryDataSource.prototype, 'deleteBackedUpData');

        await getBackupService().restore(backup, { deleteFirst: true });

        expect(deleted).toHaveBeenCalledTimes(2);
        expect(await findHeld()).toEqual({ notes: ['backed up'], tasks: ['backed up'] });
        // the record of the backup, which a backup leaves out
        expect(await inject(repositoryTokenFor(BackupEntity)).findById(backup.id)).toBeDefined();
    }, 30000);
});