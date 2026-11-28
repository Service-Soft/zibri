import assert from 'node:assert';
import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { StartedWebDavTestServer, WebDavTestServerUtilities } from '../../__testing__/web-dav/web-dav-test-server.utilities';
import { PostgresBackupScope } from '../../data-source/data-sources/postgres/postgres-backup-scope.model';
import { PostgresDataSource, PostgresOptions } from '../../data-source/data-sources/postgres/postgres-data-source.model';
import { PostgresPooler } from '../../data-source/data-sources/postgres/postgres-pooler.model';
import { DataSource } from '../../data-source/decorators/data-source.decorator';
import { SchemaManagement } from '../../data-source/models/schema-management.model';
import { Repository } from '../../data-source/repository/repository';
import { RepositoryClass } from '../../data-source/repository/repository-class.type';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { Newable } from '../../types/newable.type';
import { Ms } from '../../utilities/ms';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { WebDavClient } from '../../web-dav/web-dav-client';
import { WebDavConnection } from '../../web-dav/web-dav-connection.model';
import { WebDavEntry } from '../../web-dav/web-dav-entry.model';
import { BackupEntity } from '../backup-entity.model';
import { BackupResourceEntity } from '../backup-resource-entity.model';
import { BackupService } from '../backup.service';
import { Backup } from '../decorators/backup-resource.decorator';
import { BackupTransport } from '../decorators/backup-transport.decorator';
import { BackupTransportSessionInterface } from './backup-transport-session.interface';
import { describeBackupTransport } from './backup-transport.cases';
import { WebDavBackupTransport } from './web-dav.backup-transport';

// against a real WebDAV server, Apache's mod_dav, in a container, which refuses a listing of infinite depth: what the
// transport asks of a server, and an encrypted backup of a Postgres data source through it. How the transport handles
// an upload that fails part way is held by web-dav.backup-transport.test.ts, against a server in this process

/**
 * Written into every item, so that finding it in a stored file means the backup can be read without the master key.
 */
const MARKER: string = 'only-readable-with-the-master-key';

// only known once the container runs, which is after the transport below is declared
let connection: WebDavConnection | undefined;

/**
 * The connection to the folder Apache serves.
 * @returns The connection.
 */
function getConnection(): WebDavConnection {
    if (connection == undefined) {
        throw new Error('The WebDAV server did not start.');
    }
    return connection;
}

@BackupTransport()
class ApacheBackupTransport extends WebDavBackupTransport {
    constructor() {
        // a folder that does not exist yet, so that storing the first backup has to create it
        super('apache-backup-transport', { connection: getConnection(), folder: 'backups/app', network: undefined });
    }
}

@Entity({ tenant: 'shared' })
class Item {
    @Property.string({ primary: true })
    id!: string;

    @Property.string()
    value!: string;
}

@DataSource()
@Backup({ transports: [ApacheBackupTransport], encrypt: true })
class DbDataSource extends PostgresDataSource {
    override backupScope: PostgresBackupScope = 'schema';
    override rootPw: string = 'password';
    override rootUsername: string = 'postgres';
    override options: PostgresOptions = {
        host: 'localhost',
        username: 'postgres',
        password: 'password',
        database: 'db',
        ssl: false
    };
    entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, Item, BackupResourceEntity, BackupEntity];
    repositories: RepositoryClass[] = defaultTestServerRepositories;
    schemaManagement: SchemaManagement = 'synchronize';
    readonly pooler: PostgresPooler = 'none';
}

/**
 * Every file below a folder of the server, read through a client of its own.
 * @param client - The client.
 * @param folder - The folder.
 * @returns The paths of the files.
 */
async function findFilesBelow(client: WebDavClient, folder: string): Promise<string[]> {
    const entries: WebDavEntry[] = await client.findEntries(folder);
    const below: string[][] = await Promise.all(entries.filter(entry => entry.kind === 'folder').map(async entry => await findFilesBelow(client, entry.path)));
    return [...entries.filter(entry => entry.kind === 'file').map(entry => entry.path), ...below.flat()];
}

describe('WebDavBackupTransport against Apache', () => {
    let webDav: StartedWebDavTestServer | undefined;
    let server: StartedTestServer | undefined;

    beforeAll(async () => {
        webDav = await WebDavTestServerUtilities.startApache({ username: 'ada', password: 'Lovelace-1815' });
        connection = webDav.connection;
        server = await startTestServer({ dataSources: [DbDataSource] });
    }, Ms.MINUTE * 2);

    afterAll(async () => {
        await server?.shutdown();
        await webDav?.stop();
    }, Ms.SECOND * 30);

    describeBackupTransport('WebDavBackupTransport', () => new WebDavBackupTransport('apache-backup-transport-cases', {
        connection: getConnection(),
        folder: 'cases',
        network: undefined
    }));

    it('stores data of several megabytes, and reads it back unchanged', async () => {
        const transport: WebDavBackupTransport = new WebDavBackupTransport('apache-backup-transport-large', { connection: getConnection(), folder: 'large', network: undefined });
        const data: Buffer = Buffer.alloc(6 * 1024 * 1024, 7);
        const key: string = `${UUIDUtilities.generate()}/data`;
        const session: BackupTransportSessionInterface = await transport.openSession();

        await session.put(key, Readable.from([data]));
        const keys: string[] = [];
        for await (const page of session.findKeys('')) {
            keys.push(...page);
        }
        const read: Buffer = await buffer(await session.get(key, data.length));
        await session.close();

        expect(keys).toContain(key);
        expect(read.equals(data)).toBe(true);
    }, Ms.MINUTE);

    it('creates an encrypted backup of a Postgres data source, stores nothing of it readably, and restores it', async () => {
        const itemRepository: Repository<Item> = inject(repositoryTokenFor(Item));
        const backupRepository: Repository<BackupEntity> = inject(repositoryTokenFor(BackupEntity));
        const backupService: BackupService = inject(BackupService);
        await itemRepository.create({ value: `${MARKER}-42` });

        await backupService.waitForBackup(await backupService.queueBackup({ name: 'round-trip' }));
        const client: WebDavClient = new WebDavClient({ connection: getConnection(), network: undefined, timeoutInMs: Ms.SECOND * 30 });
        const files: string[] = await findFilesBelow(client, 'backups/app');
        const contents: Buffer[] = await Promise.all(files.map(async path => await buffer((await client.get(path, '64mb')).content)));
        await itemRepository.deleteAll({});
        await backupRepository.deleteAll({});
        await backupService.syncBackupEntities();
        const [backup]: BackupEntity[] = await backupRepository.findAll({ where: { name: 'round-trip' }, relations: ['resources'] });
        assert(backup, 'the backup was not found on the server');
        await backupService.restore(backup);

        expect(files.some(path => path.includes('.zibri-repository/chunks/'))).toBe(true);
        expect(contents.filter(content => content.includes(MARKER))).toEqual([]);
        expect(await itemRepository.findAll()).toEqual([expect.objectContaining({ value: `${MARKER}-42` })]);
    }, Ms.MINUTE);
});