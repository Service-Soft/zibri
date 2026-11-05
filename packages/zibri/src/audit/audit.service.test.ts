import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { AuditCheckpoint } from './audit-checkpoint.model';
import { AuditCollapse } from './audit-collapse.enum';
import { AuditEntry } from './audit-entry.model';
import { type AuditServiceInterface } from './audit-service.interface';
import { TestTimeouts } from '../__testing__/constants';
import { missingEntityPattern } from '../__testing__/missing-entity-pattern.function';
import { JwtTestAuthController } from '../__testing__/mocks/controllers/jwt-test-auth.controller';
import { JwtUser } from '../__testing__/mocks/entities/jwt-user.entity';
import { Roles } from '../__testing__/mocks/entities/roles.enum';
import { runWithApplicationClockAhead } from '../__testing__/run-with-application-clock-ahead.function';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { startAndStopTestServerWithout } from '../__testing__/test-server/start-and-stop-test-server-without.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { PasswordCredentials, PasswordCredentialsCreateData } from '../auth/authenticators/password/password-credentials.model';
import { JwtAuthStrategy } from '../auth/strategies/jwt/jwt.auth-strategy';
import { Repository } from '../data-source/repository/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { defineProvider, DiProvider } from '../di/models/di-provider.model';
import { AuditAction, AuditEvent, AuditOutcome, AuditReason } from '../logging/audit-event.model';
import { type LoggerInterface } from '../logging/logger.interface';
import { MetricsSnapshot } from '../metrics/metrics-snapshot.model';
import { RateLimitStoreFailurePolicy } from '../rate-limiting/limiter/rate-limiter-config.model';
import { TenantServiceInterface } from '../tenancy/tenant-service.interface';
import { JsonUtilities } from '../utilities/json.utilities';
import { Ms } from '../utilities/ms';
import { UUIDUtilities } from '../utilities/uuid.utilities';

const PASSWORD: string = 'correct horse battery staple';
const MAX_REFUSALS_PER_MINUTE: number = 3;
const RETENTION_IN_MS: number = Ms.DAY * 30;
const SEAL_DELAY_IN_MS: number = Ms.MINUTE;

let server: StartedTestServer;
let baseUrl: string;
let auditService: AuditServiceInterface;
let entries: Repository<AuditEntry>;
let tenants: TenantServiceInterface;

/**
 * The providers of the test server, with the audit settings and the log buffer of these cases.
 * @returns The providers.
 */
function providers(): DiProvider<unknown>[] {
    const replaced: unknown[] = [
        ZIBRI_DI_TOKENS.AUDIT_MAX_REFUSALS_PER_MINUTE,
        ZIBRI_DI_TOKENS.AUDIT_RETENTION_IN_MS,
        ZIBRI_DI_TOKENS.AUDIT_SEAL_DELAY_IN_MS,
        ZIBRI_DI_TOKENS.LOGGER_BUFFER_CAPACITY,
        ZIBRI_DI_TOKENS.AUTH_RATE_LIMIT_OPTIONS
    ];
    return [
        ...defaultTestServerProviders.filter(p => !replaced.includes(p.token)),
        defineProvider({ token: ZIBRI_DI_TOKENS.AUDIT_MAX_REFUSALS_PER_MINUTE, useValue: MAX_REFUSALS_PER_MINUTE }),
        defineProvider({ token: ZIBRI_DI_TOKENS.AUDIT_RETENTION_IN_MS, useValue: RETENTION_IN_MS }),
        defineProvider({ token: ZIBRI_DI_TOKENS.AUDIT_SEAL_DELAY_IN_MS, useValue: SEAL_DELAY_IN_MS }),
        // small, so a handful of log lines is enough to make the logger drop entries
        defineProvider({ token: ZIBRI_DI_TOKENS.LOGGER_BUFFER_CAPACITY, useValue: 5 }),
        defineProvider({
            token: ZIBRI_DI_TOKENS.AUTH_RATE_LIMIT_OPTIONS,
            useFactory: () => ({ maxAttempts: 1000, windowInMs: Ms.MINUTE, onStoreFailure: RateLimitStoreFailurePolicy.ALLOW })
        })
    ];
}

/**
 * Records events inside a tenant of its own, which is what tells this case's rows apart from every other.
 * @param tenantId - The tenant to record in.
 * @param recordAll - The calls.
 */
async function recordIn(tenantId: string, recordAll: () => void): Promise<void> {
    await tenants.runAs(tenantId, async () => {
        recordAll();
        await Promise.resolve();
    });
}

/**
 * Finds what the trail holds for a tenant, once everything recorded so far is stored.
 * @param tenantId - The tenant.
 * @returns Its entries.
 */
async function findEntriesOf(tenantId: string): Promise<AuditEntry[]> {
    await auditService.flush();
    return await entries.findAll({ where: { tenantId }, acrossTenants: true });
}

/**
 * Adds up how many attempts the entries stand for.
 * @param of - The entries.
 * @returns The number of attempts.
 */
function countAttempts(of: AuditEntry[]): number {
    return of.reduce((sum, e) => sum + e.count, 0);
}

/**
 * Builds a refused login of the given address.
 * @param subject - The address the attempt named.
 * @returns The event.
 */
function refusedLoginOf(subject: string): AuditEvent {
    return { action: AuditAction.LOGIN, outcome: AuditOutcome.FAILURE, reason: AuditReason.REFUSED, subject };
}

// first, for the reason on startAndStopTestServerWithout
describe('AuditService - at startup', () => {
    it('refuses an application that does not say how long the trail is kept', async () => {
        const start: Promise<void> = startAndStopTestServerWithout([], {
            providers: [
                ...defaultTestServerProviders.filter(p => p.token !== ZIBRI_DI_TOKENS.AUDIT_RETENTION_IN_MS),
                defineProvider({ token: ZIBRI_DI_TOKENS.AUDIT_RETENTION_IN_MS, useValue: undefined })
            ]
        });

        await expect(start).rejects.toThrow('ZIBRI_DI_TOKENS.AUDIT_RETENTION_IN_MS');
    }, TestTimeouts.inMemory.start);

    it('refuses an application whose data sources do not hold the trail, and names it', async () => {
        await expect(startAndStopTestServerWithout([AuditEntry])).rejects.toThrow(missingEntityPattern('AuditEntry', 'AuditService'));
    }, TestTimeouts.inMemory.start);

    it('refuses an application kept with checkpoints whose data sources do not hold them, and names them', async () => {
        await expect(startAndStopTestServerWithout([AuditCheckpoint])).rejects.toThrow(missingEntityPattern('AuditCheckpoint', 'AuditService'));
    }, TestTimeouts.inMemory.start);

    it('refuses an application kept as a chain whose data sources do not hold the chained entries, and names them', async () => {
        const start: Promise<void> = startAndStopTestServerWithout([], {
            providers: [...defaultTestServerProviders, defineProvider({ token: ZIBRI_DI_TOKENS.AUDIT_INTEGRITY, useValue: 'chain' })]
        });

        await expect(start).rejects.toThrow(missingEntityPattern('ChainedAuditEntry', 'AuditService'));
    }, TestTimeouts.inMemory.start);
});

// the trail rode the log pipeline, whose buffer drops the
// least important entry, whose db budget collapses past 1000 a minute, and whose retention is the level's
describe('AuditService', () => {
    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories })],
            authStrategies: [JwtAuthStrategy],
            controllers: [JwtTestAuthController],
            providers: providers(),
            // each case is its own caller, which is what the recorded address is checked against
            security: { trustProxy: true }
        });
        baseUrl = await server.start();
        auditService = inject(ZIBRI_DI_TOKENS.AUDIT_SERVICE);
        entries = inject(repositoryTokenFor(AuditEntry));
        tenants = inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
    }, TestTimeouts.inMemory.start);

    afterEach(() => {
        jest.restoreAllMocks();
    });

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('keeps a success the log buffer dropped', async () => {
        const tenantId: string = UUIDUtilities.generate();
        const logger: LoggerInterface = inject(ZIBRI_DI_TOKENS.LOGGER);

        await recordIn(tenantId, () => {
            for (let i: number = 0; i < 6; i++) {
                logger.debug(`noise ${i}`);
            }
            auditService.record({ action: AuditAction.ROLE_ASSIGNED, outcome: AuditOutcome.SUCCESS, role: 'admin', subject: 'alice' });
            // more important than the success's info line, so the buffer evicts it to make room
            for (let i: number = 0; i < 20; i++) {
                logger.warn(`flood ${i}`);
            }
        });
        await logger.flush();

        const found: AuditEntry[] = await findEntriesOf(tenantId);
        expect(found.map(e => [e.action, e.outcome, e.role, e.subject, e.count])).toEqual([[AuditAction.ROLE_ASSIGNED, AuditOutcome.SUCCESS, 'admin', 'alice', 1]]);
    });

    it('records each refused login over http with the address it came from, and counts those past the budget per kind', async () => {
        const user: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser)).create({ email: 'stuffed@audit.test', roles: [Roles.USER] });
        const credentials: Repository<PasswordCredentials, PasswordCredentialsCreateData> = inject(repositoryTokenFor(PasswordCredentials));
        await credentials.create({ userId: user.id, password: PASSWORD });

        for (const from of ['203.0.113.1', '203.0.113.1', '203.0.113.1', '203.0.113.1', '203.0.113.2', '203.0.113.2']) {
            const res: Response = await fetch(`${baseUrl}/auth/login`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'x-forwarded-for': from },
                body: JsonUtilities.stringify({ email: user.email, password: 'wrong' })
            });
            expect(res.status).toBe(401);
        }

        await auditService.flush();
        const refused: AuditEntry[] = (await entries.findAll({ where: { subject: user.email }, acrossTenants: true }))
            .filter(e => e.action === AuditAction.LOGIN);
        expect(countAttempts(refused)).toBe(6);
        expect(refused.filter(e => e.collapsed == undefined).map(e => e.clientIp)).toEqual(['203.0.113.1', '203.0.113.1', '203.0.113.1']);
        expect(refused.filter(e => e.collapsed === AuditCollapse.PER_KIND).map(e => [e.clientIp, e.count])).toEqual(expect.arrayContaining([
            ['203.0.113.1', 1],
            ['203.0.113.2', 2]
        ]));
        expect(refused.every(e => e.reason === AuditReason.REFUSED && e.outcome === AuditOutcome.FAILURE)).toBe(true);
    });

    it('never collapses a success, whatever the refusals used up', async () => {
        const tenantId: string = UUIDUtilities.generate();

        await recordIn(tenantId, () => {
            for (let i: number = 0; i < 5; i++) {
                auditService.record(refusedLoginOf('mallory@example.com'));
            }
            for (let i: number = 0; i < 5; i++) {
                auditService.record({ action: AuditAction.LOGIN, outcome: AuditOutcome.SUCCESS, subject: 'alice@example.com', userId: UUIDUtilities.generate() });
            }
        });

        const found: AuditEntry[] = await findEntriesOf(tenantId);
        const successes: AuditEntry[] = found.filter(e => e.outcome === AuditOutcome.SUCCESS);
        expect(successes).toHaveLength(5);
        expect(successes.every(e => e.count === 1 && e.collapsed == undefined)).toBe(true);
        expect(countAttempts(found.filter(e => e.outcome === AuditOutcome.FAILURE))).toBe(5);
    });

    it('counts what is past the first hundred kinds per action and reason, so a run of addresses is never lost', async () => {
        const tenantId: string = UUIDUtilities.generate();
        // a minute of its own, so the cases before it have not used up the budget
        jest.spyOn(Date, 'now').mockReturnValue(Date.now() + (Ms.MINUTE * 2));

        await recordIn(tenantId, () => {
            for (let i: number = 0; i < 1200; i++) {
                auditService.record(refusedLoginOf(`user${i}@example.com`));
            }
        });

        const found: AuditEntry[] = await findEntriesOf(tenantId);
        expect(found.filter(e => e.collapsed == undefined)).toHaveLength(MAX_REFUSALS_PER_MINUTE);
        expect(found.filter(e => e.collapsed === AuditCollapse.PER_KIND)).toHaveLength(100);
        // of no tenant, since it counts the refusals of every tenant
        const past: AuditEntry[] = await entries.findAll({ where: { collapsed: AuditCollapse.PAST_KINDS }, acrossTenants: true });
        expect(countAttempts([...found, ...past])).toBe(1200);
        const expected: unknown[] = [undefined, AuditAction.LOGIN, AuditReason.REFUSED, undefined, 1200 - MAX_REFUSALS_PER_MINUTE - 100];
        expect(past.map(e => [e.tenantId ?? undefined, e.action, e.reason, e.subject, e.count])).toEqual([expected]);
    });

    it('keeps an entry it could not store and stores it on the next attempt, reporting it as pending meanwhile', async () => {
        const tenantId: string = UUIDUtilities.generate();
        const createAll: jest.Spied<typeof entries.createAll> = jest.spyOn(entries, 'createAll')
            .mockRejectedValue(new Error('the data source cannot be reached'));

        await recordIn(tenantId, () => {
            auditService.record({ action: AuditAction.USER_DEACTIVATED, outcome: AuditOutcome.SUCCESS, subject: 'bob' });
        });

        await expect(auditService.flush()).rejects.toThrow('the data source cannot be reached');
        await inject(ZIBRI_DI_TOKENS.METRICS_SERVICE).collect();
        const snapshot: MetricsSnapshot | undefined = inject(ZIBRI_DI_TOKENS.METRICS_SERVICE).getMetricSnapshots()
            .at(-1);
        expect(snapshot?.metrics.find(m => m.name === 'audit_entries_pending')?.value).toBe(1);

        createAll.mockRestore();
        const found: AuditEntry[] = await findEntriesOf(tenantId);
        expect(found.map(e => [e.action, e.subject])).toEqual([[AuditAction.USER_DEACTIVATED, 'bob']]);
    });

    it('deletes the entries of the hours that ended before the retention, and only those', async () => {
        const tenantId: string = UUIDUtilities.generate();
        await runWithApplicationClockAhead(-RETENTION_IN_MS - (Ms.HOUR * 3), async () => {
            await recordIn(tenantId, () => auditService.record({ action: AuditAction.LOGOUT, outcome: AuditOutcome.SUCCESS, subject: 'expired' }));
            await auditService.flush();
        });
        await runWithApplicationClockAhead(-RETENTION_IN_MS - Ms.HOUR, async () => await auditService.writeCheckpoints());
        await runWithApplicationClockAhead(-Ms.HOUR * 2, async () => {
            await recordIn(tenantId, () => auditService.record({ action: AuditAction.LOGOUT, outcome: AuditOutcome.SUCCESS, subject: 'kept' }));
            await auditService.flush();
        });
        await auditService.writeCheckpoints();

        expect(await auditService.deleteExpiredEntries()).toBe(1);

        expect((await findEntriesOf(tenantId)).map(e => e.subject)).toEqual(['kept']);
        expect(await auditService.resolveVerification(tenantId)).toMatchObject({ intact: true, newestSequence: 2 });
    });

    // the five minutes before an entry could be sealed were fixed
    it('seals what was stored up to the delay it is given before it runs', async () => {
        const tenantId: string = UUIDUtilities.generate();
        // past everything the cases before it stored and sealed
        await runWithApplicationClockAhead(Ms.DAY, async () => {
            await recordIn(tenantId, () => auditService.record({ action: AuditAction.LOGOUT, outcome: AuditOutcome.SUCCESS, subject: 'sealed' }));
            await auditService.flush();
        });

        await runWithApplicationClockAhead(Ms.DAY + (SEAL_DELAY_IN_MS * 2), async () => await auditService.writeCheckpoints());

        const sealed: AuditCheckpoint[] = await inject(repositoryTokenFor(AuditCheckpoint)).findAll({ where: { tenantId }, acrossTenants: true });
        expect(sealed.map(c => c.entryCount)).toEqual([1]);
    });
});