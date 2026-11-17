import { afterAll, beforeAll } from '@jest/globals';

import { S3StandIn } from '../__testing__/backup/s3-stand-in.model';
import { APPENDED_DAILY, describeBackupCosts, resolveBackupScenario } from '../__testing__/benchmark/backup/backup-benchmark.cases';
import { testFileFolder } from '../__testing__/constants';
import { FsUtilities } from '../utilities/fs.utilities';
import { UUIDUtilities } from '../utilities/uuid.utilities';

/**
 * What the backup pipeline costs: staging, encryption, the fs transport and the record, and the s3
 * transport against a stand-in for a service.
 *
 * The data is a seeded table rather than a database, so that nothing but the pipeline is measured,
 * and nothing needs a container. What a dump of postgres or valkey costs on top is measured by the
 * `backup.postgres` and `backup.val-key` suites, and what the s3 and sftp transports do against real
 * services by `backup.s3.benchmark.test.ts` and `backup.sftp.benchmark.test.ts`.
 *
 * `ZIBRI_BACKUP_BENCHMARK_SIZES_MB` sets the ladder of sizes, `10,100` by default; locally, such as
 * `10,100,1000,10000`. `ZIBRI_BACKUP_BENCHMARK_CONCURRENT_MB` sets the size of each of the three
 * resources backed up at once, 100 by default. `ZIBRI_BACKUP_BENCHMARK_FORMAT_VERSION=1` writes every
 * scenario in format 1, to tell what the current format costs from what the machine does, run beside
 * one without it.
 */

const MIB: number = 1024 * 1024;

const sizesInMb: number[] = (process.env['ZIBRI_BACKUP_BENCHMARK_SIZES_MB'] ?? '10,100').split(',').map(Number);
const concurrentInMb: number = Number(process.env['ZIBRI_BACKUP_BENCHMARK_CONCURRENT_MB'] ?? '100');

// in this process rather than the measured one, so that what it holds weighs nothing on a measurement
const s3: S3StandIn = new S3StandIn(FsUtilities.getPath(testFileFolder, `s3-stand-in-${UUIDUtilities.generate()}`));

beforeAll(async () => {
    await s3.start();
});

afterAll(async () => {
    await s3.stop();
});

describeBackupCosts({
    name: 'backup',
    baselinePath: FsUtilities.getPath(__dirname, 'backup.baseline.json'),
    resolveScenarios: outputFolder => [
        ...sizesInMb.map(sizeInMb => resolveBackupScenario({
            name: `${sizeInMb} MB`,
            series: 'seeded',
            resources: [{ kind: 'seeded', bytes: sizeInMb * MIB }],
            seed: 1,
            transport: { kind: 'fs', path: FsUtilities.getPath(outputFolder, `${sizeInMb} MB`) }
        })),
        // what deduplicates: a backup after the first stores what was appended and the chunks around its end
        ...sizesInMb.map(sizeInMb => resolveBackupScenario({
            name: `${sizeInMb} MB appended to`,
            series: 'appended to',
            resources: [{ kind: 'seeded', bytes: sizeInMb * MIB }],
            seed: 3,
            transport: { kind: 'fs', path: FsUtilities.getPath(outputFolder, `${sizeInMb} MB appended to`) },
            changes: APPENDED_DAILY
        })),
        resolveBackupScenario({
            name: `3 x ${concurrentInMb} MB at once`,
            series: undefined,
            resources: [0, 1, 2].map(() => ({ kind: 'seeded', bytes: concurrentInMb * MIB })),
            seed: 7,
            transport: { kind: 'fs', path: FsUtilities.getPath(outputFolder, 'concurrent') }
        }),
        ...sizesInMb.map(sizeInMb => resolveBackupScenario({
            name: `${sizeInMb} MB through the s3 stand-in`,
            series: 'through the s3 stand-in',
            resources: [{ kind: 'seeded', bytes: sizeInMb * MIB }],
            seed: 1,
            transport: {
                kind: 's3',
                options: {
                    endpoint: s3.getEndpoint(),
                    bucket: 'backups',
                    region: 'us-east-1',
                    credentials: { accessKeyId: 'stand-in', secretAccessKey: 'stand-in' },
                    serverSideEncryption: 'bucket-default',
                    // each measurement under a prefix of its own, since each boots an application that
                    // would otherwise find the backups of the one before
                    prefix: `measured-${sizeInMb}`,
                    addressingStyle: 'path'
                }
            }
        }))
    ]
});