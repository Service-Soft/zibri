import { afterAll, describe, expect, it } from '@jest/globals';
import { TOTP } from 'otpauth';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { OtpRegistration, OtpTwoFactorMethod } from './methods/otp/otp.two-factor-method';
import { RecoveryCodeRegistration, RecoveryCodeTwoFactorMethod } from './methods/recovery-code/recovery-code.two-factor-method';
import { TwoFactorRecoveryCode } from './methods/recovery-code/two-factor-recovery-code.model';
import { type TwoFactorServiceInterface } from './two-factor-service.interface';
import { TestTimeouts } from '../../__testing__/constants';
import { JwtUser } from '../../__testing__/mocks/entities/jwt-user.entity';
import { Roles } from '../../__testing__/mocks/entities/roles.enum';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider, DiProvider } from '../../di/models/di-provider.model';
import { Newable } from '../../types/newable.type';
import { UUIDUtilities } from '../../utilities/uuid.utilities';

// one for every server of the file, each starting with its own store
const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
    entities: [...defaultTestServerEntities, TwoFactorRecoveryCode],
    repositories: defaultTestServerRepositories
});

let server: StartedTestServer | undefined;

/**
 * Starts an application whose users enroll an authenticator app and recovery codes.
 * @param providers - What it runs with besides the defaults.
 * @returns The server.
 */
async function startApp(providers: DiProvider<unknown>[]): Promise<StartedTestServer> {
    return await startTestServer({
        dataSources: [dataSourceClass],
        twoFactorMethods: [OtpTwoFactorMethod, RecoveryCodeTwoFactorMethod],
        providers: [...defaultTestServerProviders, ...providers]
    });
}

/**
 * Creates a user.
 * @returns The user.
 */
async function createUser(): Promise<JwtUser> {
    return await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser)).create({ email: `${UUIDUtilities.generate()}@options.test`, roles: [Roles.USER] });
}

/**
 * The two factor service of the running application.
 * @returns The service.
 */
function twoFactorService(): TwoFactorServiceInterface {
    return inject(ZIBRI_DI_TOKENS.TWO_FACTOR_SERVICE);
}

// 04 §A15: how many recovery codes a set holds, how long they are, and how long an authenticator app's
// code is shown for were constants, where a bank commonly wants others
describe('Two factor methods - what a deployment sets', () => {
    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('hands out ten recovery codes of ten characters, and app codes of 30 seconds, by default', async () => {
        server = await startApp([]);
        const user: JwtUser = await createUser();

        const codes: RecoveryCodeRegistration = await twoFactorService().requestTwoFactorRegistration(user, inject(RecoveryCodeTwoFactorMethod), undefined);
        const app: OtpRegistration = await twoFactorService().requestTwoFactorRegistration(user, inject(OtpTwoFactorMethod), undefined);

        expect(codes.codes).toHaveLength(10);
        expect(codes.codes.every(code => code.replace('-', '').length === 10)).toBe(true);
        expect(app.qrCodeUrl).toContain('period=30');
        await server.shutdown();
    }, TestTimeouts.inMemory.start + TestTimeouts.inMemory.shutdown);

    it('hands out as many and as long recovery codes, and app codes for as long, as the tokens say', async () => {
        server = await startApp([
            defineProvider({ token: ZIBRI_DI_TOKENS.RECOVERY_CODE_OPTIONS, useValue: { count: 16, length: 16 } }),
            defineProvider({ token: ZIBRI_DI_TOKENS.OTP_PERIOD_IN_SECONDS, useValue: 60 }),
            defineProvider({ token: ZIBRI_DI_TOKENS.OTP_VALIDATION_WINDOW_IN_MS, useValue: 0 })
        ]);
        const user: JwtUser = await createUser();

        const codes: RecoveryCodeRegistration = await twoFactorService().requestTwoFactorRegistration(user, inject(RecoveryCodeTwoFactorMethod), undefined);
        const app: OtpRegistration = await twoFactorService().requestTwoFactorRegistration(user, inject(OtpTwoFactorMethod), undefined);

        expect(codes.codes).toHaveLength(16);
        expect(codes.codes.every(code => code.replace('-', '').length === 16)).toBe(true);
        expect(app.qrCodeUrl).toContain('period=60');
        // the code an app shows for a minute is the one taken
        const token: string = new TOTP({ secret: app.secret, period: 60 }).generate();
        await twoFactorService().confirmTwoFactorRegistration(user, inject(OtpTwoFactorMethod), { token });
        expect(await twoFactorService().isRegistered(user, [OtpTwoFactorMethod])).toBe(true);
        await server.shutdown();
    }, TestTimeouts.inMemory.start + TestTimeouts.inMemory.shutdown);

    // app codes were generated and checked with six digits whatever OTP_LENGTH said, so a length of
    // eight refused every code, and the QR code named neither the application nor the user
    it('hands out app codes of as many digits as the token says, named after the application and the user', async () => {
        server = await startApp([defineProvider({ token: ZIBRI_DI_TOKENS.OTP_LENGTH, useValue: 8 })]);
        const user: JwtUser = await createUser();

        const app: OtpRegistration = await twoFactorService().requestTwoFactorRegistration(user, inject(OtpTwoFactorMethod), undefined);

        const url: URL = new URL(app.qrCodeUrl);
        expect(url.searchParams.get('digits')).toBe('8');
        // the name the test server runs as
        expect(url.searchParams.get('issuer')).toBe('test');
        expect(decodeURIComponent(url.pathname)).toContain(user.email);
        const token: string = new TOTP({ secret: app.secret, digits: 8 }).generate();
        await twoFactorService().confirmTwoFactorRegistration(user, inject(OtpTwoFactorMethod), { token });
        expect(await twoFactorService().isRegistered(user, [OtpTwoFactorMethod])).toBe(true);
        await server.shutdown();
    }, TestTimeouts.inMemory.start + TestTimeouts.inMemory.shutdown);

    it('refuses to start with a window that is no whole number of periods, or recovery codes weaker than the default', async () => {
        await expect(startApp([
            defineProvider({ token: ZIBRI_DI_TOKENS.OTP_PERIOD_IN_SECONDS, useValue: 60 }),
            defineProvider({ token: ZIBRI_DI_TOKENS.OTP_VALIDATION_WINDOW_IN_MS, useValue: 30_000 })
        ])).rejects.toThrow(/OTP_VALIDATION_WINDOW_IN_MS/);
        await expect(startApp([defineProvider({ token: ZIBRI_DI_TOKENS.RECOVERY_CODE_OPTIONS, useValue: { count: 10, length: 8 } })])).rejects.toThrow(/RECOVERY_CODE_OPTIONS/);
    }, TestTimeouts.inMemory.start * 2);
});