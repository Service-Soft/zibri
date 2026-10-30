import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../../__testing__/constants';
import { JwtTestAuthController } from '../../__testing__/mocks/controllers/jwt-test-auth.controller';
import { JwtUser } from '../../__testing__/mocks/entities/jwt-user.entity';
import { Roles } from '../../__testing__/mocks/entities/roles.enum';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { waitUntil } from '../../__testing__/wait-until.function';
import { AuditEntry } from '../../audit/audit-entry.model';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider, DiProvider } from '../../di/models/di-provider.model';
import { Email } from '../../email/models/email.model';
import { KnownHeader } from '../../http/known-header.enum';
import { MimeType } from '../../http/mime-type.enum';
import { LeaseOptions } from '../../leases/lease-options.model';
import { LeaseService } from '../../leases/lease.service';
import { AuditAction, AuditOutcome, AuditReason } from '../../logging/audit-event.model';
import { JsonUtilities } from '../../utilities/json.utilities';
import { PasswordResetToken } from '../models/password-reset-token.model';

let releaseReset: () => void = () => undefined;
let resetReleased: Promise<void> = Promise.resolve();
let resetsMade: number = 0;

/**
 * Holds every password reset at its lease until the test lets it go, and counts the ones made.
 */
class HeldResetLeaseService extends LeaseService {
    override async withLease<T>(options: LeaseOptions, fn: (lost: AbortSignal) => Promise<T>): Promise<T | undefined> {
        if (!options.key.startsWith('password-reset:')) {
            return await super.withLease(options, fn);
        }
        await resetReleased;
        const result: T | undefined = await super.withLease(options, fn);
        resetsMade++;
        return result;
    }
}

/**
 * Holds the next password resets until `releaseReset` is called.
 */
function holdResets(): void {
    resetReleased = new Promise<void>(resolve => {
        releaseReset = resolve;
    });
}

const providers: DiProvider<unknown>[] = [
    ...defaultTestServerProviders,
    defineProvider({ token: ZIBRI_DI_TOKENS.LEASE_SERVICE, useClass: HeldResetLeaseService })
];

// one for both servers of the file, each starting with its own store
const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities,
    repositories: defaultTestServerRepositories
});

/**
 * Starts an application logging in with passwords, on an in-memory data source.
 * @returns The started server and where it is reachable.
 */
async function startServer(): Promise<{ server: StartedTestServer, baseUrl: string }> {
    const server: StartedTestServer = await startTestServer({
        dataSources: [dataSourceClass],
        controllers: [JwtTestAuthController],
        providers
    });
    const baseUrl: string = await server.start();
    return { server, baseUrl };
}

/**
 * Asks for a password reset link over http.
 * @param baseUrl - Where the server is reachable.
 * @param email - The address to send the link to.
 * @returns The status of the answer.
 */
async function requestReset(baseUrl: string, email: string): Promise<number> {
    const res: Response = await fetch(`${baseUrl}/auth/request-password-reset`, {
        method: 'POST',
        headers: { [KnownHeader.CONTENT_TYPE]: MimeType.JSON },
        body: JsonUtilities.stringify({ email })
    });
    return res.status;
}

/**
 * The password reset requests the audit trail holds for an address.
 * @param email - The address asked about.
 * @returns The entries.
 */
async function findResetEntries(email: string): Promise<AuditEntry[]> {
    await inject(ZIBRI_DI_TOKENS.AUDIT_SERVICE).flush();
    return await inject(repositoryTokenFor(AuditEntry)).findAll({
        where: { action: AuditAction.PASSWORD_RESET_REQUESTED, subject: email },
        acrossTenants: true
    });
}

describe('POST /auth/request-password-reset', () => {
    let server: StartedTestServer;
    let baseUrl: string;

    beforeAll(async () => {
        ({ server, baseUrl } = await startServer());
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        releaseReset();
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('answers before the link is made, so a registered address takes as long as an unknown one', async () => {
        const email: string = 'ada@reset-answer.example.com';
        const user: JwtUser = await inject(repositoryTokenFor(JwtUser)).create({ email, roles: [Roles.USER] });
        holdResets();

        // answered while the reset is still held: what a registered address costs beyond the lookup
        // an unknown one costs as well is no longer part of the answer
        expect(await requestReset(baseUrl, email)).toBe(204);
        expect(await inject(repositoryTokenFor(PasswordResetToken)).findAll({ where: { userId: user.id } })).toHaveLength(0);

        releaseReset();
        await waitUntil(async () => (await findResetEntries(email)).length === 1);
        expect(await inject(repositoryTokenFor(PasswordResetToken)).findAll({ where: { userId: user.id } })).toHaveLength(1);
        expect(await inject(repositoryTokenFor(Email)).findAll({ where: { recipients: { includes: [email] } } })).toHaveLength(1);
        expect(await findResetEntries(email)).toMatchObject([{ outcome: AuditOutcome.SUCCESS, userId: user.id }]);
    });

    it('records an unknown address once the request is answered', async () => {
        const email: string = 'nobody@reset-answer.example.com';

        expect(await requestReset(baseUrl, email)).toBe(204);

        await waitUntil(async () => (await findResetEntries(email)).length === 1);
        expect(await findResetEntries(email)).toMatchObject([{ outcome: AuditOutcome.FAILURE, reason: AuditReason.NO_SUCH_SUBJECT }]);
    });

    it('makes one link for two requests in a row', async () => {
        const email: string = 'grace@reset-answer.example.com';
        const user: JwtUser = await inject(repositoryTokenFor(JwtUser)).create({ email, roles: [Roles.USER] });
        holdResets();

        // both answered before either reset ran, so neither found the other's link yet
        expect(await requestReset(baseUrl, email)).toBe(204);
        expect(await requestReset(baseUrl, email)).toBe(204);
        releaseReset();

        await waitUntil(async () => (await findResetEntries(email)).length === 2);
        expect(await inject(repositoryTokenFor(PasswordResetToken)).findAll({ where: { userId: user.id } })).toHaveLength(1);
        expect(await inject(repositoryTokenFor(Email)).findAll({ where: { recipients: { includes: [email] } } })).toHaveLength(1);
    });
});

describe('POST /auth/request-password-reset — shutting down', () => {
    it('waits for a reset that is still being made', async () => {
        const { server, baseUrl } = await startServer();
        const email: string = 'ada@reset-shutdown.example.com';
        await inject(repositoryTokenFor(JwtUser)).create({ email, roles: [Roles.USER] });
        resetsMade = 0;
        holdResets();
        expect(await requestReset(baseUrl, email)).toBe(204);

        let shutDown: boolean = false;
        const shutdown: Promise<void> = (async () => {
            await server.shutdown();
            shutDown = true;
        })();
        await new Promise(resolve => setTimeout(resolve, 200));
        expect(shutDown).toBe(false);

        releaseReset();
        await shutdown;
        expect(resetsMade).toBe(1);
    }, TestTimeouts.inMemory.start + TestTimeouts.inMemory.shutdown);
});