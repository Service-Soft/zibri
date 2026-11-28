import { Readable } from 'node:stream';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { InMemoryDataSource } from 'zibri-testing';

import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { StartedWebDavTestServer, WebDavTestServerUtilities } from '../../__testing__/web-dav/web-dav-test-server.utilities';
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
import { NextcloudClient } from '../../web-dav/nextcloud/nextcloud-client';
import { NextcloudShare } from '../../web-dav/nextcloud/nextcloud-share.model';
import { NextcloudTrashBinEntry } from '../../web-dav/nextcloud/nextcloud-trash-bin-entry.model';
import { WebDavClient } from '../../web-dav/web-dav-client';
import { WebDavConnection } from '../../web-dav/web-dav-connection.model';
import { WebDavForbiddenError } from '../../web-dav/web-dav-forbidden.error';
import { BackupEntity } from '../backup-entity.model';
import { BackupResourceEntity } from '../backup-resource-entity.model';
import { BackupServiceInterface } from '../backup-service.interface';
import { Backup } from '../decorators/backup-resource.decorator';
import { BackupTransport } from '../decorators/backup-transport.decorator';
import { BackupTransportSessionInterface } from './backup-transport-session.interface';
import { describeBackupTransport } from './backup-transport.cases';
import { NextcloudBackupReaders } from './nextcloud/nextcloud-backup-readers.model';
import { NextcloudBackupTransport } from './nextcloud.backup-transport';

// what the Nextcloud transport does against Nextcloud in a container: the shared cases, the shares of its folder, its
// trash bin, and an encrypted backup through it. A group of its own, `npm run test:nextcloud`, as the image is half a
// gigabyte and installs itself on every start. What it sends is held by nextcloud.backup-transport.test.ts

const ADMIN: string = 'ada';
const ADMIN_PASSWORD: string = 'Lovelace-1815-Analytical';
// the dedicated user owning the backups, who nobody else logs in as
const BACKUP_USER: string = 'backup';
const READER: string = 'grace';
const READERS_GROUP: string = 'backup-readers';
const READER_PASSWORD: string = 'Hopper-1906-Compiler';
const MARKER: string = 'only-readable-with-the-master-key';

let nextcloud: StartedWebDavTestServer | undefined;
let backupConnection: WebDavConnection | undefined;
let readerConnection: WebDavConnection | undefined;

/**
 * The connection of a user created once Nextcloud runs.
 * @param connection - The connection, if the user was created.
 * @returns The connection.
 */
function getConnection(connection: WebDavConnection | undefined): WebDavConnection {
    if (connection == undefined) {
        throw new Error('Nextcloud did not start.');
    }
    return connection;
}

/**
 * A transport of a folder of the backup user.
 * @param folder - The folder, below the files of the user.
 * @param sharedWith - Who it is shared with.
 * @returns The transport.
 */
function createTransport(folder: string, sharedWith: NextcloudBackupReaders): NextcloudBackupTransport {
    return new NextcloudBackupTransport('nextcloud-backup-transport', {
        connection: getConnection(backupConnection),
        folder,
        network: undefined,
        timeoutInMs: Ms.MINUTE,
        sharedWith
    });
}

/**
 * The client of the files of the backup user.
 * @returns The client.
 */
function createBackupUserClient(): NextcloudClient {
    return new NextcloudClient({ connection: getConnection(backupConnection), network: undefined, timeoutInMs: Ms.MINUTE });
}

/**
 * Puts a key through a session of its own.
 * @param transport - The transport.
 * @param key - The key.
 */
async function putThrough(transport: NextcloudBackupTransport, key: string): Promise<void> {
    const session: BackupTransportSessionInterface = await transport.openSession();
    try {
        await session.put(key, Readable.from([Buffer.from(key)]));
    }
    finally {
        await session.close();
    }
}

@BackupTransport()
class NextcloudFolderBackupTransport extends NextcloudBackupTransport {
    constructor() {
        super('nextcloud-folder-backup-transport', {
            connection: getConnection(backupConnection),
            folder: 'Backups/app',
            network: undefined,
            timeoutInMs: Ms.MINUTE,
            sharedWith: { users: [READER], groups: [] }
        });
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
@Backup({ transports: [NextcloudFolderBackupTransport], encrypt: true })
class NotesDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, Note, BackupEntity, BackupResourceEntity];
    override readonly repositories: RepositoryClass[] = defaultTestServerRepositories;
}

let server: StartedTestServer | undefined;

beforeAll(async () => {
    nextcloud = await WebDavTestServerUtilities.startNextcloud({ username: ADMIN, password: ADMIN_PASSWORD });
    backupConnection = await WebDavTestServerUtilities.createNextcloudUser(nextcloud, { username: BACKUP_USER, password: 'Backup-User-1815-Engine' }, []);
    readerConnection = await WebDavTestServerUtilities.createNextcloudUser(nextcloud, { username: READER, password: READER_PASSWORD }, [READERS_GROUP]);
    server = await startTestServer({ dataSources: [NotesDataSource] });
}, Ms.MINUTE * 6);

afterAll(async () => {
    await server?.shutdown();
    await nextcloud?.stop();
}, Ms.SECOND * 30);

describeBackupTransport('NextcloudBackupTransport', () => createTransport('cases', { users: [], groups: [] }));

describe('NextcloudBackupTransport against Nextcloud', () => {
    it('shares its folder with the readers to read, and a reader writes nothing into it', async () => {
        const folder: string = `Backups-${UUIDUtilities.generate()}`;

        await putThrough(createTransport(folder, { users: [READER], groups: [READERS_GROUP] }), 'record');
        const shares: NextcloudShare[] = await createBackupUserClient().findShares(folder);
        const asReader: WebDavClient = new WebDavClient({ connection: getConnection(readerConnection), network: undefined, timeoutInMs: Ms.MINUTE });
        const refused: unknown = await asReader.put(`${folder}/synced-by-accident.txt`, 'a file of a device', { contentType: 'text/plain', overwrite: true })
            .then(() => undefined, (error: unknown) => error);

        expect(shares.map(share => [share.type, share.shareWith, share.permissions]).sort()).toEqual([['group', READERS_GROUP, 1], ['user', READER, 1]]);
        expect((await asReader.findEntries(folder)).map(entry => entry.name)).toEqual(['record']);
        expect(refused).toBeInstanceOf(WebDavForbiddenError);
    }, Ms.MINUTE);

    it('makes a share that allows writing read-only again, and deletes a share by link, before the next session writes', async () => {
        const folder: string = `Backups-${UUIDUtilities.generate()}`;
        const transport: NextcloudBackupTransport = createTransport(folder, { users: [READER], groups: [] });
        await putThrough(transport, 'first');
        const client: NextcloudClient = createBackupUserClient();
        const [withReader] = await client.findShares(folder);
        await client.updateShare(withReader?.id ?? '', { permissions: 31 });
        await client.createShare({ type: 'link', path: folder, password: undefined, expiresOn: undefined });

        await putThrough(transport, 'second');

        expect((await client.findShares(folder)).map(share => [share.type, share.shareWith, share.permissions])).toEqual([['user', READER, 1]]);
    }, Ms.MINUTE);

    it('deletes what it deletes from the trash bin as well', async () => {
        const folder: string = `Backups-${UUIDUtilities.generate()}`;
        const transport: NextcloudBackupTransport = createTransport(folder, { users: [], groups: [] });
        await putThrough(transport, 'chunks/ab/abcdef');
        await putThrough(transport, 'chunks/cd/cdef01');

        const session: BackupTransportSessionInterface = await transport.openSession();
        await session.delete(['chunks/ab/abcdef']);
        await session.close();
        const trashed: NextcloudTrashBinEntry[] = await createBackupUserClient().findTrashBinEntries(folder);

        expect(trashed).toEqual([]);
        expect((await createBackupUserClient().findEntries(`${folder}/chunks`)).map(entry => entry.name)).toEqual(['cd']);
    }, Ms.MINUTE);

    it('creates an encrypted backup into the folder, stores nothing of it readably, and restores it', async () => {
        const notes: Repository<Note> = inject(repositoryTokenFor(Note));
        await notes.createAll(Array.from({ length: 20 }, (_, i) => ({ text: `${MARKER}-${i}-${'a'.repeat(5000)}` })));
        const backupService: BackupServiceInterface = inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);

        await backupService.waitForBackup(await backupService.queueBackup({ name: 'nightly' }));
        const [backup]: BackupEntity[] = await inject<Repository<BackupEntity>>(repositoryTokenFor(BackupEntity)).findAll({
            where: { name: 'nightly' },
            relations: ['resources']
        });
        if (backup == undefined) {
            throw new Error('The backup was not created.');
        }
        const client: NextcloudClient = createBackupUserClient();
        const chunkFolders: string[] = (await client.findEntries('Backups/app/.zibri-repository/chunks')).map(entry => entry.path);
        const chunks: string[] = (await Promise.all(chunkFolders.map(async path => await client.findEntries(path)))).flat().map(entry => entry.path);
        const contents: Buffer[] = await Promise.all(chunks.map(async path => Buffer.concat(await (await client.get(path, '16mb')).content.toArray())));
        await notes.deleteAll({});
        await backupService.restore(backup);

        expect(chunks.length).toBeGreaterThan(0);
        expect(contents.filter(content => content.includes(MARKER))).toEqual([]);
        expect(await notes.count()).toBe(20);
    }, Ms.MINUTE * 2);
});