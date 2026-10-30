import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { CookieAuthRefreshSession } from './cookie-auth-refresh-session.model';
import { CookieAuthSession } from './cookie-auth-session.model';
import { CookieAuthStrategy } from './cookie-auth.auth-strategy';
import { TestTimeouts } from '../../../__testing__/constants';
import { CookieTestAuthController } from '../../../__testing__/mocks/controllers/cookie-test-auth.controller';
import { JwtUser } from '../../../__testing__/mocks/entities/jwt-user.entity';
import { Roles } from '../../../__testing__/mocks/entities/roles.enum';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { Repository } from '../../../data-source/repository/repository';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { defineProvider } from '../../../di/models/di-provider.model';
import { JsonUtilities } from '../../../utilities/json.utilities';
import { Ms } from '../../../utilities/ms';
import { PasswordCredentials, PasswordCredentialsCreateData } from '../../authenticators/password/password-credentials.model';

const PASSWORD: string = 'correct horse battery staple';

let server: StartedTestServer | undefined;
let baseUrl: string;

// 04 §A15: how long a row outlives its cookie was five minutes in code, for clocks that run behind
describe('CookieAuthStrategy - the rows outliving their cookies', () => {
    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [
                createInMemoryDataSource({
                    entities: [...defaultTestServerEntities, CookieAuthSession, CookieAuthRefreshSession],
                    repositories: defaultTestServerRepositories
                })
            ],
            authStrategies: [CookieAuthStrategy],
            controllers: [CookieTestAuthController],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({ token: ZIBRI_DI_TOKENS.COOKIE_SIGN_SECRET, useFactory: () => 'test-cookie-secret' }),
                defineProvider({ token: ZIBRI_DI_TOKENS.COOKIE_AUTH_ROW_GRACE_IN_MS, useValue: Ms.MINUTE * 20 })
            ]
        });
        baseUrl = await server.start();
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('keeps a row as long past its cookie as ZIBRI_DI_TOKENS.COOKIE_AUTH_ROW_GRACE_IN_MS says', async () => {
        const user: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser)).create({ email: 'grace@row.test', roles: [Roles.USER] });
        await inject<Repository<PasswordCredentials, PasswordCredentialsCreateData>>(repositoryTokenFor(PasswordCredentials))
            .create({ userId: user.id, password: PASSWORD });
        const before: number = Date.now();

        const res: Response = await fetch(`${baseUrl}/auth/login`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JsonUtilities.stringify({ email: user.email, password: PASSWORD })
        });
        expect(res.status).toBe(200);

        const session: CookieAuthSession = await inject(repositoryTokenFor(CookieAuthSession)).findOne({ where: { userId: user.id } });
        const refreshSession: CookieAuthRefreshSession = await inject(repositoryTokenFor(CookieAuthRefreshSession)).findOne({ where: { userId: user.id } });
        // a day and thirty days, the lifetimes of the cookies, and the grace on top
        expect(new Date(session.expirationDate).getTime()).toBeGreaterThanOrEqual(before + Ms.DAY + (Ms.MINUTE * 20));
        expect(new Date(refreshSession.expirationDate).getTime()).toBeGreaterThanOrEqual(before + (Ms.DAY * 30) + (Ms.MINUTE * 20));
    });
});