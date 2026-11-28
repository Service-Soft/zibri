import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { AuthServiceInterface, inject, JsonUtilities, PasswordCredentials, PasswordCredentialsCreateData, Repository, repositoryTokenFor, ZIBRI_DI_TOKENS } from 'zibri';
import { StartedTestServer, startTestServer, TestCommandRun } from 'zibri-testing';

import { env } from '../env';
import { PlatformRoles, User } from '../models';
import { RoleRepository, UserRepository } from '../repositories';
import { testApplicationOptions } from './test-application-options';

/**
 * What the login route answers while it waits for a password of the admin's own.
 */
type PendingLoginBody = {
    name: string,
    ticket: string
};

let server: StartedTestServer;
let baseUrl: string;

/**
 * Logs in with a password.
 * @param email - Who logs in.
 * @param password - The password.
 * @returns The response.
 */
async function login(email: string, password: string): Promise<Response> {
    return await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JsonUtilities.stringify({ email, password })
    });
}

beforeAll(async () => {
    server = await startTestServer({ application: testApplicationOptions });
}, 30000);

afterAll(async () => {
    await server.shutdown();
}, 30000);

describe('reset-admin', () => {

    it('lets a locked out default admin in again, with a password they replace at once', async () => {
        const email: string = env.defaultAdmin.email;
        // what starting the application creates, before it creates the default admin
        await inject(RoleRepository).create({ name: PlatformRoles.ADMIN, level: 'platform', permissions: [], description: 'Administers the application' });
        // an admin nobody can get in as any more: their password forgotten, their role taken away,
        // and their account deactivated
        const admin: User = await inject(UserRepository).create({ name: 'root', email, roles: [] });
        await inject<Repository<PasswordCredentials, PasswordCredentialsCreateData>>(repositoryTokenFor(PasswordCredentials))
            .create({ userId: admin.id, password: 'the password nobody remembers' });
        const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
        await authService.deactivateUser(admin.id, undefined);

        const run: TestCommandRun = await server.runCommand(['reset-admin']);
        expect(run.ran).toBe(true);

        await server.reInit();
        baseUrl = await server.start();
        const reset: User = await inject(UserRepository).findById(admin.id);
        expect(reset.roles).toContain(PlatformRoles.ADMIN);
        // the password from the environment logs in once, to choose one of the admin's own
        const pending: Response = await login(email, env.defaultAdmin.password);
        const body: PendingLoginBody = await pending.json() as PendingLoginBody;
        expect([pending.status, body.name]).toEqual([401, 'PasswordChangeRequiredError']);
        const changed: Response = await fetch(`${baseUrl}/auth/login/change-password`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-login-ticket': body.ticket },
            body: JsonUtilities.stringify({ newPassword: 'a password of the admin\'s own' })
        });
        expect(changed.status).toBe(200);
    });
});
