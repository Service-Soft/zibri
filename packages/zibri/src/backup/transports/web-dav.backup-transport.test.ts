import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { InMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { InProcessWebDavServer } from '../../__testing__/web-dav/in-process-web-dav-server.model';
import { DataSource } from '../../data-source/decorators/data-source.decorator';
import { Repository } from '../../data-source/repository/repository';
import { RepositoryClass } from '../../data-source/repository/repository-class.type';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { Newable } from '../../types/newable.type';
import { Ms } from '../../utilities/ms';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { WebDavConnection } from '../../web-dav/web-dav-connection.model';
import { BackupEntity } from '../backup-entity.model';
import { BackupResourceEntity } from '../backup-resource-entity.model';
import { BackupServiceInterface } from '../backup-service.interface';
import { Backup } from '../decorators/backup-resource.decorator';
import { BackupTransport } from '../decorators/backup-transport.decorator';
import { BackupKeyNotFoundError } from './backup-key-not-found.error';
import { BackupTransportSessionInterface } from './backup-transport-session.interface';
import { describeBackupTransport } from './backup-transport.cases';
import { WebDavBackupTransport } from './web-dav.backup-transport';

// against a WebDAV server in this process. What a real server does with the same requests is held by
// web-dav.backup-transport.container.test.ts, and what Nextcloud does by nextcloud.backup-transport.nextcloud.test.ts

const USER: string = 'ada';

/**
 * Written into every note, so that finding it in a stored file means the backup can be read without the master key.
 */
const MARKER: string = 'only-readable-with-the-master-key';

const server: InProcessWebDavServer = new InProcessWebDavServer(USER, 'Lovelace-app-password');

// a server of its own for the cases that fail requests, whose failures open no circuit of the http client for the
// other one
const failing: InProcessWebDavServer = new InProcessWebDavServer(USER, 'Lovelace-app-password');

/**
 * The connection to the files of the user on a server.
 * @param of - The server.
 * @returns The connection.
 */
function resolveConnection(of: InProcessWebDavServer): WebDavConnection {
    return { ...of.connection, url: `${of.connection.url}files/${USER}/` };
}

@BackupTransport()
class FolderBackupTransport extends WebDavBackupTransport {
    constructor() {
        super('web-dav-backup-transport', { connection: resolveConnection(server), folder: 'Backups/app', network: undefined });
    }
}

@Entity({ tenant: 'shared' })
class Note {
    @Property.string({ primary: true })
    id!: string;

    @Property.string()
    text!: string;
}

@DataSource()
@Backup({ transports: [FolderBackupTransport], encrypt: true })
class NotesDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, Note, BackupEntity, BackupResourceEntity];
    override readonly repositories: RepositoryClass[] = defaultTestServerRepositories;
}

/**
 * A transport of a folder on the failing server, sending each request once.
 * @param folder - The folder, below the files of the user.
 * @returns The transport.
 */
function createFailingTransport(folder: string = `failing-${UUIDUtilities.generate()}`): WebDavBackupTransport {
    return new WebDavBackupTransport('failing-web-dav-backup-transport', {
        connection: resolveConnection(failing),
        folder,
        network: undefined,
        attempts: 1
    });
}

/**
 * Runs work on a session of a transport, closed once the work is done.
 * @param transport - The transport.
 * @param work - The work.
 * @returns What it returned.
 */
async function withSession<T>(transport: WebDavBackupTransport, work: (session: BackupTransportSessionInterface) => Promise<T>): Promise<T> {
    const session: BackupTransportSessionInterface = await transport.openSession();
    try {
        return await work(session);
    }
    finally {
        await session.close();
    }
}

/**
 * Every key a session finds under a prefix.
 * @param session - The session.
 * @param prefix - The prefix.
 * @returns The keys, sorted.
 */
async function findAllKeys(session: BackupTransportSessionInterface, prefix: string): Promise<string[]> {
    const keys: string[] = [];
    for await (const page of session.findKeys(prefix)) {
        keys.push(...page);
    }
    return keys.sort();
}

function getBackupService(): BackupServiceInterface {
    return inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);
}

let testServer: StartedTestServer | undefined;

beforeAll(async () => {
    await server.start();
    await failing.start();
    server.createFolder(`files/${USER}`);
    failing.createFolder(`files/${USER}`);
    // the transport sends through the application's http client
    testServer = await startTestServer({ dataSources: [NotesDataSource] });
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await testServer?.shutdown();
    await server.stop();
    await failing.stop();
}, TestTimeouts.inMemory.shutdown);

describeBackupTransport('WebDavBackupTransport', () => new WebDavBackupTransport('web-dav-backup-transport-cases', {
    connection: resolveConnection(server),
    folder: 'cases',
    network: undefined
}));

describe('WebDavBackupTransport, when an upload fails', () => {
    it('leaves no key behind when the connection breaks while a put is sent', async () => {
        const transport: WebDavBackupTransport = createFailingTransport();
        failing.interruptedPuts = 1;

        const [refused, keys] = await withSession(transport, async session => [
            await session.put('chunks/ab/abcdef', Readable.from([Buffer.alloc(64 * 1024, 1)])).then(() => undefined, (error: unknown) => error),
            await findAllKeys(session, '')
        ]);

        expect(refused).toBeInstanceOf(Error);
        expect(keys).toEqual([]);
        await withSession(transport, async session => {
            await expect(session.get('chunks/ab/abcdef', 1024 * 1024)).rejects.toBeInstanceOf(BackupKeyNotFoundError);
        });
    });

    it('keeps what a key held when its replacement breaks halfway', async () => {
        const transport: WebDavBackupTransport = createFailingTransport();

        const read: string = await withSession(transport, async session => {
            await session.put('record', Readable.from([Buffer.from('as it was')]));
            failing.interruptedPuts = 1;
            await expect(session.put('record', Readable.from([Buffer.from('the replacement')]))).rejects.toThrow();
            return (await buffer(await session.get('record', 1024))).toString();
        });

        expect(read).toBe('as it was');
    });

    it('deletes the upload when it cannot be moved into place, and leaves no key behind', async () => {
        const folder: string = `failing-${UUIDUtilities.generate()}`;
        const transport: WebDavBackupTransport = createFailingTransport(folder);
        failing.refusedMoves = 1;

        const keys: string[] = await withSession(transport, async session => {
            // eslint-disable-next-line cspell/spellchecker
            await expect(session.put('chunks/cd/cdef01', Readable.from([Buffer.from('a chunk')]))).rejects.toThrow();
            return await findAllKeys(session, '');
        });

        expect(keys).toEqual([]);
        expect(failing.findFilePaths(`files/${USER}/${folder}`)).toEqual([]);
    });

    it('lists no upload still running, and takes no key named like one', async () => {
        const folder: string = `failing-${UUIDUtilities.generate()}`;
        const transport: WebDavBackupTransport = createFailingTransport(folder);
        await withSession(transport, async session => await session.put('backups/1/record', Readable.from([Buffer.from('{}')])));
        failing.edit(`files/${USER}/${folder}/backups/1/.zibri-upload-${UUIDUtilities.generate()}`, 'still arriving');

        const [keys, names] = await withSession(transport, async session => {
            const found: string[] = [];
            for await (const page of session.findNames('backups/1')) {
                found.push(...page);
            }
            return [await findAllKeys(session, 'backups/'), found];
        });

        expect(keys).toEqual(['backups/1/record']);
        expect(names).toEqual(['record']);
        await withSession(transport, async session => {
            await expect(session.put('backups/1/.zibri-upload-x', Readable.from([Buffer.from('x')]))).rejects.toThrow('needs segments that do not start with');
        });
    });
});

describe('WebDavBackupTransport, as the transport of an encrypted backup', () => {
    // kept rather than read back: restoring an in memory store puts its backup rows back the way they were when the
    // data was taken, which is before this backup was recorded as finished
    let backup: BackupEntity;

    beforeAll(async () => {
        await inject<Repository<Note>>(repositoryTokenFor(Note)).createAll(
            Array.from({ length: 20 }, (_, i) => ({ text: `${MARKER}-${i}-${'a'.repeat(5000)}` }))
        );
        await getBackupService().waitForBackup(await getBackupService().queueBackup({ name: 'nightly' }));
        const [stored]: BackupEntity[] = await inject<Repository<BackupEntity>>(repositoryTokenFor(BackupEntity)).findAll({
            where: { name: 'nightly' },
            relations: ['resources']
        });
        if (stored == undefined) {
            throw new Error('The backup was not created.');
        }
        backup = stored;
    }, 30000);

    it('stores nothing of the data readably, in the folder, and restores all of it', async () => {
        const files: string[] = server.findFilePaths(`files/${USER}/Backups/app`);
        expect(files.some(path => path.includes('/.zibri-repository/chunks/'))).toBe(true);
        expect(files.filter(path => server.files.get(path)?.content.includes(MARKER) === true)).toEqual([]);
        expect(files.filter(path => path.includes('.zibri-upload-'))).toEqual([]);

        const notes: Repository<Note> = inject(repositoryTokenFor(Note));
        await notes.deleteAll({});
        await getBackupService().restore(backup);

        expect(await notes.count()).toBe(20);
    }, 30000);

    it('deletes a backup with its folder, so that syncing does not bring it back', async () => {
        const backupService: BackupServiceInterface = getBackupService();
        await backupService.waitForBackup(await backupService.queueBackup({ name: 'deleted-for-good' }));
        const [deleted]: BackupEntity[] = await inject<Repository<BackupEntity>>(repositoryTokenFor(BackupEntity)).findAll({
            where: { name: 'deleted-for-good' },
            relations: ['resources']
        });
        if (deleted == undefined) {
            throw new Error('The backup was not created.');
        }
        const backupFolder: string = `files/${USER}/Backups/app/.zibri-repository/backups/${deleted.id}`;
        expect(server.findFolderPaths(`files/${USER}/Backups/app/.zibri-repository/backups`)).toContain(backupFolder);

        await backupService.delete(deleted);
        await backupService.syncBackupEntities();

        expect(server.findFolderPaths(`files/${USER}/Backups/app/.zibri-repository/backups`)).not.toContain(backupFolder);
        expect(await inject<Repository<BackupEntity>>(repositoryTokenFor(BackupEntity)).findAll({ where: { name: 'deleted-for-good' } })).toEqual([]);
    }, 30000);
});

// a process that went down between an upload and its move left the upload behind, out of every listing, where it took
// up its size and kept the folder of its key from being removed
describe('WebDavBackupTransport, at a garbage collection', () => {
    it('deletes the uploads a put left a day ago, with the folders they kept, and keeps one still arriving', async () => {
        const repository: string = `files/${USER}/Backups/app/.zibri-repository`;
        const aDayAgo: Date = new Date(Date.now() - Ms.DAY - Ms.HOUR);
        server.createFolder(`${repository}/chunks/f0`);
        server.createFolder(`${repository}/chunks/f1`);
        const leftBehind: string = `${repository}/chunks/f0/.zibri-upload-${UUIDUtilities.generate()}`;
        const arriving: string = `${repository}/chunks/f1/.zibri-upload-${UUIDUtilities.generate()}`;
        server.edit(leftBehind, 'part of a chunk', aDayAgo);
        server.edit(arriving, 'a chunk being moved into place');
        const collectGarbage: BackupServiceInterface['collectGarbage'] = getBackupService().collectGarbage;
        if (collectGarbage == undefined) {
            throw new Error('The backup service collects no garbage.');
        }

        await collectGarbage.call(getBackupService());

        expect(server.files.has(leftBehind)).toBe(false);
        expect(server.findFolderPaths(`${repository}/chunks`)).not.toContain(`${repository}/chunks/f0`);
        expect(server.files.has(arriving)).toBe(true);
        expect(server.findFolderPaths(`${repository}/chunks`)).toContain(`${repository}/chunks/f1`);
    }, 30000);
});