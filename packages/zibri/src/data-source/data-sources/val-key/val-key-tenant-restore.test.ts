import { Readable } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';

import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';

import { ValKeyDataSource } from './val-key-data-source.model';
import { TestTimeouts } from '../../../__testing__/constants';
import { createTestDataSource } from '../../../__testing__/test-server/create-test-data-source.function';
import { createTestValKeyDataSource } from '../../../__testing__/test-server/create-test-val-key-data-source.function';
import { defaultTestServerProviders } from '../../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { TenantRowsBackupResource } from '../../../backup/tenant-rows.backup-resource';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { defineProvider } from '../../../di/models/di-provider.model';
import { LoggerInterface } from '../../../logging/logger.interface';
import { TenantServiceInterface } from '../../../tenancy/tenant-service.interface';
import { Newable } from '../../../types/newable.type';
import { UUIDUtilities } from '../../../utilities/uuid.utilities';
import { ChangeSet } from '../../change-sets/models/change-set.model';
import { Change } from '../../change-sets/models/change.model';
import { MigrationEntity } from '../../migration/migration-entity.model';
import { Repository } from '../../repository/repository';
import { TENANT_ROWS_ENTITIES, TenantRowsFolder } from '../../tests/tenant-rows.cases';
import { DataSourceInterface } from '../data-source.interface';

/**
 * A restore of a tenant on valkey that takes many times as long as a lock of its transaction lives: what a
 * tenant of many rows does with the hold as it is, thirty seconds, made to happen in a few seconds.
 */

/**
 * How long a lock of a transaction lives before it lapses, unless it is renewed: a renewal every third
 * of it. At 200 ms, a worker of the whole suite was kept from renewing for longer than the two thirds
 * left, while it read the rows it locked, and the locks lapsed.
 */
const HOLD_IN_MS: number = 1000;

/**
 * How many rows the tenant holds.
 */
const FOLDERS: number = 3000;

/**
 * How many parts the backup reaches the restore in, a hold apart: a restore lasting many holds on any
 * machine. Written back as fast as they arrive, 3000 rows took less than one hold.
 */
const PARTS: number = 8;

const postgresDataSourceClass: Newable<DataSourceInterface> = createTestDataSource();

const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource({
    // a customer records its change sets, which are stored beside it
    entities: [MigrationEntity, Change, ChangeSet, ...TENANT_ROWS_ENTITIES]
});

let server: StartedTestServer | undefined;

beforeAll(async () => {
    server = await startTestServer({
        dataSources: [postgresDataSourceClass, valKeyDataSourceClass],
        providers: [
            ...defaultTestServerProviders,
            defineProvider({ token: ZIBRI_DI_TOKENS.VAL_KEY_TRANSACTION_LOCK_HOLD_IN_MS, useValue: HOLD_IN_MS })
        ]
    });
}, TestTimeouts.resolveCombined('postgres', 'valKey').start);

afterAll(async () => {
    jest.restoreAllMocks();
    await server?.shutdown();
}, TestTimeouts.resolveCombined('postgres', 'valKey').shutdown);

async function asTenant<T>(tenantId: string, work: () => Promise<T>): Promise<T> {
    const tenants: TenantServiceInterface = inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
    return await tenants.runAs(tenantId, work);
}

/**
 * Hands over a backup in {@link PARTS} parts of whole lines, waiting a hold after each, as a transport
 * slower than the restore hands over a large one.
 * @param backup - The backup.
 * @yields Its parts.
 */
async function* handOverSlowly(backup: Buffer): AsyncGenerator<Buffer> {
    const lines: string[] = backup.toString('utf8').split(/(?<=\n)/);
    const perPart: number = Math.ceil(lines.length / PARTS);
    for (let i: number = 0; i < lines.length; i += perPart) {
        yield Buffer.from(lines.slice(i, i + perPart).join(''));
        await sleep(HOLD_IN_MS);
    }
}

async function readAll(data: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of data) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
    return Buffer.concat(chunks);
}

describe('a restore of a tenant on valkey that outlasts the hold of its locks', () => {
    it('keeps its locks for as long as it writes, and brings back every row', async () => {
        const tenant: string = UUIDUtilities.generate();
        const folders: Repository<TenantRowsFolder> = inject(repositoryTokenFor(TenantRowsFolder));
        await asTenant(tenant, async () => {
            await folders.createAll(Array.from({ length: FOLDERS }, (_, i) => ({ name: `folder ${i}`, note: `note ${i}`, tags: [] })));
        });
        const backup: Buffer = await readAll(new TenantRowsBackupResource(inject(valKeyDataSourceClass), tenant).createBackupData());
        // rows to replace, which the restore locks as it removes them at its start and holds until it commits:
        // removing none, it would take its locks only as it commits
        await asTenant(tenant, async () => {
            await folders.createAll(Array.from({ length: 100 }, (_, i) => ({ name: `created since ${i}`, note: 'since', tags: [] })));
        });

        const logger: LoggerInterface = inject(ZIBRI_DI_TOKENS.LOGGER);
        const warn: jest.SpiedFunction<LoggerInterface['warn']> = jest.spyOn(logger, 'warn');
        const startedAt: number = performance.now();
        await new TenantRowsBackupResource(inject(valKeyDataSourceClass), tenant).restoreBackup(Readable.from(handOverSlowly(backup)));
        const tookMs: number = performance.now() - startedAt;

        // not vacuous: a restore within one hold would show nothing about one outlasting it
        expect(tookMs).toBeGreaterThan(HOLD_IN_MS * 5);
        // the rows created since gone, every row of the backup back
        expect(await asTenant(tenant, async () => await folders.count())).toBe(FOLDERS);
        // the renewal reports a lock it found gone while the transaction was still working
        expect(warn.mock.calls.map(([message]) => String(message)).filter(message => message.includes('while still working'))).toEqual([]);
    }, 120000);
});