import assert from 'node:assert';
import { setTimeout } from 'node:timers/promises';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TOTP } from 'otpauth';

import { InvalidTwoFactorCodeError } from './invalid-two-factor-code.error.ts';
import { OtpCodeAlreadyUsedError } from './methods/otp/otp-code-already-used.error.ts';
import { OtpCredentials } from './methods/otp/otp-credentials.model.ts';
import { TwoFactorFailureStreak } from './two-factor-failure-streak.model.ts';
import { TwoFactorServiceInterface } from './two-factor-service.interface.ts';
import { TwoFactorThrottledError } from './two-factor-throttled.error.ts';
import { createTestDataSource, defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers.ts';
import { startAndStopTestServerWithout } from '../../__testing__/test-server/start-and-stop-test-server-without.function.ts';
import { startTestServer, StartedTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { HttpRequestContext } from '../../context/request/http-request.context.ts';
import { PostgresDataSource } from '../../data-source/data-sources/postgres/postgres-typeorm-data-source.model.ts';
import { Repository } from '../../data-source/repository/repository.ts';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../di/inject.function.ts';
import { defineProvider } from '../../di/models/di-provider.model.ts';
import { Entity } from '../../entity/decorators/entity.decorator.ts';
import { UnauthorizedError } from '../../error-handling/errors/unauthorized.error.ts';
import { Newable } from '../../types/newable.type.ts';
import { BaseUserEntity } from '../models/base-user.model.ts';
import { OtpTwoFactorMethod } from './methods/otp/otp.two-factor-method.ts';
import { OTP_PERIOD_IN_SECONDS } from './methods/otp/otp.utilities.ts';
import { Ms } from '../../utilities/ms.ts';

enum TestRole {
    USER = 'user'
}

// allowed to go unused, because the starting case boots without it
@Entity({ tenant: 'shared', allowOrphan: true })
class User extends BaseUserEntity(TestRole) {}

let server: StartedTestServer;
let twoFactorService: TwoFactorServiceInterface;
let otpMethod: OtpTwoFactorMethod;
let userRepo: Repository<User>;
let otpCredentialsRepo: Repository<OtpCredentials>;
let streakRepo: Repository<TwoFactorFailureStreak>;
let otpHeader: string; // injected value of ZIBRI_DI_TOKENS.OTP_HEADER
let otpLength: number;

/**
 * The code the authenticator showed one window ago.
 *
 * What an enrollment is confirmed with whenever the test then wants to present a code of its own.
 * Confirming is a successful validation and spends the digits it is given, so confirming with the
 * current code would leave the test holding a code that is already used - and the refusal it then
 * gets says nothing about what it was trying to observe.
 * @param secret - The secret to generate for.
 * @returns The code of the previous step.
 */
function previousCode(secret: string): string {
    return new TOTP({ secret, period: OTP_PERIOD_IN_SECONDS })
        .generate({ timestamp: Date.now() - (OTP_PERIOD_IN_SECONDS * Ms.SECOND) });
}

// first, for the reason on startAndStopTestServerWithout
describe('OtpTwoFactorMethod — starting', () => {
    it('refuses to start without OtpCredentials, and names it', async () => {
        const start: Promise<void> = startAndStopTestServerWithout([OtpCredentials]);

        await expect(start).rejects.toThrow(/Error initializing OtpTwoFactorMethod[\S\s]*OtpCredentials/);
    }, 30000);

    it('refuses to start without TwoFactorFailureStreak, and names it', async () => {
        const start: Promise<void> = startAndStopTestServerWithout([TwoFactorFailureStreak]);

        await expect(start).rejects.toThrow(/Error initializing TwoFactorService[\S\s]*TwoFactorFailureStreak/);
    }, 30000);

    it('refuses a failure delay that would switch the wait off', async () => {
        const start: Promise<void> = startAndStopTestServerWithout([], {
            providers: [
                ...defaultTestServerProviders,
                defineProvider({ token: ZIBRI_DI_TOKENS.TWO_FACTOR_FAILURE_DELAY_IN_MS, useFactory: () => 0 })
            ]
        });

        await expect(start).rejects.toThrow(/TWO_FACTOR_FAILURE_DELAY_IN_MS must be greater than 0/);
    }, 30000);
});

describe('TwoFactorService (contract via OTP method)', () => {
    beforeAll(async () => {
        const dataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
            entities: [...defaultTestServerEntities, User]
        });
        server = await startTestServer({ dataSources: [dataSourceClass] });

        twoFactorService = inject(ZIBRI_DI_TOKENS.TWO_FACTOR_SERVICE);
        otpMethod = inject(OtpTwoFactorMethod);
        userRepo = inject(repositoryTokenFor(User));
        otpCredentialsRepo = inject(repositoryTokenFor(OtpCredentials));
        streakRepo = inject(repositoryTokenFor(TwoFactorFailureStreak));
        otpHeader = inject(ZIBRI_DI_TOKENS.OTP_HEADER);
        otpLength = inject(ZIBRI_DI_TOKENS.OTP_LENGTH);
    }, 30000);

    afterAll(async () => {
        await server.shutdown();
    }, 15000);

    let user: User;

    beforeEach(async () => {
        // start fresh every test
        await otpCredentialsRepo.deleteAll({});
        await streakRepo.deleteAll({});
        await userRepo.deleteAll({});
        user = await userRepo.create({ email: '2fa-test@example.com', roles: [TestRole.USER] });
    });

    /**
     * The credential registering the otp method left for the user.
     *
     * Every test that generates a code needs the secret off it, so the row not being there is worth
     * failing on once here rather than in whatever the code generator does with nothing.
     * @returns The credential.
     */
    async function registeredCredential(): Promise<OtpCredentials> {
        const [credential]: OtpCredentials[] = await otpCredentialsRepo.findAll({ where: { userId: user.id } });
        assert(credential, 'no otp credential was registered for the user');
        return credential;
    }

    it('requestRegister should create an unconfirmed credential', async () => {
        await twoFactorService.requestRegisterTwoFactorMethodForUser(user, otpMethod, undefined);
        const credentials: OtpCredentials[] = await otpCredentialsRepo.findAll({ where: { userId: user.id } });
        expect(credentials).toHaveLength(1);
        expect(credentials[0]?.secret).toBeTruthy();
        expect(credentials[0]?.confirmed).toBe(false);
    });

    it('confirmRegister with a valid token should mark the credential as confirmed', async () => {
        await twoFactorService.requestRegisterTwoFactorMethodForUser(user, otpMethod, undefined);
        const credential: OtpCredentials = await registeredCredential();
        const secret: string = credential.secret;

        const validToken: string = new TOTP({ secret }).generate();
        await twoFactorService.confirmRegisterTwoFactorMethodForUser(user, otpMethod, {
            token: validToken
        });

        const updated: OtpCredentials[] = await otpCredentialsRepo.findAll({ where: { userId: user.id } });
        expect(updated[0]?.confirmed).toBe(true);
    });

    it('confirmRegister with an invalid token should throw', async () => {
        await twoFactorService.requestRegisterTwoFactorMethodForUser(user, otpMethod, undefined);
        await expect(
            twoFactorService.confirmRegisterTwoFactorMethodForUser(user, otpMethod, {
                token: '000000'.slice(0, otpLength)
            })
        ).rejects.toThrow('The provided two factor code is invalid.');
    });

    it('has2fa should return true when a valid and unused OTP header is present', async () => {
        // register & confirm
        await twoFactorService.requestRegisterTwoFactorMethodForUser(user, otpMethod, undefined);
        const credential: OtpCredentials = await registeredCredential();
        await twoFactorService.confirmRegisterTwoFactorMethodForUser(user, otpMethod, {
            token: previousCode(credential.secret)
        });
        const validToken: string = new TOTP({ secret: credential.secret }).generate();

        const context: HttpRequestContext = {
            request: { headers: { [otpHeader]: validToken } }
        } as HttpRequestContext;

        const result: boolean = await twoFactorService.has2fa(user, context);
        expect(result).toBe(true);
    });

    it('has2fa should return false when the token is invalid', async () => {
        await twoFactorService.requestRegisterTwoFactorMethodForUser(user, otpMethod, undefined);
        const credential: OtpCredentials = await registeredCredential();
        const validToken: string = new TOTP({ secret: credential.secret }).generate();
        await twoFactorService.confirmRegisterTwoFactorMethodForUser(user, otpMethod, {
            token: validToken
        });

        const context: HttpRequestContext = {
            request: { headers: { [otpHeader]: '000000'.slice(0, otpLength) } }
        } as HttpRequestContext;

        const result: boolean = await twoFactorService.has2fa(user, context);
        expect(result).toBe(false);
    });

    it('has2fa should return false when the token is valid but has already been used', async () => {
        // register & confirm
        await twoFactorService.requestRegisterTwoFactorMethodForUser(user, otpMethod, undefined);
        const credential: OtpCredentials = await registeredCredential();
        await twoFactorService.confirmRegisterTwoFactorMethodForUser(user, otpMethod, {
            token: previousCode(credential.secret)
        });
        const validToken: string = new TOTP({ secret: credential.secret }).generate();

        const context: HttpRequestContext = {
            request: { headers: { [otpHeader]: validToken } }
        } as HttpRequestContext;

        // used once, should be fine
        const result: boolean = await twoFactorService.has2fa(user, context);
        expect(result).toBe(true);
        // used twice, should be false
        const secondUseResult: boolean = await twoFactorService.has2fa(user, context);
        expect(secondUseResult).toBe(false);
    });

    it('unregister should delete all credentials and make has2fa false', async () => {
        await twoFactorService.requestRegisterTwoFactorMethodForUser(user, otpMethod, undefined);
        const credential: OtpCredentials = await registeredCredential();
        await twoFactorService.confirmRegisterTwoFactorMethodForUser(user, otpMethod, {
            token: new TOTP({ secret: credential.secret }).generate()
        });

        await twoFactorService.unregisterTwoFactorMethodForUser(user, otpMethod);

        const remaining: OtpCredentials[] = await otpCredentialsRepo.findAll({ where: { userId: user.id } });
        expect(remaining).toHaveLength(0);

        const context: HttpRequestContext = {
            request: { headers: { [otpHeader]: 'does-not-matter' } }
        } as HttpRequestContext;
        const result: boolean = await twoFactorService.has2fa(user, context);
        expect(result).toBe(false);
    });

    describe('wrong codes in a row', () => {
        /**
         * Enrolls the user and hands back the secret their authenticator holds.
         * @returns The secret.
         */
        async function enrolled(): Promise<string> {
            await twoFactorService.requestRegisterTwoFactorMethodForUser(user, otpMethod, undefined);
            const credential: OtpCredentials = await registeredCredential();
            await twoFactorService.confirmRegisterTwoFactorMethodForUser(user, otpMethod, { token: previousCode(credential.secret) });
            return credential.secret;
        }

        function contextWith(code: string | undefined): HttpRequestContext {
            return { request: { headers: code == undefined ? {} : { [otpHeader]: code } } } as HttpRequestContext;
        }

        function wrongCodeFor(secret: string): string {
            return new TOTP({ secret }).generate() === '000000' ? '111111' : '000000';
        }

        async function streakOf(): Promise<TwoFactorFailureStreak | undefined> {
            return await streakRepo.findOne({ where: { userId: user.id }, required: false });
        }

        async function waitUntil(date: Date): Promise<void> {
            await setTimeout(Math.max(0, date.getTime() - Date.now()) + 50);
        }

        it('doubles the wait with each wrong code', async () => {
            const secret: string = await enrolled();

            await expect(twoFactorService.validate2fa(user, contextWith(wrongCodeFor(secret)))).rejects.toThrow(InvalidTwoFactorCodeError);
            const first: TwoFactorFailureStreak | undefined = await streakOf();
            assert(first);
            expect(first.count).toBe(1);

            await waitUntil(first.retryAt);
            const secondFailedAt: number = Date.now();
            await expect(twoFactorService.validate2fa(user, contextWith(wrongCodeFor(secret)))).rejects.toThrow(InvalidTwoFactorCodeError);
            const second: TwoFactorFailureStreak | undefined = await streakOf();
            assert(second);
            expect(second.count).toBe(2);
            // twice the first wait, measured from the second failure
            expect(second.retryAt.getTime() - secondFailedAt).toBeGreaterThanOrEqual(Ms.SECOND * 2);
            expect(second.retryAt.getTime() - secondFailedAt).toBeLessThan(Ms.SECOND * 3);
        });

        it('refuses the right code unchecked while the user has to wait, and ends the streak with it afterwards', async () => {
            const secret: string = await enrolled();
            await expect(twoFactorService.validate2fa(user, contextWith(wrongCodeFor(secret)))).rejects.toThrow(InvalidTwoFactorCodeError);

            const code: string = new TOTP({ secret }).generate();
            await expect(twoFactorService.validate2fa(user, contextWith(code))).rejects.toThrow(TwoFactorThrottledError);

            const streak: TwoFactorFailureStreak | undefined = await streakOf();
            assert(streak);
            await waitUntil(streak.retryAt);
            // refused unchecked, so the same code was never spent and is still good
            await twoFactorService.validate2fa(user, contextWith(code));
            expect(await streakOf()).toBeUndefined();
        });

        it('does not count a request without a code, or a code already used', async () => {
            const secret: string = await enrolled();
            const code: string = new TOTP({ secret }).generate();
            await twoFactorService.validate2fa(user, contextWith(code));

            await expect(twoFactorService.validate2fa(user, contextWith(undefined))).rejects.toThrow(UnauthorizedError);
            await expect(twoFactorService.validate2fa(user, contextWith(code))).rejects.toThrow(OtpCodeAlreadyUsedError);

            expect(await streakOf()).toBeUndefined();
        });
    });
});