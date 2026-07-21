import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { TOTP } from 'otpauth';

import { OtpCredentials } from './methods/otp/otp-credentials.model';
import { TwoFactorServiceInterface } from './two-factor-service.interface';
import { createTestDataSource, defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
import { startTestServer, StartedTestServer } from '../../__testing__/test-server/start-test-server.function';
import { HttpRequestContext } from '../../context/request/http-request.context';
import { RequestContextToken } from '../../context/request/request-context-token.model';
import { PostgresDataSource } from '../../data-source/data-sources/postgres-typeorm-data-source.model';
import { Repository } from '../../data-source/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { BaseUserEntity } from '../models/base-user.model';
import { OtpConfirmRegisterData, OtpTwoFactorMethod } from './methods/otp/otp.two-factor-method';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Newable } from '../../types/newable.type';

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

    it('requestRegister should create an unconfirmed credential', async () => {
        await twoFactorService.requestRegisterTwoFactorMethodForUser(user, otpMethod, undefined);
        const credentials: OtpCredentials[] = await otpCredentialsRepo.findAll({ where: { userId: user.id } });
        expect(credentials).toHaveLength(1);
        expect(credentials[0].secret).toBeTruthy();
        expect(credentials[0].confirmed).toBe(false);
    });

    it('confirmRegister with a valid token should mark the credential as confirmed', async () => {
        await twoFactorService.requestRegisterTwoFactorMethodForUser(user, otpMethod, undefined);
        const credentials: OtpCredentials[] = await otpCredentialsRepo.findAll({ where: { userId: user.id } });
        const secret: string = credentials[0].secret;

        const validToken: string = new TOTP({ secret }).generate();
        await twoFactorService.confirmRegisterTwoFactorMethodForUser(user, otpMethod, {
            token: validToken
        } as OtpConfirmRegisterData);

        const updated: OtpCredentials[] = await otpCredentialsRepo.findAll({ where: { userId: user.id } });
        expect(updated[0].confirmed).toBe(true);
    });

    it('confirmRegister with an invalid token should throw', async () => {
        await twoFactorService.requestRegisterTwoFactorMethodForUser(user, otpMethod, undefined);
        await expect(
            twoFactorService.confirmRegisterTwoFactorMethodForUser(user, otpMethod, {
                token: '000000'.slice(0, otpLength)
            } as OtpConfirmRegisterData)
        ).rejects.toThrow('The provided two factor code is invalid.');
    });

    it('has2fa should return true when a valid OTP header is present', async () => {
        // register & confirm
        await twoFactorService.requestRegisterTwoFactorMethodForUser(user, otpMethod, undefined);
        const credentials: OtpCredentials[] = await otpCredentialsRepo.findAll({ where: { userId: user.id } });
        const validToken: string = new TOTP({ secret: credentials[0].secret }).generate();
        await twoFactorService.confirmRegisterTwoFactorMethodForUser(user, otpMethod, {
            token: validToken
        } as OtpConfirmRegisterData);

        const context: HttpRequestContext = {
            request: { headers: { [otpHeader]: validToken } },
            // eslint-disable-next-line unusedImports/no-unused-vars
            has: <T>(token: RequestContextToken<T>) => false
        } as HttpRequestContext;

        const result: boolean = await twoFactorService.has2fa(user, context);
        expect(result).toBe(true);
    });

    it('has2fa should return false when the token is invalid', async () => {
        await twoFactorService.requestRegisterTwoFactorMethodForUser(user, otpMethod, undefined);
        const credentials: OtpCredentials[] = await otpCredentialsRepo.findAll({ where: { userId: user.id } });
        const validToken: string = new TOTP({ secret: credentials[0].secret }).generate();
        await twoFactorService.confirmRegisterTwoFactorMethodForUser(user, otpMethod, {
            token: validToken
        } as OtpConfirmRegisterData);

        const context: HttpRequestContext = {
            request: { headers: { [otpHeader]: '000000'.slice(0, otpLength) } },
            // eslint-disable-next-line unusedImports/no-unused-vars
            has: <T>(token: RequestContextToken<T>) => false
        } as HttpRequestContext;

        const result: boolean = await twoFactorService.has2fa(user, context);
        expect(result).toBe(false);
    });

    it('unregister should delete all credentials and make has2fa false', async () => {
        await twoFactorService.requestRegisterTwoFactorMethodForUser(user, otpMethod, undefined);
        const credentials: OtpCredentials[] = await otpCredentialsRepo.findAll({ where: { userId: user.id } });
        await twoFactorService.confirmRegisterTwoFactorMethodForUser(user, otpMethod, {
            token: new TOTP({ secret: credentials[0].secret }).generate()
        } as OtpConfirmRegisterData);

        await twoFactorService.unregisterTwoFactorMethodForUser(user, otpMethod);

        const remaining: OtpCredentials[] = await otpCredentialsRepo.findAll({ where: { userId: user.id } });
        expect(remaining).toHaveLength(0);

        const context: HttpRequestContext = {
            request: { headers: { [otpHeader]: 'does-not-matter' } },
            // eslint-disable-next-line unusedImports/no-unused-vars
            has: <T>(token: RequestContextToken<T>) => false
        } as HttpRequestContext;
        const result: boolean = await twoFactorService.has2fa(user, context);
        expect(result).toBe(false);
    });
});