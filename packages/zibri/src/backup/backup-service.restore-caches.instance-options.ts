import { ClusterMark, clusterInstanceId, defaultClusterProviders, StartTestServerOptions } from 'zibri-testing';

import { testFileFolder } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { testServerPasswordPolicyProvider } from '../__testing__/test-server/providers';
import { WriteThroughReadThroughCache } from '../caching/cache/read-through/write-through-read-through.cache';
import { type CacheServiceInterface } from '../caching/cache-service.interface';
import { Cache } from '../caching/decorators/cache.decorator';
import { InMemoryCacheStore } from '../caching/store/in-memory.cache-store';
import { PostgresBackupScope } from '../data-source/data-sources/postgres/postgres-backup-scope.model';
import { PostgresDataSource, PostgresOptions } from '../data-source/data-sources/postgres/postgres-data-source.model';
import { PostgresPooler } from '../data-source/data-sources/postgres/postgres-pooler.model';
import { DataSource } from '../data-source/decorators/data-source.decorator';
import { SchemaManagement } from '../data-source/models/schema-management.model';
import { Repository } from '../data-source/repository/repository';
import { RepositoryClass } from '../data-source/repository/repository-class.type';
import { InjectRepository } from '../di/decorators/inject-repository.decorator';
import { Inject } from '../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { BaseEntity } from '../entity/base-entity.model';
import { type LoggerInterface } from '../logging/logger.interface';
import { type MetricsServiceInterface } from '../metrics/metrics-service.interface';
import { Response } from '../open-api/decorators/response.decorator';
import { Controller } from '../routing/decorators/controller.decorator';
import { Get } from '../routing/decorators/get.decorator';
import { Post } from '../routing/decorators/post.decorator';
import { Newable } from '../types/newable.type';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';
import { UUIDUtilities } from '../utilities/uuid.utilities';
import { BackupEntity } from './backup-entity.model';
import { BackupResourceEntity } from './backup-resource-entity.model';
import { BackupServiceInterface } from './backup-service.interface';
import { Backup } from './decorators/backup-resource.decorator';
import { BackupTransport } from './decorators/backup-transport.decorator';
import { FsBackupTransport } from './transports/fs.backup-transport';

/**
 * What every instance of the cluster restoring the application boots with.
 *
 * An in-memory cache on each instance, in front of rows a restore replaces: a restore on one instance has
 * to empty the caches of every other, which hold what the restore replaced. Like every instance options
 * module this is imported by the parent as well, so nothing at the top level may assume it is running
 * inside an instance.
 */

/**
 * Where the backups of the cluster are kept, which every instance writes to and reads from.
 *
 * Fixed rather than generated: every instance loads this module for itself, so a generated one would give
 * each of them a folder of its own.
 */
export const restoreCachesBackupFolder: FsPath = FsUtilities.getPath(testFileFolder, 'cluster-restore-caches');

/**
 * The kind of mark the value counts.
 */
const originKind: string = 'restore-caches-origin';

@BackupTransport()
class RestoreCachesTransport extends FsBackupTransport {
    constructor() {
        super('restore-caches-transport', restoreCachesBackupFolder);
    }
}

@DataSource()
@Backup({ transports: [RestoreCachesTransport], encrypt: false })
class RestoreCachesDataSource extends PostgresDataSource {
    override backupScope: PostgresBackupScope = 'schema';
    override options: PostgresOptions = {
        host: 'localhost',
        username: 'postgres',
        password: 'password',
        database: 'db',
        // the container serves no tls
        ssl: false
    };
    // this repository's own fixtures, the mark table and the records of the backups
    entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, ClusterMark, BackupEntity, BackupResourceEntity];
    readonly repositories: RepositoryClass[] = defaultTestServerRepositories;
    schemaManagement: SchemaManagement = 'synchronize';
    readonly pooler: PostgresPooler = 'none';
}

/**
 * In this instance's memory, and reachable by nothing else. It declares no tags: those of a restore reach
 * every cache.
 */
@Cache()
class RestoreCachesLocalCache extends WriteThroughReadThroughCache<string, number, 'RestoreCachesLocalCache'> {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        protected readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.CACHE_SERVICE)
        protected readonly cacheService: CacheServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE)
        protected readonly metricsService: MetricsServiceInterface
    ) {
        super('RestoreCachesLocalCache', new InMemoryCacheStore(), []);
    }
}

/**
 * The backup the instance took last, which it restores.
 */
let taken: BackupEntity | undefined;

/**
 * Reads a value through this instance's cache, moves it, backs the application up and restores it.
 */
@Controller('/restore-caches')
class RestoreCachesController {
    constructor(
        @InjectRepository(ClusterMark)
        private readonly markRepository: Repository<ClusterMark>
    ) {}

    /**
     * Reads the value through this instance's cache.
     * @returns How many origin marks exist, as this instance currently believes.
     */
    @Get('/value')
    async value(): Promise<number> {
        return await inject(RestoreCachesLocalCache).wrap(
            async () => (await this.markRepository.findAll({ where: { kind: originKind } })).length,
            () => 'counter'
        )();
    }

    /**
     * Moves the value by writing one more origin mark.
     */
    @Response.empty()
    @Post('/bump')
    async bump(): Promise<void> {
        await this.markRepository.create({ instanceId: clusterInstanceId(), kind: originKind, tag: originKind, at: new Date() });
    }

    /**
     * Backs the application up, and keeps the backup to restore.
     */
    @Response.empty()
    @Post('/backup')
    async backup(): Promise<void> {
        const backupService: BackupServiceInterface = inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);
        taken = await backupService.waitForBackup(await backupService.queueBackup({ name: `restore-caches-${UUIDUtilities.generate()}` }));
    }

    /**
     * Restores the backup this instance took last.
     */
    @Response.empty()
    @Post('/restore')
    async restore(): Promise<void> {
        if (taken == undefined) {
            throw new Error('this instance took no backup');
        }
        await inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE).restore(taken);
    }
}

const options: StartTestServerOptions = {
    controllers: [RestoreCachesController],
    dataSources: [RestoreCachesDataSource],
    providers: [...defaultClusterProviders, testServerPasswordPolicyProvider]
};

export default options;