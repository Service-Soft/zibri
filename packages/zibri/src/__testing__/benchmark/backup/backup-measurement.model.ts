import { ChangeProfile } from './seeded-table.model';
import { S3BackupTransportOptions } from '../../../backup/transports/s3/s3-backup-transport-options.model';
import { S3Credentials } from '../../../backup/transports/s3/s3-credentials.model';
import { SftpBackupTransportOptions } from '../../../backup/transports/sftp/sftp-backup-transport-options.model';
import { ValKeyBackupMode } from '../../../data-source/data-sources/val-key/val-key-backup-mode.model';
import { ValKeyRestoreMode } from '../../../data-source/data-sources/val-key/val-key-restore-mode.model';
import { OmitStrict } from '../../../types/omit-strict.type';

/**
 * The environment variable the measured process reads its {@link BackupMeasurementConfig} from.
 */
export const BACKUP_MEASUREMENT_CONFIG_ENV: string = 'ZIBRI_BACKUP_MEASUREMENT_CONFIG';

/**
 * One resource a measured process backs up, holding a seeded table of about `bytes`.
 */
export type MeasuredResourceConfig = {
    /**
     * About how large the table is to begin with, in bytes.
     */
    bytes: number
} & ({
    /**
     * The table itself, read as the bytes of a dump: what the backup pipeline costs, without a database.
     */
    kind: 'seeded'
} | {
    /**
     * The table in postgres, in a container of its own.
     */
    kind: 'postgres',
    /**
     * Whether pg_dump compresses the dump although the backup cuts it into chunks, as a reference for
     * what leaving it uncompressed costs.
     */
    compressedDump: boolean,
    /**
     * Whether a backup after the first reads only what changed, through logical decoding.
     */
    incrementalRead: boolean
} | {
    /**
     * The table in valkey, in a container of its own.
     */
    kind: 'val-key',
    /**
     * How valkey's keys are read.
     */
    backupMode: ValKeyBackupMode,
    /**
     * How a restore writes them.
     */
    restoreMode: ValKeyRestoreMode
});

/**
 * Where a measured process stores its backups. Plain data, since it reaches the process as json.
 */
export type MeasuredTransportConfig = {
    /**
     * The fs transport.
     */
    kind: 'fs',
    /**
     * The folder it stores into.
     */
    path: string
} | {
    /**
     * The s3 transport.
     */
    kind: 's3',
    /**
     * Its options, with credentials that are given rather than resolved.
     */
    options: OmitStrict<S3BackupTransportOptions, 'credentials'> & { credentials: S3Credentials }
} | {
    /**
     * The sftp transport.
     */
    kind: 'sftp',
    /**
     * Its options.
     */
    options: SftpBackupTransportOptions
};

/**
 * What one measured process backs up, and how.
 */
export type BackupMeasurementConfig = {
    /**
     * What the measurement is called in the report.
     */
    name: string,
    /**
     * The resources. Every resource is backed up in the same backup, so several of them measure what
     * running at once costs.
     */
    resources: MeasuredResourceConfig[],
    /**
     * How many backups are taken one after another, with `changes` applied between two of them.
     */
    backups: number,
    /**
     * How the resources change between two backups.
     */
    changes: ChangeProfile,
    /**
     * Whether the resources are encrypted.
     */
    encrypt: boolean,
    /**
     * What every row is derived from.
     */
    seed: number,
    /**
     * Where the backups are stored.
     */
    transport: MeasuredTransportConfig,
    /**
     * The format the backups are written in: `BACKUP_FORMAT_VERSION`, or 1 to measure what this build
     * costs writing format 1, as a reference on the same machine.
     */
    formatVersion: number,
    /**
     * Where the live phases write a heap snapshot at their start and near their peak, or undefined
     * for nowhere. `node scripts/summarize-heap-growth.mjs <start> <peak>` tells what the phase held
     * and what held it.
     */
    heapSnapshotFolder: string | undefined
};

/**
 * What one phase held right after a collection: what it holds on to, without what the collector had
 * not come for yet.
 */
export type LivePhaseMeasurement = {
    /**
     * How often it was read, in milliseconds.
     */
    intervalInMs: number,
    /**
     * How many readings were taken.
     */
    readings: number,
    /**
     * The most of the heap and the buffers outside it, above the start, in bytes. Not the rss, which
     * keeps what the allocator was given back, and so after the timed phases grows no further.
     * Without what native code allocates by itself, which the timed peaks still hold.
     */
    peakHeldGrowthBytes: number
};

/**
 * A backup and its restore read right after a collection.
 */
export type LiveMeasurement = {
    /**
     * The backup.
     */
    backup: LivePhaseMeasurement,
    /**
     * Its restore.
     */
    restore: LivePhaseMeasurement
};

/**
 * What one phase of a measured process cost.
 */
export type PhaseMeasurement = {
    /**
     * How long it took, in milliseconds.
     */
    durationMs: number,
    /**
     * The most memory the process held during the phase, above what it held when the phase began, in
     * bytes. What the phase itself costs, without what the process held anyway.
     */
    peakRssGrowthBytes: number,
    /**
     * The most of the heap in use during the phase, above the start, in bytes.
     */
    peakHeapGrowthBytes: number,
    /**
     * The most memory held outside the heap during the phase, buffers included, above the start, in
     * bytes.
     */
    peakExternalGrowthBytes: number,
    /**
     * The most the staging folder held during the phase, in bytes.
     */
    peakStagingBytes: number,
    /**
     * CPU time spent in the process, in milliseconds.
     */
    cpuUserMs: number,
    /**
     * CPU time spent in the kernel for the process, in milliseconds.
     */
    cpuSystemMs: number,
    /**
     * What it held right after a collection, undefined unless it was read so.
     */
    live: LivePhaseMeasurement | undefined
};

/**
 * What the transport was asked to do during one phase.
 */
export type TransportMeasurement = {
    /**
     * How many times each method was called, by its name.
     */
    calls: Record<string, number>,
    /**
     * How long the calls of each method took in all, by its name, in milliseconds. A call that hands
     * back a stream takes until the stream was read to its end. Calls run at once add up, so the sum
     * can exceed the phase.
     */
    callDurationsMs: Record<string, number>,
    /**
     * Bytes written to the transport.
     */
    bytesWritten: number,
    /**
     * Bytes read from the transport.
     */
    bytesRead: number
};

/**
 * What the Valkey servers of the resources did for everyone else during one phase, read by a client of
 * its own asking each of them every few milliseconds.
 */
export type ValKeyServerMeasurement = {
    /**
     * The longest that client waited for an answer, in milliseconds, of the servers: how long a server
     * answered no other client.
     */
    slowestAnswerMs: number,
    /**
     * How many answers it was read in.
     */
    answers: number,
    /**
     * The most memory the servers used during the phase, above what they used when it began, in bytes:
     * their `used_memory`, added up over the servers.
     */
    peakUsedMemoryGrowthBytes: number
};

/**
 * One backup of a series.
 */
export type BackupRunMeasurement = PhaseMeasurement & {
    /**
     * What the Valkey servers of the resources did for everyone else meanwhile, undefined without a
     * Valkey resource.
     */
    server: ValKeyServerMeasurement | undefined,
    /**
     * Bytes the resources produced.
     */
    bytesProduced: number,
    /**
     * How long reading the resources took in all, from asking for their data to its last byte, in
     * milliseconds. Encryption, staging and the transport keep up with the reading or slow it down, so
     * this is where they show beside the transport's own time.
     */
    resourceReadMs: number,
    /**
     * What the transport was asked to do.
     */
    transport: TransportMeasurement
};

/**
 * The restore of the last backup.
 */
export type RestoreMeasurement = PhaseMeasurement & {
    /**
     * What the Valkey servers of the resources did for everyone else meanwhile, undefined without a
     * Valkey resource.
     */
    server: ValKeyServerMeasurement | undefined,
    /**
     * Whether every resource holds exactly what it held when the last backup was taken, although it
     * was changed once more before the restore: the bytes its last backup produced for a seeded
     * resource, and the same rows for a data source.
     */
    restoredExactly: boolean,
    /**
     * What tells the restore apart from what it had to bring back, one line per resource that
     * differs. A data source that differed from its table already at the backup names that, since
     * then the measurement wrote the table wrongly rather than the restore failing.
     */
    mismatches: string[],
    /**
     * How long taking the snapshots of what the restore replaces took in all, in milliseconds.
     */
    snapshotReadMs: number,
    /**
     * How long applying the restored data to the resources took in all, in milliseconds.
     */
    applyMs: number,
    /**
     * What the transport was asked to do.
     */
    transport: TransportMeasurement
};

/**
 * The garbage collection once the oldest backup was deleted.
 */
export type GarbageCollectionMeasurement = PhaseMeasurement & {
    /**
     * What the transport was asked to do.
     */
    transport: TransportMeasurement,
    /**
     * What the folder of the fs transport holds afterwards, in bytes, or undefined for another transport.
     */
    bytesStoredAfter: number | undefined
};

/**
 * What a measured process reports back.
 */
export type BackupMeasurement = {
    /**
     * The name from the config.
     */
    name: string,
    /**
     * Each backup, in the order they were taken.
     */
    backups: BackupRunMeasurement[],
    /**
     * The restore of the last backup.
     */
    restore: RestoreMeasurement,
    /**
     * The garbage collection after the restore, once the oldest backup was deleted.
     */
    garbageCollection: GarbageCollectionMeasurement,
    /**
     * The most memory the process ever held, from the operating system, in bytes. Includes what the
     * application and the test data hold.
     */
    maxRssBytes: number,
    /**
     * Bytes the transport holds once every backup was taken: what its folder holds for the fs
     * transport, and what was written to it for another, since nothing is deleted before then.
     */
    bytesStored: number,
    /**
     * How long reading every resource once takes on its own, without a backup, in milliseconds. What
     * a backup's `resourceReadMs` takes beyond this is what the backup adds to reading the data.
     */
    sourceReadMs: number,
    /**
     * How long what the measurement does around the backups took, in milliseconds: none of it is a
     * backup's cost, and all of it is the suite's.
     */
    harness: HarnessMeasurement,
    /**
     * A backup and its restore after the others, each read right after a collection as often as its
     * timed one took for: what a backup holds on to. After the others rather than with them, since the
     * collections it forces made a backup half as slow again and flatten the peaks the reports hold;
     * in the same process, which is booted and filled already.
     */
    live: LiveMeasurement
};

/**
 * Where a measured process spent the time it did not spend measuring, in milliseconds.
 */
export type HarnessMeasurement = {
    /**
     * Starting the process and loading the framework into it, before anything of the measurement ran.
     */
    loadMs: number,
    /**
     * Starting the application, with the containers of its data sources.
     */
    bootMs: number,
    /**
     * Writing the tables into their data sources.
     */
    fillMs: number,
    /**
     * Writing the changes between the backups into the data sources.
     */
    changesMs: number,
    /**
     * Reading what the data sources hold, to compare the restore with the backup.
     */
    fingerprintMs: number,
    /**
     * Stopping the application.
     */
    shutdownMs: number
};

/**
 * What a measured process sends its parent: the measurement, or why there is none.
 */
export type BackupMeasurementResult = {
    /**
     * The measurement.
     */
    measurement: BackupMeasurement
} | {
    /**
     * Why the measurement failed, with its stack.
     */
    error: string
};