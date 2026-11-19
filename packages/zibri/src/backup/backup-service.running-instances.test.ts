import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { InMemoryDataSource } from 'zibri-testing';

import { testFileFolder, TestTimeouts } from '../__testing__/constants';
import { MemberRoles } from '../__testing__/mocks/entities/member-roles.enum';
import { TestPermissions } from '../__testing__/mocks/entities/test-permissions.model';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { DefaultTestServerRoleRepository } from '../__testing__/test-server/role-repository';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { Permission } from '../auth/roles/permission.type';
import { WriteThroughReadThroughCache } from '../caching/cache/read-through/write-through-read-through.cache';
import { CacheInvalidation } from '../caching/cache-invalidation.model';
import { CacheRestoreTagUtilities } from '../caching/cache-restore-tag.utilities';
import { type CacheServiceInterface } from '../caching/cache-service.interface';
import { Cache } from '../caching/decorators/cache.decorator';
import { InMemoryCacheStore } from '../caching/store/in-memory.cache-store';
import { DataSource } from '../data-source/decorators/data-source.decorator';
import { Repository } from '../data-source/repository/repository';
import { RepositoryClass } from '../data-source/repository/repository-class.type';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { Inject } from '../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { BaseEntity } from '../entity/base-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { EventSubscriberRegistration } from '../event/event-subscriber-registration.model';
import { Event, EventStatus } from '../event/event.model';
import { type LoggerInterface } from '../logging/logger.interface';
import { type MetricsServiceInterface } from '../metrics/metrics-service.interface';
import { Newable } from '../types/newable.type';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';
import { Ms } from '../utilities/ms';
import { UUIDUtilities } from '../utilities/uuid.utilities';
import { BackupEntity } from './backup-entity.model';
import { BackupResourceEntity } from './backup-resource-entity.model';
import { BackupServiceInterface } from './backup-service.interface';
import { Backup } from './decorators/backup-resource.decorator';
import { BackupTransport } from './decorators/backup-transport.decorator';
import { FsBackupTransport } from './transports/fs.backup-transport';

/**
 * What the instances running keep across a restore of the application: what the caches hold and the
 * roles a check reads, which the restore makes stale on this instance and on every other one, and the
 * subscribers they host, which the restore leaves as they are.
 */

declare module '../event/event-service.interface' {
    /**
     * What this suite emits.
     */
    interface ZibriEventMap {
        'restore.subscribed-since': { n: number }
    }
}

const backupFolder: FsPath = FsUtilities.getPath(testFileFolder, `backups-running-instances-${UUIDUtilities.generate()}`);

/**
 * The tag the setting is cached under, and invalidated by once it is written.
 */
const SETTING_TAG: 'restored-setting' = 'restored-setting';

@Entity({ tenant: 'shared', allowOrphan: true })
class RestoredSetting extends BaseEntity {
    @Property.string()
    value!: string;
}

@Cache()
class RestoredSettingCache extends WriteThroughReadThroughCache<string, string, 'RestoredSettingCache', typeof SETTING_TAG> {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        protected readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.CACHE_SERVICE)
        protected readonly cacheService: CacheServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE)
        protected readonly metricsService: MetricsServiceInterface
    ) {
        super('RestoredSettingCache', new InMemoryCacheStore(), [SETTING_TAG]);
    }
}

@BackupTransport()
class CachesFsBackupTransport extends FsBackupTransport {
    constructor() {
        super('caches-fs-backup-transport', backupFolder);
    }
}

@DataSource()
@Backup({ transports: [CachesFsBackupTransport], encrypt: false })
class CachesDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, RestoredSetting, BackupEntity, BackupResourceEntity];
    override readonly repositories: RepositoryClass[] = defaultTestServerRepositories;
}

function getBackupService(): BackupServiceInterface {
    return inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);
}

function getSettings(): Repository<RestoredSetting> {
    return inject(repositoryTokenFor(RestoredSetting));
}

async function takeBackup(): Promise<BackupEntity> {
    return await getBackupService().waitForBackup(await getBackupService().queueBackup({ name: `caches-${UUIDUtilities.generate()}` }));
}

/**
 * How often the setting was read from the data source, rather than from the cache.
 */
let loads: number = 0;

/**
 * Reads the setting through the cache, in the active tenant if any.
 * @returns The value.
 */
async function readSetting(): Promise<string> {
    return await inject(RestoredSettingCache).wrap(
        async () => {
            loads++;
            const [setting] = await getSettings().findAll({});
            return setting?.value ?? 'none';
        },
        () => 'setting',
        { tags: () => [SETTING_TAG] }
    )();
}

/**
 * Writes the setting, and invalidates what is cached of it, as a write path of an application does.
 * @param value - What it is set to.
 */
async function writeSetting(value: string): Promise<void> {
    await getSettings().deleteAll({});
    await getSettings().create({ value });
    await inject(ZIBRI_DI_TOKENS.CACHE_SERVICE).invalidateTags([SETTING_TAG]);
}

async function asTenant<T>(tenantId: string, work: () => Promise<T>): Promise<T> {
    return await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(tenantId, work);
}

let server: StartedTestServer | undefined;

beforeAll(async () => {
    await FsUtilities.rm(backupFolder);
    server = await startTestServer({ dataSources: [CachesDataSource] });
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
    await FsUtilities.rm(backupFolder);
}, TestTimeouts.inMemory.shutdown);

describe('BackupService - the caches across a restore of the application', () => {
    beforeEach(async () => {
        await writeSetting('backed up');
    });

    it('reads again what every cache held, in every tenant and outside them, once the application is restored', async () => {
        const tenantId: string = UUIDUtilities.generate();
        const backup: BackupEntity = await takeBackup();
        await writeSetting('written after the backup');
        expect([await readSetting(), await asTenant(tenantId, readSetting)]).toEqual(['written after the backup', 'written after the backup']);

        await getBackupService().restore(backup);

        expect([await readSetting(), await asTenant(tenantId, readSetting)]).toEqual(['backed up', 'backed up']);
    }, 30000);

    it('tells every other instance to empty its caches once the application is restored', async () => {
        const backup: BackupEntity = await takeBackup();

        await getBackupService().restore(backup);

        // what another instance applies, which holds what this one held
        const published: CacheInvalidation[] = await inject(repositoryTokenFor(CacheInvalidation)).findAll({});
        expect(published.map(p => p.tags)).toContainEqual([CacheRestoreTagUtilities.APPLICATION_TAG]);
    }, 30000);

    it('empties every cache once another instance restored the application', async () => {
        const before: number = loads;
        await readSetting();
        await readSetting();
        expect(loads).toBe(before + 1);

        // what the instance restoring publishes once it is done
        await inject(repositoryTokenFor(CacheInvalidation)).create({ tags: [CacheRestoreTagUtilities.APPLICATION_TAG] });
        await inject(ZIBRI_DI_TOKENS.CACHE_SERVICE).applyPendingInvalidations();

        await readSetting();
        expect(loads).toBe(before + 2);
    }, 30000);

    it('checks the roles every tenant shares as the restore wrote them', async () => {
        const tenantId: string = UUIDUtilities.generate();
        const roles: DefaultTestServerRoleRepository = inject(DefaultTestServerRoleRepository);
        const backup: BackupEntity = await takeBackup();
        const [member] = await roles.findAll({ where: { name: MemberRoles.USER, tenantId: null }, acrossTenants: true });
        await roles.updateById(member?.id ?? '', { permissions: [TestPermissions.MEMBER_USER, TestPermissions.MEMBER_ADMIN] });
        const granted: Permission[] = await inject(ZIBRI_DI_TOKENS.ROLE_SERVICE).resolvePermissionsOf([MemberRoles.USER], tenantId);
        expect(granted.sort()).toEqual([TestPermissions.MEMBER_ADMIN, TestPermissions.MEMBER_USER].sort());

        await getBackupService().restore(backup);

        expect(await inject(ZIBRI_DI_TOKENS.ROLE_SERVICE).resolvePermissionsOf([MemberRoles.USER], tenantId)).toEqual([TestPermissions.MEMBER_USER]);
    }, 30000);
});

describe('BackupService - the subscribers of events across a restore of the application', () => {
    // one hosted here runs what this instance emits whatever the event owes, so the subscriber is one of
    // another instance, which runs only what the event owes it
    it('owes an event emitted right after the restore to a subscriber another instance hosts since the backup', async () => {
        const backup: BackupEntity = await takeBackup();
        // what the instance hosting it keeps on record
        await inject(repositoryTokenFor(EventSubscriberRegistration)).create({
            subscriberId: 'hosted-elsewhere',
            eventType: 'restore.subscribed-since',
            runsOn: 'oneInstance',
            expiresAt: new Date(Date.now() + Ms.MINUTE)
        });

        await getBackupService().restore(backup);
        await inject(ZIBRI_DI_TOKENS.EVENT_SERVICE).emit('restore.subscribed-since', { n: 1 });

        const [event] = await inject(repositoryTokenFor(Event)).findAll({ where: { type: 'restore.subscribed-since' } });
        expect(event?.subscriberIds).toEqual(['hosted-elsewhere']);
        expect(event?.status).toBe(EventStatus.CREATED);
    }, 30000);
});