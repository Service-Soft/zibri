import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { InMemoryDataSource } from 'zibri-testing';

import { S3StandIn } from '../__testing__/backup/s3-stand-in.model';
import { testFileFolder, TestTimeouts } from '../__testing__/constants';
import { runWithApplicationClockAhead } from '../__testing__/run-with-application-clock-ahead.function';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { DataSource } from '../data-source/decorators/data-source.decorator';
import { RepositoryClass } from '../data-source/repository/repository-class.type';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { defineProvider } from '../di/models/di-provider.model';
import { BaseEntity } from '../entity/base-entity.model';
import { BadRequestError } from '../error-handling/errors/bad-request.error';
import { ConflictError } from '../error-handling/errors/conflict.error';
import { Newable } from '../types/newable.type';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';
import { Ms } from '../utilities/ms';
import { UUIDUtilities } from '../utilities/uuid.utilities';
import { FileStore } from './decorators/file-store.decorator';
import { FileRecord } from './file-record.model';
import { FileServiceInterface } from './file-service.interface';
import { FsFileStore } from './stores/fs.file-store';
import { S3FileStore } from './stores/s3.file-store';
import { S3TenantFileStoreKind } from './tenant/s3.tenant-file-store-kind';
import { TenantFileStore } from './tenant/tenant-file-store.model';

/**
 * The files of a tenant kept in a bucket the tenant configured, here the stand-in, which the options let a tenant
 * reach inside the network the application runs in.
 */

const applicationFolder: FsPath = FsUtilities.getPath(testFileFolder, `file-service-tenant-store-${UUIDUtilities.generate()}`);
const standIn: S3StandIn = new S3StandIn(FsUtilities.getPath(testFileFolder, `file-service-tenant-bucket-${UUIDUtilities.generate()}`));
const BUCKET: string = 'tenant-files';

@FileStore()
class DocumentFileStore extends FsFileStore {
    constructor() {
        super('documents', applicationFolder);
    }
}

@DataSource()
class TenantStoreDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, FileRecord, TenantFileStore];
    override readonly repositories: RepositoryClass[] = defaultTestServerRepositories;
}

let server: StartedTestServer | undefined;

beforeAll(async () => {
    await standIn.start();
    server = await startTestServer({
        dataSources: [TenantStoreDataSource],
        fileStores: [DocumentFileStore],
        providers: [
            ...defaultTestServerProviders,
            defineProvider({
                token: ZIBRI_DI_TOKENS.FILE_TENANT_STORE_OPTIONS,
                useValue: { kinds: [new S3TenantFileStoreKind()], allowedHosts: undefined, allowPrivateNetworks: true }
            })
        ]
    });
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
    await standIn.stop();
    await FsUtilities.rm(applicationFolder);
}, TestTimeouts.inMemory.shutdown);

function getFileService(): FileServiceInterface {
    return inject(ZIBRI_DI_TOKENS.FILE_SERVICE);
}

async function asTenant<T>(tenantId: string, work: () => Promise<T>): Promise<T> {
    return await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(tenantId, work);
}

/**
 * The keys a store holds of a tenant.
 * @param store - The store.
 * @param tenantId - The tenant.
 * @returns The keys, sorted.
 */
async function findStoredKeys(store: FsFileStore | S3FileStore, tenantId: string): Promise<string[]> {
    const keys: string[] = [];
    for await (const page of store.findKeys(`${tenantId}/`)) {
        keys.push(...page);
    }
    return keys.sort();
}

/**
 * The tenant's bucket, as the application reaches it.
 * @returns The store.
 */
function resolveTenantBucket(): S3FileStore {
    return new S3FileStore('tenant-bucket', {
        endpoint: standIn.getEndpoint(),
        bucket: BUCKET,
        region: 'us-east-1',
        credentials: { accessKeyId: 'tenant-key', secretAccessKey: 'tenant-secret' },
        serverSideEncryption: 'bucket-default',
        addressingStyle: 'path'
    });
}

async function addTenantBucket(tenantId: string): Promise<TenantFileStore> {
    return await getFileService().createTenantFileStore(tenantId, {
        name: 'documents',
        kind: 's3',
        settings: { endpoint: standIn.getEndpoint(), bucket: BUCKET, region: 'us-east-1', accessKeyId: 'tenant-key', addressingStyle: 'path' },
        secret: { secretAccessKey: 'tenant-secret' }
    });
}

describe('FileService, with the file stores of tenants', () => {
    it('keeps the files of a tenant with a store of its own there alone, and those of another tenant in the application\'s', async () => {
        const withBucket: string = UUIDUtilities.generate();
        const without: string = UUIDUtilities.generate();
        const bucket: TenantFileStore = await addTenantBucket(withBucket);

        const own: FileRecord = await asTenant(withBucket, async () => await getFileService().store({
            store: 'documents',
            name: 'receipt.pdf',
            mimeType: 'application/pdf',
            data: Buffer.from('kept in the tenant\'s bucket')
        }));
        const application: FileRecord = await asTenant(without, async () => await getFileService().store({
            store: 'documents',
            name: 'receipt.pdf',
            mimeType: 'application/pdf',
            data: Buffer.from('kept in the application\'s folder')
        }));

        expect(own.storeName).toBe(`tenant-file-store:${bucket.id}`);
        expect(application.storeName).toBe('documents');
        expect(await findStoredKeys(resolveTenantBucket(), withBucket)).toEqual([own.key]);
        expect(await findStoredKeys(inject(DocumentFileStore), withBucket)).toEqual([]);
        expect(await findStoredKeys(inject(DocumentFileStore), without)).toEqual([application.key]);
        expect((await asTenant(withBucket, async () => await getFileService().read(own.id))).toString()).toBe('kept in the tenant\'s bucket');
        expect((await asTenant(without, async () => await getFileService().read(application.id))).toString())
            .toBe('kept in the application\'s folder');
    });

    it('keeps the store of a tenant while files are kept in it, and cleans up what no row references in it', async () => {
        const tenant: string = UUIDUtilities.generate();
        const bucket: TenantFileStore = await addTenantBucket(tenant);
        const stored: FileRecord = await asTenant(tenant, async () => await getFileService().store({
            store: 'documents',
            name: 'statement.xml',
            mimeType: 'application/xml',
            data: Buffer.from('<statement/>')
        }));

        await expect(getFileService().deleteTenantFileStore(tenant, bucket.id)).rejects.toBeInstanceOf(ConflictError);
        await asTenant(tenant, async () => await getFileService().delete(stored.id));
        await runWithApplicationClockAhead(2 * Ms.DAY, async () => await getFileService().deleteUnreferencedFiles());
        expect(await findStoredKeys(resolveTenantBucket(), tenant)).toEqual([]);

        await getFileService().deleteTenantFileStore(tenant, bucket.id);
        expect(await getFileService().findTenantFileStores(tenant)).toEqual([]);
    });

    it('refuses a store of a kind the application does not list, and keeps none of it', async () => {
        const tenant: string = UUIDUtilities.generate();

        await expect(getFileService().createTenantFileStore(tenant, {
            name: 'documents',
            kind: 'webdav',
            settings: {},
            secret: {}
        })).rejects.toBeInstanceOf(BadRequestError);
        expect(await getFileService().findTenantFileStores(tenant)).toEqual([]);
    });

    it('refuses a store that cannot be written to, at once, and keeps none of it', async () => {
        const tenant: string = UUIDUtilities.generate();

        await expect(getFileService().createTenantFileStore(tenant, {
            name: 'documents',
            kind: 's3',
            // a port nothing listens on
            settings: { endpoint: 'http://127.0.0.1:1', bucket: BUCKET, region: 'us-east-1', accessKeyId: 'tenant-key', addressingStyle: 'path' },
            secret: { secretAccessKey: 'tenant-secret' }
        })).rejects.toThrow('could not be written to');
        expect(await getFileService().findTenantFileStores(tenant)).toEqual([]);
    }, 60000);
});