import { setTimeout } from 'node:timers/promises';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource,
    InMemoryDataSource,
    inMemoryStoreFor,
    RecordingEmailTransport,
    RecordingSmsService,
    TestBrowser } from 'zibri-testing';

import { EmailTwoFactorMethod } from './email.two-factor-method';
import { SmsCodeLimits } from './sms-code-limits.model';
import { SmsTwoFactorMethod } from './sms.two-factor-method';
import { TwoFactorCodeCredentials } from './two-factor-code-credentials.model';
import { TwoFactorCodeOptions } from './two-factor-code-options.model';
import { TwoFactorCode } from './two-factor-code.model';
import { JwtUser } from '../../../../__testing__/mocks/entities/jwt-user.entity';
import { Roles } from '../../../../__testing__/mocks/entities/roles.enum';
import { defaultTestServerEntities } from '../../../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../../../__testing__/test-server/providers';
import { startAndStopTestServerWithout } from '../../../../__testing__/test-server/start-and-stop-test-server-without.function';
import { StartedTestServer, startTestServer } from '../../../../__testing__/test-server/start-test-server.function';
import { Repository } from '../../../../data-source/repository/repository';
import { repositoryTokenFor } from '../../../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../../di/inject.function';
import { defineProvider } from '../../../../di/models/di-provider.model';
import { EmailConfigInput } from '../../../../email/models/email-config.model';
import { EntityMetadata } from '../../../../entity/decorators/entity.decorator';
import { BadRequestError } from '../../../../error-handling/errors/bad-request.error';
import { TooManyRequestsError } from '../../../../error-handling/errors/too-many-requests.error';
import { KnownHeader } from '../../../../http/known-header.enum';
import { MimeType } from '../../../../http/mime-type.enum';
import { RateLimitStateEntity } from '../../../../rate-limiting/stores/rate-limit-state-entity.model';
import { Controller } from '../../../../routing/decorators/controller.decorator';
import { Post } from '../../../../routing/decorators/post.decorator';
import { JsonUtilities } from '../../../../utilities/json.utilities';
import { MetadataUtilities } from '../../../../utilities/metadata.utilities';
import { Ms } from '../../../../utilities/ms';
import { AuthController } from '../../../auth-controller/auth-controller.model';
import { PasswordCredentials, PasswordCredentialsCreateData } from '../../../authenticators/password/password-credentials.model';
import { PasswordAuthenticator } from '../../../authenticators/password/password.authenticator';
import { Auth } from '../../../decorators/auth.decorator';
import { CookieAuthData } from '../../../strategies/cookie/cookie-auth-data.model';
import { CookieAuthRefreshSession } from '../../../strategies/cookie/cookie-auth-refresh-session.model';
import { CookieAuthSession } from '../../../strategies/cookie/cookie-auth-session.model';
import { CookieAuthStrategy } from '../../../strategies/cookie/cookie-auth.auth-strategy';
import { type TwoFactorServiceInterface } from '../../two-factor-service.interface';

const EMAIL_HEADER: string = 'x-authorization-email-code';
const SMS_HEADER: string = 'x-authorization-sms-code';
const PHONE_NUMBER: string = '+4915112345678';

// an orphan for the cases in this file that boot without it
@Controller('/auth', { allowOrphan: true, versions: 'all' })
class CodeAuthController extends AuthController({
        strategies: [CookieAuthStrategy],
        authenticators: [PasswordAuthenticator],
        twoFactorMethods: [EmailTwoFactorMethod, SmsTwoFactorMethod]
    }) {}

@Controller('/account', { allowOrphan: true })
class AccountController {
    @Auth.require2fa()
    @Post('/payment-details')
    updatePaymentDetails(): { ok: boolean } {
        return { ok: true };
    }
}

/**
 * A user logged in to cookies.
 */
type LoggedIn = {
    /**
     * The browser holding their session.
     */
    browser: TestBrowser,
    /**
     * The csrf token of that session.
     */
    csrfToken: string,
    /**
     * The user.
     */
    user: JwtUser
};

const transport: RecordingEmailTransport = new RecordingEmailTransport();
const sms: RecordingSmsService = new RecordingSmsService();

let baseUrl: string;
let dataSourceClass: new () => InMemoryDataSource;
let twoFactorService: TwoFactorServiceInterface;
let emailMethod: EmailTwoFactorMethod;
let smsMethod: SmsTwoFactorMethod;

/**
 * Limits on text messages no case reaches unless it is about them.
 */
const generousSmsLimits: SmsCodeLimits = { maxPerHour: 1000, maxPerNumberPerDay: 1000, allowedCallingCodes: ['+49', '+43'] };

/**
 * Starts an application with both methods, logging in to cookies.
 * @param options - How the codes look and how long they last.
 * @param failureDelayInMs - How long a user waits after their first wrong code.
 * @param smsLimits - What text messages may cost.
 * @returns The server.
 */
async function startApp(
    options: TwoFactorCodeOptions,
    failureDelayInMs: number = 1,
    smsLimits: SmsCodeLimits = generousSmsLimits
): Promise<StartedTestServer> {
    dataSourceClass = createInMemoryDataSource({
        entities: [
            ...defaultTestServerEntities,
            CookieAuthSession,
            CookieAuthRefreshSession,
            TwoFactorCodeCredentials,
            TwoFactorCode,
            RateLimitStateEntity
        ],
        allowOrphan: true
    });
    const server: StartedTestServer = await startTestServer({
        dataSources: [dataSourceClass],
        authStrategies: [CookieAuthStrategy],
        authenticators: [PasswordAuthenticator],
        twoFactorMethods: [EmailTwoFactorMethod, SmsTwoFactorMethod],
        controllers: [CodeAuthController, AccountController],
        providers: [
            ...defaultTestServerProviders,
            defineProvider({ token: ZIBRI_DI_TOKENS.COOKIE_SIGN_SECRET, useFactory: () => 'test-cookie-secret' }),
            defineProvider({
                token: ZIBRI_DI_TOKENS.EMAIL_CONFIG,
                useFactory: (): EmailConfigInput => ({ maxEmailsPerHour: 1000, defaultSender: 'Max Mustermann', failedRetentionInMs: 'forever' })
            }),
            defineProvider({ token: ZIBRI_DI_TOKENS.EMAIL_TRANSPORT, useValue: transport }),
            defineProvider({ token: ZIBRI_DI_TOKENS.SMS_SERVICE, useValue: sms }),
            defineProvider({ token: ZIBRI_DI_TOKENS.SMS_CODE_LIMITS, useValue: smsLimits }),
            defineProvider({ token: ZIBRI_DI_TOKENS.TWO_FACTOR_CODE_OPTIONS, useValue: options }),
            // short unless a test is about the wait, so that a wrong code does not make a test wait
            defineProvider({ token: ZIBRI_DI_TOKENS.TWO_FACTOR_FAILURE_DELAY_IN_MS, useFactory: () => failureDelayInMs })
        ]
    });
    await resolveRunningApp(server);
    return server;
}

/**
 * Takes what the cases use from a server that has just started.
 * @param server - The server.
 */
async function resolveRunningApp(server: StartedTestServer): Promise<void> {
    baseUrl = await server.start();
    twoFactorService = inject(ZIBRI_DI_TOKENS.TWO_FACTOR_SERVICE);
    emailMethod = inject(EmailTwoFactorMethod);
    smsMethod = inject(SmsTwoFactorMethod);
}

/**
 * Starts enrolling a user by text message, after the wait between two codes of a user is over.
 * @param user - The user.
 * @param phoneNumber - Where the code goes.
 * @returns What the request ended in: undefined when the code went out, or what refused it.
 */
async function requestSmsEnrollment(user: JwtUser, phoneNumber: string): Promise<unknown> {
    await afterResendInterval();
    return await twoFactorService.requestRegisterTwoFactorMethodForUser(user, smsMethod, { phoneNumber })
        .catch((error: unknown) => error);
}

/**
 * Creates a user with a password and logs them in.
 * @returns The user, logged in.
 */
async function createLoggedInUser(): Promise<LoggedIn> {
    const email: string = `${crypto.randomUUID()}@example.com`;
    const user: JwtUser = await inject(repositoryTokenFor(JwtUser)).create({ email, roles: [Roles.USER] });
    await inject<Repository<PasswordCredentials, PasswordCredentialsCreateData>>(repositoryTokenFor(PasswordCredentials))
        .create({ password: 'secure123', userId: user.id });
    const browser: TestBrowser = new TestBrowser(baseUrl, undefined);
    const res: Response = await post(browser, '/auth/login', { email, password: 'secure123' });
    expect(res.status).toBe(200);
    // eslint-disable-next-line typescript/no-unsafe-assignment
    const { csrfToken }: CookieAuthData<string> = await res.json();
    return { browser, csrfToken, user };
}

/**
 * Posts json, as a page does.
 * @param browser - The browser.
 * @param path - The route.
 * @param body - The body.
 * @param headers - Anything else to send.
 * @returns The response.
 */
async function post(browser: TestBrowser, path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
    return await browser.open(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { [KnownHeader.CONTENT_TYPE]: MimeType.JSON, ...headers },
        body: JsonUtilities.stringify(body)
    });
}

/**
 * Asks for the guarded operation, presenting the given second factor.
 * @param loggedIn - The user, logged in.
 * @param headers - What the request carries as the second factor.
 * @returns The status.
 */
async function updatePaymentDetails(loggedIn: LoggedIn, headers: Record<string, string> = {}): Promise<number> {
    const res: Response = await post(loggedIn.browser, '/account/payment-details', {}, { 'x-csrf-token': loggedIn.csrfToken, ...headers });
    return res.status;
}

/**
 * The code of the last mail, once the queue has been delivered.
 * @returns The code.
 */
async function mailedCode(): Promise<string> {
    await inject(ZIBRI_DI_TOKENS.EMAIL_SERVICE).sendQueuedEmails();
    return readCode(transport.sends.at(-1)?.html);
}

/**
 * The code of the last text message.
 * @returns The code.
 */
function textedCode(): string {
    return readCode(sms.sent.at(-1)?.message);
}

/**
 * Reads the digits out of a message.
 * @param message - The message.
 * @returns The code in it.
 */
function readCode(message: string | undefined): string {
    const code: string | undefined = /\d{6}/.exec(message ?? '')?.[0];
    expect(code).toBeDefined();
    return code ?? '';
}

/**
 * A code that is not the given one.
 * @param code - The code.
 * @returns Another code of the same length.
 */
function otherThan(code: string): string {
    return code === '000000' ? '111111' : '000000';
}

/**
 * Waits until the interval a user has to wait between two codes is over.
 */
async function afterResendInterval(): Promise<void> {
    await setTimeout(30);
}

/**
 * The codes of a user as they are stored, before anything decrypts them.
 * @param credentialsId - The credentials the codes were sent for.
 * @returns The stored values.
 */
async function findStoredCodes(credentialsId: string): Promise<(string | undefined)[]> {
    const metadata: EntityMetadata<TwoFactorCode> | undefined = MetadataUtilities.getEntityMetadata(TwoFactorCode);
    const rows: TwoFactorCode[] = await inject(repositoryTokenFor(TwoFactorCode)).findAll({ where: { credentialsId } });
    return rows.map(r => inMemoryStoreFor(dataSourceClass).readRow(metadata?.tableName ?? '', r.id)?.['value']);
}

/**
 * Enrolls the user by email and confirms it with the mailed code.
 * @param user - The user.
 */
async function enrollByEmail(user: JwtUser): Promise<void> {
    await twoFactorService.requestRegisterTwoFactorMethodForUser(user, emailMethod, undefined);
    await twoFactorService.confirmRegisterTwoFactorMethodForUser(user, emailMethod, { code: await mailedCode() });
}

// first, for the reason on startAndStopTestServerWithout
describe('Two factor codes — starting', () => {
    it('refuses to start without the entities that keep them, and names them', async () => {
        const start: Promise<void> = startAndStopTestServerWithout([], {
            twoFactorMethods: [EmailTwoFactorMethod],
            providers: [...defaultTestServerProviders]
        });

        await expect(start).rejects.toThrow(/Error initializing EmailTwoFactorMethod[\S\s]*TwoFactorCodeCredentials/);
    }, 30000);

    it('refuses to start the sms method without a sender', async () => {
        const dataSourceClass: new () => InMemoryDataSource = createInMemoryDataSource({
            entities: [...defaultTestServerEntities, TwoFactorCodeCredentials, TwoFactorCode, RateLimitStateEntity],
            allowOrphan: true
        });

        const start: Promise<StartedTestServer> = startTestServer({
            dataSources: [dataSourceClass],
            twoFactorMethods: [SmsTwoFactorMethod],
            providers: [...defaultTestServerProviders]
        });

        await expect(start).rejects.toThrow(/sms_service/);
    }, 30000);

    // evaluation/03-auth-and-security H21: a text message is the one channel that costs money, and
    // nothing bounded how many any caller could have sent, or where to
    it('refuses to start the sms method without limits on what its text messages cost', async () => {
        const dataSourceClass: new () => InMemoryDataSource = createInMemoryDataSource({
            entities: [...defaultTestServerEntities, TwoFactorCodeCredentials, TwoFactorCode, RateLimitStateEntity],
            allowOrphan: true
        });

        const start: Promise<StartedTestServer> = startTestServer({
            dataSources: [dataSourceClass],
            twoFactorMethods: [SmsTwoFactorMethod],
            providers: [...defaultTestServerProviders, defineProvider({ token: ZIBRI_DI_TOKENS.SMS_SERVICE, useValue: sms })]
        });

        await expect(start).rejects.toThrow(/ZIBRI_DI_TOKENS\.SMS_CODE_LIMITS/);
    }, 30000);

    it('refuses to start without the entity that keeps how many codes went out, and names it', async () => {
        const dataSourceClass: new () => InMemoryDataSource = createInMemoryDataSource({
            entities: [...defaultTestServerEntities, TwoFactorCodeCredentials, TwoFactorCode],
            allowOrphan: true
        });

        const start: Promise<StartedTestServer> = startTestServer({
            dataSources: [dataSourceClass],
            twoFactorMethods: [EmailTwoFactorMethod],
            providers: [...defaultTestServerProviders]
        });

        await expect(start).rejects.toThrow(/Error initializing EmailTwoFactorMethod[\S\s]*RateLimitStateEntity/);
    }, 30000);

    it('refuses a setting that is not a whole number above 0', async () => {
        await expect(startApp({ digits: 0 })).rejects.toThrow(/digits must be a whole number above 0/);
    }, 30000);
});

describe('Two factor codes — by email and text message', () => {
    let server: StartedTestServer;

    beforeAll(async () => {
        server = await startApp({ resendAfterMs: 1 });
    }, 30000);

    afterAll(async () => {
        await server.shutdown();
    }, 15000);

    it('enrolls by email with a code that is mailed, which counts once confirmed, and takes a sent code once', async () => {
        const { browser, csrfToken, user } = await createLoggedInUser();
        const loggedIn: LoggedIn = { browser, csrfToken, user };

        await twoFactorService.requestRegisterTwoFactorMethodForUser(user, emailMethod, undefined);
        const enrollmentCode: string = await mailedCode();
        expect(transport.sends.at(-1)?.recipients).toEqual([user.email]);
        // asked for but not confirmed: nothing to present yet
        expect(await twoFactorService.isRegistered(user, [EmailTwoFactorMethod])).toBe(false);

        await twoFactorService.confirmRegisterTwoFactorMethodForUser(user, emailMethod, { code: enrollmentCode });
        expect(await twoFactorService.isRegistered(user, [EmailTwoFactorMethod])).toBe(true);

        expect(await updatePaymentDetails(loggedIn)).toBe(401);
        await afterResendInterval();
        await emailMethod.startSecondFactor(user);
        const code: string = await mailedCode();
        expect(await updatePaymentDetails(loggedIn, { [EMAIL_HEADER]: code })).toBe(200);
        expect(await updatePaymentDetails(loggedIn, { [EMAIL_HEADER]: code })).toBe(401);
    });

    it('keeps the code encrypted', async () => {
        const { user } = await createLoggedInUser();
        await twoFactorService.requestRegisterTwoFactorMethodForUser(user, emailMethod, undefined);
        const code: string = await mailedCode();
        const credentials: TwoFactorCodeCredentials[] = await inject(repositoryTokenFor(TwoFactorCodeCredentials))
            .findAll({ where: { userId: user.id } });

        const stored: (string | undefined)[] = await findStoredCodes(credentials[0]?.id ?? '');

        expect(stored).toHaveLength(1);
        expect(stored[0]).toBeDefined();
        expect(stored[0]).not.toContain(code);
    });

    it('refuses a code that was sent to somebody else', async () => {
        const owner: LoggedIn = await createLoggedInUser();
        const other: LoggedIn = await createLoggedInUser();
        await enrollByEmail(owner.user);
        await enrollByEmail(other.user);
        await afterResendInterval();
        await emailMethod.startSecondFactor(owner.user);
        const ownersCode: string = await mailedCode();

        expect(await updatePaymentDetails(other, { [EMAIL_HEADER]: ownersCode })).toBe(401);
        expect(await updatePaymentDetails(owner, { [EMAIL_HEADER]: ownersCode })).toBe(200);
    });

    it('does not take the code of a new enrollment for the second factor that is already in force', async () => {
        const loggedIn: LoggedIn = await createLoggedInUser();
        await enrollByEmail(loggedIn.user);
        await afterResendInterval();
        await emailMethod.startSecondFactor(loggedIn.user);
        const challengeCode: string = await mailedCode();
        await afterResendInterval();
        // somebody holding the session starts enrolling again, and reads the code that goes with it
        await twoFactorService.requestRegisterTwoFactorMethodForUser(loggedIn.user, emailMethod, undefined);
        const enrollmentCode: string = await mailedCode();

        expect(await updatePaymentDetails(loggedIn, { [EMAIL_HEADER]: enrollmentCode })).toBe(401);
        await setTimeout(30);
        expect(await updatePaymentDetails(loggedIn, { [EMAIL_HEADER]: challengeCode })).toBe(200);
    });

    it('takes the right code after wrong ones, leaving the limit on guessing to the wait between them', async () => {
        const loggedIn: LoggedIn = await createLoggedInUser();
        await enrollByEmail(loggedIn.user);
        await afterResendInterval();
        await emailMethod.startSecondFactor(loggedIn.user);
        const code: string = await mailedCode();

        for (let attempt: number = 0; attempt < 3; attempt++) {
            expect(await updatePaymentDetails(loggedIn, { [EMAIL_HEADER]: otherThan(code) })).toBe(401);
            await setTimeout(30);
        }

        expect(await updatePaymentDetails(loggedIn, { [EMAIL_HEADER]: code })).toBe(200);
    });

    it('lets a newly sent code replace the one before', async () => {
        const loggedIn: LoggedIn = await createLoggedInUser();
        await enrollByEmail(loggedIn.user);
        await afterResendInterval();
        await emailMethod.startSecondFactor(loggedIn.user);
        const first: string = await mailedCode();
        await afterResendInterval();
        await emailMethod.startSecondFactor(loggedIn.user);
        const second: string = await mailedCode();

        expect(second).not.toBe(first);
        expect(await updatePaymentDetails(loggedIn, { [EMAIL_HEADER]: first })).toBe(401);
        await setTimeout(30);
        expect(await updatePaymentDetails(loggedIn, { [EMAIL_HEADER]: second })).toBe(200);
    });

    it('refuses a phone number that is not in international format, also when enrolling from code', async () => {
        const { user } = await createLoggedInUser();
        const sent: number = sms.sent.length;

        await expect(twoFactorService.requestRegisterTwoFactorMethodForUser(user, smsMethod, { phoneNumber: '0151 12345678' }))
            .rejects.toThrow();

        expect(sms.sent).toHaveLength(sent);
        expect(await inject(repositoryTokenFor(TwoFactorCodeCredentials)).findAll({ where: { userId: user.id } })).toEqual([]);
    });

    it('sends a code only to a user who enrolled', async () => {
        const { user } = await createLoggedInUser();

        await expect(emailMethod.startSecondFactor(user)).rejects.toThrow(/no second factor of this kind/);
    });

    it('enrolls by text message with a number, keeps it encrypted, and takes a texted code once', async () => {
        const loggedIn: LoggedIn = await createLoggedInUser();

        await twoFactorService.requestRegisterTwoFactorMethodForUser(loggedIn.user, smsMethod, { phoneNumber: PHONE_NUMBER });
        expect(sms.sent.at(-1)?.to).toBe(PHONE_NUMBER);
        await twoFactorService.confirmRegisterTwoFactorMethodForUser(loggedIn.user, smsMethod, { code: textedCode() });
        expect(await twoFactorService.isRegistered(loggedIn.user, [SmsTwoFactorMethod])).toBe(true);

        await afterResendInterval();
        await smsMethod.startSecondFactor(loggedIn.user);
        expect(sms.sent.at(-1)?.to).toBe(PHONE_NUMBER);
        const code: string = textedCode();
        // the code of a text message does not open the email factor, nor the other way round
        expect(await updatePaymentDetails(loggedIn, { [EMAIL_HEADER]: code })).toBe(401);
        await setTimeout(30);
        expect(await updatePaymentDetails(loggedIn, { [SMS_HEADER]: code })).toBe(200);
        expect(await updatePaymentDetails(loggedIn, { [SMS_HEADER]: code })).toBe(401);
    });

    it('removes an enrollment together with its codes', async () => {
        const loggedIn: LoggedIn = await createLoggedInUser();
        await enrollByEmail(loggedIn.user);
        await afterResendInterval();
        await emailMethod.startSecondFactor(loggedIn.user);
        const code: string = await mailedCode();
        const credentialsRepository: Repository<TwoFactorCodeCredentials> = inject(repositoryTokenFor(TwoFactorCodeCredentials));
        const credentialsIds: string[] = (await credentialsRepository.findAll({ where: { userId: loggedIn.user.id } })).map(c => c.id);
        expect(credentialsIds).toHaveLength(1);

        await twoFactorService.unregisterTwoFactorMethodForUser(loggedIn.user, emailMethod);

        expect(await twoFactorService.isRegistered(loggedIn.user, [EmailTwoFactorMethod])).toBe(false);
        expect(await updatePaymentDetails(loggedIn, { [EMAIL_HEADER]: code })).toBe(401);
        expect(await credentialsRepository.findAll({ where: { userId: loggedIn.user.id } })).toEqual([]);
        const codesLeft: TwoFactorCode[] = await inject(repositoryTokenFor(TwoFactorCode))
            .findAll({ where: { credentialsId: { oneOf: credentialsIds } } });
        expect(codesLeft).toEqual([]);
    });
});

describe('Two factor codes — sending again', () => {
    let server: StartedTestServer;

    beforeAll(async () => {
        server = await startApp({});
    }, 30000);

    afterAll(async () => {
        await server.shutdown();
    }, 15000);

    it('sends the user no second code before the interval is over, and the first one still works', async () => {
        const loggedIn: LoggedIn = await createLoggedInUser();
        await twoFactorService.requestRegisterTwoFactorMethodForUser(loggedIn.user, emailMethod, undefined);
        const enrollmentCode: string = await mailedCode();
        const sent: number = transport.sends.length;

        const refused: unknown = await twoFactorService.requestRegisterTwoFactorMethodForUser(loggedIn.user, emailMethod, undefined)
            .catch((error: unknown) => error);
        expect(refused).toBeInstanceOf(TooManyRequestsError);
        // says when the next code can go out, which is within the minute
        const retryAtMs: number | undefined = refused instanceof TooManyRequestsError ? refused.retryAtMs : undefined;
        expect(retryAtMs).toBeGreaterThan(Date.now());
        expect(retryAtMs).toBeLessThanOrEqual(Date.now() + Ms.MINUTE);

        await inject(ZIBRI_DI_TOKENS.EMAIL_SERVICE).sendQueuedEmails();
        expect(transport.sends).toHaveLength(sent);
        // the enrollment that was turned away is still the one waiting for its code
        await twoFactorService.confirmRegisterTwoFactorMethodForUser(loggedIn.user, emailMethod, { code: enrollmentCode });
        expect(await twoFactorService.isRegistered(loggedIn.user, [EmailTwoFactorMethod])).toBe(true);
        // the code that confirmed it counts as the last one sent
        await expect(emailMethod.startSecondFactor(loggedIn.user)).rejects.toThrow(TooManyRequestsError);
    });

    it('counts the interval for each channel of a user separately', async () => {
        const loggedIn: LoggedIn = await createLoggedInUser();
        await twoFactorService.requestRegisterTwoFactorMethodForUser(loggedIn.user, emailMethod, undefined);

        await expect(twoFactorService.requestRegisterTwoFactorMethodForUser(loggedIn.user, smsMethod, { phoneNumber: PHONE_NUMBER }))
            .resolves.toBeUndefined();
    });
});

describe('Two factor codes — where text messages go', () => {
    let server: StartedTestServer;

    beforeAll(async () => {
        server = await startApp({ resendAfterMs: 1 }, 1, { ...generousSmsLimits, maxPerNumberPerDay: 2 });
    }, 30000);

    afterAll(async () => {
        await server.shutdown();
    }, 15000);

    it('refuses a number outside the countries it may text, sending and storing nothing', async () => {
        const { user } = await createLoggedInUser();
        const sent: number = sms.sent.length;

        const refused: unknown = await requestSmsEnrollment(user, '+12025550123');

        expect(refused).toBeInstanceOf(BadRequestError);
        expect(sms.sent).toHaveLength(sent);
        expect(await inject(repositoryTokenFor(TwoFactorCodeCredentials)).findAll({ where: { userId: user.id } })).toEqual([]);
    });

    it('sends one number no more codes a day than allowed, whichever accounts ask for them', async () => {
        const phoneNumber: string = '+4915100000001';
        const sent: number = sms.sent.length;

        expect(await requestSmsEnrollment((await createLoggedInUser()).user, phoneNumber)).toBeUndefined();
        expect(await requestSmsEnrollment((await createLoggedInUser()).user, phoneNumber)).toBeUndefined();
        const third: JwtUser = (await createLoggedInUser()).user;
        expect(await requestSmsEnrollment(third, phoneNumber)).toBeInstanceOf(TooManyRequestsError);

        expect(sms.sent).toHaveLength(sent + 2);
        // the number is what is limited, not the account asking
        expect(await requestSmsEnrollment(third, '+4366400000001')).toBeUndefined();
    });
});

describe('Two factor codes — what text messages cost', () => {
    let server: StartedTestServer;

    beforeAll(async () => {
        server = await startApp({ resendAfterMs: 1 }, 1, { ...generousSmsLimits, maxPerHour: 2 });
    }, 30000);

    afterAll(async () => {
        await server.shutdown();
    }, 15000);

    it('stops texting once the application has sent what an hour allows, and keeps mailing', async () => {
        const sent: number = sms.sent.length;

        expect(await requestSmsEnrollment((await createLoggedInUser()).user, '+4915100000002')).toBeUndefined();
        expect(await requestSmsEnrollment((await createLoggedInUser()).user, '+4915100000003')).toBeUndefined();
        const late: JwtUser = (await createLoggedInUser()).user;
        expect(await requestSmsEnrollment(late, '+4915100000004')).toBeInstanceOf(TooManyRequestsError);

        expect(sms.sent).toHaveLength(sent + 2);
        await expect(twoFactorService.requestRegisterTwoFactorMethodForUser(late, emailMethod, undefined)).resolves.toBeUndefined();
    });
});

describe('Two factor codes — counted across instances', () => {
    let server: StartedTestServer;

    beforeAll(async () => {
        server = await startApp({});
    }, 30000);

    afterAll(async () => {
        await server.shutdown();
    }, 15000);

    it('keeps the wait between two codes in the data source, where a restarted instance finds it', async () => {
        const { user } = await createLoggedInUser();
        await twoFactorService.requestRegisterTwoFactorMethodForUser(user, emailMethod, undefined);

        // a restart starts from nothing but the data source, which every other instance shares too
        await server.reInit();
        await resolveRunningApp(server);

        await expect(twoFactorService.requestRegisterTwoFactorMethodForUser(user, emailMethod, undefined)).rejects.toThrow(TooManyRequestsError);
    }, 30000);
});

describe('Two factor codes — wrong ones', () => {
    let server: StartedTestServer;

    beforeAll(async () => {
        server = await startApp({ resendAfterMs: 1 }, 500);
    }, 30000);

    afterAll(async () => {
        await server.shutdown();
    }, 15000);

    it('makes the user wait after a wrong code, and refuses the right one unchecked until then', async () => {
        const loggedIn: LoggedIn = await createLoggedInUser();
        await enrollByEmail(loggedIn.user);
        await afterResendInterval();
        await emailMethod.startSecondFactor(loggedIn.user);
        const code: string = await mailedCode();

        expect(await updatePaymentDetails(loggedIn, { [EMAIL_HEADER]: otherThan(code) })).toBe(401);
        expect(await updatePaymentDetails(loggedIn, { [EMAIL_HEADER]: code })).toBe(429);

        await setTimeout(600);
        expect(await updatePaymentDetails(loggedIn, { [EMAIL_HEADER]: code })).toBe(200);
    });
});

describe('Two factor codes — expiring', () => {
    let server: StartedTestServer;

    beforeAll(async () => {
        server = await startApp({ resendAfterMs: 1, expiresInMs: 1000 });
    }, 30000);

    afterAll(async () => {
        await server.shutdown();
    }, 15000);

    it('refuses a code once its time is up', async () => {
        const loggedIn: LoggedIn = await createLoggedInUser();
        await twoFactorService.requestRegisterTwoFactorMethodForUser(loggedIn.user, emailMethod, undefined);
        const code: string = await mailedCode();

        await setTimeout(1100);

        await expect(twoFactorService.confirmRegisterTwoFactorMethodForUser(loggedIn.user, emailMethod, { code }))
            .rejects.toThrow(/No code is waiting/);
    });
});