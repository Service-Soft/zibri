import { afterAll, beforeAll } from '@jest/globals';

import { BackupTransportTestServerUtilities,
    S3TestServerOptions,
    SftpTestServerOptions,
    StartedS3TestServer,
    StartedSftpTestServer } from '../__testing__/backup/backup-transport-test-server.utilities';
import { BackupScenario, describeBackupCosts, resolveBackupScenario, UNCHANGED } from '../__testing__/benchmark/backup/backup-benchmark.cases';
import { MeasuredResourceConfig, MeasuredTransportConfig } from '../__testing__/benchmark/backup/backup-measurement.model';
import { ChangeProfile } from '../__testing__/benchmark/backup/seeded-table.model';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';

/**
 * What backups cost with real data sources and remote transports, beside what the pipeline itself
 * costs, which `backup.benchmark.test.ts` measures.
 *
 * - **Data sources**: postgres, and valkey in both backup modes, through the fs transport, so that
 *   what is measured beyond the pipeline is the dump and the restore of each.
 * - **Transports**: s3 and sftp, with the seeded table of the pipeline's own measurements, so that
 *   what is measured beyond the pipeline is the transport.
 *
 * The measured process starts the postgres and valkey containers itself, through the test server;
 * the s3 and sftp servers are started here. A dump of postgres is written by the `pg_dump` on PATH.
 *
 * `ZIBRI_BACKUP_CONTAINERS_BENCHMARK_SIZES_MB` sets the ladder of sizes, `10,100` by default.
 */

const MIB: number = 1024 * 1024;

const sizesInMb: number[] = (process.env['ZIBRI_BACKUP_CONTAINERS_BENCHMARK_SIZES_MB'] ?? '10,100').split(',').map(Number);

const s3Options: S3TestServerOptions = {
    bucket: 'backups',
    region: 'us-east-1',
    credentials: { accessKeyId: 'zibri-test', secretAccessKey: 'zibri-test-secret' }
};

const sftpOptions: SftpTestServerOptions = { username: 'zibri', password: 'zibri-test-password', folder: 'backups' };

let s3: StartedS3TestServer | undefined;
let sftp: StartedSftpTestServer | undefined;

beforeAll(async () => {
    [s3, sftp] = await Promise.all([
        BackupTransportTestServerUtilities.startS3(s3Options),
        BackupTransportTestServerUtilities.startSftp(sftpOptions)
    ]);
}, 60000);

afterAll(async () => {
    await Promise.all([s3?.container.stop(), sftp?.container.stop()]);
}, 30000);

/**
 * A name that can be part of a path or a key.
 * @param name - The name of a measurement.
 * @returns The name, with nothing but letters, digits and dashes.
 */
function resolveSlug(name: string): string {
    return name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-');
}

/**
 * Every measurement of the suite.
 * @param outputFolder - Where the fs transport stores into.
 * @returns The scenarios.
 */
function resolveScenarios(outputFolder: FsPath): BackupScenario[] {
    if (s3 == undefined || sftp == undefined) {
        throw new Error('The s3 and sftp servers did not start.');
    }
    const s3Endpoint: string = s3.endpoint;
    const sftpServer: StartedSftpTestServer = sftp;
    // each measurement in a place of its own, since each boots an application that would otherwise
    // find the backups of the one before
    const fs: (name: string) => MeasuredTransportConfig = name => ({ kind: 'fs', path: FsUtilities.getPath(outputFolder, resolveSlug(name)) });
    const throughS3: (name: string) => MeasuredTransportConfig = name => ({
        kind: 's3',
        options: {
            endpoint: s3Endpoint,
            bucket: s3Options.bucket,
            region: s3Options.region,
            credentials: s3Options.credentials,
            serverSideEncryption: 'bucket-default',
            prefix: resolveSlug(name),
            // a container is reached as localhost, where no bucket can be put into the host name
            addressingStyle: 'path'
        }
    });
    const throughSftp: (name: string) => MeasuredTransportConfig = name => ({
        kind: 'sftp',
        options: {
            host: sftpServer.host,
            port: sftpServer.port,
            username: sftpOptions.username,
            authentication: { password: sftpOptions.password },
            hostKeyFingerprint: sftpServer.hostKeyFingerprint,
            // the user is locked into its home folder, where the server was started with this one
            path: `/${sftpOptions.folder}/${resolveSlug(name)}`
        }
    });

    const series: {
        name: string,
        resource: (bytes: number) => MeasuredResourceConfig,
        transport: (name: string) => MeasuredTransportConfig,
        comparedWith?: string,
        changes?: ChangeProfile
    }[] = [
        // the dump uncompressed, as a backup cutting it into chunks takes it, against pg_dump compressing it
        { name: 'of postgres', resource: bytes => ({ kind: 'postgres', compressedDump: false, incrementalRead: false, bytes }), transport: fs, comparedWith: 'of postgres, dump compressed' },
        { name: 'of postgres, dump compressed', resource: bytes => ({ kind: 'postgres', compressedDump: true, incrementalRead: false, bytes }), transport: fs },
        // each backup after the first reads only what changed: designed to produce about what changed. Not
        // compared with the full reads, since a restore applying the changes after the dump takes longer. A run
        // whose backups fall either side of midnight before a Monday, in UTC, reads in full at the second
        // one, as the first backup of a week does
        { name: 'of postgres, incremental', resource: bytes => ({ kind: 'postgres', compressedDump: false, incrementalRead: true, bytes }), transport: fs },
        { name: 'of valkey, snapshot', resource: bytes => ({ kind: 'val-key', backupMode: 'snapshot', restoreMode: 'staged', bytes }), transport: fs },
        { name: 'of valkey, walked', resource: bytes => ({ kind: 'val-key', backupMode: 'walk', restoreMode: 'staged', bytes }), transport: fs },
        // restored in place of what is stored: what the server holds and how long it answers nobody else, against staging
        { name: 'of valkey, walked, restored directly', resource: bytes => ({ kind: 'val-key', backupMode: 'walk', restoreMode: 'direct', bytes }), transport: fs },
        // whether the keys come out in the same order each time, which is all that lets a store that did not
        // change deduplicate: the next backup sends its manifests and its record, and two chunks of slack
        { name: 'of valkey, walked, unchanged', resource: bytes => ({ kind: 'val-key', backupMode: 'walk', restoreMode: 'staged', bytes }), transport: fs, changes: UNCHANGED },
        { name: 'of valkey, snapshot, unchanged', resource: bytes => ({ kind: 'val-key', backupMode: 'snapshot', restoreMode: 'staged', bytes }), transport: fs, changes: UNCHANGED },
        { name: 'through s3', resource: bytes => ({ kind: 'seeded', bytes }), transport: throughS3 },
        { name: 'through sftp', resource: bytes => ({ kind: 'seeded', bytes }), transport: throughSftp }
    ];
    return series.flatMap(s => sizesInMb.map(sizeInMb => {
        const name: string = `${sizeInMb} MB ${s.name}`;
        return resolveBackupScenario({
            name,
            series: s.name,
            resources: [s.resource(sizeInMb * MIB)],
            seed: 1,
            transport: s.transport(name),
            comparedWith: s.comparedWith,
            changes: s.changes
        });
    }));
}

describeBackupCosts({
    name: 'backup-containers',
    baselinePath: FsUtilities.getPath(__dirname, 'backup-containers.baseline.json'),
    resolveScenarios
});