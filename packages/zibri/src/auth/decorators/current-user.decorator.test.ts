import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Auth } from './auth.decorator.ts';
import { CurrentUser } from './current-user.decorator.ts';
import { JwtTestAuthController } from '../../__testing__/mocks/controllers/jwt-test-auth.controller.ts';
import { JwtUser } from '../../__testing__/mocks/entities/jwt-user.entity.ts';
import { Roles } from '../../__testing__/mocks/entities/roles.enum.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { Repository } from '../../data-source/repository/repository.ts';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator.ts';
import { inject } from '../../di/inject.function.ts';
import { Controller } from '../../routing/decorators/controller.decorator.ts';
import { Get } from '../../routing/decorators/get.decorator.ts';
import { JsonUtilities } from '../../utilities/json.utilities.ts';
import { PasswordCredentials, PasswordCredentialsCreateData } from '../authenticators/password/password-credentials.model.ts';
import { JwtAuthStrategy } from '../strategies/jwt/jwt.auth-strategy.ts';

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
    let credentialsRepo: Repository<PasswordCredentials, PasswordCredentialsCreateData>;

    const email: string = 'current-user-test@example.com';
    const password: string = 'secure123';

    beforeAll(async () => {
        server = await startTestServer({ controllers: [JwtTestAuthController, CurrentUserTestController] });
        baseUrl = await server.start();
        userRepo = inject(repositoryTokenFor(JwtUser));
        credentialsRepo = inject(repositoryTokenFor(PasswordCredentials));
    }, 40000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    beforeEach(async () => {
        await credentialsRepo.deleteAll({});
        await userRepo.deleteAll({});
    });

    async function login(): Promise<string> {
        const user: JwtUser = await userRepo.create({ email, roles: [Roles.USER] });
        await credentialsRepo.create({ password, userId: user.id });

        const res: Response = await fetch(`${baseUrl}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JsonUtilities.stringify({ email, password })
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