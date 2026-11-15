/* eslint-disable typescript/no-deprecated -- the transports of 3.0, which 3.x keeps until 4.0 */
import assert from 'node:assert';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';

import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { InMemoryDataSource } from 'zibri-testing';

import { BackupEntity, BackupEntityCreateData } from './backup-entity.model';
import { BackupResourceEntity } from './backup-resource-entity.model';
import { BackupResourceInterface } from './backup-resource.interface';
import { BackupServiceInterface } from './backup-service.interface';
import { BackupStatus } from './backup-status.enum';
import { Backup } from './decorators/backup-resource.decorator';
import { BackupTransport } from './decorators/backup-transport.decorator';
import { BackupTransportInterface } from './transports/backup-transport.interface';
import { BaseFsBackupTransport } from './transports/base-fs.backup-transport';
import { BackupLayoutTestUtilities } from '../__testing__/backup/backup-layout-test.utilities';
import { testFileFolder, TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { DataSource } from '../data-source/decorators/data-source.decorator';
import { Repository } from '../data-source/repository/repository';
import { RepositoryClass } from '../data-source/repository/repository-class.type';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { BaseEntity } from '../entity/base-entity.model';
import { Logger } from '../logging/logger';
import { Newable } from '../types/newable.type';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';
import { UUIDUtilities } from '../utilities/uuid.utilities';

// what an application written against v1 of BackupTransportInterface keeps until 4.0: a transport of its
// own on it still backs up and restores, a shipped transport it overrides still calls its overrides once it
// names v1, and every kind written for it is named at boot

/**
 * A transport of an application, on v1 of BackupTransportInterface, keeping what it is handed in memory.
 */
@BackupTransport()
class ApplicationBackupTransport implements BackupTransportInterface {
    readonly name: string = 'application-backup-transport';
    readonly data: Map<string, Buffer> = new Map();
    readonly records: Map<string, string> = new Map();

    resolveBackups(existingNames: string[]): string[] {
        return [...this.records].filter(([name]) => !existingNames.includes(name)).map(([, document]) => document);
    }

    async storeData(data: Readable, backup: BackupEntity, resource: BackupResourceEntity): Promise<void> {
        this.data.set(`${backup.name}/${resource.name}`, await buffer(data));
    }

    storeMetadata(backup: BackupEntity, document: string): void {
        this.records.set(backup.name, document);
    }

    retrieveData(backup: BackupEntity, resource: BackupResourceEntity): Readable {
        const data: Buffer | undefined = this.data.get(`${backup.name}/${resource.name}`);
        if (data == undefined) {
            throw new Error(`holds nothing of "${resource.name}" in "${backup.name}"`);
        }
        return Readable.from([data]);
    }

    deleteData(backup: BackupEntity, resource: BackupResourceEntity): void {
        this.data.delete(`${backup.name}/${resource.name}`);
    }

    deleteMetadata(backup: BackupEntity): void {
        this.records.delete(backup.name);
    }
}

/**
 * A transport built on a shipped one, overriding a member of v1, which the shipped one used as v2 does not call.
 */
@BackupTransport()
class OverridingFsBackupTransport extends BaseFsBackupTransport {
    override readonly name: string = 'overriding-fs-backup-transport';
    protected override readonly backupBasePath: FsPath = FsUtilities.getPath(testFileFolder, `backups-overriding-${UUIDUtilities.generate()}`);

    // what an application wrote before the shipped transports opened sessions
    override async storeData(): Promise<void> {
        await Promise.reject(new Error('not called: the transport stores through openSession'));
    }
}

const pinnedFolder: FsPath = FsUtilities.getPath(testFileFolder, `backups-pinned-${UUIDUtilities.generate()}`);

/**
 * A transport built on a shipped one, overriding a member of v1, and naming v1 so that it is called.
 */
@BackupTransport()
class PinnedFsBackupTransport extends BaseFsBackupTransport {
    override readonly name: string = 'pinned-fs-backup-transport';
    override readonly versions: readonly 'v1'[] = ['v1'];
    protected override readonly backupBasePath: FsPath = pinnedFolder;
    readonly stored: string[] = [];

    // as an application of 3.0 wrote it: what it adds, then the shipped transport's own
    override async storeData(data: Readable, backup: BackupEntity, resource: BackupResourceEntity): Promise<void> {
        this.stored.push(`${backup.name}/${resource.name}`);
        await super.storeData(data, backup, resource);
    }
}

const mixedFolder: FsPath = FsUtilities.getPath(testFileFolder, `backups-mixed-${UUIDUtilities.generate()}`);

/**
 * A shipped transport, beside the application's own on a resource.
 */
@BackupTransport()
class MixedFsBackupTransport extends BaseFsBackupTransport {
    override readonly name: string = 'mixed-fs-backup-transport';
    protected override readonly backupBasePath: FsPath = mixedFolder;
}

@DataSource()
class Format1DataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, BackupEntity, BackupResourceEntity];
    override readonly repositories: RepositoryClass[] = defaultTestServerRepositories;
}

/**
 * A resource holding one value, restored into it.
 */
@Backup({ transports: [ApplicationBackupTransport], encrypt: false })
class SettingsStore implements BackupResourceInterface {
    value: string = 'backed up';

    createBackupData(): Readable {
        return Readable.from([Buffer.from(this.value)]);
    }

    async restoreBackup(data: Readable): Promise<void> {
        this.value = (await buffer(data)).toString();
    }

    validateBackupConfiguration(): void {
        // holds everything it needs
    }
}

/**
 * A resource going to the application's transport and to a shipped one, encrypted.
 */
@Backup({ transports: [ApplicationBackupTransport, MixedFsBackupTransport], encrypt: true })
class NotesStore implements BackupResourceInterface {
    value: string = 'notes backed up';

    createBackupData(): Readable {
        return Readable.from([Buffer.from(this.value)]);
    }

    async restoreBackup(data: Readable): Promise<void> {
        this.value = (await buffer(data)).toString();
    }

    validateBackupConfiguration(): void {
        // holds everything it needs
    }
}

/**
 * A resource going to the transport that keeps its override of v1 in use.
 */
@Backup({ transports: [PinnedFsBackupTransport], encrypt: false })
class ProjectsStore implements BackupResourceInterface {
    value: string = 'projects backed up';

    createBackupData(): Readable {
        return Readable.from([Buffer.from(this.value)]);
    }

    async restoreBackup(data: Readable): Promise<void> {
        this.value = (await buffer(data)).toString();
    }

    validateBackupConfiguration(): void {
        // holds everything it needs
    }
}

/**
 * The resource of a backup.
 * @param backup - The backup, with its resources.
 * @param name - The name of the resource.
 * @returns The resource.
 */
function getResource(backup: BackupEntity, name: string): BackupResourceEntity {
    const resource: BackupResourceEntity | undefined = backup.resources.find(r => r.name === name);
    assert(resource, `the backup holds no resource "${name}"`);
    return resource;
}

describe('BackupService — transports written against BackupTransportInterface', () => {
    let server: StartedTestServer | undefined;
    // on the class rather than on an instance: the warnings are logged while the application starts
    const warn: jest.SpiedFunction<Logger['warn']> = jest.spyOn(Logger.prototype, 'warn');

    beforeAll(async () => {
        // registered for the application, which reads every class marked with a decorator
        expect([OverridingFsBackupTransport, ProjectsStore]).toHaveLength(2);
        server = await startTestServer({ dataSources: [Format1DataSource] });
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        warn.mockRestore();
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('backs up and restores through a transport of the application on BackupTransportInterface', async () => {
        const backupService: BackupServiceInterface = inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);
        const settings: SettingsStore = inject(SettingsStore);

        const backup: BackupEntity = await backupService.waitForBackup(await backupService.queueBackup({ name: 'through-the-application' }));
        settings.value = 'changed since';
        await backupService.restore(backup);

        expect(backup.status).toBe(BackupStatus.COMPLETED);
        expect(inject(ApplicationBackupTransport).records.has('through-the-application')).toBe(true);
        expect(settings.value).toBe('backed up');
    }, TestTimeouts.inMemory.start);

    it('stores a resource that also goes to such a transport in one piece on every transport, and restores it from either', async () => {
        const backupService: BackupServiceInterface = inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);
        const notes: NotesStore = inject(NotesStore);
        const application: ApplicationBackupTransport = inject(ApplicationBackupTransport);

        const backup: BackupEntity = await backupService.waitForBackup(await backupService.queueBackup({ name: 'mixed' }));
        const resource: BackupResourceEntity = getResource(backup, NotesStore.name);
        const stored: Buffer = await readFile(BackupLayoutTestUtilities.resolveResourcePath(mixedFolder, backup, resource));

        // in one piece, encrypted with a key of its own, as the application's transport holds it
        expect(stored.subarray(0, 2)).toEqual(Buffer.from([1, 3]));
        expect(stored.subarray(2)).toEqual(application.data.get(`mixed/${NotesStore.name}`));
        expect(stored.includes('notes backed up')).toBe(false);
        expect(resource.encryptedKey).toEqual(expect.any(String));
        expect(await FsUtilities.exists(BackupLayoutTestUtilities.resolveRecordPath(mixedFolder, backup))).toBe(true);

        // what only the shipped transport still holds
        application.data.delete(`mixed/${NotesStore.name}`);
        notes.value = 'changed since';
        await backupService.restore(backup);

        expect(notes.value).toBe('notes backed up');
    }, TestTimeouts.inMemory.start);

    it('writes a backup queued in format 1 in format 1, and finds and restores it beside the backups of format 2', async () => {
        const backupService: BackupServiceInterface = inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);
        const backups: Repository<BackupEntity, BackupEntityCreateData> = inject(repositoryTokenFor(BackupEntity));
        const notes: NotesStore = inject(NotesStore);
        // as a build reading only format 1 queued it, before an instance of this one stored its resources
        const queued: BackupEntity = await backups.create({
            name: 'queued-in-format-1',
            status: BackupStatus.RUNNING,
            masterKeys: [],
            dataKeyIds: [],
            resources: [{ name: NotesStore.name, transportNames: ['application-backup-transport', 'mixed-fs-backup-transport'] }]
        });
        await backups.updateById(queued.id, { formatVersion: 1 });

        await backupService.runQueuedBackups();
        const done: BackupEntity = await backupService.waitForBackup(queued);

        expect(done.formatVersion).toBe(1);
        expect(await FsUtilities.exists(FsUtilities.getPath(mixedFolder, 'queued-in-format-1', NotesStore.name))).toBe(true);
        expect(await FsUtilities.exists(FsUtilities.getPath(mixedFolder, 'queued-in-format-1', 'metadata.json'))).toBe(true);

        // as after the database was replaced: the record is read back off the transports
        await inject(repositoryTokenFor(BackupResourceEntity)).deleteAll({ backupId: queued.id });
        await backups.deleteById(queued.id);
        await backupService.syncBackupEntities();
        const synced: BackupEntity = await backups.findById(queued.id, { relations: ['resources'] });
        inject(ApplicationBackupTransport).data.delete(`queued-in-format-1/${NotesStore.name}`);
        notes.value = 'changed since';
        await backupService.restore(synced);

        expect(synced.formatVersion).toBe(1);
        expect(notes.value).toBe('notes backed up');
    }, TestTimeouts.inMemory.start);

    // during a rolling deploy from 3.0, an instance of 3.0 stores the resources of a backup this build queued in
    // format 2 as it stores every backup: in format 1
    it('restores a resource of a backup of format 2 that a build reading only format 1 stored in format 1', async () => {
        const backupService: BackupServiceInterface = inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);
        const backups: Repository<BackupEntity, BackupEntityCreateData> = inject(repositoryTokenFor(BackupEntity));
        const notes: NotesStore = inject(NotesStore);
        const queued: BackupEntity = await backups.create({
            name: 'stored-in-format-1',
            status: BackupStatus.RUNNING,
            masterKeys: [],
            dataKeyIds: [],
            resources: [{ name: NotesStore.name, transportNames: ['application-backup-transport', 'mixed-fs-backup-transport'] }]
        });
        await backups.updateById(queued.id, { formatVersion: 1 });
        await backupService.runQueuedBackups();
        await backupService.waitForBackup(queued);
        await backups.updateById(queued.id, { formatVersion: 2 });
        const recorded: BackupEntity = await backups.findById(queued.id, { relations: ['resources'] });

        // what only the shipped transport holds, which stores format 2 as well
        inject(ApplicationBackupTransport).data.delete(`stored-in-format-1/${NotesStore.name}`);
        notes.value = 'changed since';
        await backupService.restore(recorded);

        expect(recorded.formatVersion).toBe(2);
        expect(notes.value).toBe('notes backed up');
    }, TestTimeouts.inMemory.start);

    it('calls the override of a transport built on a shipped one that names v1, and restores what it stored in format 1', async () => {
        const backupService: BackupServiceInterface = inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);
        const projects: ProjectsStore = inject(ProjectsStore);

        const backup: BackupEntity = await backupService.waitForBackup(await backupService.queueBackup({ name: 'pinned' }));
        projects.value = 'changed since';
        await backupService.restore(backup);

        expect(backup.status).toBe(BackupStatus.COMPLETED);
        // the backups of the tests before went through it as well
        expect(inject(PinnedFsBackupTransport).stored).toContain(`pinned/${ProjectsStore.name}`);
        expect(await FsUtilities.exists(FsUtilities.getPath(pinnedFolder, 'pinned', ProjectsStore.name))).toBe(true);
        expect(await FsUtilities.exists(FsUtilities.getPath(pinnedFolder, 'pinned', 'metadata.json'))).toBe(true);
        expect(projects.value).toBe('projects backed up');
    }, TestTimeouts.inMemory.start);

    it('names a transport supporting v1 alone at boot, which 4.0 no longer takes', () => {
        expect(warn).toHaveBeenCalledWith(expect.stringContaining(
            'The backup transport "application-backup-transport" supports v1 of BackupTransportInterface alone, which 4.0 no longer takes'
        ));
        expect(warn).toHaveBeenCalledWith(expect.stringContaining(
            'The backup transport "pinned-fs-backup-transport" supports v1 of BackupTransportInterface alone'
        ));
        expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('"mixed-fs-backup-transport" supports v1'));
    });

    it('names a transport built on a deprecated shipped one at boot, with the one replacing it', () => {
        expect(warn).toHaveBeenCalledWith(expect.stringContaining(
            'The backup transport "mixed-fs-backup-transport" is built on BaseFsBackupTransport, which 4.0 no longer has. '
            + 'Use FsBackupTransport instead.'
        ));
        expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('"application-backup-transport" is built on'));
    });

    it('names a transport built on a shipped one that overrides a member of v1 it is not called with', () => {
        expect(warn).toHaveBeenCalledWith(expect.stringContaining(
            'The backup transport "overriding-fs-backup-transport" defines storeData, which a transport used as v2 is not called with. '
            + 'Override openSession instead, or set its versions to [\'v1\'] to keep them in use until 4.0.'
        ));
        expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('"application-backup-transport" defines'));
        expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('"mixed-fs-backup-transport" defines'));
        expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('"pinned-fs-backup-transport" defines'));
    });
});