/* eslint-disable cspell/spellchecker */
import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import { io, Socket } from 'socket.io-client';
import { createInMemoryDataSource } from 'zibri-testing';

import { TenantServiceInterface } from './tenant-service.interface';
import { TenantService } from './tenant.service';
import { JwtUser } from '../__testing__/mocks/entities/jwt-user.entity';
import { Roles } from '../__testing__/mocks/entities/roles.enum';
import { defaultTestServerEntities } from '../__testing__/test-server/create-test-data-source.function';
import { DefaultTestServerMembershipRepository } from '../__testing__/test-server/membership-repository';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { type AuthServiceInterface } from '../auth/auth-service.interface';
import { PasswordCredentials, PasswordCredentialsCreateData } from '../auth/authenticators/password/password-credentials.model';
import { PasswordAuthenticator } from '../auth/authenticators/password/password.authenticator';
import { JwtAuthData } from '../auth/strategies/jwt/jwt-auth-data.model';
import { JwtAuthStrategy } from '../auth/strategies/jwt/jwt.auth-strategy';
import { Repository } from '../data-source/repository/repository';
import { InjectRepository, repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { defineProvider, DiProvider } from '../di/models/di-provider.model';
import { BaseEntity } from '../entity/base-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { HttpRequest } from '../http/http-request.model';
import { Controller } from '../routing/decorators/controller.decorator';
import { Get } from '../routing/decorators/get.decorator';
import { Ms } from '../utilities/ms';
import { UUIDUtilities } from '../utilities/uuid.utilities';
import { WebsocketController } from '../websocket/decorators/websocket-controller.decorator';
import { WebsocketRoute } from '../websocket/decorators/websocket-route.decorator';
import { WebsocketMessage } from '../websocket/models/websocket-message.model';
import { WebsocketOptionsInput } from '../websocket/models/websocket-options.model';
import { WebsocketRequest } from '../websocket/models/websocket-request.model';

@Entity()
class TenancyNote extends BaseEntity {
    @Property.string({ format: 'uuid' })
    tenantId!: string;

    @Property.string()
    title!: string;
}

@Controller('/tenancy-notes', { allowOrphan: true })
class TenancyNoteController {
    constructor(
        @InjectRepository(TenancyNote)
        private readonly notes: Repository<TenancyNote>
    ) {}

    @Get('/')
    async titles(): Promise<string[]> {
        return (await this.notes.findAll({ order: { title: 'ASC' } })).map(note => note.title);
    }
}

@WebsocketController({ allowOrphan: true, eventPrefix: 'tenancy:' })
class TenancyNoteWsController {
    constructor(
        @InjectRepository(TenancyNote)
        private readonly notes: Repository<TenancyNote>
    ) {}

    @WebsocketRoute('titles')
    async titles(): Promise<string[]> {
        return (await this.notes.findAll({ order: { title: 'ASC' } })).map(note => note.title);
    }
}

/**
 * Reads the tenant of a request from its query instead of a header, the way an application replaces
 * the default.
 */
class QueryTenantService extends TenantService {
    override resolveTenant(request: HttpRequest | WebsocketRequest): string | undefined {
        const value: unknown = request.query?.['tenant'];
        return typeof value === 'string' ? value : undefined;
    }

    override resolveTenantUrl(url: string, tenantId: string): string {
        const link: URL = new URL(url);
        link.searchParams.set('tenant', tenantId);
        return link.toString();
    }
}

/**
 * The tenant service of the running application.
 * @returns The service.
 */
function tenantService(): TenantServiceInterface {
    return inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
}

// one class for the whole file, for the reason websocket-payload.test.ts gives
const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource({
    entities: [...defaultTestServerEntities, TenancyNote]
});

const websocketOptions: WebsocketOptionsInput = {
    messageRetentionInMs: Ms.DAY,
    timeoutInMs: 5000,
    handlerInMs: 5000,
    isAllowedToConnect: () => true
};

let server: StartedTestServer | undefined;
let baseUrl: string = '';
const clients: Socket[] = [];

/**
 * Starts the application.
 * @param providers - What it is started with on top of the defaults.
 */
async function startApp(providers: DiProvider<unknown>[]): Promise<void> {
    server = await startTestServer({
        controllers: [TenancyNoteController],
        websocketControllers: [TenancyNoteWsController],
        dataSources: [dataSourceClass],
        providers: [
            ...defaultTestServerProviders,
            defineProvider({ token: ZIBRI_DI_TOKENS.WEBSOCKET_OPTIONS_INPUT, useValue: websocketOptions }),
            ...providers
        ]
    });
    baseUrl = await server.start();
}

/**
 * Stores a note in a tenant.
 * @param tenantId - The tenant.
 * @param title - The title of the note.
 */
async function createNote(tenantId: string, title: string): Promise<void> {
    await inject<TenantServiceInterface>(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(
        tenantId,
        async () => await inject<Repository<TenancyNote>>(repositoryTokenFor(TenancyNote)).create({ tenantId, title })
    );
}

/**
 * Creates a user who can log in, and logs them in.
 * @param name - What sets the user's email apart.
 * @returns The user and their access token.
 */
async function logIn(name: string): Promise<{ user: JwtUser, accessToken: string }> {
    const email: string = `${name}@tenancy.test`;
    const user: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser)).create({ email, roles: [Roles.USER] });
    await inject<Repository<PasswordCredentials, PasswordCredentialsCreateData>>(repositoryTokenFor(PasswordCredentials))
        .create({ password: 'secure123', userId: user.id });
    const authData: JwtAuthData<Roles> = await inject<AuthServiceInterface>(ZIBRI_DI_TOKENS.AUTH_SERVICE)
        .login(PasswordAuthenticator<Roles>, JwtAuthStrategy<Roles>, { email, password: 'secure123' }, undefined);
    return { user, accessToken: authData.accessToken.value };
}

/**
 * Asks for the titles of the notes.
 * @param headers - What the request sends.
 * @param query - The query of the request.
 * @returns The status and the answer.
 */
async function fetchTitles(headers: Record<string, string>, query: string = ''): Promise<{ status: number, body: unknown }> {
    const res: Response = await fetch(`${baseUrl}/tenancy-notes${query}`, { headers });
    return { status: res.status, body: await res.json() as unknown };
}

/**
 * Opens a socket and waits for it to be connected.
 * @returns The connected socket.
 */
async function connectClient(): Promise<Socket> {
    return await new Promise<Socket>((resolve, reject) => {
        const socket: Socket = io(baseUrl, { auth: { offset: 0 } });
        clients.push(socket);
        socket.once('connect', () => resolve(socket));
        socket.once('connect_error', reject);
    });
}

afterEach(() => {
    for (const client of clients.splice(0)) {
        client.disconnect();
    }
});

describe('the tenant of a request', () => {
    const acme: string = UUIDUtilities.generate();
    const globex: string = UUIDUtilities.generate();

    beforeAll(async () => {
        await startApp([]);
        await createNote(acme, 'acme plan');
        await createNote(globex, 'globex plan');
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
    }, 30000);

    it('is read from the x-tenant-id header, and the request reaches that tenant\'s rows only', async () => {
        expect(await fetchTitles({ 'x-tenant-id': acme })).toEqual({ status: 200, body: ['acme plan'] });
        expect(await fetchTitles({ 'x-tenant-id': globex })).toEqual({ status: 200, body: ['globex plan'] });
    });

    it('is read from the x-tenant-id query parameter too, which a link can carry', async () => {
        expect(await fetchTitles({}, `?x-tenant-id=${acme}`)).toEqual({ status: 200, body: ['acme plan'] });
        expect(await fetchTitles({ 'x-tenant-id': acme }, `?x-tenant-id=${acme}`)).toEqual({ status: 200, body: ['acme plan'] });
    });

    it('refuses a request whose header and query parameter name different tenants, as the caller\'s mistake', async () => {
        expect((await fetchTitles({ 'x-tenant-id': acme }, `?x-tenant-id=${globex}`)).status).toBe(400);
    });

    it('puts the tenant into a link the way it reads it back', async () => {
        const link: string = await tenantService().resolveTenantUrl(`${baseUrl}/tenancy-notes?order=title`, globex);

        const res: Response = await fetch(link);

        expect({ status: res.status, body: await res.json() as unknown }).toEqual({ status: 200, body: ['globex plan'] });
        expect(new URL(link).searchParams.get('order')).toBe('title');
    });

    it('refuses a request naming no tenant that reaches the rows of one, as the caller\'s mistake', async () => {
        expect((await fetchTitles({})).status).toBe(400);
    });

    it('refuses a request naming a tenant that is not a uuid, as the caller\'s mistake', async () => {
        expect((await fetchTitles({ 'x-tenant-id': 'acme' })).status).toBe(400);
    });

    it('is one tenant whichever case its uuid is written in', async () => {
        const capitals: string = acme.toUpperCase();

        // the form every uuid is stored in, so that whatever compares it to a stored one - a key
        // bound to the tenant, a room, a row's tenant sent back unchanged - sees the same tenant
        const active: string | undefined = await tenantService().runAs(
            capitals,
            async () => await Promise.resolve(tenantService().getActiveTenantId())
        );
        expect(active).toBe(acme);
        expect(await fetchTitles({ 'x-tenant-id': capitals })).toEqual({ status: 200, body: ['acme plan'] });
    });

    it('refuses running as a tenant that is not a uuid', async () => {
        await expect(inject<TenantServiceInterface>(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs('acme', async () => await Promise.resolve()))
            .rejects.toThrow(/"acme" is not a uuid/);
    });

    it('refuses a logged in user in a tenant they are no member of, also on a route asking for no login', async () => {
        const { user, accessToken }: { user: JwtUser, accessToken: string } = await logIn('outsider');
        await inject<TenantServiceInterface>(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(
            acme,
            async () => await inject(DefaultTestServerMembershipRepository).create({ tenantId: acme, userId: user.id, roles: [Roles.USER] })
        );

        expect(await fetchTitles({ 'x-tenant-id': acme, authorization: `Bearer ${accessToken}` })).toEqual({ status: 200, body: ['acme plan'] });
        expect((await fetchTitles({ 'x-tenant-id': globex, authorization: `Bearer ${accessToken}` })).status).toBe(403);
    });

    it('is read per websocket message, from the headers the message sends', async () => {
        const socket: Socket = await connectClient();

        const inAcme: WebsocketMessage = await socket.timeout(5000)
            .emitWithAck('tenancy:titles', { headers: { 'x-tenant-id': acme } }) as WebsocketMessage;
        const inGlobex: WebsocketMessage = await socket.timeout(5000)
            .emitWithAck('tenancy:titles', { headers: { 'x-tenant-id': globex } }) as WebsocketMessage;
        const inNone: WebsocketMessage = await socket.timeout(5000)
            .emitWithAck('tenancy:titles', {}) as WebsocketMessage;
        const inNoUuid: WebsocketMessage = await socket.timeout(5000)
            .emitWithAck('tenancy:titles', { headers: { 'x-tenant-id': 'acme' } }) as WebsocketMessage;

        expect(inAcme.data).toEqual(['acme plan']);
        expect(inGlobex.data).toEqual(['globex plan']);
        expect(inNone).toMatchObject({ ok: false, status: 400 });
        expect(inNoUuid).toMatchObject({ ok: false, status: 400 });
    }, 15000);
});

describe('an application reading the tenant of a request its own way', () => {
    const initech: string = UUIDUtilities.generate();

    beforeAll(async () => {
        await startApp([defineProvider({ token: ZIBRI_DI_TOKENS.TENANT_SERVICE, useClass: QueryTenantService })]);
        await createNote(initech, 'initech plan');
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
    }, 30000);

    it('overrides resolveTenant, and the default header means nothing anymore', async () => {
        expect(await fetchTitles({}, `?tenant=${initech}`)).toEqual({ status: 200, body: ['initech plan'] });
        expect((await fetchTitles({ 'x-tenant-id': initech })).status).toBe(400);
        expect((await fetchTitles({}, `?x-tenant-id=${initech}`)).status).toBe(400);
    });

    it('overrides resolveTenantUrl beside it, so its links name the tenant the way it reads them', async () => {
        const link: string = await tenantService().resolveTenantUrl(`${baseUrl}/tenancy-notes`, initech);

        const res: Response = await fetch(link);

        expect({ status: res.status, body: await res.json() as unknown }).toEqual({ status: 200, body: ['initech plan'] });
    });

    it('has what the override reads refused the same way when it is not a uuid', async () => {
        expect((await fetchTitles({}, '?tenant=initech')).status).toBe(400);
    });
});