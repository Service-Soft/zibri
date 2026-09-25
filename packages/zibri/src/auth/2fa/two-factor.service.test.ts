import assert from 'node:assert';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { TOTP } from 'otpauth';

import { OtpCredentials } from './methods/otp/otp-credentials.model';
import { TwoFactorServiceInterface } from './two-factor-service.interface';
import { createTestDataSource, defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
import { startTestServer, StartedTestServer } from '../../__testing__/test-server/start-test-server.function';
import { HttpRequestContext } from '../../context/request/http-request.context';
import { PostgresDataSource } from '../../data-source/data-sources/postgres/postgres-typeorm-data-source.model';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Newable } from '../../types/newable.type';
import { BaseUserEntity } from '../models/base-user.model';
import { OtpTwoFactorMethod } from './methods/otp/otp.two-factor-method';
import { OTP_PERIOD_IN_SECONDS } from './methods/otp/otp.utilities';
import { Ms } from '../../utilities/ms';

enum TestRole {
    USER = 'user'
}

@Entity()
class User extends BaseUserEntity(TestRole) {}

let server: StartedTestServer;
let twoFactorService: TwoFactorServiceInterface;
let otpMethod: OtpTwoFactorMethod;
let userRepo: Repository<User>;
let otpCredentialsRepo: Repository<OtpCredentials>;
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
        otpHeader = inject(ZIBRI_DI_TOKENS.OTP_HEADER);
        otpLength = inject(ZIBRI_DI_TOKENS.OTP_LENGTH);
    }, 15000);

    afterAll(async () => {
        await server.shutdown();
    }, 15000);

    let user: User;

    beforeEach(async () => {
        // start fresh every test
        await otpCredentialsRepo.deleteAll({});
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
});