import { Readable } from 'node:stream';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { TenantRowsBackupResource } from './tenant-rows.backup-resource';
import { BenchmarkTiming } from '../__testing__/benchmark/benchmark-timing.model';
import { BenchmarkUtilities } from '../__testing__/benchmark/benchmark.utilities';
import { testFileFolder, TestTimeouts } from '../__testing__/constants';
import { createTestDataSource, defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { SoftDeleteRepository } from '../data-source/change-sets/soft-delete-repository';
import { PostgresDataSource } from '../data-source/data-sources/postgres/postgres-data-source.model';
import { TENANT_ROWS_ENTITIES, TenantRowsCustomer, TenantRowsInvoice } from '../data-source/tests/tenant-rows.cases';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { Newable } from '../types/newable.type';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';
import { UUIDUtilities } from '../utilities/uuid.utilities';

/**
 * What a restore of a tenant's rows costs when rows outside the backup point at some of them: those are
 * written over in place, and the backup is read once more to find them, against a restore that deletes
 * every row and writes it again. Customers, of which a share is pointed at by an append-only invoice.
 *
 * Nothing here fails on the numbers - see `BenchmarkUtilities`.
 *
 * `npm run test:benchmark` runs it. Setting `ZIBRI_BENCHMARK_UPDATE_BASELINE=1` makes the run the new
 * baseline of this machine; the file is not committed. `npm run test:benchmark:compare` sets it against
 * the release instead, which is what CI fails a slower operation on.
 */

/**
 * How many customers a tenant holds, and how often a restore of that many is timed.
 */
const SIZES: { customers: number, runs: number }[] = [
    { customers: 1000, runs: 10 },
    { customers: 10_000, runs: 3 }
];

/**
 * Which share of the customers an invoice points at.
 */
const REFERENCED_SHARES: number[] = [0, 0.1, 1];

/**
 * How many rows are created in one call while the tenants are filled.
 */
const ROWS_PER_CREATE: number = 500;

const baselinePath: FsPath = FsUtilities.getPath(__dirname, 'tenant-rows.backup-resource.baseline.json');

const reportPath: FsPath = FsUtilities.getPath(testFileFolder, 'tenant-rows.backup-resource.benchmark-report.json');

const dataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [...defaultTestServerEntities, ...TENANT_ROWS_ENTITIES],
    repositories: defaultTestServerRepositories
});

let server: StartedTestServer | undefined;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
}, TestTimeouts.postgres.start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.postgres.shutdown);

/**
 * Fills a new tenant with customers, an invoice pointing at the given share of them.
 * @param customers - How many customers.
 * @param referencedShare - The share of them an invoice points at.
 * @returns The tenant.
 */
async function fillTenant(customers: number, referencedShare: number): Promise<string> {
    const tenantId: string = UUIDUtilities.generate();
    await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(tenantId, async () => {
        const repository: SoftDeleteRepository<TenantRowsCustomer> = inject(dataSourceClass).getRepository(TenantRowsCustomer);
        const referenced: number = Math.round(customers * referencedShare);
        for (let start: number = 0; start < customers; start += ROWS_PER_CREATE) {
            const created: TenantRowsCustomer[] = await repository.createAll(Array.from({ length: Math.min(ROWS_PER_CREATE, customers - start) }, (_, i) => ({
                name: `customer ${start + i}`,
                email: `customer-${start + i}@example.com`,
                number: start + i,
                joinedAt: new Date(Date.UTC(2026, 0, 1) + start + i)
            })));
            const pointedAt: TenantRowsCustomer[] = created.slice(0, Math.max(0, Math.min(created.length, referenced - start)));
            if (pointedAt.length) {
                await inject(dataSourceClass).getRepository(TenantRowsInvoice)
                    .createAll(pointedAt.map(c => ({ amount: 10, customerId: c.id })));
            }
        }
    });
    return tenantId;
}

async function readAll(data: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of data) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
    return Buffer.concat(chunks);
}

describe('restoring the rows of a tenant', () => {
    it('measures a restore with a share of its rows pointed at from outside the backup', async () => {
        const timings: BenchmarkTiming[] = [];
        for (const { customers, runs } of SIZES) {
            for (const share of REFERENCED_SHARES) {
                const tenantId: string = await fillTenant(customers, share);
                const resource: TenantRowsBackupResource = new TenantRowsBackupResource(inject(dataSourceClass), tenantId);
                const backup: Buffer = await readAll(resource.createBackupData());
                timings.push(await BenchmarkUtilities.resolveTiming(
                    `restore of ${customers} rows, ${share * 100}% pointed at from outside`,
                    runs,
                    async () => await resource.restoreBackup(Readable.from([backup]), () => Readable.from([backup]))
                ));
                // not vacuous: every customer is still there, pointed at or not
                const held: number = await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(tenantId, async () => await inject(dataSourceClass)
                    .getRepository(TenantRowsCustomer)
                    .count());
                expect(held).toBe(customers);
            }
        }

        const report: string = await BenchmarkUtilities.resolveReport(
            timings,
            reportPath,
            baselinePath,
            process.env['ZIBRI_BENCHMARK_UPDATE_BASELINE'] === '1'
        );
        process.stdout.write(`\n${report}\n\n`);

        expect(timings.every(t => Number.isFinite(t.medianMs) && Number.isFinite(t.p95Ms))).toBe(true);
    }, 1_800_000);
});