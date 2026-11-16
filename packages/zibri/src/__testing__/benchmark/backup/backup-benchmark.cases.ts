import { ChildProcess, fork, ForkOptions } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';

import { afterAll, describe, expect, it } from '@jest/globals';
import { resolveTypeScriptForkOptions } from 'zibri-testing';

import { BACKUP_MEASUREMENT_CONFIG_ENV,
    BackupMeasurement,
    BackupMeasurementConfig,
    BackupMeasurementResult,
    GarbageCollectionMeasurement,
    LiveMeasurement,
    LivePhaseMeasurement,
    MeasuredResourceConfig,
    MeasuredTransportConfig,
    PhaseMeasurement,
    ValKeyServerMeasurement } from './backup-measurement.model';
import { ChangeProfile } from './seeded-table.model';
import { BACKUP_FORMAT_VERSION } from '../../../backup/backup-format';
import { FsPath, FsUtilities } from '../../../utilities/fs.utilities';
import { JsonUtilities } from '../../../utilities/json.utilities';
import { UUIDUtilities } from '../../../utilities/uuid.utilities';
import { testFileFolder } from '../../constants';
import { BenchmarkFigure } from '../benchmark-figure.model';
import { BenchmarkTiming } from '../benchmark-timing.model';
import { BenchmarkUtilities } from '../benchmark.utilities';

const MIB: number = 1024 * 1024;

const updateBaseline: boolean = process.env['ZIBRI_BENCHMARK_UPDATE_BASELINE'] === '1';

// What a backup and a restore are designed to hold, beside what the process held before: what each
// phase may hold at most, read after a collection, whatever the size of the data. Stated here rather
// than read from the transports, so that a change of what they hold changes these on purpose

/**
 * What the stream pipeline of one resource holds by itself: a few chunks in each of its stages, and
 * what the services of the application allocate meanwhile. Read at 0.4 to 0.7 MiB at 100 MB to a folder.
 */
const PIPELINE_HELD_BYTES: number = 4 * MIB;

/**
 * The largest chunk a resource is cut into, the default `maxChunkBytes`.
 */
const MAX_CHUNK_BYTES: number = 4 * MIB;

/**
 * The smallest chunk a resource is cut into, except its last, the default `minChunkBytes`.
 */
const MIN_CHUNK_BYTES: number = 256 * 1024;

/**
 * How many chunks of a resource are being stored at once, and fetched ahead in a restore.
 */
const CHUNKS_IN_FLIGHT: number = 4;

/**
 * What storing the chunks of one resource holds beyond the pipeline: the chunk being cut, and each
 * chunk in flight with its sealed copy. Every object a backup stores is a chunk or smaller, so an S3
 * backup gathers no part beyond them.
 */
const BACKUP_CHUNKS_HELD_BYTES: number = MAX_CHUNK_BYTES * (1 + (2 * CHUNKS_IN_FLIGHT));

/**
 * What restoring one resource holds beyond the pipeline: each chunk fetched ahead, as stored and as opened.
 */
const RESTORE_CHUNKS_HELD_BYTES: number = MAX_CHUNK_BYTES * 2 * CHUNKS_IN_FLIGHT;

/**
 * What an SFTP backup holds beyond the chunks: the writes in flight of each put, the transport's
 * WRITE_BUFFER_BYTES.
 */
const SFTP_WRITES_HELD_BYTES: number = 2 * MIB * CHUNKS_IN_FLIGHT;

/**
 * What a Valkey backup or restore holds beyond the pipeline: one batch of 250 keys, each a row of at
 * most 1.5 KiB as its dump, its base64, its line and what parsing it makes. A set too large for that,
 * such as the ids of a table, is read and restored a page of 250 members at a time, which is less.
 */
const VALKEY_BATCH_HELD_BYTES: number = 2 * MIB;

/**
 * How many times a live phase has to have been read to be compared: fewer may have missed what it
 * held, which then reads as nothing.
 */
const MIN_LIVE_READINGS: number = 5;

/**
 * How much more an archive is than what it holds, as a share: the authentication tags of the encryption.
 */
const ARCHIVE_OVERHEAD_RATIO: number = 1.01;

/**
 * What a Valkey backup stages beside its data, as a share of what it produced: the names of its keys,
 * sorted in runs on the disk. A run's line is the name a line of the backup carries beside the key's
 * dump, a snapshot's copies named as the keys they copy. With rows of about 1 KiB, each beside the key of
 * its unique, the names come to less than a tenth of the lines.
 */
const VALKEY_SORTED_NAMES_RATIO: number = 0.1;

/**
 * What a Valkey walk stages beside the names, as a share of what it produced: the unique entries of each
 * row of an entity with a unique, sorted in runs to find two rows read at different moments holding one.
 * An entry's line is its key and the row's id, against a row of about 1 KiB.
 */
const VALKEY_UNIQUE_ENTRIES_RATIO: number = 0.1;

/**
 * What a Valkey backup holds while it sorts the names of its keys: one run of them. A walk holds one run of
 * the unique entries beside it.
 */
const VALKEY_SORT_HELD_BYTES: number = 4 * MIB;

/**
 * What the Valkey server may hold beyond the store while a phase copies every key, a snapshot or a staged
 * restore, as a share of the data: the copy, whose names are longer by the prefix it is held under. Read at
 * 1.74 at 10 and 100 MB.
 */
const VALKEY_COPY_SERVER_RATIO: number = 2;

/**
 * What the Valkey server may hold beyond the store while a phase copies no key but the set it reads, a
 * walk or a direct restore, as a share of the data: the copy of the largest set, such as the ids of a
 * table. Read at 0.04 to 0.05 at 10 and 100 MB.
 */
const VALKEY_WALK_SERVER_RATIO: number = 0.1;

/**
 * What the Valkey server may hold beyond either share: what its clients' buffers hold.
 */
const VALKEY_SERVER_SLACK_BYTES: number = 2 * MIB;

/**
 * How long another client may wait for an answer of a Valkey server while a walk or a direct restore
 * runs: the request timeout of a Glide client, so that one at its defaults never times out then. Read at
 * 2 to 17 ms at 10 and 100 MB. A snapshot and a staged restore pause the server by design.
 */
const VALKEY_WALK_SLOWEST_ANSWER_MS: number = 250;

/**
 * How much a backup reading only what changed may produce, as a share of what changed in the backup in
 * full: a written row is a delete and an insert, each a line of JSON naming its columns beside its values.
 */
const INCREMENT_OVERHEAD_RATIO: number = 2;

/**
 * How much more the staging folder, or the transport, may be handed than the archives: the files and
 * the document of the record.
 */
const RECORD_SLACK_BYTES: number = MIB;

/**
 * How much a duration may grow beyond the growth of the data, before it counts as worse than linear.
 */
const LINEAR_SLACK_RATIO: number = 1.5;

/**
 * How much longer, or larger, a measurement may come out than the one it is compared with: what two
 * processes measuring the same thing one after another differ by.
 */
const COMPARED_SLACK_RATIO: number = 1.1;

/**
 * How long measuring every scenario of a suite may take.
 */
const MEASURING_TIMEOUT_IN_MS: number = 60 * 60 * 1000;

/**
 * How one day of use changes the data between two backups.
 */
const DAILY_CHANGES: ChangeProfile = { updatedShare: 0.01, deletedShare: 0.005, insertedShare: 0.01, movedShare: 0.02 };

/**
 * How one day changes a table only ever added to, such as a log of events: what deduplicates.
 */
export const APPENDED_DAILY: ChangeProfile = { updatedShare: 0, deletedShare: 0, insertedShare: 0.01, movedShare: 0 };

/**
 * No change between two backups: whether a resource writes the same data the same way each time, which a
 * later backup then stores nothing of but its manifests and its record.
 */
export const UNCHANGED: ChangeProfile = { updatedShare: 0, deletedShare: 0, insertedShare: 0, movedShare: 0 };

/**
 * How many backups each measurement takes, one after another.
 */
const BACKUPS: number = 3;

const entryPath: FsPath = FsUtilities.getPath(__dirname, 'backup-measurement.entry.ts');

/**
 * How long a measured process may take to exit by itself once it reported.
 */
const CHILD_EXIT_WITHIN_MS: number = 10_000;

/**
 * Where the cpu profiles of the measured processes are written, when they are asked for.
 */
const cpuProfileFolder: FsPath = FsUtilities.getPath(testFileFolder, `backup-cpu-profiles-${UUIDUtilities.generate()}`);

/**
 * Where the live phases write their heap snapshots, when ZIBRI_BENCHMARK_HEAP_SNAPSHOT=1 asks for
 * them: `node scripts/summarize-heap-growth.mjs <…-start.heapsnapshot> <…-peak.heapsnapshot>` tells
 * what a phase held and what held it. A phase that never held 16 MiB more than at its start writes
 * no peak.
 */
const heapSnapshotFolder: FsPath | undefined = process.env['ZIBRI_BENCHMARK_HEAP_SNAPSHOT'] === '1'
    ? FsUtilities.getPath(testFileFolder, `backup-heap-snapshots-${UUIDUtilities.generate()}`)
    : undefined;

/**
 * The format every scenario writes. ZIBRI_BACKUP_BENCHMARK_FORMAT_VERSION=1 measures what this build costs
 * writing format 1, beside a run of the current format on the same machine: what a format adds is told
 * apart from what the machine does. The design limits are the current format's, so such a run checks only
 * that the restore brings back what was backed up.
 */
const formatVersion: number = Number(process.env['ZIBRI_BACKUP_BENCHMARK_FORMAT_VERSION'] ?? BACKUP_FORMAT_VERSION);

/**
 * Whether each measurement runs its live phases, the only ones what a phase holds after a collection is
 * read from. ZIBRI_BENCHMARK_SKIP_HELD_MEMORY=1 leaves them out, as `npm run test:benchmark:compare` does
 * in every round but the first of the checkout.
 */
// the live phases are a quarter of a measurement, and come after everything timed or compared with the
// release: in one run they are a design check, in eight they are the same check seven times over
const measureHeld: boolean = process.env['ZIBRI_BENCHMARK_SKIP_HELD_MEMORY'] !== '1';

/**
 * What tells one measurement of the suites from another.
 */
export type BackupScenarioInput = {
    /**
     * What it is called in the reports, unique among every benchmark suite.
     */
    name: string,
    /**
     * The series it belongs to, see {@link BackupScenario.series}.
     */
    series: string | undefined,
    /**
     * Its resources.
     */
    resources: MeasuredResourceConfig[],
    /**
     * What its rows are derived from.
     */
    seed: number,
    /**
     * Where it stores its backups.
     */
    transport: MeasuredTransportConfig,
    /**
     * How the data changes between two backups, {@link DAILY_CHANGES} unless given.
     */
    changes?: ChangeProfile,
    /**
     * The series whose measurement of the same size this one has to take no longer than and store no more
     * than, such as a way of producing the data it replaced.
     */
    comparedWith?: string
};

/**
 * One measurement a suite takes.
 */
export type BackupScenario = {
    /**
     * What is measured.
     */
    config: BackupMeasurementConfig,
    /**
     * The series the measurement belongs to, whose measurements differ in the size of the data alone:
     * how memory and duration grow with the size is checked within one. Undefined for a measurement
     * of no series.
     */
    series: string | undefined,
    /**
     * See {@link BackupScenarioInput.comparedWith}, undefined for a measurement compared with none.
     */
    comparedWith: string | undefined
};

/**
 * What a suite of backup measurements measures, and where it keeps what it records.
 */
export type BackupBenchmarkOptions = {
    /**
     * What the suite's reports are named after, unique among the benchmark suites.
     */
    name: string,
    /**
     * Where the timings of this machine are recorded, never committed.
     */
    baselinePath: FsPath,
    /**
     * The measurements, resolved once the suite's servers run.
     * @param outputFolder - A folder the measurements may store into, removed once they ran.
     * @returns The measurements, in the order they are taken.
     */
    resolveScenarios: (outputFolder: FsPath) => BackupScenario[]
};

/**
 * A measurement taken, with what it was taken of.
 */
type TakenMeasurement = {
    scenario: BackupScenario,
    measurement: BackupMeasurement
};

/**
 * A measurement taken the way every measurement of the suites is: {@link BACKUPS} encrypted backups
 * a day of {@link DAILY_CHANGES} apart.
 * @param input - What tells it from the others.
 * @returns The scenario.
 */
export function resolveBackupScenario(input: BackupScenarioInput): BackupScenario {
    return {
        series: input.series,
        comparedWith: input.comparedWith,
        config: {
            // named apart, so that a reference run is never compared with the release as the scenario
            name: formatVersion === BACKUP_FORMAT_VERSION ? input.name : `${input.name} in format ${formatVersion}`,
            formatVersion,
            resources: input.resources,
            backups: BACKUPS,
            changes: input.changes ?? DAILY_CHANGES,
            encrypt: true,
            seed: input.seed,
            transport: input.transport,
            measureHeld,
            heapSnapshotFolder
        }
    };
}

/**
 * What a phase is designed to hold at most, read after a collection: the pipeline of each resource,
 * since every resource runs at once, with what its resource and its transport hold beside it.
 * @param config - The measurement.
 * @param phase - The phase.
 * @returns The bytes.
 */
function resolveHeldLimit(config: BackupMeasurementConfig, phase: keyof LiveMeasurement): number {
    const transportBytes: number = phase === 'backup' && config.transport.kind === 'sftp' ? SFTP_WRITES_HELD_BYTES : 0;
    const chunkBytes: number = phase === 'backup' ? BACKUP_CHUNKS_HELD_BYTES : RESTORE_CHUNKS_HELD_BYTES;
    return config.resources.reduce((sum, resource) => {
        const resourceBytes: number = resource.kind === 'val-key'
            ? VALKEY_BATCH_HELD_BYTES + (VALKEY_SORT_HELD_BYTES * (resource.backupMode === 'walk' ? 2 : 1))
            : 0;
        return sum + PIPELINE_HELD_BYTES + chunkBytes + resourceBytes + transportBytes;
    }, 0);
}

/**
 * Whether the changes between two backups only ever add rows at the end, which leaves every chunk but
 * the last ones as it was.
 * @param config - What is measured.
 * @returns Whether they do.
 */
function isAppendOnly(config: BackupMeasurementConfig): boolean {
    return config.changes.updatedShare === 0 && config.changes.deletedShare === 0 && config.changes.movedShare === 0;
}

/**
 * Whether the backups after the first read only what changed, building on the one before.
 * @param config - What is measured.
 * @returns Whether they do.
 */
function isIncremental(config: BackupMeasurementConfig): boolean {
    return config.resources.some(r => r.kind === 'postgres' && r.incrementalRead);
}

/**
 * Whether a restore keeps no snapshot to put back: of postgres alone, or of valkey alone restored staged,
 * whose measured data sources carry no migration, so a backup records every one of them.
 * @param config - What is measured.
 * @returns Whether it does.
 */
function restoresWhole(config: BackupMeasurementConfig): boolean {
    const [only] = config.resources;
    return config.resources.length === 1 && (only?.kind === 'postgres' || (only?.kind === 'val-key' && only.restoreMode === 'staged'));
}

/**
 * Where the calls a backup made of the transport differ from what it is designed to make: a session per
 * resource and one for the record, and one more to store the repository key on the first backup of a
 * process; a put per manifest, per new chunk, and for that key; one record.
 * @param config - What is measured.
 * @param calls - The calls, by method.
 * @param round - Which backup it was, from zero.
 * @param producedBytes - What the resources produced.
 * @returns What differs, if anything.
 */
function findCallViolation(
    config: BackupMeasurementConfig,
    calls: Record<string, number>,
    round: number,
    producedBytes: number
): string | undefined {
    const resources: number = config.resources.length;
    const key: number = round === 0 ? 1 : 0;
    // at most as many chunks as the smallest chunk allows, and one smaller one at the end of each resource
    const mostChunks: number = Math.ceil(producedBytes / MIN_CHUNK_BYTES) + resources;
    const { openSession = 0, put = 0, putRecord = 0, ...others } = calls;
    const expected: string = `{ openSession: ${resources + 1 + key}, `
        + `put: ${resources + key} to ${resources + key + mostChunks}, putRecord: 1 }`;
    const matches: boolean = openSession === resources + 1 + key
        && put >= resources + key
        && put <= resources + key + mostChunks
        && putRecord === 1
        && !Object.keys(others).length;
    return matches ? undefined : `backup ${round} called the transport ${JsonUtilities.stringify(calls)}, designed to call it ${expected}`;
}

/**
 * The most an archive of what was produced may weigh, and so what staging or sending it may amount to.
 * @param producedBytes - What the resources produced.
 * @returns The bytes.
 */
function resolveArchiveLimit(producedBytes: number): number {
    return (producedBytes * ARCHIVE_OVERHEAD_RATIO) + RECORD_SLACK_BYTES;
}

/**
 * The most the staging folder may hold while the data of a resource is produced: what a Valkey resource
 * sorts beside it, a share of what it produced, on top of the archive.
 * @param config - What is measured.
 * @param archiveBytes - The most the archives staged at once may weigh.
 * @param producedBytes - What the resource produced that its keys were sorted for.
 * @returns The bytes.
 */
function resolveStagingLimit(config: BackupMeasurementConfig, archiveBytes: number, producedBytes: number): number {
    const sorts: boolean = config.resources.some(resource => resource.kind === 'val-key');
    const walks: boolean = config.resources.some(resource => resource.kind === 'val-key' && resource.backupMode === 'walk');
    return archiveBytes
        + (sorts ? producedBytes * VALKEY_SORTED_NAMES_RATIO : 0)
        + (walks ? producedBytes * VALKEY_UNIQUE_ENTRIES_RATIO : 0);
}

/**
 * Where a measurement differs from what a backup is designed to cost: what a phase held, what the
 * staging folder and the transport were handed, the calls the transport got, and what the restore
 * brought back.
 * @param config - What was measured.
 * @param measurement - The measurement.
 * @returns One line per difference, none when it costs what it was designed to.
 */
function findDesignViolations(config: BackupMeasurementConfig, measurement: BackupMeasurement): string[] {
    if (config.formatVersion !== BACKUP_FORMAT_VERSION) {
        return measurement.restore.mismatches.map(line => `${measurement.name}: ${line}`);
    }
    const mb: (bytes: number) => string = bytes => `${(bytes / MIB).toFixed(1)} MiB`;
    const measuredLive: LiveMeasurement | undefined = measurement.live;
    // nothing to check against the design when the live phases did not run
    const phases: (keyof LiveMeasurement)[] = ['backup', 'restore'];
    const held: string[] = measuredLive == undefined
        ? []
        : phases.flatMap(phase => {
            const live: LivePhaseMeasurement = measuredLive[phase];
            if (live.readings < MIN_LIVE_READINGS) {
                return [`the ${phase} was read ${live.readings} times after a collection, fewer than ${MIN_LIVE_READINGS}`];
            }
            const limit: number = resolveHeldLimit(config, phase);
            return live.peakHeldGrowthBytes <= limit
                ? []
                : [
                    `the ${phase} held +${mb(live.peakHeldGrowthBytes)}, designed to hold at most +${mb(limit)}. `
                    // eslint-disable-next-line stylistic/max-len
                    + 'ZIBRI_BENCHMARK_HEAP_SNAPSHOT=1 writes the heap snapshots that scripts/summarize-heap-growth.mjs tells the holder from'
                ];
        });
    const produced: number = measurement.backups.at(-1)?.bytesProduced ?? 0;
    const backups: string[] = measurement.backups.flatMap((backup, round) => {
        const limit: number = resolveArchiveLimit(backup.bytesProduced);
        const previous: BackupMeasurement['backups'][number] | undefined = measurement.backups[round - 1];
        // what was appended since, the chunk it starts in and the last one, the manifests and the record
        const appendedLimit: number | undefined = isAppendOnly(config) && previous != undefined
            ? ((backup.bytesProduced - previous.bytesProduced) * ARCHIVE_OVERHEAD_RATIO)
            + (2 * MAX_CHUNK_BYTES * config.resources.length)
            + RECORD_SLACK_BYTES
            : undefined;
        const callViolation: string | undefined = findCallViolation(
            config,
            backup.transport.calls,
            round,
            backup.bytesProduced
        );
        const { updatedShare, deletedShare, insertedShare, movedShare } = config.changes;
        const first: BackupMeasurement['backups'][number] | undefined = measurement.backups[0];
        // what changed, and the header, the sequences and the rows of the other tables of the data source
        const incrementLimit: number | undefined = isIncremental(config) && round > 0 && first != undefined
            ? (first.bytesProduced * (updatedShare + deletedShare + insertedShare + movedShare) * INCREMENT_OVERHEAD_RATIO)
            + RECORD_SLACK_BYTES
            : undefined;
        return [
            ...incrementLimit == undefined || backup.bytesProduced <= incrementLimit
                ? []
                : [
                    `backup ${round} produced ${mb(backup.bytesProduced)}, `
                    + `designed to produce at most ${mb(incrementLimit)} of what changed`
                ],
            ...backup.peakStagingBytes <= resolveStagingLimit(config, limit, backup.bytesProduced)
                ? []
                : [`backup ${round} staged ${mb(backup.peakStagingBytes)} of ${mb(backup.bytesProduced)} produced`],
            // each byte of the data at most once, and the record
            ...backup.transport.bytesWritten <= limit
                ? []
                : [`backup ${round} sent ${mb(backup.transport.bytesWritten)} of ${mb(backup.bytesProduced)} produced`],
            ...appendedLimit == undefined || backup.transport.bytesWritten <= appendedLimit
                ? []
                : [
                    `backup ${round} sent ${mb(backup.transport.bytesWritten)}, `
                    + `designed to send at most ${mb(appendedLimit)} of what was appended`
                ],
            ...callViolation == undefined ? [] : [callViolation]
        ];
    });
    const stored: number = measurement.backups.reduce((sum, b) => sum + b.transport.bytesWritten, 0);
    // of a chain, the backup in full, every one after it, and a snapshot as large as the data is now, which
    // grew by the rows inserted since. A postgres, or a valkey restored staged, restored alone and recording
    // the migrations of the build, changes everything or nothing by itself and keeps no snapshot
    const firstProduced: number = measurement.backups[0]?.bytesProduced ?? 0;
    const snapshot: number = restoresWhole(config) ? 0 : 1;
    const restoreStaged: number = isIncremental(config)
        ? measurement.backups.reduce((sum, b) => sum + b.bytesProduced, 0)
        + (snapshot * firstProduced * (1 + (config.changes.insertedShare * config.backups)))
        : produced * (1 + snapshot);
    return [
        ...held,
        ...backups,
        ...findGarbageCollectionViolations(config, measurement),
        ...findServerViolations(config, measurement),
        // a restore holds the archive of each resource and a snapshot of what it replaces, whose keys a
        // Valkey resource sorts as a backup does
        ...measurement.restore.peakStagingBytes <= resolveStagingLimit(config, resolveArchiveLimit(restoreStaged), produced)
            ? []
            : [`the restore staged ${mb(measurement.restore.peakStagingBytes)} for ${mb(produced)} produced`],
        // what the transport keeps is what it was sent: no file left over, nothing kept twice
        ...measurement.bytesStored <= stored + RECORD_SLACK_BYTES
            ? []
            : [`the transport keeps ${mb(measurement.bytesStored)} of ${mb(stored)} sent`],
        ...measurement.restore.restoredExactly ? [] : measurement.restore.mismatches
    ].map(line => `${measurement.name}: ${line}`);
}

/**
 * Where what the Valkey servers did for everyone else differs from the design: a phase copying every key
 * holds a copy of them, and one that does not holds a copy of one set and goes on answering. A restore
 * reads what it replaces first, as a backup of the resource's mode does, so it copies when either does.
 * @param config - What was measured.
 * @param measurement - The measurement.
 * @returns One line per difference, none without a Valkey resource.
 */
function findServerViolations(config: BackupMeasurementConfig, measurement: BackupMeasurement): string[] {
    const mb: (bytes: number) => string = bytes => `${(bytes / MIB).toFixed(1)} MiB`;
    const valKeys: Extract<MeasuredResourceConfig, { kind: 'val-key' }>[] = config.resources
        .flatMap(r => r.kind === 'val-key' ? [r] : []);
    const dataBytes: number = valKeys.reduce((sum, r) => sum + r.bytes, 0);
    const backupCopies: boolean = valKeys.some(r => r.backupMode === 'snapshot');
    const restoreCopies: boolean = backupCopies || valKeys.some(r => r.restoreMode === 'staged');
    const check: (phase: string, server: ValKeyServerMeasurement | undefined, copies: boolean) => string[] = (phase, server, copies) => {
        if (server == undefined) {
            return [];
        }
        const heldLimit: number = (dataBytes * (copies ? VALKEY_COPY_SERVER_RATIO : VALKEY_WALK_SERVER_RATIO)) + VALKEY_SERVER_SLACK_BYTES;
        return [
            ...server.peakUsedMemoryGrowthBytes <= heldLimit
                ? []
                : [`Valkey held +${mb(server.peakUsedMemoryGrowthBytes)} during the ${phase}, designed to hold at most +${mb(heldLimit)}`],
            ...copies || server.slowestAnswerMs <= VALKEY_WALK_SLOWEST_ANSWER_MS
                ? []
                : [
                    `Valkey answered another client in ${server.slowestAnswerMs.toFixed(0)} ms during the ${phase}, `
                    + `designed to answer within ${VALKEY_WALK_SLOWEST_ANSWER_MS} ms`
                ]
        ];
    };
    return [
        ...measurement.backups.flatMap((backup, round) => check(`backup ${round}`, backup.server, backupCopies)),
        ...check('restore', measurement.restore.server, restoreCopies)
    ];
}

/**
 * Where the garbage collection after deleting the oldest backup, or the newest of backups building on the
 * ones before, differs from its design: it reads the manifest of each resource of the backups kept and no
 * chunk, stores nothing, and frees what only the deleted backup named, of which there is always some,
 * such as its last chunk of each resource.
 * @param config - What was measured.
 * @param measurement - The measurement.
 * @returns One line per difference.
 */
function findGarbageCollectionViolations(config: BackupMeasurementConfig, measurement: BackupMeasurement): string[] {
    const mb: (bytes: number) => string = bytes => `${(bytes / MIB).toFixed(1)} MiB`;
    const collection: GarbageCollectionMeasurement = measurement.garbageCollection;
    const manifests: number = (config.backups - 1) * config.resources.length;
    const { get = 0, put = 0, putRecord = 0 } = collection.transport.calls;
    return [
        ...put + putRecord === 0 ? [] : [`the garbage collection stored ${put + putRecord} objects, designed to store none`],
        ...get === manifests
            ? []
            : [`the garbage collection read ${get} objects, designed to read the ${manifests} manifests of the backups kept and no chunk`],
        ...collection.bytesStoredAfter == undefined || collection.bytesStoredAfter < measurement.bytesStored
            ? []
            : [`the garbage collection left ${mb(collection.bytesStoredAfter)} of ${mb(measurement.bytesStored)} once a backup was deleted`]
    ];
}

/**
 * Whether a message from the measured process is its result.
 * @param message - The message.
 * @returns True when it holds a measurement or an error.
 */
function isMeasurementResult(message: unknown): message is BackupMeasurementResult {
    return typeof message === 'object' && message != undefined && ('measurement' in message || 'error' in message);
}

/**
 * Runs one measurement in a process of its own, so that the most memory it held belongs to it alone.
 * @param config - What to measure.
 * @returns The measurement.
 */
async function runMeasurement(config: BackupMeasurementConfig): Promise<BackupMeasurement> {
    const { execArgv, env }: Required<Pick<ForkOptions, 'execArgv' | 'env'>> = resolveTypeScriptForkOptions('The backup benchmark');
    const child: ChildProcess = fork(entryPath, [], {
        cwd: process.cwd(),
        // so that each phase starts from what the process holds once the collector ran.
        // ZIBRI_BENCHMARK_CPU_PROFILE=1 writes a cpu profile of each process, for where its time goes:
        // node scripts/summarize-cpu-profile.mjs <file> sums it up by package
        execArgv: [
            ...execArgv,
            '--expose-gc',
            ...process.env['ZIBRI_BENCHMARK_CPU_PROFILE'] === '1' ? ['--cpu-prof', `--cpu-prof-dir=${cpuProfileFolder}`] : []
        ],
        stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
        env: { ...env, [BACKUP_MEASUREMENT_CONFIG_ENV]: JsonUtilities.stringify(config) }
    });
    try {
        const result: BackupMeasurementResult = await new Promise<BackupMeasurementResult>((resolve, reject) => {
            child.once('message', message => isMeasurementResult(message)
                ? resolve(message)
                : reject(new Error(`The measured process sent ${JsonUtilities.stringify(message)}.`)));
            child.once('exit', code => reject(
                new Error(`The measured process for "${config.name}" exited with ${code} before it reported.`)
            ));
        });
        if ('error' in result) {
            throw new Error(`The measurement "${config.name}" failed:\n${result.error}`);
        }
        return result.measurement;
    }
    finally {
        // a moment to exit by itself, as it does once it reported, before it is ended
        if (child.exitCode == undefined) {
            await Promise.race([
                new Promise(resolve => child.once('exit', resolve)),
                wait(CHILD_EXIT_WITHIN_MS, undefined, { ref: false })
            ]);
        }
        child.kill();
    }
}

/**
 * Every phase of a measurement: its backups, its restore and its garbage collection.
 * @param measurement - The measurement.
 * @returns The phases.
 */
function phasesOf(measurement: BackupMeasurement): PhaseMeasurement[] {
    return [...measurement.backups, measurement.restore, measurement.garbageCollection];
}

/**
 * The middle of some numbers.
 * @param values - The numbers.
 * @returns Their median.
 */
function medianOf(values: number[]): number {
    const sorted: number[] = [...values].sort((a, b) => a - b);
    const middle: number = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[middle] ?? Number.NaN : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/**
 * How much data a scenario starts with.
 * @param scenario - The scenario.
 * @returns The bytes of all its resources.
 */
function dataBytesOf(scenario: BackupScenario): number {
    return scenario.config.resources.reduce((sum, r) => sum + r.bytes, 0);
}

/**
 * The measurements of each series, from the least data to the most.
 * @param taken - Every measurement.
 * @returns The series, by name.
 */
function resolveSeries(taken: TakenMeasurement[]): Map<string, TakenMeasurement[]> {
    const series: Map<string, TakenMeasurement[]> = new Map();
    for (const t of taken) {
        if (t.scenario.series != undefined) {
            series.set(t.scenario.series, [...series.get(t.scenario.series) ?? [], t]);
        }
    }
    for (const measurements of series.values()) {
        measurements.sort((a, b) => dataBytesOf(a.scenario) - dataBytesOf(b.scenario));
    }
    return series;
}

/**
 * Where a measurement takes longer or stores more than the measurement of the same size it is compared
 * with: its backups, its restore, and what the transport holds after them.
 * @param t - The measurement.
 * @param taken - Every measurement.
 * @returns One line per difference, none for a measurement compared with nothing.
 */
function findComparedViolations(t: TakenMeasurement, taken: TakenMeasurement[]): string[] {
    const against: string | undefined = t.scenario.comparedWith;
    if (against == undefined) {
        return [];
    }
    const reference: TakenMeasurement | undefined = taken.find(
        r => r.scenario.series === against && dataBytesOf(r.scenario) === dataBytesOf(t.scenario)
    );
    if (reference == undefined) {
        return [`${t.measurement.name}: nothing of "${against}" was measured at its size`];
    }
    const figures: [string, (m: BackupMeasurement) => number][] = [
        ['backup', m => medianOf(m.backups.map(b => b.durationMs))],
        ['restore', m => m.restore.durationMs],
        ['stored bytes', m => m.bytesStored]
    ];
    return figures.flatMap(([figure, read]) => {
        const ratio: number = read(t.measurement) / read(reference.measurement);
        return ratio <= COMPARED_SLACK_RATIO
            ? []
            : [`${t.measurement.name}: ${figure} ${ratio.toFixed(2)}x of ${reference.measurement.name}, at most ${COMPARED_SLACK_RATIO}x`];
    });
}

/**
 * The figures of a measurement that are compared with the release, beside its timings.
 * @param measurement - The measurement.
 * @returns Peak memory and CPU time, of its backups, of its restore and of its garbage collection.
 */
function toFigures(measurement: BackupMeasurement): BenchmarkFigure[] {
    const cpuOf: (phase: PhaseMeasurement) => number = phase => phase.cpuUserMs + phase.cpuSystemMs;
    return [
        {
            name: `peak memory of garbage collection of ${measurement.name}`,
            value: measurement.garbageCollection.peakRssGrowthBytes,
            unit: 'bytes'
        },
        { name: `CPU of garbage collection of ${measurement.name}`, value: cpuOf(measurement.garbageCollection), unit: 'ms' },
        {
            name: `peak memory of backup of ${measurement.name}`,
            value: Math.max(...measurement.backups.map(b => b.peakRssGrowthBytes)),
            unit: 'bytes'
        },
        { name: `peak memory of restore of ${measurement.name}`, value: measurement.restore.peakRssGrowthBytes, unit: 'bytes' },
        { name: `CPU of backup of ${measurement.name}`, value: medianOf(measurement.backups.map(cpuOf)), unit: 'ms' },
        { name: `CPU of restore of ${measurement.name}`, value: cpuOf(measurement.restore), unit: 'ms' },
        ...toServerFigures(measurement)
    ];
}

/**
 * The figures of what the Valkey servers of a measurement did for everyone else: the slowest answer
 * another client got, and the most memory they used, during its backups and during its restore.
 * @param measurement - The measurement.
 * @returns The figures, none without a Valkey resource.
 */
function toServerFigures(measurement: BackupMeasurement): BenchmarkFigure[] {
    const backups: ValKeyServerMeasurement[] = measurement.backups.flatMap(b => b.server == undefined ? [] : [b.server]);
    const restore: ValKeyServerMeasurement | undefined = measurement.restore.server;
    if (!backups.length || restore == undefined) {
        return [];
    }
    return [
        {
            name: `slowest Valkey answer during backup of ${measurement.name}`,
            value: Math.max(...backups.map(s => s.slowestAnswerMs)),
            unit: 'ms'
        },
        { name: `slowest Valkey answer during restore of ${measurement.name}`, value: restore.slowestAnswerMs, unit: 'ms' },
        {
            name: `peak Valkey memory of backup of ${measurement.name}`,
            value: Math.max(...backups.map(s => s.peakUsedMemoryGrowthBytes)),
            unit: 'bytes'
        },
        { name: `peak Valkey memory of restore of ${measurement.name}`, value: restore.peakUsedMemoryGrowthBytes, unit: 'bytes' }
    ];
}

/**
 * The printed line for what the Valkey servers of a measurement did for everyone else, per phase: the
 * slowest answer another client got, of how many, and the most memory they used above the start.
 * @param measurement - The measurement.
 * @returns The line, undefined without a Valkey resource.
 */
function describeServerMeasurement(measurement: BackupMeasurement): string | undefined {
    const mb: (bytes: number) => string = bytes => `${(bytes / MIB).toFixed(1)} MiB`;
    const backups: ValKeyServerMeasurement[] = measurement.backups.flatMap(b => b.server == undefined ? [] : [b.server]);
    const restore: ValKeyServerMeasurement | undefined = measurement.restore.server;
    if (!backups.length || restore == undefined) {
        return undefined;
    }
    const describePhase: (phase: string, servers: ValKeyServerMeasurement[]) => string = (phase, servers) => `${phase} slowest answer `
        + `${Math.max(...servers.map(s => s.slowestAnswerMs)).toFixed(0)} ms `
        + `of ${Math.min(...servers.map(s => s.answers))}, used_memory +${mb(Math.max(...servers.map(s => s.peakUsedMemoryGrowthBytes)))}`;
    return `${''.padEnd(36)}valkey for others:  ${describePhase('backup', backups)}  | ${describePhase('restore', [restore])}`;
}

/**
 * The lines of the printed table for one measurement: its totals, where the time went, and what it held.
 * @param config - What was measured.
 * @param measurement - The measurement.
 * @returns The lines.
 */
function describeMeasurement(config: BackupMeasurementConfig, measurement: BackupMeasurement): string {
    const mb: (bytes: number) => string = bytes => `${(bytes / MIB).toFixed(1)} MiB`;
    const ms: (value: number) => string = value => `${value.toFixed(0)} ms`;
    const backups: BackupMeasurement['backups'] = measurement.backups;
    const median: (read: (b: BackupMeasurement['backups'][number]) => number) => number = read => medianOf(backups.map(read));
    const restore: BackupMeasurement['restore'] = measurement.restore;
    return [
        [
            measurement.name.padEnd(36),
            `backup ${ms(median(b => b.durationMs))}`.padStart(18),
            `restore ${ms(restore.durationMs)}`.padStart(18),
            `peak rss +${mb(Math.max(...phasesOf(measurement).map(p => p.peakRssGrowthBytes)))}`.padStart(24),
            `max rss ${mb(measurement.maxRssBytes)}`.padStart(20),
            `staging ${mb(Math.max(...phasesOf(measurement).map(p => p.peakStagingBytes)))}`.padStart(22),
            `stored ${mb(measurement.bytesStored)}`.padStart(20)
        ].join(''),
        [
            ''.padEnd(36),
            `source alone ${ms(measurement.sourceReadMs)}`,
            `read ${ms(median(b => b.resourceReadMs))}`,
            `store ${ms(median(b => b.transport.callDurationsMs['put'] ?? 0))}`,
            `record ${ms(median(b => b.transport.callDurationsMs['putRecord'] ?? 0))}`,
            `cpu ${ms(median(b => b.cpuUserMs + b.cpuSystemMs))}`,
            '| restore:',
            `fetch ${ms(restore.transport.callDurationsMs['get'] ?? 0)}`,
            `snapshot ${ms(restore.snapshotReadMs)}`,
            `apply ${ms(restore.applyMs)}`,
            `cpu ${ms(restore.cpuUserMs + restore.cpuSystemMs)}`,
            '| garbage collection:',
            `${ms(measurement.garbageCollection.durationMs)}`,
            ...measurement.garbageCollection.bytesStoredAfter == undefined
                ? []
                : [`left ${mb(measurement.garbageCollection.bytesStoredAfter)}`]
        ].join('  '),
        // what the suite spends that no backup does
        [
            ''.padEnd(36),
            'harness:',
            `load ${ms(measurement.harness.loadMs)}`,
            `boot ${ms(measurement.harness.bootMs)}`,
            `fill ${ms(measurement.harness.fillMs)}`,
            `changes ${ms(measurement.harness.changesMs)}`,
            `fingerprints ${ms(measurement.harness.fingerprintMs)}`,
            `shutdown ${ms(measurement.harness.shutdownMs)}`
        ].join('  '),
        ...measurement.live == undefined ? [] : [describeLiveMeasurement(config, measurement.live)],
        ...[describeServerMeasurement(measurement)].filter(line => line != undefined)
    ].join('\n');
}

/**
 * The printed line for what a measurement held after a collection, per phase, of what it is designed
 * to hold at most, and in how many readings.
 * @param config - What was measured.
 * @param live - The live phases.
 * @returns The line.
 */
function describeLiveMeasurement(config: BackupMeasurementConfig, live: LiveMeasurement): string {
    const mb: (bytes: number) => string = bytes => `${(bytes / MIB).toFixed(1)} MiB`;
    const describePhase: (phase: keyof LiveMeasurement) => string = phase => `${phase} held +${mb(live[phase].peakHeldGrowthBytes)} `
        + `of at most +${mb(resolveHeldLimit(config, phase))}, `
        + `${live[phase].readings} readings every ${live[phase].intervalInMs} ms`;
    return `${''.padEnd(36)}after a collection:  ${describePhase('backup')}  | ${describePhase('restore')}`;
}

/**
 * What backups cost: time, memory, staging disk, and what reaches the transport.
 *
 * Each measurement runs in a process of its own (`backup-measurement.entry.ts`). Three kinds of check:
 * - **Against the design**, as each measurement is taken, so that the first scenario off it ends the
 *   suite: what each phase holds after a collection, what the staging folder and the transport are
 *   handed, the calls the transport gets, and that the restore brings back exactly what the backup held.
 * - **Shape**, once every scenario was taken: within a series, duration grows at most linearly with
 *   the data.
 * - **Durations, peak memory and CPU**, against the release: written to the benchmark reports, which
 *   `npm run test:benchmark:compare` fails on as it does every other benchmark. They depend on the
 *   machine, so no design states them.
 * @param options - What the suite measures.
 */
export function describeBackupCosts(options: BackupBenchmarkOptions): void {
    const outputFolder: FsPath = FsUtilities.getPath(testFileFolder, `${options.name}-benchmark-${UUIDUtilities.generate()}`);
    const reportPath: FsPath = FsUtilities.getPath(testFileFolder, `${options.name}-benchmark-report.json`);
    const figureReportPath: FsPath = FsUtilities.getPath(testFileFolder, `${options.name}-figures-benchmark-report.json`);
    // every figure of every measurement, for reading where a backup spends its time and memory
    const measurementsPath: FsPath = FsUtilities.getPath(testFileFolder, `${options.name}-measurements.json`);
    const taken: TakenMeasurement[] = [];

    afterAll(async () => {
        await FsUtilities.rm(outputFolder);
    });

    describe('what backups cost', () => {
        it('measures every scenario, each costing what it is designed to', async () => {
            for (const scenario of options.resolveScenarios(outputFolder)) {
                const measurement: BackupMeasurement = await runMeasurement(scenario.config);
                taken.push({ scenario, measurement });
                // eslint-disable-next-line no-console
                console.log(describeMeasurement(scenario.config, measurement));
                // printed and written as each is taken, so that a failure leaves what was measured before it
                await FsUtilities.upsertFile(measurementsPath, JsonUtilities.stringify(taken.map(t => t.measurement), undefined, 4));
                // checked as each is taken rather than once every one was: the first scenario off its
                // design ends the suite minutes before the last scenario would have
                expect(findDesignViolations(scenario.config, measurement)).toStrictEqual([]);
            }
            const measurements: BackupMeasurement[] = taken.map(t => t.measurement);

            const timings: BenchmarkTiming[] = measurements.flatMap(m => [
                {
                    name: `backup of ${m.name}`,
                    medianMs: medianOf(m.backups.map(b => b.durationMs)),
                    p95Ms: Math.max(...m.backups.map(b => b.durationMs))
                },
                { name: `restore of ${m.name}`, medianMs: m.restore.durationMs, p95Ms: m.restore.durationMs },
                { name: `garbage collection of ${m.name}`, medianMs: m.garbageCollection.durationMs, p95Ms: m.garbageCollection.durationMs }
            ]);
            await BenchmarkUtilities.resolveReport(timings, reportPath, options.baselinePath, updateBaseline);
            // compared with the release like the timings: holding more memory or spending more CPU is a
            // backup getting worse as much as taking longer is
            await BenchmarkUtilities.writeFigureReport(measurements.flatMap(toFigures), figureReportPath);
        }, MEASURING_TIMEOUT_IN_MS);

        it('takes at most linearly longer for more data', () => {
            const backupMsOf: (t: TakenMeasurement) => number = t => medianOf(t.measurement.backups.map(b => b.durationMs));
            const slower: string[] = [...resolveSeries(taken).values()].flatMap(series => {
                const smallest: TakenMeasurement | undefined = series[0];
                if (smallest == undefined) {
                    return [];
                }
                return series.slice(1).flatMap(t => {
                    const dataRatio: number = dataBytesOf(t.scenario) / dataBytesOf(smallest.scenario);
                    const ratio: number = backupMsOf(t) / backupMsOf(smallest);
                    return ratio <= dataRatio * LINEAR_SLACK_RATIO
                        ? []
                        : [
                            `${t.measurement.name}: ${ratio.toFixed(1)}x as long as ${smallest.measurement.name}, `
                            + `for ${dataRatio.toFixed(1)}x the data`
                        ];
                });
            });
            expect(slower).toStrictEqual([]);
        });

        it('takes no longer and stores no more than what each measurement is compared with', () => {
            expect(taken.flatMap(t => findComparedViolations(t, taken))).toStrictEqual([]);
        });
    });
}