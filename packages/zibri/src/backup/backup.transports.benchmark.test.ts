import { afterAll, beforeAll } from '@jest/globals';

import { BackupTransportTestServerUtilities,
    S3TestServerOptions,
    SftpTestServerOptions,
    StartedS3TestServer,
    StartedSftpTestServer } from '../__testing__/backup/backup-transport-test-server.utilities';
import { BackupScenario, describeBackupCosts } from '../__testing__/benchmark/backup/backup-benchmark.cases';
import { resolveSeriesScenarios, resolveSlug } from '../__testing__/benchmark/backup/backup-containers-benchmark.cases';
import { FsUtilities } from '../utilities/fs.utilities';

/**
 * What backups cost through the s3 and sftp transports against real services, with the seeded table
 * of the pipeline's own measurements, so that what is measured beyond the pipeline, which
 * `backup.benchmark.test.ts` measures, is the transport.
 *
 * What the dumps and restores of the data sources cost is measured by `backup.postgres`,
 * `backup.val-key-snapshot` and `backup.val-key-walk`, suites of their own so that the benchmark job
 * compares them on runners of their own.
 *
 * `ZIBRI_BACKUP_CONTAINERS_BENCHMARK_SIZES_MB` sets the ladder of sizes, `10,100` by default.
 */

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
 * Every measurement of the suite.
 * @returns The scenarios.
 */
function resolveScenarios(): BackupScenario[] {
    if (s3 == undefined || sftp == undefined) {
        throw new Error('The s3 and sftp servers did not start.');
    }
    const s3Endpoint: string = s3.endpoint;
    const sftpServer: StartedSftpTestServer = sftp;
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
        },
        {
            name: 'through sftp',
            resource: bytes => ({ kind: 'seeded', bytes }),
            transport: name => ({
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
            })
        }
    ]);
}

describeBackupCosts({
    name: 'backup-transports',
    baselinePath: FsUtilities.getPath(__dirname, 'backup-transports.baseline.json'),
    resolveScenarios
});