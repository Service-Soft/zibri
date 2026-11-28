import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { TOTP } from 'otpauth';
import { createInMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../../__testing__/constants';
import { JwtUser } from '../../__testing__/mocks/entities/jwt-user.entity';
import { Roles } from '../../__testing__/mocks/entities/roles.enum';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { waitUntil } from '../../__testing__/wait-until.function';
import { AuditEntry } from '../../audit/audit-entry.model';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { BadRequestError } from '../../error-handling/errors/bad-request.error';
import { ServiceAccountRefusedError } from '../../error-handling/errors/service-account-refused.error';
import { AuditAction, AuditOutcome, AuditReason } from '../../logging/audit-event.model';
import { Controller } from '../../routing/decorators/controller.decorator';
import { Get } from '../../routing/decorators/get.decorator';
import { OtpTwoFactorMethod } from '../2fa/methods/otp/otp.two-factor-method';
import { type TwoFactorServiceInterface } from '../2fa/two-factor-service.interface';
import { type AuthServiceInterface } from '../auth-service.interface';
import { PasswordCredentials } from '../authenticators/password/password-credentials.model';
import { Auth } from '../decorators/auth.decorator';
import { CurrentUser } from '../decorators/current-user.decorator';
import { PasswordResetToken } from '../models/password-reset-token.model';
import { type UserKind } from '../models/user-kind.type';
import { ApiKeyAuthStrategy } from '../strategies/api-key/api-key.auth-strategy';
import { ApiKey } from '../strategies/api-key/api-key.model';
import { CreatedApiKey } from '../strategies/api-key/created-api-key.model';
import { JwtAuthStrategy } from '../strategies/jwt/jwt.auth-strategy';
import { type UserServiceInterface } from './user-service.interface';

/**
 * Who a request of a key acts as.
 */
type Caller = {
    /**
     * The id of the user.
     */
    id: string,
    /**
     * Their kind.
     */
    kind: UserKind
};

/**
 * Routes a key reaches: who is calling, and one that takes a second factor.
 */
@Controller('/service-accounts-test', { versions: 'all' })
class CallerTestController {
    @Auth.isLoggedIn()
    @Get('/me')
    me(
        @CurrentUser()
        user: CurrentUser<JwtUser>
    ): Caller {
        return { id: user.id, kind: user.kind ?? 'person' };
    }

    @Auth.require2fa()
    @Get('/guarded')
    guarded(): { ok: boolean } {
        return { ok: true };
    }
}

let server: StartedTestServer | undefined;
let baseUrl: string = '';

beforeAll(async () => {
    server = await startTestServer({
        dataSources: [createInMemoryDataSource({ entities: [...defaultTestServerEntities, ApiKey], repositories: defaultTestServerRepositories })],
        authStrategies: [JwtAuthStrategy, ApiKeyAuthStrategy],
        twoFactorMethods: [OtpTwoFactorMethod],
        controllers: [CallerTestController],
        providers: defaultTestServerProviders
    });
    baseUrl = await server.start();
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.inMemory.shutdown);

function users(): Repository<JwtUser> {
    return inject(repositoryTokenFor(JwtUser));
}

function authService(): AuthServiceInterface {
    return inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
}

async function createServiceAccount(name: string): Promise<JwtUser> {
    const userService: UserServiceInterface = inject(ZIBRI_DI_TOKENS.USER_SERVICE);
    if (userService.createServiceAccount == undefined) {
        throw new Error('The user service of the test server creates service accounts.');
    }
    return await userService.createServiceAccount(JwtUser, { name, roles: [Roles.USER] }, undefined);
}

async function createPerson(): Promise<JwtUser> {
    return await users().create({ email: `${Date.now()}-${Math.random()}@people.test`, roles: [Roles.USER] });
}

async function createKey(user: JwtUser): Promise<CreatedApiKey> {
    return await authService().createApiKey(
        user.id,
        { name: 'reports', permissions: [], tenantId: undefined, expiresAt: undefined, clientAuthentication: undefined, requireDpop: false },
        undefined
    );
}

async function entriesOfUser(action: AuditAction, userId: string): Promise<AuditEntry[]> {
    await inject(ZIBRI_DI_TOKENS.AUDIT_SERVICE).flush();
    return await inject(repositoryTokenFor(AuditEntry)).findAll({ where: { action, userId }, acrossTenants: true });
}

/**
 * Enrolls the authenticator app as the second factor of a user.
 * @param user - The user.
 * @returns The secret of the app.
 */
async function enrollOtp(user: JwtUser): Promise<string> {
    const twoFactorService: TwoFactorServiceInterface = inject(ZIBRI_DI_TOKENS.TWO_FACTOR_SERVICE);
    const otp: OtpTwoFactorMethod = inject(OtpTwoFactorMethod);
    const secret: string = (await twoFactorService.requestTwoFactorRegistration(user, otp, undefined)).secret;
    // the previous step's code, so the current one is still unspent for the request
    await twoFactorService.confirmTwoFactorRegistration(user, otp, { token: new TOTP({ secret }).generate({ timestamp: Date.now() - 30_000 }) });
    return secret;
}

describe('service accounts', () => {
    it('are users of the kind service, with an address no mail reaches and no password', async () => {
        const service: JwtUser = await createServiceAccount('billing');

        expect(service).toMatchObject({ kind: 'service', email: 'billing@service-accounts.invalid', roles: [Roles.USER] });
        expect(await inject(repositoryTokenFor(PasswordCredentials)).count({ where: { userId: service.id } })).toBe(0);
        expect((await createPerson()).kind).toBe('person');
    });

    it('refuse a name that is no local part of an address, and a name taken', async () => {
        await expect(createServiceAccount('Billing Team')).rejects.toThrow(BadRequestError);
        await expect(createServiceAccount('-billing')).rejects.toThrow(BadRequestError);
        await createServiceAccount('invoices');
        await expect(createServiceAccount('invoices')).rejects.toThrow();
    });

    it('act through their keys, which name them as service accounts in the list and the audit trail', async () => {
        const service: JwtUser = await createServiceAccount('reporting');
        const person: JwtUser = await createPerson();
        const serviceKey: CreatedApiKey = await createKey(service);
        await createKey(person);

        const res: Response = await fetch(`${baseUrl}/service-accounts-test/me`, { headers: { 'x-api-key': serviceKey.key } });

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ id: service.id, kind: 'service' });
        expect(await authService().findApiKeys(service.id, undefined)).toMatchObject([{ name: 'reports', userKind: 'service' }]);
        expect(await authService().findApiKeys(person.id, undefined)).toMatchObject([{ name: 'reports', userKind: 'person' }]);
        expect(await entriesOfUser(AuditAction.API_KEY_CREATED, service.id))
            .toMatchObject([{ outcome: AuditOutcome.SUCCESS, userKind: 'service' }]);
    });

    it('keep their kind, and so do people', async () => {
        const service: JwtUser = await createServiceAccount('keeping');
        const person: JwtUser = await createPerson();

        await expect(users().updateById(service.id, { kind: 'person' })).rejects.toThrow(BadRequestError);
        await expect(users().updateById(person.id, { kind: 'service' })).rejects.toThrow(BadRequestError);
        await expect(users().updateAll({ id: person.id }, { kind: 'service' })).rejects.toThrow(BadRequestError);
        // writing down the kind a user has changes nothing
        await users().updateById(person.id, { kind: 'person' });
        expect((await users().findById(service.id)).kind).toBe('service');
    });

    it('get no password, set or by a reset', async () => {
        const service: JwtUser = await createServiceAccount('passwordless');

        await expect(authService().setPassword?.(service.id, { password: 'correct horse battery staple', requireChange: false }, undefined))
            .rejects.toThrow(ServiceAccountRefusedError);
        await authService().requestPasswordResetForEmail(service.email);

        await waitUntil(async () => (await entriesOfUser(AuditAction.PASSWORD_RESET_REQUESTED, service.id)).length === 1);
        expect(await entriesOfUser(AuditAction.PASSWORD_RESET_REQUESTED, service.id))
            .toMatchObject([{ outcome: AuditOutcome.FAILURE, reason: AuditReason.SERVICE_ACCOUNT, userKind: 'service' }]);
        expect(await inject(repositoryTokenFor(PasswordResetToken)).count({ where: { userId: service.id } })).toBe(0);
        expect(await inject(repositoryTokenFor(PasswordCredentials)).count({ where: { userId: service.id } })).toBe(0);
    });

    it('never pass a route that takes a second factor, which a person with the same key and code does', async () => {
        const service: JwtUser = await createServiceAccount('second-factor');
        const person: JwtUser = await createPerson();
        const serviceSecret: string = await enrollOtp(service);
        const personSecret: string = await enrollOtp(person);
        const otpHeader: string = inject(ZIBRI_DI_TOKENS.OTP_HEADER);

        const refused: Response = await fetch(`${baseUrl}/service-accounts-test/guarded`, {
            headers: { 'x-api-key': (await createKey(service)).key, [otpHeader]: new TOTP({ secret: serviceSecret }).generate() }
        });
        const passed: Response = await fetch(`${baseUrl}/service-accounts-test/guarded`, {
            headers: { 'x-api-key': (await createKey(person)).key, [otpHeader]: new TOTP({ secret: personSecret }).generate() }
        });

        expect(refused.status).not.toBe(200);
        expect(passed.status).toBe(200);
        expect(await entriesOfUser(AuditAction.TWO_FACTOR, service.id))
            .toEqual(expect.arrayContaining([expect.objectContaining({ outcome: AuditOutcome.FAILURE, reason: AuditReason.SERVICE_ACCOUNT })]));
    });
});