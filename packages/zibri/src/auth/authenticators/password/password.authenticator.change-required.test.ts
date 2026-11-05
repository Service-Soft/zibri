import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { TOTP } from 'otpauth';
import { createInMemoryDataSource, RecordingEmailTransport } from 'zibri-testing';

import { PasswordCredentials, PasswordCredentialsCreateData } from './password-credentials.model';
import { PasswordAuthenticator } from './password.authenticator';
import { TestTimeouts } from '../../../__testing__/constants';
import { JwtUser } from '../../../__testing__/mocks/entities/jwt-user.entity';
import { Roles } from '../../../__testing__/mocks/entities/roles.enum';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { waitUntil } from '../../../__testing__/wait-until.function';
import { Repository } from '../../../data-source/repository/repository';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { defineProvider } from '../../../di/models/di-provider.model';
import { EmailConfigInput } from '../../../email/models/email-config.model';
import { Controller } from '../../../routing/decorators/controller.decorator';
import { JsonUtilities } from '../../../utilities/json.utilities';
import { Ms } from '../../../utilities/ms';
import { UUIDUtilities } from '../../../utilities/uuid.utilities';
import { OtpCredentials, OtpCredentialsCreateData } from '../../2fa/methods/otp/otp-credentials.model';
import { OtpTwoFactorMethod } from '../../2fa/methods/otp/otp.two-factor-method';
import { AuthController } from '../../auth-controller/auth-controller.model';
import { LoginTicket } from '../../models/login-ticket.model';
import { PasswordResetToken } from '../../models/password-reset-token.model';
import { PasswordPolicy } from '../../password-policy/password-policy.model';
import { JwtRefreshToken } from '../../strategies/jwt/jwt-refresh-token.model';
import { JwtAuthStrategy } from '../../strategies/jwt/jwt.auth-strategy';

/**
 * A password set before the policy asked for 15 characters.
 */
const OUTDATED: string = 'short secret 1';
/**
 * A password the policy takes.
 */
const CURRENT: string = 'a longer passphrase 2';
// fixed rather than generated, so that a failing case can be re-run with the same input
// eslint-disable-next-line cspell/spellchecker
const OTP_SECRET: string = 'JBSWY3DPEHPK3PXPJBSWY3DP';

/**
 * The policy of the application, which takes shorter passwords only while a test sets one up.
 */
const policy: PasswordPolicy = { minLength: 15, outdatedPasswords: 'requireChange' };

/**
 * What the login route answers when it waits for something before the login starts.
 */
type PendingLoginBody = {
    name: string,
    ticket: string
};

/**
 * What the login route answers once the user is logged in.
 */
type TokenBody = {
    accessToken: { value: string },
    refreshToken: { value: string }
};

// an orphan for the suites that import this file's siblings without registering it
@Controller('/auth', { allowOrphan: true, versions: 'all' })
class ChangeRequiredAuthController extends AuthController({
        strategies: [JwtAuthStrategy],
        authenticators: [PasswordAuthenticator],
        twoFactorMethods: [OtpTwoFactorMethod]
    }) {}

const transport: RecordingEmailTransport = new RecordingEmailTransport();

let server: StartedTestServer;
let baseUrl: string;
let otpHeader: string;
let ticketHeader: string;

/**
 * Creates a user with a password, set as the policy was when it was.
 * @param password - The password.
 * @param minLength - What the policy asked for when the password was set.
 * @returns The user.
 */
async function createUser(password: string, minLength: number = policy.minLength): Promise<JwtUser> {
    const user: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser))
        .create({ email: `${UUIDUtilities.generate()}@change-required.test`, roles: [Roles.USER] });
    const raised: number = policy.minLength;
    policy.minLength = minLength;
    try {
        await inject<Repository<PasswordCredentials, PasswordCredentialsCreateData>>(repositoryTokenFor(PasswordCredentials))
            .create({ userId: user.id, password });
    }
    finally {
        policy.minLength = raised;
    }
    return user;
}

/**
 * Enrolls the authenticator app for a user, confirmed.
 * @param user - The user.
 */
async function enrollOtp(user: JwtUser): Promise<void> {
    const repository: Repository<OtpCredentials, OtpCredentialsCreateData> = inject(repositoryTokenFor(OtpCredentials));
    const credentials: OtpCredentials = await repository.create({ secret: OTP_SECRET, userId: user.id });
    await repository.updateById(credentials.id, { confirmed: true });
}

/**
 * The code the authenticator app shows now, or showed some steps ago.
 * @param stepsAgo - How many steps back.
 * @returns The code.
 */
function otpCode(stepsAgo: number = 0): string {
    return new TOTP({ secret: OTP_SECRET }).generate({ timestamp: Date.now() - (stepsAgo * 30 * Ms.SECOND) });
}

/**
 * Posts json to a route of the auth controller.
 * @param path - The route below `/auth`.
 * @param body - The body.
 * @param headers - What else the request carries.
 * @returns The response.
 */
async function post(path: string, body: object, headers: Record<string, string> = {}): Promise<Response> {
    return await fetch(`${baseUrl}/auth${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JsonUtilities.stringify(body)
    });
}

/**
 * Sends a user's password to the login route.
 * @param user - The user.
 * @param password - The password.
 * @returns The response.
 */
async function login(user: JwtUser, password: string): Promise<Response> {
    return await post('/login', { email: user.email, password });
}

/**
 * Logs a user in up to what the login waits for.
 * @param user - The user.
 * @param password - The password.
 * @param waitingFor - The error the login answers with.
 * @returns The ticket the login continues with.
 */
async function pendingLoginOf(user: JwtUser, password: string, waitingFor: string): Promise<string> {
    const res: Response = await login(user, password);
    const body: PendingLoginBody = await res.json() as PendingLoginBody;
    expect([res.status, body.name]).toEqual([401, waitingFor]);
    return body.ticket;
}

/**
 * Sets the new password a login waits for.
 * @param ticket - The ticket the login answered with.
 * @param newPassword - The new password.
 * @returns The response.
 */
async function changePasswordAtLogin(ticket: string, newPassword: string): Promise<Response> {
    return await post('/login/change-password', { newPassword }, { [ticketHeader]: ticket });
}

/**
 * The refresh tokens a user holds, which is what a login leaves behind.
 * @param user - The user.
 * @returns How many.
 */
async function loginsOf(user: JwtUser): Promise<number> {
    return (await inject<Repository<JwtRefreshToken>>(repositoryTokenFor(JwtRefreshToken)).findAll({ where: { userId: user.id } })).length;
}

// a password the policy had stopped taking logged in like any other, and nothing could make a user
// choose a new one
describe('PasswordAuthenticator - a new password required at login', () => {
    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [
                createInMemoryDataSource({
                    entities: [...defaultTestServerEntities, LoginTicket],
                    repositories: defaultTestServerRepositories
                })
            ],
            authStrategies: [JwtAuthStrategy],
            authenticators: [PasswordAuthenticator],
            twoFactorMethods: [OtpTwoFactorMethod],
            twoFactorAtLogin: 'ifEnrolled',
            controllers: [ChangeRequiredAuthController],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({ token: ZIBRI_DI_TOKENS.PASSWORD_POLICY, useValue: policy }),
                defineProvider({
                    token: ZIBRI_DI_TOKENS.EMAIL_CONFIG,
                    useFactory: (): EmailConfigInput => ({ maxEmailsPerHour: 1000, defaultSender: 'Max Mustermann', failedRetentionInMs: 'forever' })
                }),
                defineProvider({ token: ZIBRI_DI_TOKENS.EMAIL_TRANSPORT, useValue: transport })
            ]
        });
        baseUrl = await server.start();
        otpHeader = inject(ZIBRI_DI_TOKENS.OTP_HEADER);
        ticketHeader = inject(ZIBRI_DI_TOKENS.LOGIN_TICKET_HEADER);
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    describe('a password the policy no longer takes', () => {
        it('is answered with a ticket for a new password, and no login', async () => {
            const user: JwtUser = await createUser(OUTDATED, 1);

            await pendingLoginOf(user, OUTDATED, 'PasswordChangeRequiredError');

            expect(await loginsOf(user)).toBe(0);
        });

        it('logs in once the ticket sets a password the policy takes, which replaces the old one', async () => {
            const user: JwtUser = await createUser(OUTDATED, 1);
            const ticket: string = await pendingLoginOf(user, OUTDATED, 'PasswordChangeRequiredError');

            // refused by the policy, and the ticket stays for another try
            expect((await changePasswordAtLogin(ticket, 'too short 3')).status).toBe(400);
            const res: Response = await changePasswordAtLogin(ticket, CURRENT);

            expect(res.status).toBe(200);
            expect((await res.json() as TokenBody).refreshToken.value).toEqual(expect.any(String));
            expect((await changePasswordAtLogin(ticket, `${CURRENT} again`)).status).toBe(401);
            expect((await login(user, OUTDATED)).status).toBe(401);
            expect((await login(user, CURRENT)).status).toBe(200);
        });
    });

    // whoever holds an old password and not the second factor must not get to set a new one: it would
    // lock the user out of their own account
    describe('a user with a second factor', () => {
        it('is asked for the second factor before the new password, and the second factor\'s ticket sets none', async () => {
            const user: JwtUser = await createUser(OUTDATED, 1);
            await enrollOtp(user);

            const secondFactorTicket: string = await pendingLoginOf(user, OUTDATED, 'SecondFactorRequiredError');
            expect((await changePasswordAtLogin(secondFactorTicket, CURRENT)).status).toBe(401);
            // the old password still is the password
            await pendingLoginOf(user, OUTDATED, 'SecondFactorRequiredError');

            const confirmed: Response = await post('/login/2fa/confirm', {}, { [ticketHeader]: secondFactorTicket, [otpHeader]: otpCode() });
            const body: PendingLoginBody = await confirmed.json() as PendingLoginBody;
            expect([confirmed.status, body.name]).toEqual([401, 'PasswordChangeRequiredError']);
            expect(await loginsOf(user)).toBe(0);
            // spent by the second factor it was for
            expect((await post('/login/2fa/confirm', {}, { [ticketHeader]: secondFactorTicket, [otpHeader]: otpCode(1) })).status).toBe(401);

            expect((await changePasswordAtLogin(body.ticket, CURRENT)).status).toBe(200);
            expect(await loginsOf(user)).toBe(1);
        });

        it('cannot log in with the ticket for a new password as with one for the second factor', async () => {
            const user: JwtUser = await createUser(OUTDATED, 1);
            await enrollOtp(user);
            const secondFactorTicket: string = await pendingLoginOf(user, OUTDATED, 'SecondFactorRequiredError');
            const confirmed: Response = await post('/login/2fa/confirm', {}, { [ticketHeader]: secondFactorTicket, [otpHeader]: otpCode() });
            const passwordTicket: string = (await confirmed.json() as PendingLoginBody).ticket;

            // a code of a step not spent yet, which would log in on a ticket that took it
            const res: Response = await post('/login/2fa/confirm', {}, { [ticketHeader]: passwordTicket, [otpHeader]: otpCode(1) });

            expect(res.status).toBe(401);
            expect(await loginsOf(user)).toBe(0);
        });
    });

    describe('a user the application asks for a new password', () => {
        it('ends their logins, and asks the next one for a password other than the one they have', async () => {
            const user: JwtUser = await createUser(CURRENT);
            expect((await login(user, CURRENT)).status).toBe(200);

            await inject(ZIBRI_DI_TOKENS.AUTH_SERVICE).requirePasswordChange(user.id, undefined);

            expect(await loginsOf(user)).toBe(0);
            const ticket: string = await pendingLoginOf(user, CURRENT, 'PasswordChangeRequiredError');
            expect((await changePasswordAtLogin(ticket, CURRENT)).status).toBe(400);
            expect((await changePasswordAtLogin(ticket, `${CURRENT} renewed`)).status).toBe(200);
            expect((await login(user, `${CURRENT} renewed`)).status).toBe(200);
        });

        it('takes a reset in place of the new password at login', async () => {
            const user: JwtUser = await createUser(CURRENT);
            await inject(ZIBRI_DI_TOKENS.AUTH_SERVICE).requirePasswordChange(user.id, undefined);

            await inject(ZIBRI_DI_TOKENS.AUTH_SERVICE).requestPasswordResetForEmail(user.email);
            await waitUntil(async () => (await inject(repositoryTokenFor(PasswordResetToken)).findAll({ where: { userId: user.id } })).length > 0);
            await inject(ZIBRI_DI_TOKENS.EMAIL_SERVICE).sendQueuedEmails();
            const resetToken: string | undefined = /confirm-password-reset\/([\da-f]+)/.exec(transport.sends.at(-1)?.html ?? '')?.[1];
            expect((await post('/confirm-password-reset', { resetToken, newPassword: `${CURRENT} reset` })).status).toBe(204);

            expect((await login(user, `${CURRENT} reset`)).status).toBe(200);
        });
    });
});