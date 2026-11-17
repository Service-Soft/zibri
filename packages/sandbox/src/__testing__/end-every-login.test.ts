import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { inject, JsonUtilities, PasswordCredentials, PasswordCredentialsCreateData, Repository, repositoryTokenFor } from 'zibri';
import { StartedTestServer, startTestServer, TestCommandRun } from 'zibri-testing';

import { testApplicationOptions } from './test-application-options';
import { User } from '../models';
import { UserRepository } from '../repositories';

const PASSWORD: string = 'a password long enough';

let server: StartedTestServer;
let baseUrl: string;

/**
 * Creates a user and logs them in.
 * @param email - Who logs in.
 * @returns The refresh token of the login.
 */
async function loggedIn(email: string): Promise<string> {
    const user: User = await inject(UserRepository).create({ name: email, email, roles: [] });
    await inject<Repository<PasswordCredentials, PasswordCredentialsCreateData>>(repositoryTokenFor(PasswordCredentials))
        .create({ userId: user.id, password: PASSWORD });
    const res: Response = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JsonUtilities.stringify({ email, password: PASSWORD })
    });
    expect(res.status).toBe(200);
    return (await res.json() as { refreshToken: { value: string } }).refreshToken.value;
}

/**
 * Refreshes a login.
 * @param refreshToken - The refresh token of the login.
 * @returns The status of the answer.
 */
async function refresh(refreshToken: string): Promise<number> {
    const res: Response = await fetch(`${baseUrl}/auth/refresh-login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JsonUtilities.stringify({ refreshToken })
    });
    await res.arrayBuffer();
    return res.status;
}

beforeAll(async () => {
    server = await startTestServer({ application: testApplicationOptions });
    baseUrl = await server.start();
}, 30000);

afterAll(async () => {
    await server.shutdown();
}, 30000);

describe('end-every-login', () => {

    it('logs every user out', async () => {
        const ada: string = await loggedIn('ada@example.com');
        const grace: string = await loggedIn('grace@example.com');

        const run: TestCommandRun = await server.runCommand(['end-every-login']);
        expect(run.ran).toBe(true);

        await server.reInit();
        baseUrl = await server.start();
        expect(await refresh(ada)).toBe(401);
        expect(await refresh(grace)).toBe(401);
    });
});