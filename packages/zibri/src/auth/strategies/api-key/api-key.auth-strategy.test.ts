import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { ApiKeyAuthStrategy } from './api-key.auth-strategy';
import { ApiKey, ApiKeyCreateDto } from './api-key.model';
import { CreatedApiKey } from './created-api-key.model';
import { JwtUser } from '../../../__testing__/mocks/entities/jwt-user.entity';
import { Roles } from '../../../__testing__/mocks/entities/roles.enum';
import { defaultTestServerEntities } from '../../../__testing__/test-server/create-test-data-source.function';
import { DefaultTestServerMembershipRepository } from '../../../__testing__/test-server/membership-repository';
import { defaultTestServerProviders } from '../../../__testing__/test-server/providers';
import { startAndStopTestServerWithout } from '../../../__testing__/test-server/start-and-stop-test-server-without.function';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { Repository } from '../../../data-source/repository/repository';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { BadRequestError } from '../../../error-handling/errors/bad-request.error';
import { AuditAction, AuditOutcome, AuditReason } from '../../../logging/audit-event.model';
import { Log } from '../../../logging/log.model';
import { type LoggerInterface } from '../../../logging/logger.interface';
import { Controller } from '../../../routing/decorators/controller.decorator';
import { Get } from '../../../routing/decorators/get.decorator';
import { type TenantServiceInterface } from '../../../tenancy/tenant-service.interface';
import { Newable } from '../../../types/newable.type';
import { JsonUtilities } from '../../../utilities/json.utilities';
import { UUIDUtilities } from '../../../utilities/uuid.utilities';
import { type AuthServiceInterface } from '../../auth-service.interface';
import { Auth } from '../../decorators/auth.decorator';
import { CurrentUser } from '../../decorators/current-user.decorator';
import { AuthStrategies } from '../auth-strategies.model';
import { JwtAuthStrategy } from '../jwt/jwt.auth-strategy';

/**
 * What the route answering with the current user answers.
 */
type Me = {
    id: string,
    roles: Roles[]
};

@Controller('/machine')
class MachineController {
    @Auth.isLoggedIn()
    @Get('/me')
    me(
        @CurrentUser()
        user: JwtUser
    ): Me {
        return { id: user.id, roles: user.roles };
    }

    @Auth.hasPlatformRole([Roles.ADMIN])
    @Get('/admin')
    admin(): { ok: boolean } {
        return { ok: true };
    }

    @Auth.hasRole([Roles.ADMIN])
    @Get('/tenant-admin')
    tenantAdmin(): { ok: boolean } {
        return { ok: true };
    }

    // a route for people only, which an api key cannot reach whatever its roles
    @Auth.isLoggedIn([JwtAuthStrategy])
    @Get('/people-only')
    peopleOnly(): { ok: boolean } {
        return { ok: true };
    }
}

let server: StartedTestServer | undefined;
let baseUrl: string;

/**
 * Calls a route of the machine controller with an api key.
 * @param path - The route below /machine.
 * @param key - The key to send.
 * @returns The answer.
 */
async function callWithKey(path: string, key: string): Promise<Response> {
    return await fetch(`${baseUrl}/machine${path}`, { headers: { 'x-api-key': key } });
}

/**
 * Calls a route of the machine controller with an api key, for a tenant.
 * @param path - The route below /machine.
 * @param key - The key to send.
 * @param tenantId - The tenant the request is for.
 * @returns The answer.
 */
async function callInTenant(path: string, key: string, tenantId: string): Promise<Response> {
    return await fetch(`${baseUrl}/machine${path}`, { headers: { 'x-api-key': key, 'x-tenant-id': tenantId } });
}

/**
 * Makes a user a member of a new tenant.
 * @param user - The user.
 * @param roles - The roles they hold in it.
 * @returns The id of the tenant.
 */
async function createMembership(user: JwtUser, roles: Roles[]): Promise<string> {
    const tenantId: string = UUIDUtilities.generate();
    await inject<TenantServiceInterface>(ZIBRI_DI_TOKENS.TENANT_SERVICE)
        .runAs(tenantId, async () => await inject(DefaultTestServerMembershipRepository).create({ tenantId, userId: user.id, roles }));
    return tenantId;
}

/**
 * Creates an api key bound to a tenant.
 * @param user - The user the key acts as.
 * @param roles - The roles the key may use.
 * @param tenantId - The tenant it is bound to.
 * @returns The created key.
 */
async function createBoundKey(user: JwtUser, roles: Roles[], tenantId: string): Promise<CreatedApiKey> {
    return await authService().createApiKey(
        user.id,
        { name: 'bound', roles, expiresAt: undefined, tenantId, clientAuthentication: undefined, requireDpop: false },
        undefined
    );
}

/**
 * The auth service of the running application.
 * @returns The service.
 */
function authService(): AuthServiceInterface {
    return inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
}

/**
 * The users of the running application.
 * @returns Their repository.
 */
function users(): Repository<JwtUser> {
    return inject(repositoryTokenFor(JwtUser));
}

/**
 * The stored api keys of the running application.
 * @returns Their repository.
 */
function apiKeys(): Repository<ApiKey, ApiKeyCreateDto> {
    return inject(repositoryTokenFor(ApiKey));
}

/**
 * Creates a user with the given roles.
 * @param name - What sets the user's email apart.
 * @param roles - The roles of the user.
 * @returns The user.
 */
async function createUser(name: string, roles: Roles[]): Promise<JwtUser> {
    return await users().create({ email: `${name}@machines.test`, roles });
}

/**
 * Creates an api key that works until it is revoked.
 * @param user - The user the key acts as.
 * @param roles - The roles the key may use.
 * @returns The created key.
 */
async function createKey(user: JwtUser, roles: Roles[]): Promise<CreatedApiKey> {
    return await authService().createApiKey(user.id, { name: 'ci', roles, expiresAt: undefined, tenantId: undefined, clientAuthentication: undefined, requireDpop: false }, undefined);
}

/**
 * Starts an application keeping its data in memory.
 * @param authStrategies - The strategies it reads requests with.
 * @returns The server, started.
 */
async function startApp(authStrategies: AuthStrategies): Promise<StartedTestServer> {
    const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
        entities: [...defaultTestServerEntities, ApiKey],
        allowOrphan: true
    });
    return await startTestServer({
        dataSources: [dataSourceClass],
        authStrategies,
        controllers: [MachineController],
        providers: defaultTestServerProviders
    });
}

/**
 * What the audit trail recorded.
 * @returns Whatever each entry carries under `context.metadata.audit`.
 */
async function auditEvents(): Promise<unknown[]> {
    await inject<LoggerInterface>(ZIBRI_DI_TOKENS.LOGGER).flush();
    return (await inject(repositoryTokenFor(Log)).findAll({})).map(l => l.context.metadata?.['audit']);
}

// first, for the reason on startAndStopTestServerWithout
describe('ApiKeyAuthStrategy — starting', () => {
    it('refuses to start without ApiKey, and names it', async () => {
        const start: Promise<void> = startAndStopTestServerWithout(
            [],
            { authStrategies: [JwtAuthStrategy, ApiKeyAuthStrategy], controllers: [MachineController] }
        );

        await expect(start).rejects.toThrow(/ApiKeyAuthStrategy[\S\s]*ApiKey/);
    }, 30000);

    it('refuses to create a key in an application that reads none', async () => {
        const started: StartedTestServer = await startApp([JwtAuthStrategy]);
        try {
            const user: JwtUser = await createUser('no-strategy', [Roles.USER]);

            await expect(createKey(user, [Roles.USER])).rejects.toThrow('Api keys are read by nothing in this application');
        }
        finally {
            await started.shutdown();
        }
    }, 30000);
});

describe('ApiKeyAuthStrategy', () => {
    beforeAll(async () => {
        server = await startApp([JwtAuthStrategy, ApiKeyAuthStrategy]);
        baseUrl = await server.start();
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    it('lets a request act as the user of its key, and keeps only a hash of the key', async () => {
        const user: JwtUser = await createUser('anna', [Roles.USER]);
        const { key, apiKey }: CreatedApiKey = await createKey(user, [Roles.USER]);

        const res: Response = await callWithKey('/me', key);

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ id: user.id, roles: [Roles.USER] });
        const stored: ApiKey = await apiKeys().findById(apiKey.id);
        expect(stored.value).not.toBe(key);
        expect(stored.value).not.toContain(key);
        // and never part of an answer
        expect(JsonUtilities.stringify(await authService().findApiKeys(user.id, undefined))).not.toContain(stored.value);
    });

    it('takes a key sent as a bearer token, and leaves other bearer tokens to the jwt strategy', async () => {
        const user: JwtUser = await createUser('olga', [Roles.USER]);
        const { key }: CreatedApiKey = await createKey(user, [Roles.USER]);
        expect(key.startsWith('zibri_')).toBe(true);

        const res: Response = await fetch(`${baseUrl}/machine/me`, { headers: { authorization: `Bearer ${key}` } });

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ id: user.id, roles: [Roles.USER] });
        // a key in both places is still one credential of one strategy, and a jwt beside it two
        expect((await fetch(`${baseUrl}/machine/me`, { headers: { authorization: 'Bearer zibri_unknown' } })).status).toBe(401);
        expect((await fetch(`${baseUrl}/machine/me`, { headers: { authorization: 'Bearer a.b.c', 'x-api-key': key } })).status).toBe(401);
    });

    it('refuses a key nobody holds', async () => {
        const res: Response = await callWithKey('/me', 'not-a-key');

        expect(res.status).toBe(401);
    });

    it('holds only the roles the key may use, also for the handler', async () => {
        const admin: JwtUser = await createUser('bob', [Roles.USER, Roles.ADMIN]);
        const readOnly: CreatedApiKey = await createKey(admin, [Roles.USER]);
        const full: CreatedApiKey = await createKey(admin, [Roles.USER, Roles.ADMIN]);

        expect((await callWithKey('/admin', readOnly.key)).status).toBe(403);
        expect((await callWithKey('/admin', full.key)).status).toBe(200);
        // the user the handler gets holds the key's roles, so a check of its own cannot be wider
        expect(await (await callWithKey('/me', readOnly.key)).json()).toEqual({ id: admin.id, roles: [Roles.USER] });
    });

    it('takes a role from the keys once it is taken from the user', async () => {
        const admin: JwtUser = await createUser('carla', [Roles.USER, Roles.ADMIN]);
        const { key }: CreatedApiKey = await createKey(admin, [Roles.USER, Roles.ADMIN]);
        expect((await callWithKey('/admin', key)).status).toBe(200);

        await users().updateById(admin.id, { roles: [Roles.USER] });

        expect((await callWithKey('/admin', key)).status).toBe(403);
    });

    it('holds the roles of its user\'s membership in the tenant the request is for, as far as the key may use them', async () => {
        const member: JwtUser = await createUser('frida', [Roles.USER]);
        const tenantId: string = await createMembership(member, [Roles.USER, Roles.ADMIN]);
        const readOnly: CreatedApiKey = await createKey(member, [Roles.USER]);
        const full: CreatedApiKey = await createKey(member, [Roles.USER, Roles.ADMIN]);

        expect((await callInTenant('/tenant-admin', readOnly.key, tenantId)).status).toBe(403);
        expect((await callInTenant('/tenant-admin', full.key, tenantId)).status).toBe(200);
        // a membership role is no role of the user's own
        expect((await callInTenant('/admin', full.key, tenantId)).status).toBe(403);
    });

    it('refuses every request for a tenant its user is no member of, also on a route asking for no role', async () => {
        const member: JwtUser = await createUser('greta', [Roles.USER]);
        await createMembership(member, [Roles.ADMIN]);
        const { key }: CreatedApiKey = await createKey(member, [Roles.USER, Roles.ADMIN]);

        const otherTenantId: string = UUIDUtilities.generate();
        expect((await callInTenant('/me', key, otherTenantId)).status).toBe(403);
        expect((await callInTenant('/tenant-admin', key, otherTenantId)).status).toBe(403);
        // and a request for no tenant reaches what every tenant shares, without a membership to hold
        expect((await callWithKey('/me', key)).status).toBe(200);
        expect((await callWithKey('/tenant-admin', key)).status).toBe(403);
    });

    it('acts only in the tenant a key is bound to', async () => {
        const member: JwtUser = await createUser('hanna', [Roles.USER]);
        const bound: string = await createMembership(member, [Roles.ADMIN]);
        const other: string = await createMembership(member, [Roles.ADMIN]);
        const { key }: CreatedApiKey = await createBoundKey(member, [Roles.ADMIN], bound);

        expect((await callInTenant('/tenant-admin', key, bound)).status).toBe(200);
        // a member there too, and still refused: the key is not
        expect((await callInTenant('/tenant-admin', key, other)).status).toBe(403);
        expect((await callInTenant('/me', key, other)).status).toBe(403);
    });

    it('acts in the tenant a key is bound to when the request names none', async () => {
        const member: JwtUser = await createUser('bound-tenant', [Roles.USER]);
        const bound: string = await createMembership(member, [Roles.ADMIN]);
        const { key }: CreatedApiKey = await createBoundKey(member, [Roles.ADMIN], bound);
        const unbound: CreatedApiKey = await createKey(member, [Roles.USER, Roles.ADMIN]);

        expect((await callWithKey('/tenant-admin', key)).status).toBe(200);
        // a key acting in every tenant of its user has none to choose
        expect((await callWithKey('/tenant-admin', unbound.key)).status).toBe(403);
    });

    it('refuses every request through a deactivated membership, until it is reactivated', async () => {
        const member: JwtUser = await createUser('paused-member', [Roles.USER]);
        const tenantId: string = await createMembership(member, [Roles.ADMIN]);
        const { key }: CreatedApiKey = await createKey(member, [Roles.USER, Roles.ADMIN]);
        const setDeactivatedAt: (deactivatedAt: Date | null) => Promise<void> = async deactivatedAt => {
            await inject<TenantServiceInterface>(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(
                tenantId,
                async () => await inject(DefaultTestServerMembershipRepository).updateDeactivatedAt(member.id, deactivatedAt, undefined)
            );
        };

        await setDeactivatedAt(new Date());

        expect((await callInTenant('/me', key, tenantId)).status).toBe(403);
        expect((await callInTenant('/tenant-admin', key, tenantId)).status).toBe(403);
        await expect(createBoundKey(member, [Roles.ADMIN], tenantId)).rejects.toThrow(/no member of the tenant/);

        // null rather than undefined: it clears the column
        // eslint-disable-next-line unicorn/no-null
        await setDeactivatedAt(null);

        expect((await callInTenant('/tenant-admin', key, tenantId)).status).toBe(200);
    });

    it('refuses to create a key bound to a tenant its user is no member of, or with a role they hold in none', async () => {
        const member: JwtUser = await createUser('ida', [Roles.USER]);
        const tenantId: string = await createMembership(member, [Roles.USER]);

        await expect(createBoundKey(member, [Roles.USER], UUIDUtilities.generate())).rejects.toThrow(/no member of the tenant/);
        await expect(createBoundKey(member, [Roles.ADMIN], tenantId)).rejects.toThrow('The user does not have the roles ADMIN.');
        expect(await authService().findApiKeys(member.id, undefined)).toEqual([]);
    });

    it('refuses to create a key bound to a tenant that is not a uuid, as the caller\'s mistake', async () => {
        const member: JwtUser = await createUser('ivo', [Roles.USER]);
        await createMembership(member, [Roles.USER]);

        await expect(createBoundKey(member, [Roles.USER], 'acme')).rejects.toThrow(BadRequestError);
        expect(await authService().findApiKeys(member.id, undefined)).toEqual([]);
    });

    it('refuses to create a key with a role the user does not have', async () => {
        const user: JwtUser = await createUser('dave', [Roles.USER]);

        await expect(createKey(user, [Roles.USER, Roles.ADMIN])).rejects.toThrow('The user does not have the roles ADMIN.');
        expect(await authService().findApiKeys(user.id, undefined)).toEqual([]);
    });

    it('refuses to create a key without a name, or one that has expired already', async () => {
        const user: JwtUser = await createUser('erin', [Roles.USER]);

        await expect(authService().createApiKey(user.id, { name: ' ', roles: [], expiresAt: undefined, tenantId: undefined, clientAuthentication: undefined, requireDpop: false }, undefined))
            .rejects.toThrow('An api key needs a name.');
        await expect(authService().createApiKey(
            user.id,
            { name: 'ci', roles: [], expiresAt: new Date(Date.now() - 1000), tenantId: undefined, clientAuthentication: undefined, requireDpop: false },
            undefined
        )).rejects.toThrow('An api key cannot expire in the past.');
    });

    it('refuses a key once it has expired', async () => {
        const user: JwtUser = await createUser('frank', [Roles.USER]);
        const { key, apiKey }: CreatedApiKey = await authService().createApiKey(
            user.id,
            { name: 'nightly', roles: [Roles.USER], expiresAt: new Date(Date.now() + 60_000), tenantId: undefined, clientAuthentication: undefined, requireDpop: false },
            undefined
        );
        expect((await callWithKey('/me', key)).status).toBe(200);

        await apiKeys().updateById(apiKey.id, { expiresAt: new Date(Date.now() - 1000) });

        expect((await callWithKey('/me', key)).status).toBe(401);
    });

    it('revokes one key without the others, and then all of them', async () => {
        const user: JwtUser = await createUser('gina', [Roles.USER]);
        const first: CreatedApiKey = await createKey(user, [Roles.USER]);
        const second: CreatedApiKey = await createKey(user, [Roles.USER]);
        const third: CreatedApiKey = await createKey(user, [Roles.USER]);

        await authService().revokeApiKey(user.id, first.apiKey.id, undefined);

        expect((await callWithKey('/me', first.key)).status).toBe(401);
        expect((await callWithKey('/me', second.key)).status).toBe(200);
        expect((await authService().findApiKeys(user.id, undefined)).map(k => k.id)).toEqual([second.apiKey.id, third.apiKey.id]);

        await authService().revokeApiKeys(user.id, undefined);

        expect((await callWithKey('/me', second.key)).status).toBe(401);
        expect((await callWithKey('/me', third.key)).status).toBe(401);
    });

    it('revokes only a key of the user it is asked for', async () => {
        const holder: JwtUser = await createUser('hank', [Roles.USER]);
        const other: JwtUser = await createUser('ivy', [Roles.USER]);
        const { key, apiKey }: CreatedApiKey = await createKey(holder, [Roles.USER]);

        await expect(authService().revokeApiKey(other.id, apiKey.id, undefined)).rejects.toThrow();

        expect((await callWithKey('/me', key)).status).toBe(200);
    });

    it('keeps the keys when the logins of the user are ended', async () => {
        const user: JwtUser = await createUser('jack', [Roles.USER]);
        const { key }: CreatedApiKey = await createKey(user, [Roles.USER]);

        await authService().endLogins(user.id, undefined);

        expect((await callWithKey('/me', key)).status).toBe(200);
    });

    it('refuses a key whose user has been deleted', async () => {
        const user: JwtUser = await createUser('kate', [Roles.USER]);
        const { key }: CreatedApiKey = await createKey(user, [Roles.USER]);

        await users().deleteById(user.id);

        expect((await callWithKey('/me', key)).status).toBe(401);
    });

    it('cannot reach a route that accepts other strategies only', async () => {
        const user: JwtUser = await createUser('mike', [Roles.USER, Roles.ADMIN]);
        const { key }: CreatedApiKey = await createKey(user, [Roles.USER, Roles.ADMIN]);

        expect((await callWithKey('/people-only', key)).status).toBe(401);
    });

    it('records creating and revoking a key', async () => {
        const user: JwtUser = await createUser('nick', [Roles.USER]);
        const { apiKey }: CreatedApiKey = await createKey(user, [Roles.USER]);
        await expect(createKey(user, [Roles.ADMIN])).rejects.toThrow();
        await authService().revokeApiKey(user.id, apiKey.id, undefined);
        await expect(authService().revokeApiKey(user.id, apiKey.id, undefined)).rejects.toThrow();

        const events: unknown[] = await auditEvents();

        expect(events).toContainEqual({ action: AuditAction.API_KEY_CREATED, outcome: AuditOutcome.SUCCESS, userId: user.id });
        expect(events).toContainEqual({ action: AuditAction.API_KEY_CREATED, outcome: AuditOutcome.FAILURE, reason: AuditReason.REFUSED, userId: user.id });
        expect(events).toContainEqual({ action: AuditAction.API_KEY_REVOKED, outcome: AuditOutcome.SUCCESS, userId: user.id });
        expect(events).toContainEqual({ action: AuditAction.API_KEY_REVOKED, outcome: AuditOutcome.FAILURE, reason: AuditReason.REFUSED, userId: user.id });
    });
});