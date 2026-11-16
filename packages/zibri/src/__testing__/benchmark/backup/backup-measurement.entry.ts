// The process one backup measurement runs in, forked by the backup benchmarks. A process of its own,
// so that the most memory it held belongs to this measurement alone. It reads what to measure from
// BACKUP_MEASUREMENT_CONFIG_ENV, sends one BackupMeasurementResult to its parent, and exits.
import { createHash, Hash } from 'node:crypto';
import { pipeline, Readable, Transform } from 'node:stream';

import { createInMemoryDataSource } from 'zibri-testing';

import { BackupMeasurement,
    BackupMeasurementConfig,
    BackupMeasurementResult,
    BackupRunMeasurement,
    GarbageCollectionMeasurement,
    HarnessMeasurement,
    LiveMeasurement,
    LivePhaseMeasurement,
    MeasuredResourceConfig,
    PhaseMeasurement,
    ValKeyServerMeasurement } from './backup-measurement.model';
import { MeasuredRowStore } from './measured-row-store.model';
import { MeasuredRow } from './measured-row.model';
import { MeasuredBackupTransport } from './measured.backup-transport';
import { MIN_LIVE_INTERVAL_IN_MS, PhaseSampler } from './phase-sampler.model';
import { resolveBackupMeasurementConfig } from './resolve-backup-measurement-config.function';
import { SeededChanges, SeededFingerprint, SeededTable } from './seeded-table.model';
import { ValKeyServerProbe } from './val-key-server-probe.model';
import { KeysInUse } from '../../../auth/encryption/keys-in-use.model';
import { BackupChunkEntity } from '../../../backup/backup-chunk-entity.model';
import { BackupDataOptions } from '../../../backup/backup-data-options.model';
import { BackupEntity, BackupEntityCreateData } from '../../../backup/backup-entity.model';
import { BACKUP_FORMAT_VERSION } from '../../../backup/backup-format';
import { BackupResourceEntity } from '../../../backup/backup-resource-entity.model';
import { BackupResourceInterface } from '../../../backup/backup-resource.interface';
import { BackupServiceInterface } from '../../../backup/backup-service.interface';
import { BackupStatus } from '../../../backup/backup-status.enum';
import { Backup } from '../../../backup/decorators/backup-resource.decorator';
import { IncrementalBackupData } from '../../../backup/incremental-backup-data.model';
import { DataSourceInterface } from '../../../data-source/data-sources/data-source.interface';
import { PostgresBackupScope } from '../../../data-source/data-sources/postgres/postgres-backup-scope.model';
import { PostgresDataSource, PostgresOptions } from '../../../data-source/data-sources/postgres/postgres-data-source.model';
import { PostgresPooler } from '../../../data-source/data-sources/postgres/postgres-pooler.model';
import { ValKeyBackupMode } from '../../../data-source/data-sources/val-key/val-key-backup-mode.model';
import { ValKeyDataSource, ValKeyOptions } from '../../../data-source/data-sources/val-key/val-key-data-source.model';
import { ValKeyRestoreMode } from '../../../data-source/data-sources/val-key/val-key-restore-mode.model';
import { DataSource } from '../../../data-source/decorators/data-source.decorator';
import { MigrationEntity } from '../../../data-source/migration/migration-entity.model';
import { SchemaManagement } from '../../../data-source/models/schema-management.model';
import { Repository } from '../../../data-source/repository/repository';
import { RepositoryClass } from '../../../data-source/repository/repository-class.type';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { defineProvider } from '../../../di/models/di-provider.model';
import { BaseEntity } from '../../../entity/base-entity.model';
import { Newable } from '../../../types/newable.type';
import { FsPath, FsUtilities } from '../../../utilities/fs.utilities';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../test-server/providers';
import { StartedTestServer, startTestServer } from '../../test-server/start-test-server.function';

/**
 * What a resource produced in its last backup, and what its last restore was handed.
 */
type ResourceBytes = {
    bytes: number,
    sha256: string
};

/**
 * One resource of the measurement, whatever holds its table.
 */
type MeasuredResource = {
    /**
     * The name it is backed up under.
     */
    name: string,
    /**
     * The table it holds.
     */
    table: SeededTable,
    /**
     * The data source holding the table, or undefined when the resource is the table itself.
     */
    dataSourceClass: Newable<DataSourceInterface> | undefined,
    /**
     * Reads its data the way a backup does, without one.
     */
    readAlone: () => Readable | Promise<Readable>
};

/**
 * About how many times a live phase is read: its interval is how long its timed phase took, divided by
 * this. A fixed interval read a phase shorter than it not once.
 */
const LIVE_READINGS_PER_PHASE: number = 10;

/**
 * The longest interval of a live phase: what a phase of seconds is read at, whose collections then
 * make it half as slow again.
 */
const MAX_LIVE_INTERVAL_IN_MS: number = 200;

const config: BackupMeasurementConfig = resolveBackupMeasurementConfig();

const produced: Map<string, ResourceBytes> = new Map();
const restored: Map<string, ResourceBytes> = new Map();

/**
 * How long the resources spent in each stage during the current phase, in milliseconds, added up
 * over every resource. Reading a resource during a restore is the snapshot of what it replaces.
 */
const stageTimes: { readMs: number, applyMs: number } = { readMs: 0, applyMs: 0 };

const harness: HarnessMeasurement = { loadMs: 0, bootMs: 0, fillMs: 0, changesMs: 0, fingerprintMs: 0, shutdownMs: 0 };

/**
 * Runs what the measurement does around the backups, adding how long it took to {@link harness}.
 * @param stage - What it is.
 * @param work - The work.
 * @returns What the work returned.
 */
async function timeHarness<T>(stage: keyof HarnessMeasurement, work: () => Promise<T>): Promise<T> {
    const startedAt: number = performance.now();
    try {
        return await work();
    }
    finally {
        harness[stage] += performance.now() - startedAt;
    }
}

/**
 * Counts and hashes what passes through, and hands the result over once the stream ended.
 *
 * A transform rather than a listener on the data: listening puts a stream into flowing mode, and what
 * flows before the backup pipes it on is lost.
 * @param done - Called with what passed through.
 * @returns The stream to pipe through.
 */
function measureBytes(done: (bytes: ResourceBytes) => void): Transform {
    const hash: Hash = createHash('sha256');
    let bytes: number = 0;
    // the callbacks are the signature Transform calls its methods with
    /* eslint-disable promise/prefer-await-to-callbacks */
    return new Transform({
        transform: (chunk: Buffer, _encoding, callback) => {
            bytes += chunk.length;
            hash.update(chunk);
            callback(undefined, chunk);
        },
        flush: callback => {
            done({ bytes, sha256: hash.digest('hex') });
            callback();
        }
    });
    /* eslint-enable promise/prefer-await-to-callbacks */
}

/**
 * Measures what a resource hands a backup: its bytes, and how long reading them took.
 * @param name - The resource.
 * @param data - What it hands over.
 * @returns The stream to hand over instead.
 */
function measureProduced(name: string, data: Readable): Readable {
    const startedAt: number = performance.now();
    // joined by a pipeline, so that a dump failing half way fails what the backup reads as well
    return pipeline(data, measureBytes(bytes => {
        produced.set(name, bytes);
        stageTimes.readMs += performance.now() - startedAt;
    }), () => undefined);
}

/**
 * Times a restore of a resource.
 * @param restore - What applies the restored data.
 */
async function measureApplied(restore: () => Promise<void>): Promise<void> {
    const startedAt: number = performance.now();
    await restore();
    stageTimes.applyMs += performance.now() - startedAt;
}

/**
 * A resource whose data is one {@link SeededTable}, read as the bytes of a dump.
 */
abstract class SeededBackupResource implements BackupResourceInterface {
    protected abstract readonly resource: MeasuredResource;

    createBackupData(): Readable {
        return measureProduced(this.resource.name, this.resource.table.read());
    }

    async restoreBackup(data: Readable): Promise<void> {
        await measureApplied(async () => {
            // read to the end here, so that what was restored is known once the restore returns
            const hash: Hash = createHash('sha256');
            let bytes: number = 0;
            for await (const chunk of data) {
                const buffer: Buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
                bytes += buffer.length;
                hash.update(buffer);
            }
            restored.set(this.resource.name, { bytes, sha256: hash.digest('hex') });
        });
    }

    validateBackupConfiguration(): void {
        // holds everything it needs
    }
}

/**
 * Creates the class of a resource, and registers it as a backup resource. Declared before the
 * application is built, since a backup resource is registered by its decorator.
 * @param index - Which resource of the config it is.
 * @param resourceConfig - What it is.
 * @returns The resource.
 */
function createResource(index: number, resourceConfig: MeasuredResourceConfig): MeasuredResource {
    const name: string = `${resourceConfig.kind}-resource-${index}`;
    const resource: MeasuredResource = {
        name,
        table: new SeededTable(config.seed + index, resourceConfig.bytes, config.changes.insertedShare * (config.backups + 1)),
        dataSourceClass: undefined,
        readAlone: () => resource.table.read()
    };
    const backup: ClassDecorator = Backup({ name, transports: [MeasuredBackupTransport], encrypt: config.encrypt });
    switch (resourceConfig.kind) {
        case 'seeded': {
            backup(class extends SeededBackupResource {
                protected readonly resource: MeasuredResource = resource;
            });
            return resource;
        }
        case 'postgres': {
            const { compressedDump, incrementalRead } = resourceConfig;
            const dataSourceClass: Newable<MeasuredPostgresDataSource> = class extends MeasuredPostgresDataSource {
                protected readonly resource: MeasuredResource = resource;
                protected readonly compressedDump: boolean = compressedDump;
                override readonly incrementalRead: boolean = incrementalRead;
            };
            DataSource()(dataSourceClass);
            backup(dataSourceClass);
            resource.dataSourceClass = dataSourceClass;
            resource.readAlone = async () => await inject(dataSourceClass).readAlone();
            return resource;
        }
        case 'val-key': {
            const { backupMode, restoreMode } = resourceConfig;
            const dataSourceClass: Newable<MeasuredValKeyDataSource> = class extends MeasuredValKeyDataSource {
                protected readonly resource: MeasuredResource = resource;
                override readonly backupMode: ValKeyBackupMode = backupMode;
                override readonly restoreMode: ValKeyRestoreMode = restoreMode;
            };
            DataSource()(dataSourceClass);
            backup(dataSourceClass);
            resource.dataSourceClass = dataSourceClass;
            resource.readAlone = () => inject(dataSourceClass).readAlone();
            return resource;
        }
    }
}

/**
 * A postgres data source holding the table of a resource, in a container the harness starts.
 */
abstract class MeasuredPostgresDataSource extends PostgresDataSource {
    protected abstract readonly resource: MeasuredResource;
    protected abstract readonly compressedDump: boolean;

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
    entities: Newable<BaseEntity>[] = [MigrationEntity, MeasuredRow];
    repositories: RepositoryClass[] = [];
    schemaManagement: SchemaManagement = 'synchronize';
    readonly pooler: PostgresPooler = 'none';

    override async createBackupData(backup?: BackupEntity, options?: BackupDataOptions): Promise<Readable> {
        return measureProduced(this.resource.name, await super.createBackupData(backup, this.resolveDumpOptions(options)));
    }

    override async createIncrementalBackupData(
        backup: BackupEntity,
        options: BackupDataOptions,
        since: string | undefined
    ): Promise<IncrementalBackupData> {
        const read: IncrementalBackupData = await super.createIncrementalBackupData(backup, this.resolveDumpOptions(options), since);
        return { ...read, data: measureProduced(this.resource.name, read.data) };
    }

    // a restore in full is one of a full read and no changes after it, so this times either
    override async restoreIncrementalBackup(full: Readable, increments: Readable[]): Promise<void> {
        await measureApplied(async () => await super.restoreIncrementalBackup(full, increments));
    }

    /**
     * The dump a backup reads, without the backup.
     * @returns The dump.
     */
    async readAlone(): Promise<Readable> {
        return await super.createBackupData(undefined, this.resolveDumpOptions(resolveAloneOptions()));
    }

    private resolveDumpOptions(options: BackupDataOptions | undefined): BackupDataOptions {
        return {
            chunked: options?.chunked === true && !this.compressedDump,
            stagingFolder: options?.stagingFolder ?? inject(ZIBRI_DI_TOKENS.BACKUP_TEMP_FOLDER)
        };
    }
}

/**
 * A valkey data source holding the table of a resource, in a container the harness starts.
 */
abstract class MeasuredValKeyDataSource extends ValKeyDataSource {
    protected abstract readonly resource: MeasuredResource;

    override options: ValKeyOptions = {
        host: 'localhost',
        // the container serves no tls
        useTLS: false,
        keyPrefix: 'measured'
    };
    entities: Newable<BaseEntity>[] = [MigrationEntity, MeasuredRow];
    override readonly repositories: RepositoryClass[] = [];

    override createBackupData(backup: BackupEntity | undefined, options: BackupDataOptions): Readable {
        return measureProduced(this.resource.name, super.createBackupData(backup, options));
    }

    override async restoreBackup(backupData: Readable): Promise<void> {
        await measureApplied(async () => await super.restoreBackup(backupData));
    }

    /**
     * The keys a backup reads, without the backup.
     * @returns The keys.
     */
    readAlone(): Readable {
        return super.createBackupData(undefined, resolveAloneOptions());
    }
}

/**
 * What reading a resource alone hands it: what a backup of the measured format hands it.
 * @returns The options.
 */
function resolveAloneOptions(): BackupDataOptions {
    return { chunked: config.formatVersion === BACKUP_FORMAT_VERSION, stagingFolder: inject(ZIBRI_DI_TOKENS.BACKUP_TEMP_FOLDER) };
}

const resources: MeasuredResource[] = config.resources.map((resourceConfig, index) => createResource(index, resourceConfig));

/**
 * The stores of the resources held in a data source, by the resource's name, built once the
 * application runs.
 */
const stores: Map<string, MeasuredRowStore> = new Map();

/**
 * The rows a resource's data source holds.
 * @param resource - The resource.
 * @returns Its store, or undefined when the resource is the table itself.
 */
function resolveStore(resource: MeasuredResource): MeasuredRowStore | undefined {
    if (resource.dataSourceClass == undefined) {
        return undefined;
    }
    const store: MeasuredRowStore = stores.get(resource.name)
        ?? new MeasuredRowStore(inject(resource.dataSourceClass).getRepository(MeasuredRow));
    stores.set(resource.name, store);
    return store;
}

/**
 * Changes every resource, and the data source holding it the same way.
 * @param round - Which change this is.
 */
async function applyChanges(round: number): Promise<void> {
    for (const resource of resources) {
        const changes: SeededChanges = resource.table.applyChanges(config.changes, round);
        await resolveStore(resource)?.applyChanges(changes);
    }
}

/**
 * Describes a fingerprint for a mismatch.
 * @param fingerprint - The fingerprint.
 * @returns The description.
 */
function describeFingerprint(fingerprint: SeededFingerprint | undefined): string {
    return fingerprint == undefined ? 'nothing' : `${fingerprint.rows} rows hashing to ${fingerprint.sha256.slice(0, 12)}`;
}

/**
 * Whether two fingerprints say the same.
 * @param a - One.
 * @param b - The other.
 * @returns True when both are there and equal.
 */
function isSameFingerprint(a: SeededFingerprint | undefined, b: SeededFingerprint | undefined): boolean {
    return a != undefined && a.rows === b?.rows && a.sha256 === b.sha256;
}

/**
 * What every resource holds at the last backup, and what tells its restore apart from it.
 */
type ResourceFingerprints = {
    /**
     * What the backup held: the table's rows, or for a table read as bytes, the bytes it produced.
     */
    backedUp: SeededFingerprint | undefined,
    /**
     * What its data source held at the backup, undefined for a table read as bytes.
     */
    stored: SeededFingerprint | undefined,
    /**
     * The id each row was stored under at the backup, which a restore brings back.
     */
    storedIds: Map<number, string> | undefined
};

/**
 * What a resource holds at the last backup.
 * @param resource - The resource.
 * @returns The fingerprints.
 */
async function resolveBackedUpFingerprints(resource: MeasuredResource): Promise<ResourceFingerprints> {
    const store: MeasuredRowStore | undefined = resolveStore(resource);
    if (store == undefined) {
        const bytes: ResourceBytes | undefined = produced.get(resource.name);
        return {
            backedUp: bytes == undefined ? undefined : { rows: bytes.bytes, sha256: bytes.sha256 },
            stored: undefined,
            storedIds: undefined
        };
    }
    return { backedUp: resource.table.resolveFingerprint(), stored: await store.resolveFingerprint(), storedIds: store.getStoredIds() };
}

/**
 * What a resource holds once the restore returned.
 * @param resource - The resource.
 * @param before - What it held at the backup.
 * @returns The fingerprint: of its data source's rows, or for a table read as bytes, of what the
 * restore handed it.
 */
async function resolveRestoredFingerprint(
    resource: MeasuredResource,
    before: ResourceFingerprints | undefined
): Promise<SeededFingerprint | undefined> {
    const store: MeasuredRowStore | undefined = resolveStore(resource);
    if (store == undefined) {
        const bytes: ResourceBytes | undefined = restored.get(resource.name);
        return bytes == undefined ? undefined : { rows: bytes.bytes, sha256: bytes.sha256 };
    }
    // the rows of the backup, under the ids they had then: what changed since is what the restore undoes
    return await store.resolveFingerprint(before?.storedIds);
}

/**
 * What tells a restore apart from what it had to bring back.
 * @param resource - The resource.
 * @param before - What it held at the backup.
 * @param after - What it holds after the restore.
 * @returns The mismatch, or undefined when there is none.
 */
function resolveMismatch(
    resource: MeasuredResource,
    before: ResourceFingerprints,
    after: SeededFingerprint | undefined
): string | undefined {
    if (before.stored != undefined && !isSameFingerprint(before.backedUp, before.stored)) {
        return `${resource.name}: the data source held ${describeFingerprint(before.stored)} at the backup, `
            + `the table ${describeFingerprint(before.backedUp)}, so the measurement wrote the table wrongly`;
    }
    return !isSameFingerprint(before.backedUp, after)
        ? `${resource.name}: the restore brought back ${describeFingerprint(after)}, `
        + `the backup held ${describeFingerprint(before.backedUp)}`
        : undefined;
}

/**
 * How often a live phase is read.
 * @param timedMs - How long the same phase took when timed.
 * @returns The interval, in milliseconds.
 */
function resolveLiveIntervalInMs(timedMs: number): number {
    return Math.min(MAX_LIVE_INTERVAL_IN_MS, Math.max(MIN_LIVE_INTERVAL_IN_MS, Math.round(timedMs / LIVE_READINGS_PER_PHASE)));
}

/**
 * Takes one more backup and restores it, each read right after a collection.
 * @param sampler - What reads the phases.
 * @param backups - The timed backups, whose shortest sets how often the backup is read.
 * @param restore - The timed restore, which sets how often the restore is read.
 * @returns The measurement.
 */
async function measureLive(sampler: PhaseSampler, backups: BackupRunMeasurement[], restore: PhaseMeasurement): Promise<LiveMeasurement> {
    const backupService: BackupServiceInterface = inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);
    const readLive: (phase: PhaseMeasurement) => LivePhaseMeasurement = phase => {
        if (phase.live == undefined) {
            throw new Error('A live phase was read without a collection.');
        }
        return phase.live;
    };
    sampler.begin({ intervalInMs: resolveLiveIntervalInMs(Math.min(...backups.map(b => b.durationMs))), name: `${config.name} backup` });
    const backup: BackupEntity = await takeBackup('measured-live');
    const backupPhase: PhaseMeasurement = await sampler.end();
    sampler.begin({ intervalInMs: resolveLiveIntervalInMs(restore.durationMs), name: `${config.name} restore` });
    await backupService.restore(backup);
    return { backup: readLive(backupPhase), restore: readLive(await sampler.end()) };
}

/**
 * Takes a backup in the format of the config, and waits for it.
 * @param name - The name of the backup.
 * @returns The backup, completed.
 */
async function takeBackup(name: string): Promise<BackupEntity> {
    const backupService: BackupServiceInterface = inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);
    if (config.formatVersion === BACKUP_FORMAT_VERSION) {
        return await backupService.waitForBackup(await backupService.queueBackup({ name }));
    }
    // as a build writing only that format queued it, with the keys it records, before this one stored it
    const keys: KeysInUse = await inject(ZIBRI_DI_TOKENS.ENCRYPTION_SERVICE).resolveKeysInUse();
    const backups: Repository<BackupEntity, BackupEntityCreateData> = inject(repositoryTokenFor(BackupEntity));
    const queued: BackupEntity = await backups.create({
        name,
        status: BackupStatus.RUNNING,
        masterKeys: config.encrypt ? [keys.currentMasterKey] : [],
        dataKeyIds: keys.dataKeyIds,
        resources: resources.map(r => ({ name: r.name, transportNames: [inject(MeasuredBackupTransport).name] }))
    });
    await backups.updateById(queued.id, { formatVersion: config.formatVersion });
    await backupService.runQueuedBackups();
    return await backupService.waitForBackup(queued);
}

/**
 * Deletes the oldest backup, as a retention deletes it, and measures collecting what only it named.
 * @param sampler - What reads the phase.
 * @param transport - The transport, whose calls during the collection are measured.
 * @returns The measurement.
 */
async function measureGarbageCollection(
    sampler: PhaseSampler,
    transport: MeasuredBackupTransport
): Promise<GarbageCollectionMeasurement> {
    const backupService: BackupServiceInterface = inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);
    // the newest of backups reading only what changed, each of which builds on the ones before it
    const deletedName: string = `measured-${
        config.resources.some(r => r.kind === 'postgres' && r.incrementalRead) ? config.backups - 1 : 0
    }`;
    const [deleted]: BackupEntity[] = await inject(repositoryTokenFor(BackupEntity))
        .findAll({ where: { name: deletedName }, relations: ['resources'] });
    if (deleted == undefined || backupService.collectGarbage == undefined) {
        throw new Error(`There is no backup "${deletedName}", or the backup service collects no garbage.`);
    }
    await backupService.delete(deleted);
    // what deleting asked of the transport is no part of the collection
    transport.takeMeasurement();
    sampler.begin(undefined);
    await backupService.collectGarbage();
    const phase: PhaseMeasurement = await sampler.end();
    return {
        ...phase,
        transport: transport.takeMeasurement(),
        bytesStoredAfter: config.transport.kind === 'fs' ? await PhaseSampler.resolveFolderBytes(config.transport.path) : undefined
    };
}

/**
 * Starts a probe of the server of every Valkey resource.
 * @returns The probes, one per server.
 */
async function startProbes(): Promise<ValKeyServerProbe[]> {
    const probes: ValKeyServerProbe[] = [];
    try {
        for (const resource of resources) {
            const dataSource: DataSourceInterface | undefined = resource.dataSourceClass == undefined
                ? undefined
                : inject(resource.dataSourceClass);
            if (dataSource instanceof ValKeyDataSource) {
                // as the data source connects
                const { host = 'localhost', port = 6379 } = dataSource.options;
                probes.push(await ValKeyServerProbe.start({ host, port }));
            }
        }
    }
    catch (error) {
        stopProbes(probes);
        throw error;
    }
    return probes;
}

/**
 * Stops probes.
 * @param probes - The probes.
 */
function stopProbes(probes: ValKeyServerProbe[]): void {
    for (const probe of probes) {
        probe.stop();
    }
}

/**
 * Runs one phase with every probe reading its server meanwhile.
 * @param probes - The probes.
 * @param run - The phase.
 * @returns What the phase returned, and what the servers did meanwhile.
 */
async function probe<T>(probes: ValKeyServerProbe[], run: () => Promise<T>): Promise<[T, ValKeyServerMeasurement | undefined]> {
    await Promise.all(probes.map(async p => await p.begin()));
    const res: T = await run();
    return [res, ValKeyServerProbe.resolveCombined(await Promise.all(probes.map(async p => await p.end())))];
}

/**
 * Takes the backups, restores the last one, collects the garbage of the oldest, and measures each.
 * @returns The measurement.
 */
async function measure(): Promise<BackupMeasurement> {
    const probes: ValKeyServerProbe[] = await startProbes();
    try {
        return await measureProbed(probes);
    }
    finally {
        stopProbes(probes);
    }
}

/**
 * Takes the backups, restores the last one, collects the garbage of the oldest, and measures each.
 * @param probes - What reads the Valkey servers during the backups and the restore.
 * @returns The measurement.
 */
async function measureProbed(probes: ValKeyServerProbe[]): Promise<BackupMeasurement> {
    const backupService: BackupServiceInterface = inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);
    const transport: MeasuredBackupTransport = inject(MeasuredBackupTransport);
    const sampler: PhaseSampler = new PhaseSampler(inject(ZIBRI_DI_TOKENS.BACKUP_TEMP_FOLDER), config.heapSnapshotFolder);
    await timeHarness('fillMs', async () => {
        for (const resource of resources) {
            await resolveStore(resource)?.writeRows(resource.table.resolveRows());
        }
    });
    // what booting asked of the transport, such as the sync of its backups, is no backup's cost
    transport.takeMeasurement();

    // what producing the data costs by itself, one resource after another, as the backups read them
    // at once only when there are several
    const sourceStartedAt: number = performance.now();
    for (const resource of resources) {
        for await (const chunk of await resource.readAlone()) {
            // read and dropped
            void chunk;
        }
    }
    const sourceReadMs: number = performance.now() - sourceStartedAt;

    const backups: BackupRunMeasurement[] = [];
    let last: BackupEntity | undefined;
    for (let round: number = 0; round < config.backups; round++) {
        if (round > 0) {
            await timeHarness('changesMs', async () => await applyChanges(round));
        }
        produced.clear();
        stageTimes.readMs = 0;
        const [[backup, phase], server]: [[BackupEntity, PhaseMeasurement], ValKeyServerMeasurement | undefined] = await probe<
            [BackupEntity, PhaseMeasurement]
        >(probes, async () => {
            sampler.begin(undefined);
            const taken: BackupEntity = await takeBackup(`measured-${round}`);
            return [taken, await sampler.end()];
        });
        last = backup;
        backups.push({
            ...phase,
            server,
            bytesProduced: [...produced.values()].reduce((sum, p) => sum + p.bytes, 0),
            resourceReadMs: stageTimes.readMs,
            transport: transport.takeMeasurement()
        });
    }
    if (last == undefined) {
        throw new Error('The config asks for no backup.');
    }

    const backedUp: ResourceFingerprints[] = await timeHarness(
        'fingerprintMs',
        async () => await Promise.all(resources.map(r => resolveBackedUpFingerprints(r)))
    );
    // so that the restore has something to bring back, as one has once a day went wrong
    await timeHarness('changesMs', async () => await applyChanges(config.backups));
    restored.clear();
    stageTimes.readMs = 0;
    stageTimes.applyMs = 0;
    const restoredBackup: BackupEntity = last;
    const [restorePhase, restoreServer]: [PhaseMeasurement, ValKeyServerMeasurement | undefined] = await probe(probes, async () => {
        sampler.begin(undefined);
        await backupService.restore(restoredBackup);
        return await sampler.end();
    });
    const restoreTransport: BackupRunMeasurement['transport'] = transport.takeMeasurement();
    const afterRestore: (SeededFingerprint | undefined)[] = await timeHarness(
        'fingerprintMs',
        async () => await Promise.all(resources.map((r, index) => resolveRestoredFingerprint(r, backedUp[index])))
    );
    const mismatches: string[] = resources.flatMap((resource, index) => {
        const before: ResourceFingerprints | undefined = backedUp[index];
        const mismatch: string | undefined = before == undefined
            ? `${resource.name}: nothing was backed up`
            : resolveMismatch(resource, before, afterRestore[index]);
        return mismatch == undefined ? [] : [mismatch];
    });
    const bytesStored: number = config.transport.kind === 'fs'
        ? await PhaseSampler.resolveFolderBytes(config.transport.path)
        : backups.reduce((sum, b) => sum + b.transport.bytesWritten, 0);
    const garbageCollection: GarbageCollectionMeasurement = await measureGarbageCollection(sampler, transport);
    // before the live phases, which store a backup more and are no part of the timed ones
    // (reported in kilobytes on every platform node runs on)
    const maxRssBytes: number = process.resourceUsage().maxRSS * 1024;

    return {
        name: config.name,
        backups,
        restore: {
            ...restorePhase,
            server: restoreServer,
            restoredExactly: mismatches.length === 0,
            mismatches,
            snapshotReadMs: stageTimes.readMs,
            applyMs: stageTimes.applyMs,
            transport: restoreTransport
        },
        garbageCollection,
        maxRssBytes,
        bytesStored,
        sourceReadMs,
        // the same object as the one still being added to, since shutting down follows
        harness,
        // last, so that skipping them changes nothing that was timed
        live: config.measureHeld ? await measureLive(sampler, backups, restorePhase) : undefined
    };
}

/**
 * Boots the application, measures, and reports to the parent.
 */
async function main(): Promise<void> {
    // counted from when the process started, so this is what loading every module took
    harness.loadMs = performance.now();
    if (config.heapSnapshotFolder != undefined) {
        await FsUtilities.mkdir(FsUtilities.getPath(config.heapSnapshotFolder));
    }
    if (config.transport.kind === 'fs') {
        const transportPath: FsPath = FsUtilities.getPath(config.transport.path);
        await FsUtilities.rm(transportPath);
        await FsUtilities.mkdir(transportPath);
    }
    let result: BackupMeasurementResult;
    let server: StartedTestServer | undefined;
    try {
        // the framework's own entities in memory, so that a backup of a data source holds the table
        // and nothing else
        server = await timeHarness('bootMs', async () => await startTestServer({
            dataSources: [
                createInMemoryDataSource({
                    // the chunk index as a deployment declares it, rather than a listing of the transport
                    entities: [...defaultTestServerEntities, BackupEntity, BackupResourceEntity, BackupChunkEntity],
                    repositories: defaultTestServerRepositories
                }),
                ...resources.flatMap(r => r.dataSourceClass == undefined ? [] : [r.dataSourceClass])
            ],
            providers: [
                ...defaultTestServerProviders,
                // every resource at once, as several resources are meant to measure: the default of one
                // stored them one after another
                defineProvider({ token: ZIBRI_DI_TOKENS.BACKUP_MAX_CONCURRENT_RESOURCES, useValue: resources.length })
            ]
        }));
        result = { measurement: await measure() };
    }
    catch (error) {
        result = { error: error instanceof Error ? error.stack ?? error.message : String(error) };
    }
    finally {
        await timeHarness('shutdownMs', async () => await server?.shutdown());
    }
    // and then let go of the channel, which is all that keeps the process alive: one that exits by
    // itself writes the cpu profile it was asked for, where one that is killed writes nothing
    process.send?.(result, () => process.disconnect?.());
}

void main();