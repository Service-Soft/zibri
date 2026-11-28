import { afterAll, beforeAll } from '@jest/globals';

import { BackupScenario, describeBackupCosts } from '../__testing__/benchmark/backup/backup-benchmark.cases';
import { resolveSeriesScenarios, resolveSlug } from '../__testing__/benchmark/backup/backup-containers-benchmark.cases';
import { StartedWebDavTestServer, WebDavTestServerUtilities } from '../__testing__/web-dav/web-dav-test-server.utilities';
import { FsUtilities } from '../utilities/fs.utilities';
import { Ms } from '../utilities/ms';

/**
 * What backups cost through the WebDAV transport against a real server, Apache's mod_dav, with the seeded table of
 * the pipeline's own measurements, so that what is measured beyond the pipeline, which `backup.benchmark.test.ts`
 * measures, is the transport. The s3 and sftp transports are measured by `backup.s3.benchmark.test.ts` and
 * `backup.sftp.benchmark.test.ts`.
 *
 * `ZIBRI_BACKUP_CONTAINERS_BENCHMARK_SIZES_MB` sets the ladder of sizes, `10,100` by default.
 */

let webDav: StartedWebDavTestServer | undefined;

beforeAll(async () => {
    webDav = await WebDavTestServerUtilities.startApache({ username: 'zibri', password: 'zibri-test-password' });
}, 60000);

afterAll(async () => {
    await webDav?.container.stop();
}, 30000);

/**
 * Every measurement of the suite.
 * @returns The scenarios.
 */
function resolveScenarios(): BackupScenario[] {
    if (webDav == undefined) {
        throw new Error('The WebDAV server did not start.');
    }
    const server: StartedWebDavTestServer = webDav;
    // each measurement in a place of its own, since each boots an application that would otherwise
    // find the backups of the one before
    return resolveSeriesScenarios([
        {
            name: 'through web-dav',
            resource: bytes => ({ kind: 'seeded', bytes }),
            transport: name => ({
                kind: 'web-dav',
                options: { connection: server.connection, folder: `backups/${resolveSlug(name)}`, timeoutInMs: Ms.MINUTE * 5 }
            })
        }
    ]);
}

describeBackupCosts({
    name: 'backup-web-dav',
    baselinePath: FsUtilities.getPath(__dirname, 'backup-web-dav.baseline.json'),
    resolveScenarios
});
