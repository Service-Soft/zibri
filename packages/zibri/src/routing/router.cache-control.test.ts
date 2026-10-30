import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { Controller } from './decorators/controller.decorator';
import { Get } from './decorators/get.decorator';
import { testFileFolder, TestTimeouts } from '../__testing__/constants';
import { JwtTestAuthController } from '../__testing__/mocks/controllers/jwt-test-auth.controller';
import { JwtUser } from '../__testing__/mocks/entities/jwt-user.entity';
import { Roles } from '../__testing__/mocks/entities/roles.enum';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { PasswordCredentials, PasswordCredentialsCreateData } from '../auth/authenticators/password/password-credentials.model';
import { Auth } from '../auth/decorators/auth.decorator';
import { JwtAuthStrategy } from '../auth/strategies/jwt/jwt.auth-strategy';
import { Repository } from '../data-source/repository/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { inject } from '../di/inject.function';
import { JsonResponse } from '../http/json-response.model';
import { KnownHeader } from '../http/known-header.enum';
import { MimeType } from '../http/mime-type.enum';
import { Response } from '../open-api/decorators/response.decorator';
import { FileResponse } from '../parsing/form-data/file-response.model';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';
import { JsonUtilities } from '../utilities/json.utilities';

const PASSWORD: string = 'correct horse battery staple';

const reportPath: FsPath = FsUtilities.getPath(testFileFolder, 'cache-control-report.txt');

@Controller('/cache-control')
class CacheControlController {
    @Auth.isLoggedIn()
    @Get('/me')
    me(): { name: string } {
        return { name: 'Ada' };
    }

    @Auth.isLoggedIn()
    @Response.file()
    @Get('/report')
    async report(): Promise<FileResponse> {
        return await FileResponse.fromPath(reportPath);
    }

    @Auth.isLoggedIn()
    @Get('/own')
    own(): JsonResponse<{ name: string }> {
        return JsonResponse.of({ name: 'Ada' }, { headers: { [KnownHeader.CACHE_CONTROL]: 'private, max-age=60' } });
    }

    @Auth.skip()
    @Response.file()
    @Get('/public-report')
    async publicReport(): Promise<FileResponse> {
        return await FileResponse.fromPath(reportPath);
    }
}

let server: StartedTestServer | undefined;
let baseUrl: string;
let accessToken: string;

beforeAll(async () => {
    await FsUtilities.upsertFile(reportPath, 'the report');
    server = await startTestServer({
        dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories })],
        authStrategies: [JwtAuthStrategy],
        controllers: [JwtTestAuthController, CacheControlController],
        providers: defaultTestServerProviders
    });
    baseUrl = await server.start();

    const user: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser)).create({ email: 'ada@cache-control.test', roles: [Roles.USER] });
    const credentials: Repository<PasswordCredentials, PasswordCredentialsCreateData> = inject(repositoryTokenFor(PasswordCredentials));
    await credentials.create({ userId: user.id, password: PASSWORD });
    const login: globalThis.Response = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { [KnownHeader.CONTENT_TYPE]: MimeType.JSON },
        body: JsonUtilities.stringify({ email: user.email, password: PASSWORD })
    });
    const tokens: unknown = await login.json();
    if (typeof tokens !== 'object' || tokens == undefined || !('accessToken' in tokens) || typeof tokens.accessToken !== 'object' || tokens.accessToken == undefined
        || !('value' in tokens.accessToken) || typeof tokens.accessToken.value !== 'string') {
        throw new Error('the login answered no access token');
    }
    accessToken = tokens.accessToken.value;
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
    await FsUtilities.rm(reportPath);
}, TestTimeouts.inMemory.shutdown);

/**
 * The cache directive a route is answered with.
 * @param path - The route, below the controller.
 * @param loggedIn - Whether the request carries the user's access token.
 * @returns The header.
 */
async function cacheControlOf(path: string, loggedIn: boolean = true): Promise<string | null> {
    const res: globalThis.Response = await fetch(`${baseUrl}/cache-control${path}`, {
        headers: loggedIn ? { [KnownHeader.AUTHORIZATION]: `Bearer ${accessToken}` } : {}
    });
    expect(res.status).toBe(200);
    await res.arrayBuffer();
    return res.headers.get(KnownHeader.CACHE_CONTROL);
}

// part of evaluation round 2, 03 §H11: an answer that depends on who asked carried no cache directive,
// so a shared cache in front of a cookie login could keep one user's answer for the next, and a file
// was answered `public`
describe('the cache directive of an answer', () => {
    it('keeps an answer to a logged in user out of every cache', async () => {
        await expect(cacheControlOf('/me')).resolves.toBe('no-store');
        await expect(cacheControlOf('/report')).resolves.toBe('no-store');
    });

    it('leaves a directive the route set as it is', async () => {
        await expect(cacheControlOf('/own')).resolves.toBe('private, max-age=60');
    });

    it('calls no file public on its own', async () => {
        await expect(cacheControlOf('/public-report', false)).resolves.toBeNull();
    });
});