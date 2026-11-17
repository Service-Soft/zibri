import { afterAll, beforeAll } from '@jest/globals';

import { BackupTransportTestServerUtilities, SftpTestServerOptions, StartedSftpTestServer } from '../__testing__/backup/backup-transport-test-server.utilities';
import { BackupScenario, describeBackupCosts } from '../__testing__/benchmark/backup/backup-benchmark.cases';
import { resolveSeriesScenarios, resolveSlug } from '../__testing__/benchmark/backup/backup-containers-benchmark.cases';
import { FsUtilities } from '../utilities/fs.utilities';

/**
 * What backups cost through the sftp transport against a real server, with the seeded table of the
 * pipeline's own measurements, so that what is measured beyond the pipeline, which
 * `backup.benchmark.test.ts` measures, is the transport. The s3 transport is measured by
 * `backup.s3.benchmark.test.ts`.
 *
 * `ZIBRI_BACKUP_CONTAINERS_BENCHMARK_SIZES_MB` sets the ladder of sizes, `10,100` by default.
 */

const sftpOptions: SftpTestServerOptions = { username: 'zibri', password: 'zibri-test-password', folder: 'backups' };

let sftp: StartedSftpTestServer | undefined;

beforeAll(async () => {
    sftp = await BackupTransportTestServerUtilities.startSftp(sftpOptions);
}, 60000);

afterAll(async () => {
    await sftp?.container.stop();
}, 30000);

/**
 * Every measurement of the suite.
 * @returns The scenarios.
 */
function resolveScenarios(): BackupScenario[] {
    if (sftp == undefined) {
        throw new Error('The sftp server did not start.');
    }
    const sftpServer: StartedSftpTestServer = sftp;
    // each measurement in a place of its own, since each boots an application that would otherwise
    // find the backups of the one before
    return resolveSeriesScenarios([
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
    name: 'backup-sftp',
    baselinePath: FsUtilities.getPath(__dirname, 'backup-sftp.baseline.json'),
    resolveScenarios
});