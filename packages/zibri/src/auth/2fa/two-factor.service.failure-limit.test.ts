import { setTimeout } from 'node:timers/promises';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TOTP } from 'otpauth';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { OtpCredentials } from './methods/otp/otp-credentials.model.ts';
import { OtpTwoFactorMethod } from './methods/otp/otp.two-factor-method.ts';
import { RecoveryCodeRegistration, RecoveryCodeTwoFactorMethod } from './methods/recovery-code/recovery-code.two-factor-method.ts';
import { TwoFactorRecoveryCode } from './methods/recovery-code/two-factor-recovery-code.model.ts';
import { TwoFactorFailureLimit, TwoFactorLock } from './two-factor-failure-limit.model.ts';
import { TwoFactorFailureStreak } from './two-factor-failure-streak.model.ts';
import { TwoFactorServiceInterface } from './two-factor-service.interface.ts';
import { JwtUser } from '../../__testing__/mocks/entities/jwt-user.entity.ts';
import { Roles } from '../../__testing__/mocks/entities/roles.enum.ts';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers.ts';
import { startAndStopTestServerWithout } from '../../__testing__/test-server/start-and-stop-test-server-without.function.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { Repository } from '../../data-source/repository/repository.ts';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../di/inject.function.ts';
import { defineProvider } from '../../di/models/di-provider.model.ts';
import { KnownHeader } from '../../http/known-header.enum.ts';
import { Controller } from '../../routing/decorators/controller.decorator.ts';
import { Get } from '../../routing/decorators/get.decorator.ts';
import { Newable } from '../../types/newable.type.ts';
import { JsonUtilities } from '../../utilities/json.utilities.ts';
import { AuthController } from '../auth-controller/auth-controller.model.ts';
import { PasswordCredentials, PasswordCredentialsCreateData } from '../authenticators/password/password-credentials.model.ts';
import { PasswordAuthenticator } from '../authenticators/password/password.authenticator.ts';
import { Auth } from '../decorators/auth.decorator.ts';
import { JwtAuthStrategy } from '../strategies/jwt/jwt.auth-strategy.ts';

const EMAIL: string = 'failure-limit@example.com';
const PASSWORD: string = 'secure123';
const LOCKED_MESSAGE: string = 'Your second factor is locked after too many wrong codes. Use a recovery code, or have it reset.';

// orphans for the starting cases, which boot without them
@Controller('/auth', { versions: 'all', allowOrphan: true })
class LimitAuthController extends AuthController({ strategies: [JwtAuthStrategy], authenticators: [PasswordAuthenticator], twoFactorMethods: [OtpTwoFactorMethod, RecoveryCodeTwoFactorMethod] }) {}

@Controller('/limited', { allowOrphan: true })
class LimitedController {
    @Get('/second-factor')
    @Auth.require2fa()
    secondFactor(): { ok: boolean } {
        return { ok: true };
    }

    @Get('/reauth')
    @Auth.require2fa({ reauth: true })
    reauth(): { ok: boolean } {
        return { ok: true };
    }
}

/**
 * Starts the application with the given limit, its wait after a wrong code shortened so a streak builds
 * up within a test.
 * @param twoFactorFailureLimit - The limit.
 * @returns The server, and the url it listens at.
 */
async function startApp(twoFactorFailureLimit: TwoFactorFailureLimit): Promise<[StartedTestServer, string]> {
    const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
        entities: [...defaultTestServerEntities, TwoFactorRecoveryCode],
        allowOrphan: true
    });
    const server: StartedTestServer = await startTestServer({
        dataSources: [dataSourceClass],
        authStrategies: [JwtAuthStrategy],
        authenticators: [PasswordAuthenticator],
        twoFactorMethods: [OtpTwoFactorMethod, RecoveryCodeTwoFactorMethod],
        twoFactorFailureLimit,
        controllers: [LimitAuthController, LimitedController],
        providers: [
            ...defaultTestServerProviders,
            defineProvider({ token: ZIBRI_DI_TOKENS.TWO_FACTOR_FAILURE_DELAY_IN_MS, useFactory: () => 1 })
        ]
    });
    return [server, await server.start()];
}

describe('TwoFactorService — the limit on wrong codes, starting', () => {
    it.each([0, 101, 2.5])('refuses %s wrong codes as the limit', async maxFailures => {
        await expect(startAndStopTestServerWithout([], { twoFactorFailureLimit: { maxFailures, lock: 'secondFactor' } }))
            .rejects.toThrow(`twoFactorFailureLimit.maxFailures must be a whole number from 1 to 100, got ${maxFailures}.`);
    }, 30000);
});

const locks: TwoFactorLock[] = ['secondFactor', 'account'];

for (const lock of locks) {
    describe(`TwoFactorService — the limit on wrong codes, locking the ${lock}`, () => {
        let server: StartedTestServer;
        let baseUrl: string;
        let user: JwtUser;
        let twoFactorService: TwoFactorServiceInterface;
        let otpSecret: string;
        let recoveryCodes: string[];

        async function logIn(): Promise<Response> {
            return await fetch(`${baseUrl}/auth/login`, {
                method: 'POST',
                headers: { [KnownHeader.CONTENT_TYPE]: 'application/json' },
                body: JsonUtilities.stringify({ email: EMAIL, password: PASSWORD })
            });
        }

        async function accessToken(): Promise<string> {
            const res: Response = await logIn();
            expect(res.status).toBe(200);
            // eslint-disable-next-line typescript/no-unsafe-assignment
            const body: { accessToken: { value: string } } = await res.json();
            return body.accessToken.value;
        }

        async function call(path: string, token: string, headers: Record<string, string> = {}): Promise<Response> {
            return await fetch(`${baseUrl}/limited${path}`, { headers: { [KnownHeader.AUTHORIZATION]: `Bearer ${token}`, ...headers } });
        }

        async function messageOf(res: Response): Promise<string> {
            // eslint-disable-next-line typescript/no-unsafe-assignment
            const body: { message: string } = await res.json();
            return body.message;
        }

        function otpHeaders(code: string): Record<string, string> {
            return { [inject(ZIBRI_DI_TOKENS.OTP_HEADER)]: code };
        }

        function recoveryHeaders(code: string): Record<string, string> {
            return { [inject(ZIBRI_DI_TOKENS.RECOVERY_CODE_HEADER)]: code };
        }

        function wrongOtp(): string {
            return new TOTP({ secret: otpSecret }).generate() === '000000' ? '111111' : '000000';
        }

        /**
         * Presents wrong codes until the limit of three locks the second factor.
         * @param token - The access token to present them with.
         * @returns The answer to the code that locked it.
         */
        async function guessUntilLocked(token: string): Promise<Response> {
            for (let i: number = 0; i < 2; i++) {
                expect((await call('/second-factor', token, otpHeaders(wrongOtp()))).status).toBe(401);
                // past the doubled wait, which is a few milliseconds here
                await setTimeout(50);
            }
            return await call('/second-factor', token, otpHeaders(wrongOtp()));
        }

        beforeAll(async () => {
            [server, baseUrl] = await startApp({ maxFailures: 3, lock });
            twoFactorService = inject(ZIBRI_DI_TOKENS.TWO_FACTOR_SERVICE);
            user = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser)).create({ email: EMAIL, roles: [Roles.USER] });
            await inject<Repository<PasswordCredentials, PasswordCredentialsCreateData>>(repositoryTokenFor(PasswordCredentials))
                .create({ password: PASSWORD, userId: user.id });
        }, 30000);

        beforeEach(async () => {
            await twoFactorService.resetSecondFactors(user);
            const otp: OtpTwoFactorMethod = inject(OtpTwoFactorMethod);
            otpSecret = (await twoFactorService.requestRegisterTwoFactorMethodForUser(user, otp, undefined)).secret;
            // the previous step's code, so the current one is still unspent for the test
            await twoFactorService.confirmRegisterTwoFactorMethodForUser(user, otp, {
                token: new TOTP({ secret: otpSecret }).generate({ timestamp: Date.now() - 30_000 })
            });
            const recovery: RecoveryCodeTwoFactorMethod = inject(RecoveryCodeTwoFactorMethod);
            const registration: RecoveryCodeRegistration = await twoFactorService.requestRegisterTwoFactorMethodForUser(user, recovery, undefined);
            recoveryCodes = registration.codes;
            await twoFactorService.confirmRegisterTwoFactorMethodForUser(user, recovery, { code: recoveryCodes[0] ?? '' });
        });

        afterAll(async () => {
            await server?.shutdown();
        }, 15000);

        it('locks the second factor at the limit, and says so on the code that locks it', async () => {
            const token: string = await accessToken();

            const locking: Response = await guessUntilLocked(token);

            expect(locking.status).toBe(403);
            expect(await messageOf(locking)).toBe(LOCKED_MESSAGE);
            expect(await twoFactorService.resolveLock(user)).toBe(lock);
        });

        it('replaces a set of recovery codes only once a code of the new one is confirmed', async () => {
            const recovery: RecoveryCodeTwoFactorMethod = inject(RecoveryCodeTwoFactorMethod);
            const next: RecoveryCodeRegistration = await twoFactorService.requestRegisterTwoFactorMethodForUser(user, recovery, undefined);

            await expect(twoFactorService.confirmRegisterTwoFactorMethodForUser(user, recovery, { code: recoveryCodes[1] ?? '' }))
                .rejects.toThrow('The provided two factor code is invalid.');
            // the old set still works until then
            expect((await call('/second-factor', await accessToken(), recoveryHeaders(recoveryCodes[1] ?? ''))).status).toBe(200);

            await twoFactorService.confirmRegisterTwoFactorMethodForUser(user, recovery, { code: next.codes[0] ?? '' });
            expect((await call('/second-factor', await accessToken(), recoveryHeaders(recoveryCodes[2] ?? ''))).status).toBe(401);
            expect((await call('/second-factor', await accessToken(), recoveryHeaders(next.codes[1] ?? ''))).status).toBe(200);
        });

        it('lifts the lock with a reset, which removes every second factor', async () => {
            await guessUntilLocked(await accessToken());

            await twoFactorService.resetSecondFactors(user);

            expect(await twoFactorService.resolveLock(user)).toBeUndefined();
            expect(await twoFactorService.isRegistered(user)).toBe(false);
            expect((await logIn()).status).toBe(200);
        });

        if (lock === 'secondFactor') {
            it('does not check the right code of a locked method', async () => {
                const token: string = await accessToken();
                await guessUntilLocked(token);
                await setTimeout(50);

                const res: Response = await call('/second-factor', token, otpHeaders(new TOTP({ secret: otpSecret }).generate()));

                expect(res.status).toBe(403);
                expect(await messageOf(res)).toBe(LOCKED_MESSAGE);
            });

            it('does not take a recent login in place of a locked second factor', async () => {
                const token: string = await accessToken();
                expect((await call('/reauth', token)).status).toBe(200);

                await guessUntilLocked(token);
                await setTimeout(50);

                // a login made after the lock as well, since it is the most recent there can be
                expect((await call('/reauth', token)).status).toBe(403);
                expect((await call('/reauth', await accessToken())).status).toBe(403);
            });

            it('lets a recovery code through, which removes the locked methods and lifts the lock', async () => {
                const token: string = await accessToken();
                await guessUntilLocked(token);
                await setTimeout(50);

                // with its dash and in another case, the way a person types it
                const res: Response = await call('/second-factor', token, recoveryHeaders(recoveryCodes[1]?.toLowerCase() ?? ''));

                expect(res.status).toBe(200);
                expect(await twoFactorService.resolveLock(user)).toBeUndefined();
                // the authenticator that was guessed at is gone, so the user enrolls a new one
                expect(await inject(OtpTwoFactorMethod).isRegisteredForUser(user)).toBe(false);
                expect(await inject<Repository<OtpCredentials>>(repositoryTokenFor(OtpCredentials)).count({ where: { userId: user.id } }))
                    .toBe(0);
                // and the code is spent, while the rest of the set still works
                expect(await inject<Repository<TwoFactorRecoveryCode>>(repositoryTokenFor(TwoFactorRecoveryCode))
                    .count({ where: { userId: user.id } })).toBe(recoveryCodes.length - 1);
                await setTimeout(50);
                expect((await call('/second-factor', token, recoveryHeaders(recoveryCodes[1] ?? ''))).status).toBe(401);
            });

            it('counts a wrong recovery code towards the wait while locked', async () => {
                const token: string = await accessToken();
                await guessUntilLocked(token);
                await setTimeout(50);

                const res: Response = await call('/second-factor', token, recoveryHeaders('AAAAA-AAAAA'));

                expect(res.status).toBe(401);
                const streak: TwoFactorFailureStreak | undefined = await inject<Repository<TwoFactorFailureStreak>>(
                    repositoryTokenFor(TwoFactorFailureStreak)
                ).findOne({ where: { userId: user.id }, required: false });
                expect(streak?.count).toBe(4);
            });

            it('still logs the user in', async () => {
                await guessUntilLocked(await accessToken());

                expect((await logIn()).status).toBe(200);
            });
        }
        else {
            it('refuses to log the user in, and ends the logins they had', async () => {
                const res: Response = await logIn();
                expect(res.status).toBe(200);
                // eslint-disable-next-line typescript/no-unsafe-assignment
                const { accessToken: access, refreshToken }: { accessToken: { value: string }, refreshToken: { value: string } } = await res.json();

                await guessUntilLocked(access.value);

                const login: Response = await logIn();
                expect(login.status).toBe(403);
                expect(await messageOf(login)).toBe('This account is locked after too many wrong two factor codes.');
                const refreshed: Response = await fetch(`${baseUrl}/auth/refresh-login`, {
                    method: 'POST',
                    headers: { [KnownHeader.CONTENT_TYPE]: 'application/json' },
                    body: JsonUtilities.stringify({ refreshToken: refreshToken.value })
                });
                expect(refreshed.status).toBe(401);
            });
        }
    });
}