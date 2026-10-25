import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import { TOTP } from 'otpauth';
import { createInMemoryDataSource, RecordingEmailTransport } from 'zibri-testing';

import { EmailTwoFactorMethod } from './2fa/methods/code/email.two-factor-method';
import { TwoFactorCodeCredentials, TwoFactorCodeCredentialsCreateData } from './2fa/methods/code/two-factor-code-credentials.model';
import { TwoFactorCode } from './2fa/methods/code/two-factor-code.model';
import { OtpCredentials, OtpCredentialsCreateData } from './2fa/methods/otp/otp-credentials.model';
import { OtpTwoFactorMethod } from './2fa/methods/otp/otp.two-factor-method';
import { AuthController } from './auth-controller/auth-controller.model';
import { PasswordCredentials, PasswordCredentialsCreateData } from './authenticators/password/password-credentials.model';
import { PasswordAuthenticator } from './authenticators/password/password.authenticator';
import { LoginTicket, LoginTicketCreateData } from './models/login-ticket.model';
import { JwtRefreshToken } from './strategies/jwt/jwt-refresh-token.model';
import { JwtAuthStrategy } from './strategies/jwt/jwt.auth-strategy';
import { TestTimeouts } from '../__testing__/constants';
import { JwtUser } from '../__testing__/mocks/entities/jwt-user.entity';
import { Roles } from '../__testing__/mocks/entities/roles.enum';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { Repository } from '../data-source/repository/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { defineProvider } from '../di/models/di-provider.model';
import { EmailConfigInput } from '../email/models/email-config.model';
import { AuditAction, AuditEvent, AuditOutcome } from '../logging/audit-event.model';
import { Log } from '../logging/log.model';
import { type LoggerInterface } from '../logging/logger.interface';
import { RateLimitStateEntity } from '../rate-limiting/stores/rate-limit-state-entity.model';
import { Controller } from '../routing/decorators/controller.decorator';
import { JsonUtilities } from '../utilities/json.utilities';
import { Ms } from '../utilities/ms';

const PASSWORD: string = 'correct horse battery staple';
// fixed rather than generated, so that a failing case can be re-run with the same input
// eslint-disable-next-line cspell/spellchecker
const OTP_SECRET: string = 'JBSWY3DPEHPK3PXPJBSWY3DP';

/**
 * What the login route answers when the password was right and a second factor is still to come.
 */
type PendingLoginBody = {
    name: string,
    message: string,
    ticket: string,
    methods: string[]
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
class TwoFactorLoginAuthController extends AuthController({
        strategies: [JwtAuthStrategy],
        authenticators: [PasswordAuthenticator],
        twoFactorMethods: [OtpTwoFactorMethod, EmailTwoFactorMethod]
    }) {}

const transport: RecordingEmailTransport = new RecordingEmailTransport();

let server: StartedTestServer;
let baseUrl: string;
let otpHeader: string;
let emailCodeHeader: string;
let ticketHeader: string;

/**
 * Creates a user with a password.
 * @param name - What sets the user's email apart.
 * @returns The user.
 */
async function createUser(name: string): Promise<JwtUser> {
    const user: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser)).create({ email: `${name}@login.test`, roles: [Roles.USER] });
    const credentials: Repository<PasswordCredentials, PasswordCredentialsCreateData> = inject(repositoryTokenFor(PasswordCredentials));
    await credentials.create({ userId: user.id, password: PASSWORD });
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
 * Enrolls codes by email for a user, confirmed.
 * @param user - The user.
 */
async function enrollEmail(user: JwtUser): Promise<void> {
    const repository: Repository<TwoFactorCodeCredentials, TwoFactorCodeCredentialsCreateData> = inject(repositoryTokenFor(TwoFactorCodeCredentials));
    const credentials: TwoFactorCodeCredentials = await repository.create({ userId: user.id, channel: 'email', destination: undefined });
    await repository.updateById(credentials.id, { confirmed: true });
}

/**
 * The code the authenticator app shows now, or showed one step ago.
 * @param stepsAgo - How many steps back.
 * @returns The code.
 */
function otpCode(stepsAgo: number = 0): string {
    return new TOTP({ secret: OTP_SECRET }).generate({ timestamp: Date.now() - (stepsAgo * 30 * Ms.SECOND) });
}

/**
 * Sends a user's password to the login route.
 * @param user - The user.
 * @returns The response.
 */
async function login(user: JwtUser): Promise<Response> {
    return await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JsonUtilities.stringify({ email: user.email, password: PASSWORD })
    });
}

/**
 * Logs a user in up to the second factor.
 * @param user - The user.
 * @returns What the login route answered.
 */
async function pendingLoginOf(user: JwtUser): Promise<PendingLoginBody> {
    const res: Response = await login(user);
    expect(res.status).toBe(401);
    return await res.json() as PendingLoginBody;
}

/**
 * Calls one of the routes a login ticket continues at.
 * @param path - The route below `/auth/login/2fa`.
 * @param ticket - The ticket.
 * @param headers - What else the request carries.
 * @param body - The body, if any.
 * @returns The response.
 */
async function continueWith(path: string, ticket: string, headers: Record<string, string> = {}, body?: object): Promise<Response> {
    return await fetch(`${baseUrl}/auth/login/2fa${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [ticketHeader]: ticket, ...headers },
        body: body == undefined ? undefined : JsonUtilities.stringify(body)
    });
}

/**
 * The code of the last mail, once the queue has been delivered.
 * @returns The code.
 */
async function mailedCode(): Promise<string> {
    await inject(ZIBRI_DI_TOKENS.EMAIL_SERVICE).sendQueuedEmails();
    const code: string | undefined = /\d{6}/.exec(transport.sends.at(-1)?.html ?? '')?.[0];
    expect(code).toBeDefined();
    return code ?? '';
}

/**
 * The events the trail recorded for an action, oldest first.
 * @param action - The action.
 * @returns The events.
 */
async function eventsOf(action: AuditAction): Promise<AuditEvent[]> {
    await inject<LoggerInterface>(ZIBRI_DI_TOKENS.LOGGER).flush();
    return (await inject(repositoryTokenFor(Log)).findAll({}))
        .map(l => l.context.metadata?.['audit'] as AuditEvent | undefined)
        .filter((event): event is AuditEvent => event?.action === action);
}

/**
 * The refresh tokens a user holds, which is what a login leaves behind.
 * @param user - The user.
 * @returns How many.
 */
async function loginsOf(user: JwtUser): Promise<number> {
    return (await inject<Repository<JwtRefreshToken>>(repositoryTokenFor(JwtRefreshToken)).findAll({ where: { userId: user.id } })).length;
}

describe('AuthService - a second factor at login', () => {
    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [
                createInMemoryDataSource({
                    entities: [...defaultTestServerEntities, LoginTicket, TwoFactorCodeCredentials, TwoFactorCode, RateLimitStateEntity],
                    repositories: defaultTestServerRepositories
                })
            ],
            authStrategies: [JwtAuthStrategy],
            authenticators: [PasswordAuthenticator],
            twoFactorMethods: [OtpTwoFactorMethod, EmailTwoFactorMethod],
            twoFactorAtLogin: 'ifEnrolled',
            controllers: [TwoFactorLoginAuthController],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({
                    token: ZIBRI_DI_TOKENS.EMAIL_CONFIG,
                    useFactory: (): EmailConfigInput => ({ maxEmailsPerHour: 1000, defaultSender: 'Max Mustermann', failedRetentionInMs: 'forever' })
                }),
                defineProvider({ token: ZIBRI_DI_TOKENS.EMAIL_TRANSPORT, useValue: transport }),
                // short, so that a case about a wrong code does not wait
                defineProvider({ token: ZIBRI_DI_TOKENS.TWO_FACTOR_FAILURE_DELAY_IN_MS, useFactory: () => 1 })
            ]
        });
        baseUrl = await server.start();
        otpHeader = inject(ZIBRI_DI_TOKENS.OTP_HEADER);
        emailCodeHeader = inject(ZIBRI_DI_TOKENS.EMAIL_CODE_HEADER);
        ticketHeader = inject(ZIBRI_DI_TOKENS.LOGIN_TICKET_HEADER);
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    afterEach(async () => {
        await inject<LoggerInterface>(ZIBRI_DI_TOKENS.LOGGER).flush();
        await inject(repositoryTokenFor(Log)).deleteAll({});
    });

    describe('ifEnrolled', () => {
        it('logs a user without a second factor straight in', async () => {
            const user: JwtUser = await createUser('no-factor');

            const res: Response = await login(user);

            expect(res.status).toBe(200);
            expect((await res.json() as TokenBody).accessToken.value).toEqual(expect.any(String));
        });

        it('answers the password of an enrolled user with a ticket rather than a login', async () => {
            const user: JwtUser = await createUser('enrolled');
            await enrollOtp(user);

            const res: Response = await login(user);

            expect(res.status).toBe(401);
            const body: PendingLoginBody = await res.json() as PendingLoginBody;
            expect(body.name).toBe('SecondFactorRequiredError');
            expect(body.ticket).toEqual(expect.any(String));
            expect(body.methods).toEqual(['otp']);
            expect(await loginsOf(user)).toBe(0);
            const pending: AuditEvent[] = await eventsOf(AuditAction.LOGIN_PENDING);
            expect(pending).toEqual([expect.objectContaining({ outcome: AuditOutcome.SUCCESS, userId: user.id })]);
            expect(await eventsOf(AuditAction.LOGIN)).toEqual([]);
        });

        it('completes the login with the ticket and a code, and spends the ticket', async () => {
            const user: JwtUser = await createUser('completing');
            await enrollOtp(user);
            const { ticket }: PendingLoginBody = await pendingLoginOf(user);

            const res: Response = await continueWith('/complete', ticket, { [otpHeader]: otpCode() });

            expect(res.status).toBe(200);
            expect((await res.json() as TokenBody).refreshToken.value).toEqual(expect.any(String));
            expect(await loginsOf(user)).toBe(1);
            expect(await eventsOf(AuditAction.LOGIN)).toEqual([expect.objectContaining({ outcome: AuditOutcome.SUCCESS, userId: user.id })]);

            // refused on the ticket, before any code is looked at
            const again: Response = await continueWith('/complete', ticket, { [otpHeader]: otpCode(1) });
            expect(again.status).toBe(401);
            expect((await again.json() as PendingLoginBody).message).toContain('ticket');
        });

        it('keeps the ticket after a wrong code', async () => {
            const user: JwtUser = await createUser('wrong-code');
            await enrollOtp(user);
            const { ticket }: PendingLoginBody = await pendingLoginOf(user);

            const wrong: Response = await continueWith('/complete', ticket, { [otpHeader]: '000000' });
            expect(wrong.status).toBe(401);
            expect((await wrong.json() as PendingLoginBody).name).toBe('InvalidTwoFactorCodeError');
            expect(await loginsOf(user)).toBe(0);

            // after the wait the first wrong code costs
            await new Promise(resolve => setTimeout(resolve, 20));
            expect((await continueWith('/complete', ticket, { [otpHeader]: otpCode() })).status).toBe(200);
        });

        it('sends a code for the ticket, and completes the login with it', async () => {
            const user: JwtUser = await createUser('by-email');
            await enrollEmail(user);
            const { ticket, methods }: PendingLoginBody = await pendingLoginOf(user);
            expect(methods).toEqual(['email']);

            expect((await continueWith('/start?method=email', ticket)).status).toBe(204);
            const res: Response = await continueWith('/complete', ticket, { [emailCodeHeader]: await mailedCode() });

            expect(res.status).toBe(200);
            expect(await loginsOf(user)).toBe(1);
        });

        it('refuses a ticket that has expired', async () => {
            const user: JwtUser = await createUser('expired');
            await enrollOtp(user);
            const { ticket }: PendingLoginBody = await pendingLoginOf(user);
            const tickets: Repository<LoginTicket, LoginTicketCreateData> = inject(repositoryTokenFor(LoginTicket));
            const [row] = await tickets.findAll({ where: { userId: user.id } });
            expect(row).toBeDefined();
            await tickets.updateById(row?.id ?? '', { expirationDate: new Date(Date.now() - Ms.SECOND) });

            expect((await continueWith('/complete', ticket, { [otpHeader]: otpCode() })).status).toBe(401);
            expect(await loginsOf(user)).toBe(0);
        });

        it('refuses the ticket of a user who has a second factor to enroll another', async () => {
            const user: JwtUser = await createUser('has-one');
            await enrollOtp(user);
            const { ticket }: PendingLoginBody = await pendingLoginOf(user);

            expect((await continueWith('/register?method=email', ticket)).status).toBe(403);
            expect((await continueWith('/confirm?method=email', ticket, {}, { code: '123456' })).status).toBe(403);
        });
    });

    describe('required', () => {
        beforeAll(async () => {
            await server.reInit({ twoFactorAtLogin: 'required' });
            baseUrl = await server.start();
        }, 20000);

        it('answers a user without a second factor with a ticket that enrolls one, and completes with it', async () => {
            const user: JwtUser = await createUser('first-factor');

            const { ticket, methods }: PendingLoginBody = await pendingLoginOf(user);
            expect(methods).toEqual([]);

            const registered: Response = await continueWith('/register?method=otp', ticket);
            expect(registered.status).toBe(200);
            const { secret }: { secret: string } = await registered.json() as { secret: string };
            // the code one step back, so that the one the login completes with is still unspent
            const earlier: string = new TOTP({ secret }).generate({ timestamp: Date.now() - (30 * Ms.SECOND) });
            expect((await continueWith('/confirm?method=otp', ticket, {}, { token: earlier })).status).toBe(204);

            const res: Response = await continueWith('/complete', ticket, { [otpHeader]: new TOTP({ secret }).generate() });

            expect(res.status).toBe(200);
            expect(await loginsOf(user)).toBe(1);
        });

        it('refuses to complete the login of a user who enrolled nothing', async () => {
            const user: JwtUser = await createUser('nothing-enrolled');
            const { ticket }: PendingLoginBody = await pendingLoginOf(user);

            expect((await continueWith('/complete', ticket, { [otpHeader]: otpCode() })).status).toBe(403);
            expect(await loginsOf(user)).toBe(0);
        });

        it('asks an enrolled user for their factor like ifEnrolled does', async () => {
            const user: JwtUser = await createUser('required-enrolled');
            await enrollOtp(user);

            const { ticket, methods }: PendingLoginBody = await pendingLoginOf(user);

            expect(methods).toEqual(['otp']);
            expect((await continueWith('/complete', ticket, { [otpHeader]: otpCode() })).status).toBe(200);
        });
    });

    describe('never', () => {
        beforeAll(async () => {
            await server.reInit({ twoFactorAtLogin: 'never' });
            baseUrl = await server.start();
        }, 20000);

        it('logs an enrolled user in on their password alone', async () => {
            const user: JwtUser = await createUser('never-asked');
            await enrollOtp(user);

            const res: Response = await login(user);

            expect(res.status).toBe(200);
            expect(await loginsOf(user)).toBe(1);
        });
    });
});