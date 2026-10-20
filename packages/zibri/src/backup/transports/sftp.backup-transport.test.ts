import assert from 'node:assert';
import { createHash, randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { utils } from 'ssh2';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';

import { SftpBackupTransportOptions } from './sftp/sftp-backup-transport-options.model.ts';
import { BaseSftpBackupTransport } from './sftp.backup-transport.ts';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { PostgresDataSource, PostgresOptions } from '../../data-source/data-sources/postgres/postgres-typeorm-data-source.model.ts';
import { DataSource } from '../../data-source/decorators/data-source.decorator.ts';
import { SchemaManagement } from '../../data-source/models/schema-management.model.ts';
import { Repository } from '../../data-source/repository/repository.ts';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator.ts';
import { inject } from '../../di/inject.function.ts';
import { BaseEntity } from '../../entity/base-entity.model.ts';
import { Entity } from '../../entity/decorators/entity.decorator.ts';
import { Property } from '../../entity/decorators/property.decorator.ts';
import { Newable } from '../../types/newable.type.ts';
import { OmitStrict } from '../../types/omit-strict.type.ts';
import { JsonUtilities } from '../../utilities/json.utilities.ts';
import { BackupEntity } from '../backup-entity.model.ts';
import { BackupResourceEntity } from '../backup-resource-entity.model.ts';
import { BackupService } from '../backup.service.ts';
import { Backup } from '../decorators/backup-resource.decorator.ts';
import { BackupTransport } from '../decorators/backup-transport.decorator.ts';

/**
 * The SFTP server the transport is tested against: OpenSSH's own, configured by the image from its command.
 *
 * The image publishes no version tags, so this is the smallest of the ones it has.
 */
const SFTP_TEST_IMAGE: string = 'atmoz/sftp:alpine';
const SFTP_PORT: number = 22;
const USERNAME: string = 'zibri';
const PASSWORD: string = 'zibri-test-password';
// the user is locked into its home folder, so `/backups` is `/home/zibri/backups` on the server
const HOME: string = `/home/${USERNAME}`;
const MIB: number = 1024 * 1024;

// only known once the container runs, which is after the transports below are declared
let host: string = '';
let port: number = 0;
let hostKeyFingerprint: string = '';

// ecdsa rather than ed25519: ssh2 strips leading zero bytes from a generated ed25519 public key, so
// one key in 256 comes out a byte short and ssh2 itself then refuses to parse it. An ecdsa point
// starts with 0x04 and is never cut
const { private: privateKey, public: publicKey } = utils.generateKeyPairSync('ecdsa', { bits: 256 });

/**
 * The options every transport here shares, the way it logs in aside.
 * @returns The options.
 */
function sharedOptions(): OmitStrict<SftpBackupTransportOptions, 'authentication'> {
    return {
        host,
        port,
        username: USERNAME,
        hostKeyFingerprint,
        // a folder that does not exist yet, so that storing the first backup has to create it
        path: '/backups/app'
    };
}

@BackupTransport()
class TestSftpBackupTransport extends BaseSftpBackupTransport {
    override readonly name: string = 'sftp-backup-transport';
    protected override get options(): SftpBackupTransportOptions {
        return { ...sharedOptions(), authentication: { password: PASSWORD } };
    }
}

// the two below are built directly by the cases that use them rather than registered: the application
// asks every registered transport for its backups while it starts, and one that is meant to be refused
// would refuse the application
class KeySftpBackupTransport extends BaseSftpBackupTransport {
    override readonly name: string = 'sftp-key-backup-transport';
    protected override get options(): SftpBackupTransportOptions {
        return { ...sharedOptions(), authentication: { privateKey } };
    }
}

class OtherHostSftpBackupTransport extends BaseSftpBackupTransport {
    override readonly name: string = 'sftp-other-host-backup-transport';
    protected override get options(): SftpBackupTransportOptions {
        return {
            ...sharedOptions(),
            authentication: { password: PASSWORD },
            // a fingerprint of the right shape that belongs to no key
            hostKeyFingerprint: `SHA256:${randomBytes(32).toString('base64')
                .replace(/=+$/, '')}`
        };
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
@Backup({ transports: [TestSftpBackupTransport], encrypt: false })
class DbDataSource extends PostgresDataSource {
    override rootPw: string = 'password';
    override rootUsername: string = 'postgres';
    override options: OmitStrict<PostgresOptions, 'type'> = {
        host: 'localhost',
        username: 'postgres',
        password: 'password',
        database: 'db',
        ssl: false
    };
    entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, Item, BackupResourceEntity, BackupEntity];
    schemaManagement: SchemaManagement = 'synchronize';
}

/**
 * Creates the entities the transport is called with.
 * @param backupName - The name of the backup.
 * @param size - The size recorded for the resource.
 * @returns The backup and its one resource.
 */
function resolveBackup(backupName: string, size: number): [BackupEntity, BackupResourceEntity] {
    const backup: BackupEntity = Object.assign(new BackupEntity(), { name: backupName });
    const resource: BackupResourceEntity = Object.assign(new BackupResourceEntity(), { name: 'Data', size });
    return [backup, resource];
}

/**
 * Some random data, in the chunks a file is read in.
 * @param size - How many bytes.
 * @returns The chunks.
 */
function resolveRandomChunks(size: number): Buffer[] {
    const chunkSize: number = 64 * 1024;
    return Array.from({ length: Math.ceil(size / chunkSize) }, (_, i) => randomBytes(Math.min(chunkSize, size - (i * chunkSize))));
}

/**
 * The sha256 of some data, to compare two copies of it.
 * @param data - The data.
 * @returns Its hash.
 */
function resolveHash(data: Buffer): string {
    return createHash('sha256')
        .update(data)
        .digest('hex');
}

describe('BaseSftpBackupTransport', () => {
    let sftp: StartedTestContainer;
    let server: StartedTestServer;
    let transport: TestSftpBackupTransport;

    /**
     * Lists a folder on the server directly, for what the transport itself never says.
     * @param folder - The folder, below the user's home.
     * @returns The names in it.
     */
    async function listOnServer(folder: string): Promise<string[]> {
        const { output } = await sftp.exec(['ls', '-1', `${HOME}${folder}`]);
        return output.split('\n').filter(name => name !== '');
    }

    beforeAll(async () => {
        // `user:password:uid:gid:folder`. The image adds the keys under .ssh/keys to the user's authorized keys
        sftp = await new GenericContainer(SFTP_TEST_IMAGE)
            .withCommand([`${USERNAME}:${PASSWORD}:::backups`])
            .withCopyContentToContainer([{ content: publicKey, target: `${HOME}/.ssh/keys/id_ecdsa.pub` }])
            .withExposedPorts(SFTP_PORT)
            .withWaitStrategy(Wait.forLogMessage(/Server listening on/))
            .start();
        host = sftp.getHost();
        port = sftp.getMappedPort(SFTP_PORT);
        // the key the transport is offered first, as `ssh-keygen -lf` prints it: `256 SHA256:... comment (ED25519)`
        const { output } = await sftp.exec(['ssh-keygen', '-lf', '/etc/ssh/ssh_host_ed25519_key.pub']);
        hostKeyFingerprint = output.split(' ')[1] ?? '';
        expect(hostKeyFingerprint).toMatch(/^SHA256:/);

        server = await startTestServer({ dataSources: [DbDataSource] });
        transport = inject(TestSftpBackupTransport);
    }, 60000);

    afterAll(async () => {
        await server.shutdown();
        await sftp.stop();
    }, 30000);

    it('refuses a server that identifies itself with another key, and names the key it did', async () => {
        const otherHost: OtherHostSftpBackupTransport = new OtherHostSftpBackupTransport();

        // without this, every other case here could pass against a transport that verifies nothing
        await expect(otherHost.resolveBackups([])).rejects.toThrow(hostKeyFingerprint);
    });

    it('creates and restores a backup through the server', async () => {
        const itemRepository: Repository<Item> = inject(repositoryTokenFor(Item));
        const backupRepository: Repository<BackupEntity> = inject(repositoryTokenFor(BackupEntity));
        const backupService: BackupService = inject(BackupService);
        await itemRepository.create({ value: '42' });

        await backupService.createBackup({ name: 'round-trip' });
        await itemRepository.deleteAll({});
        await backupRepository.deleteAll({});
        await backupService.syncBackupEntities();
        const [backup]: BackupEntity[] = await backupRepository.findAll({ where: { name: 'round-trip' }, relations: ['resources'] });
        assert(backup, 'the backup was not found on the server');
        await backupService.restore(backup);

        expect(await itemRepository.findAll()).toEqual([expect.objectContaining({ value: '42' })]);
    }, 30000);

    it('deletes a backup from the server with its folder, so that syncing does not bring it back', async () => {
        const backupRepository: Repository<BackupEntity> = inject(repositoryTokenFor(BackupEntity));
        const backupService: BackupService = inject(BackupService);
        await backupService.createBackup({ name: 'deleted-for-good' });
        const [backup]: BackupEntity[] = await backupRepository.findAll({ where: { name: 'deleted-for-good' }, relations: ['resources'] });
        assert(backup, 'the backup was not created');
        expect(await listOnServer('/backups/app')).toContain('deleted-for-good');

        await backupService.delete(backup);
        await backupService.syncBackupEntities();

        expect(await backupRepository.findAll({ where: { name: 'deleted-for-good' } })).toEqual([]);
        // the folder too: left empty, it would be resolved as a backup that was interrupted on every sync
        expect(await listOnServer('/backups/app')).not.toContain('deleted-for-good');
    }, 30000);

    it('logs in with a private key', async () => {
        const withKey: KeySftpBackupTransport = new KeySftpBackupTransport();
        const [backup] = resolveBackup('with-key', 0);

        await withKey.storeMetadata(backup, JsonUtilities.stringify({ name: 'with-key' }));

        expect(await listOnServer('/backups/app/with-key')).toEqual(['metadata.json']);
    });

    it('stores data of several megabytes, and reads it back unchanged', async () => {
        const chunks: Buffer[] = resolveRandomChunks(6 * MIB);
        const [backup, resource] = resolveBackup('large', 6 * MIB);

        await transport.storeData(Readable.from(chunks), backup, resource);
        const read: Buffer = await buffer(await transport.retrieveData(backup, resource));

        expect(resolveHash(read)).toBe(resolveHash(Buffer.concat(chunks)));
    }, 30000);

    it('refuses a file larger than the size recorded for it', async () => {
        const [backup, resource] = resolveBackup('grown', 1024);
        await transport.storeData(Readable.from(resolveRandomChunks(2048)), backup, resource);

        await expect(transport.retrieveData(backup, resource)).rejects.toThrow('larger than the 1024 recorded for it');
    });

    it('passes on the error of data that fails half way', async () => {
        const [backup, resource] = resolveBackup('failing', 2 * MIB);
        const failing: Readable = Readable.from((function* failAfterSomeData(): Generator<Buffer> {
            yield* resolveRandomChunks(MIB);
            throw new Error('the dump failed');
        })());

        await expect(transport.storeData(failing, backup, resource)).rejects.toThrow('the dump failed');
    });

    it('resolves the record of every finished backup, and none of an unfinished one', async () => {
        const [finished] = resolveBackup('finished', 0);
        const [unfinished, resource] = resolveBackup('unfinished', 3);
        await transport.storeMetadata(finished, JsonUtilities.stringify({ name: 'finished' }));
        await transport.storeData(Readable.from([Buffer.from('abc')]), unfinished, resource);
        // a record that was cut off while it was written is still under the name it is written under
        await sftp.exec(['sh', '-c', `mkdir -p ${HOME}/backups/app/cut-off && echo '{"na' > ${HOME}/backups/app/cut-off/metadata.json.partial`]);

        const names: string[] = (await transport.resolveBackups([]))
            .map(document => JsonUtilities.parse<{ name: string }>(document).name);

        expect(names).toContain('finished');
        expect(names).not.toContain('unfinished');
        expect(names).not.toContain('cut-off');
        expect(await transport.resolveBackups(['finished', 'round-trip', 'with-key'])).toEqual([]);
    });

    it('deletes the data of a resource', async () => {
        const [backup, resource] = resolveBackup('deleted', 3);
        await transport.storeData(Readable.from([Buffer.from('abc')]), backup, resource);

        await transport.deleteData(backup, resource);

        await expect(transport.retrieveData(backup, resource)).rejects.toThrow('holds no data');
    });
});