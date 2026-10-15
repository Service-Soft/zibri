import assert from 'node:assert';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';

import { S3BackupTransportOptions } from './s3/s3-backup-transport-options.model';
import { S3SignatureUtilities } from './s3/s3-signature.utilities';
import { BaseS3BackupTransport } from './s3.backup-transport';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
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
import { JsonUtilities } from '../../utilities/json.utilities';
import { BackupEntity } from '../backup-entity.model';
import { BackupResourceEntity } from '../backup-resource-entity.model';
import { BackupService } from '../backup.service';
import { Backup } from '../decorators/backup-resource.decorator';
import { BackupTransport } from '../decorators/backup-transport.decorator';

/**
 * The S3 compatible service the transport is tested against: the Versity S3 gateway, storing into its own
 * file system. It checks every signature, so a request signed wrongly fails here as it would anywhere.
 *
 * Pinned rather than `latest`, so a suite that passes today passes tomorrow for the same reason.
 */
const S3_TEST_IMAGE: string = 'versity/versitygw:v1.8.0';
const S3_PORT: number = 7070;
const BUCKET: string = 'backups';
const REGION: string = 'us-east-1';
const ACCESS_KEY_ID: string = 'zibri-test';
const SECRET_ACCESS_KEY: string = 'zibri-test-secret';
const MIB: number = 1024 * 1024;

// only known once the container runs, which is after the transport below is declared
let endpoint: string = '';

@BackupTransport()
class TestS3BackupTransport extends BaseS3BackupTransport {
    override readonly name: string = 's3-backup-transport';
    protected override get options(): S3BackupTransportOptions {
        return {
            endpoint,
            bucket: BUCKET,
            region: REGION,
            accessKeyId: ACCESS_KEY_ID,
            secretAccessKey: SECRET_ACCESS_KEY,
            prefix: 'app',
            // a container is reached as localhost, where no bucket can be put into the host name
            addressingStyle: 'path',
            // the smallest the protocol allows, so that a few megabytes are already several parts
            partSize: '5mb'
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
@Backup({ transports: [TestS3BackupTransport], encrypt: false })
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
 * Sends a signed request to the service directly, for what the transport itself never does.
 * @param method - The http method.
 * @param path - The path and query, starting with the bucket.
 * @returns The response.
 */
async function sendSigned(method: string, path: string): Promise<Response> {
    const url: URL = new URL(`${endpoint}${path}`);
    const headers: Record<string, string> = S3SignatureUtilities.resolveHeaders({
        method,
        url,
        headers: {},
        payloadHash: S3SignatureUtilities.hash(''),
        accessKeyId: ACCESS_KEY_ID,
        secretAccessKey: SECRET_ACCESS_KEY,
        region: REGION,
        date: new Date()
    });
    return await fetch(url, { method, headers });
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

describe('BaseS3BackupTransport', () => {
    let s3: StartedTestContainer;
    let server: StartedTestServer;
    let transport: TestS3BackupTransport;

    beforeAll(async () => {
        // arguments go to the gateway as they are. /tmp/vgw is a directory the image creates
        s3 = await new GenericContainer(S3_TEST_IMAGE)
            .withCommand([
                '--access',
                ACCESS_KEY_ID,
                '--secret',
                SECRET_ACCESS_KEY,
                '--region',
                REGION,
                '--port',
                `:${S3_PORT}`,
                '--health',
                '/health',
                'posix',
                '/tmp/vgw'
            ])
            .withExposedPorts(S3_PORT)
            .withWaitStrategy(Wait.forHttp('/health', S3_PORT))
            .start();
        endpoint = `http://${s3.getHost()}:${s3.getMappedPort(S3_PORT)}`;
        expect((await sendSigned('PUT', `/${BUCKET}`)).ok).toBe(true);

        server = await startTestServer({ dataSources: [DbDataSource] });
        transport = inject(TestS3BackupTransport);
    }, 60000);

    afterAll(async () => {
        await server.shutdown();
        await s3.stop();
    }, 30000);

    it('is refused by the service when signed with the wrong secret', async () => {
        const url: URL = new URL(`${endpoint}/${BUCKET}?list-type=2`);
        const headers: Record<string, string> = S3SignatureUtilities.resolveHeaders({
            method: 'GET',
            url,
            headers: {},
            payloadHash: S3SignatureUtilities.hash(''),
            accessKeyId: ACCESS_KEY_ID,
            secretAccessKey: 'not-the-secret',
            region: REGION,
            date: new Date()
        });

        const res: Response = await fetch(url, { headers });

        // without this, every other case here could pass against a service that checks nothing
        expect(res.status).toBe(403);
        expect(await res.text()).toContain('SignatureDoesNotMatch');
    });

    it('creates and restores a backup through the bucket', async () => {
        const itemRepository: Repository<Item> = inject(repositoryTokenFor(Item));
        const backupRepository: Repository<BackupEntity> = inject(repositoryTokenFor(BackupEntity));
        const backupService: BackupService = inject(BackupService);
        await itemRepository.create({ value: '42' });

        await backupService.createBackup({ name: 'round-trip' });
        await itemRepository.deleteAll({});
        await backupRepository.deleteAll({});
        await backupService.syncBackupEntities();
        const [backup]: BackupEntity[] = await backupRepository.findAll({ where: { name: 'round-trip' }, relations: ['resources'] });
        assert(backup, 'the backup was not found in the bucket');
        await backupService.restore(backup);

        expect(await itemRepository.findAll()).toEqual([expect.objectContaining({ value: '42' })]);
    }, 30000);

    it('deletes a backup from the bucket, so that syncing does not bring it back', async () => {
        const backupRepository: Repository<BackupEntity> = inject(repositoryTokenFor(BackupEntity));
        const backupService: BackupService = inject(BackupService);
        await backupService.createBackup({ name: 'deleted-for-good' });
        const [backup]: BackupEntity[] = await backupRepository.findAll({ where: { name: 'deleted-for-good' }, relations: ['resources'] });
        assert(backup, 'the backup was not created');

        await backupService.delete(backup);
        await backupService.syncBackupEntities();

        expect(await backupRepository.findAll({ where: { name: 'deleted-for-good' } })).toEqual([]);
        const prefix: string = S3SignatureUtilities.encode('app/deleted-for-good/');
        const listing: string = await (await sendSigned('GET', `/${BUCKET}?list-type=2&prefix=${prefix}`)).text();
        expect(listing).not.toContain('<Key>');
    }, 30000);

    it('uploads data larger than a part in parts, and reads it back unchanged', async () => {
        const chunks: Buffer[] = resolveRandomChunks(12 * MIB);
        const [backup, resource] = resolveBackup('multipart', 12 * MIB);

        await transport.storeData(Readable.from(chunks), backup, resource);
        const read: Buffer = await buffer(await transport.retrieveData(backup, resource));

        expect(S3SignatureUtilities.hash(read)).toBe(S3SignatureUtilities.hash(Buffer.concat(chunks)));
    }, 30000);

    it('refuses an object larger than the size recorded for it', async () => {
        const [backup, resource] = resolveBackup('grown', 1024);
        await transport.storeData(Readable.from(resolveRandomChunks(2048)), backup, resource);

        await expect(transport.retrieveData(backup, resource)).rejects.toThrow();
    });

    it('aborts the multipart upload when the data fails half way', async () => {
        const [backup, resource] = resolveBackup('failing', 6 * MIB);
        const failing: Readable = Readable.from((function* failAfterOnePart(): Generator<Buffer> {
            yield* resolveRandomChunks(6 * MIB);
            throw new Error('the dump failed');
        })());

        await expect(transport.storeData(failing, backup, resource)).rejects.toThrow('the dump failed');

        const uploads: string = await (await sendSigned('GET', `/${BUCKET}?uploads`)).text();
        expect(uploads).not.toContain('<Upload>');
        await expect(transport.retrieveData(backup, resource)).rejects.toThrow();
    }, 30000);

    it('resolves the record of every finished backup, and none of an unfinished one', async () => {
        const [finished] = resolveBackup('finished', 0);
        const [unfinished, resource] = resolveBackup('unfinished', 3);
        await transport.storeMetadata(finished, JsonUtilities.stringify({ name: 'finished' }));
        await transport.storeData(Readable.from([Buffer.from('abc')]), unfinished, resource);

        const names: string[] = (await transport.resolveBackups([]))
            .map(document => JsonUtilities.parse<{ name: string }>(document).name);

        expect(names).toContain('finished');
        expect(names).not.toContain('unfinished');
        expect(await transport.resolveBackups(['finished', 'round-trip'])).toEqual([]);
    });

    it('deletes the data of a resource', async () => {
        const [backup, resource] = resolveBackup('deleted', 3);
        await transport.storeData(Readable.from([Buffer.from('abc')]), backup, resource);

        await transport.deleteData(backup, resource);

        await expect(transport.retrieveData(backup, resource)).rejects.toThrow();
    });
});