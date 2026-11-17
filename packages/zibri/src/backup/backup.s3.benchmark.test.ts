import { afterAll, beforeAll } from '@jest/globals';

import { BackupTransportTestServerUtilities, S3TestServerOptions, StartedS3TestServer } from '../__testing__/backup/backup-transport-test-server.utilities';
import { BackupScenario, describeBackupCosts } from '../__testing__/benchmark/backup/backup-benchmark.cases';
import { resolveSeriesScenarios, resolveSlug } from '../__testing__/benchmark/backup/backup-containers-benchmark.cases';
import { FsUtilities } from '../utilities/fs.utilities';

/**
 * What backups cost through the s3 transport against a real service, with the seeded table of the
 * pipeline's own measurements, so that what is measured beyond the pipeline, which
 * `backup.benchmark.test.ts` measures, is the transport. The sftp transport is measured by
 * `backup.sftp.benchmark.test.ts`.
 *
 * What the dumps and restores of the data sources cost is measured by the `backup.postgres` and
 * `backup.val-key` suites. Each is a suite of its own so that the benchmark job compares it on a
 * runner of its own.
 *
 * `ZIBRI_BACKUP_CONTAINERS_BENCHMARK_SIZES_MB` sets the ladder of sizes, `10,100` by default.
 */

const s3Options: S3TestServerOptions = {
    bucket: 'backups',
    region: 'us-east-1',
    credentials: { accessKeyId: 'zibri-test', secretAccessKey: 'zibri-test-secret' }
};

let s3: StartedS3TestServer | undefined;

beforeAll(async () => {
    s3 = await BackupTransportTestServerUtilities.startS3(s3Options);
}, 60000);

afterAll(async () => {
    await s3?.container.stop();
}, 30000);

/**
 * Every measurement of the suite.
 * @returns The scenarios.
 */
function resolveScenarios(): BackupScenario[] {
    if (s3 == undefined) {
        throw new Error('The s3 server did not start.');
    }
    const s3Endpoint: string = s3.endpoint;
    // each measurement in a place of its own, since each boots an application that would otherwise
    // find the backups of the one before
    return resolveSeriesScenarios([
        {
            name: 'through s3',
            resource: bytes => ({ kind: 'seeded', bytes }),
            transport: name => ({
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
            })
        }
    ]);
}

describeBackupCosts({
    name: 'backup-s3',
    baselinePath: FsUtilities.getPath(__dirname, 'backup-s3.baseline.json'),
    resolveScenarios
});