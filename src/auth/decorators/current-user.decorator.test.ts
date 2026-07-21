import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

import { Auth } from './auth.decorator';
import { CurrentUser } from './current-user.decorator';
import { JwtUser } from '../../__testing__/mocks/entities/jwt-user.entity';
import { Roles } from '../../__testing__/mocks/entities/roles.enum';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { Repository } from '../../data-source/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { inject } from '../../di/inject.function';
import { Controller } from '../../routing/decorators/controller.decorator';
import { Get } from '../../routing/decorators/get.decorator';
import { JwtAuthController } from '../strategies/jwt/jwt-auth.controller';
import { JwtCredentials, JwtCredentialsCreateData } from '../strategies/jwt/jwt-credentials.model';
import { JwtAuthStrategy } from '../strategies/jwt/jwt.auth-strategy';

@Controller('/current-user-test')
class CurrentUserTestController {
    @Get('/required')
    @Auth.isLoggedIn([JwtAuthStrategy])
    requiredUser(@CurrentUser() user: JwtUser): { id: string, email: string } {
        return { id: user.id, email: user.email };
    }

    @Get('/optional')
    optionalUser(@CurrentUser(false) user: JwtUser | undefined): { id: string | undefined } {
        return { id: user?.id };
    }
}

type LoginResponseBody = { accessToken: { value: string } };

describe('CurrentUser decorator — real HTTP flow', () => {
    let server: StartedTestServer;
    let baseUrl: string;
    let userRepo: Repository<JwtUser>;
    let credentialsRepo: Repository<JwtCredentials, JwtCredentialsCreateData>;

    const email: string = 'current-user-test@example.com';
    const password: string = 'secure123';

    beforeAll(async () => {
        server = await startTestServer({ controllers: [JwtAuthController, CurrentUserTestController] });
        baseUrl = await server.start();
        userRepo = inject(repositoryTokenFor(JwtUser));
        credentialsRepo = inject(repositoryTokenFor(JwtCredentials));
    }, 20000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    beforeEach(async () => {
        await credentialsRepo.deleteAll({});
        await userRepo.deleteAll({});
    });

    async function login(): Promise<string> {
        const user: JwtUser = await userRepo.create({ email, roles: [Roles.USER] });
        await credentialsRepo.create({ email, password, userId: user.id });

        const res: Response = await fetch(`${baseUrl}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        expect(res.status).toBe(200);
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const body: LoginResponseBody = await res.json();
        return body.accessToken.value;
    }

    it('injects the currently logged in user into a @CurrentUser() parameter', async () => {
        const accessToken: string = await login();

        const res: Response = await fetch(`${baseUrl}/current-user-test/required`, {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        expect(res.status).toBe(200);
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const body: { id: string, email: string } = await res.json();
        expect(body.email).toBe(email);
    });

    it('rejects a request without a token when @Auth.isLoggedIn() guards the route', async () => {
        const res: Response = await fetch(`${baseUrl}/current-user-test/required`);
        expect(res.status).toBe(401);
    });

    it('resolves the user for an optional @CurrentUser(false) route when a token is present', async () => {
        const accessToken: string = await login();

        const res: Response = await fetch(`${baseUrl}/current-user-test/optional`, {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        expect(res.status).toBe(200);
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const body: { id: string | undefined } = await res.json();
        expect(body.id).toBeTruthy();
    });

    it('resolves undefined for an optional @CurrentUser(false) route when no token is present', async () => {
        const res: Response = await fetch(`${baseUrl}/current-user-test/optional`);

        expect(res.status).toBe(200);
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const body: { id: string | undefined } = await res.json();
        expect(body.id).toBeUndefined();
    });
});