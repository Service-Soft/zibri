import { afterAll, afterEach, beforeAll, describe, expect, it, vi, MockInstance } from 'vitest';
import { createInMemoryDataSource } from 'zibri-testing';

import { LoggerTransport } from './logger-transport.model.ts';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { waitUntil } from '../../__testing__/wait-until.function.ts';
import { Repository } from '../../data-source/repository/repository.ts';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../di/inject.function.ts';
import { TenantServiceInterface } from '../../tenancy/tenant-service.interface.ts';
import { Ms } from '../../utilities/ms.ts';
import { UUIDUtilities } from '../../utilities/uuid.utilities.ts';
import { AuditAction, AuditEvent, AuditOutcome, AuditReason } from '../audit-event.model.ts';
import { LogLevel } from '../log-level.enum.ts';
import { Log } from '../log.model.ts';
import { Logger } from '../logger.ts';

let server: StartedTestServer;
let tenants: TenantServiceInterface;
let logs: Repository<Log>;

/**
 * Builds a logger writing to the data source of the running application through one db transport.
 * @param maxEntriesPerMinute - The transport's budget, or undefined for its default.
 * @param flushIntervalMs - How long entries gather before a write.
 * @returns The logger.
 */
function loggerWith(maxEntriesPerMinute: number | undefined, flushIntervalMs: number = Ms.SECOND): Logger {
    const cleanupAfterMs: Record<LogLevel, number> = {
        [LogLevel.DEBUG]: Ms.DAY,
        [LogLevel.INFO]: Ms.DAY,
        [LogLevel.WARN]: Ms.DAY,
        [LogLevel.ERROR]: Ms.DAY,
        [LogLevel.CRITICAL]: Ms.DAY
    };
    return new Logger([LoggerTransport.db(LogLevel.INFO, { maxEntriesPerMinute })], cleanupAfterMs, 10000, flushIntervalMs);
}

/**
 * Logs inside a tenant of its own, which is what tells this case's rows apart from every other.
 * @param tenantId - The tenant to log in.
 * @param logAll - The log calls.
 */
async function logIn(tenantId: string, logAll: () => void): Promise<void> {
    await tenants.runAs(tenantId, async () => {
        logAll();
        await Promise.resolve();
    });
}

/**
 * Finds the rows written in a tenant.
 * @param tenantId - The tenant.
 * @returns Its rows, oldest first.
 */
async function findRowsOf(tenantId: string): Promise<Log[]> {
    const rows: Log[] = await logs.findAll({ where: { tenantId }, acrossTenants: true });
    return [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

/**
 * Builds a refused login of the given address.
 * @param subject - The address the attempt named.
 * @returns The event.
 */
function refusedLoginOf(subject: string): AuditEvent {
    return { action: AuditAction.LOGIN, outcome: AuditOutcome.FAILURE, reason: AuditReason.REFUSED, subject };
}

// evaluation/03-auth-and-security G3: the db transport wrote whatever arrived, so a caller could fill
// the log table at request rate - an error row per bad input, an audit row per refused login
describe('the db logger transport\'s budget', () => {
    beforeAll(async () => {
        server = await startTestServer({ dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities })] });
        tenants = inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
        logs = inject(repositoryTokenFor(Log));
    }, 30000);

    afterEach(() => {
        vi.restoreAllMocks();
    });

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    it('writes each entry as its own row while the minute\'s budget lasts, and one counted row per kind past it', async () => {
        const tenantId: string = UUIDUtilities.generate();
        const logger: Logger = loggerWith(2);

        await logIn(tenantId, () => {
            logger.info('started');
            logger.info('listening');
        });
        await logger.flush();
        await logIn(tenantId, () => {
            for (let i: number = 0; i < 5; i++) {
                logger.audit(refusedLoginOf('alice@example.com'));
            }
            logger.audit(refusedLoginOf('bob@example.com'));
            logger.audit(refusedLoginOf('bob@example.com'));
        });
        await logger.flush();

        const rows: Log[] = await findRowsOf(tenantId);
        expect(rows.map(r => [r.message, r.context.collapsed?.count])).toEqual([
            ['started', undefined],
            ['listening', undefined],
            ['auth.login failure (refused)', 5],
            ['auth.login failure (refused)', 2]
        ]);
        // the first entry of each kind stands for the rest, so what a rule keys on is still there
        expect(rows[2]?.context.metadata?.['audit']).toEqual(refusedLoginOf('alice@example.com'));
        expect(rows[3]?.context.metadata?.['audit']).toEqual(refusedLoginOf('bob@example.com'));
        expect(rows[2]?.context.collapsed?.lastAt.getTime()).toBeGreaterThanOrEqual(rows[2]?.createdAt.getTime() ?? Infinity);
    });

    it('gives what is left of the budget to the more important entries of a batch', async () => {
        const tenantId: string = UUIDUtilities.generate();
        const logger: Logger = loggerWith(2);

        await logIn(tenantId, () => {
            logger.info('routine 1');
            logger.info('routine 2');
            logger.error(new Error('broken'));
        });
        await logger.flush();

        const rows: Log[] = await findRowsOf(tenantId);
        expect(rows.map(r => [r.message, r.context.collapsed?.count])).toEqual(expect.arrayContaining([
            ['routine 1', undefined],
            ['broken', undefined],
            ['routine 2', 1]
        ]));
        expect(rows).toHaveLength(3);
    });

    it('counts what is past the first hundred kinds in one row per level', async () => {
        const tenantId: string = UUIDUtilities.generate();
        const logger: Logger = loggerWith(1);

        // every message different, which is what input echoed into an error message looks like
        await logIn(tenantId, () => {
            for (let i: number = 0; i < 151; i++) {
                logger.warn(`unexpected token ${i}`);
            }
            for (let i: number = 0; i < 30; i++) {
                logger.info(`unknown route ${i}`);
            }
        });
        await logger.flush();

        const rows: Log[] = await findRowsOf(tenantId);
        expect(rows.filter(r => r.context.collapsed == undefined)).toHaveLength(1);
        expect(rows.filter(r => r.context.collapsed?.count === 1)).toHaveLength(100);
        const overflow: Log[] = await logs.findAll({ where: { message: 'entries past the log budget, beyond the first 100 kinds' }, acrossTenants: true });
        expect(overflow.map(r => [r.level, r.context.collapsed?.count])).toEqual(expect.arrayContaining([
            [LogLevel.WARN, 50],
            [LogLevel.INFO, 30]
        ]));
        expect(overflow).toHaveLength(2);
    });

    it('writes the counted rows when the minute ends, without waiting for another entry', async () => {
        const tenantId: string = UUIDUtilities.generate();
        const start: number = Date.now();
        const now: MockInstance<typeof Date.now> = vi.spyOn(Date, 'now').mockReturnValue(start);
        const logger: Logger = loggerWith(1, 0);

        await logIn(tenantId, () => logger.info('first'));
        await logger.flush();
        // a tenth of a second before the minute is over, so the minute ends while this test waits
        now.mockReturnValue(start + Ms.MINUTE - 100);
        await logIn(tenantId, () => logger.info('second'));
        now.mockRestore();
        await logIn(tenantId, () => logger.info('second'));

        await waitUntil(async () => (await findRowsOf(tenantId)).length === 2);
        expect((await findRowsOf(tenantId)).map(r => [r.message, r.context.collapsed?.count])).toEqual([
            ['first', undefined],
            ['second', 2]
        ]);
    });

    it('starts a new budget when the minute is over', async () => {
        const tenantId: string = UUIDUtilities.generate();
        const start: number = Date.now();
        const now: MockInstance<typeof Date.now> = vi.spyOn(Date, 'now').mockReturnValue(start);
        const logger: Logger = loggerWith(1);

        await logIn(tenantId, () => logger.info('this minute'));
        await logger.flush();
        now.mockReturnValue(start + Ms.MINUTE);
        await logIn(tenantId, () => logger.info('next minute'));
        await logger.flush();

        expect((await findRowsOf(tenantId)).map(r => [r.message, r.context.collapsed?.count])).toEqual([
            ['this minute', undefined],
            ['next minute', undefined]
        ]);
    });

    it('writes a thousand rows a minute unless told otherwise', async () => {
        const tenantId: string = UUIDUtilities.generate();
        const logger: Logger = loggerWith(undefined);

        await logIn(tenantId, () => {
            for (let i: number = 0; i < 1001; i++) {
                logger.info('request');
            }
        });
        await logger.flush();

        const rows: Log[] = await findRowsOf(tenantId);
        expect(rows.filter(r => r.context.collapsed == undefined)).toHaveLength(1000);
        expect(rows.filter(r => r.context.collapsed != undefined).map(r => r.context.collapsed?.count)).toEqual([1]);
    });
});