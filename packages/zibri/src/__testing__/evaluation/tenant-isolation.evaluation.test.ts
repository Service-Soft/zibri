import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io, Socket } from 'socket.io-client';
import { createInMemoryDataSource } from 'zibri-testing';

import { type AuthServiceInterface } from '../../auth/auth-service.interface.ts';
import { PasswordCredentials, PasswordCredentialsCreateData } from '../../auth/authenticators/password/password-credentials.model.ts';
import { PasswordAuthenticator } from '../../auth/authenticators/password/password.authenticator.ts';
import { Auth } from '../../auth/decorators/auth.decorator.ts';
import { ApiKeyAuthStrategy } from '../../auth/strategies/api-key/api-key.auth-strategy.ts';
import { ApiKey } from '../../auth/strategies/api-key/api-key.model.ts';
import { JwtAuthData } from '../../auth/strategies/jwt/jwt-auth-data.model.ts';
import { JwtAuthStrategy } from '../../auth/strategies/jwt/jwt.auth-strategy.ts';
import { DataSourceInterface } from '../../data-source/data-sources/data-source.interface.ts';
import { Repository } from '../../data-source/repository/repository.ts';
import { InjectRepository, repositoryTokenFor } from '../../di/decorators/inject-repository.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../di/inject.function.ts';
import { defineProvider } from '../../di/models/di-provider.model.ts';
import { BaseEntity } from '../../entity/base-entity.model.ts';
import { Entity } from '../../entity/decorators/entity.decorator.ts';
import { Property } from '../../entity/decorators/property.decorator.ts';
import { type Relation } from '../../entity/models/relation.type.ts';
import { PaginationResult } from '../../open-api/pagination-result.model.ts';
import { Body } from '../../routing/decorators/body.decorator.ts';
import { Controller } from '../../routing/decorators/controller.decorator.ts';
import { Delete } from '../../routing/decorators/delete.decorator.ts';
import { Get } from '../../routing/decorators/get.decorator.ts';
import { Param } from '../../routing/decorators/param.decorator.ts';
import { Patch } from '../../routing/decorators/patch.decorator.ts';
import { Post } from '../../routing/decorators/post.decorator.ts';
import { TenantServiceInterface } from '../../tenancy/tenant-service.interface.ts';
import { Newable } from '../../types/newable.type.ts';
import { JsonUtilities } from '../../utilities/json.utilities.ts';
import { Ms } from '../../utilities/ms.ts';
import { UUIDUtilities } from '../../utilities/uuid.utilities.ts';
import { WebsocketController } from '../../websocket/decorators/websocket-controller.decorator.ts';
import { WebsocketRoute } from '../../websocket/decorators/websocket-route.decorator.ts';
import { SocketIOWebsocketConnection } from '../../websocket/models/connection/socket-io-websocket-connection.model.ts';
import { WebsocketMessage } from '../../websocket/models/websocket-message.model.ts';
import { WebsocketOptionsInput } from '../../websocket/models/websocket-options.model.ts';
import { type WebsocketServiceInterface } from '../../websocket/services/websocket-service.interface.ts';
import { JwtUser } from '../mocks/entities/jwt-user.entity.ts';
import { Roles } from '../mocks/entities/roles.enum.ts';
import { createTestDataSource, defaultTestServerEntities } from '../test-server/create-test-data-source.function.ts';
import { DefaultTestServerMembershipRepository } from '../test-server/membership-repository.ts';
import { defaultTestServerProviders } from '../test-server/providers.ts';
import { StartedTestServer, startTestServer } from '../test-server/start-test-server.function.ts';
import { waitUntil } from '../wait-until.function.ts';

/**
 * Executable form of evaluation/01-data-layer.md, the multi-tenancy entry of the MINOR list.
 *
 * Driven over real http and websockets, against real logins and api keys, from the side of somebody
 * who belongs to one tenant and wants what another one holds. The guarantee is not about one call:
 * it is that no way of reaching a table reaches past the tenant a request acts in - a list, a page
 * and its total, a row by id, a filter naming the other tenant outright, a write naming it, a
 * relation pointing into it, a credential bound elsewhere, a message on a socket. Every handler
 * below is written the way an application writes one, without a filter of its own, because the
 * handler nobody remembered to guard is the one the guarantee is for.
 *
 * Run on the store that needs no container and on Postgres: the narrowing is the repository's, and
 * what each store does with the filter it is handed is the other half of it.
 *
 * Every expectation describes the fixed behavior, so this file is red until the finding is closed.
 * See ./README.md for why.
 */

/**
 * A row of one tenant, holding other rows of it.
 */
@Entity({ defaultRelations: { tasks: true } })
class IsolationProject extends BaseEntity {
    @Property.string({ format: 'uuid' })
    tenantId!: string;

    // unique within each tenant: two tenants may both have a project of the same name
    @Property.string({ unique: true })
    name!: string;

    @Property.oneToMany({ target: () => IsolationTask, inverseSide: 'project' })
    tasks!: IsolationTask[];
}

/**
 * A row of one tenant, pointing at another row of it.
 */
@Entity()
class IsolationTask extends BaseEntity {
    @Property.string({ format: 'uuid' })
    tenantId!: string;

    @Property.string()
    title!: string;

    @Property.manyToOne({ target: () => IsolationProject, joinColumn: 'projectId', inverseSide: 'tasks' })
    project?: Relation<IsolationProject>;

    @Property.string({ format: 'uuid', required: false })
    projectId?: string | null;
}

/**
 * A row of one tenant, or of none - and then every tenant reads it.
 */
@Entity()
class IsolationBulletin extends BaseEntity {
    @Property.string({ format: 'uuid', required: false })
    tenantId?: string | null;

    @Property.string()
    text!: string;
}

class TaskBody {
    @Property.string()
    title!: string;

    @Property.string({ format: 'uuid', required: false })
    tenantId?: string;
}

class ProjectCreateBody {
    @Property.string()
    name!: string;

    @Property.string({ format: 'uuid', required: false })
    tenantId?: string;

    @Property.array({ items: { type: 'object', cls: () => TaskBody }, required: false })
    tasks?: TaskBody[];
}

class ProjectUpdateBody {
    @Property.string({ required: false })
    name?: string;

    @Property.string({ format: 'uuid', required: false })
    tenantId?: string;
}

class TaskCreateBody {
    @Property.string()
    title!: string;

    @Property.string({ format: 'uuid', required: false })
    projectId?: string;
}

class BulletinUpdateBody {
    @Property.string()
    text!: string;
}

@Controller('/isolation-projects')
class IsolationProjectController {
    constructor(
        @InjectRepository(IsolationProject)
        private readonly projects: Repository<IsolationProject>
    ) {}

    @Get()
    async list(): Promise<IsolationProject[]> {
        return await this.projects.findAll();
    }

    @Get('/paginated')
    async paginated(): Promise<PaginationResult<IsolationProject>> {
        return await this.projects.findAllPaginated(1, 50);
    }

    // the handler passes on what the caller asked for, the way a search endpoint does
    @Get('/filtered')
    async filtered(@Param.query('tenantId', { type: 'string', format: 'uuid' }) tenantId: string): Promise<IsolationProject[]> {
        return await this.projects.findAll({ where: { tenantId } });
    }

    // last of the GETs, because "/:id" matches anything a more specific route did not claim first
    @Get('/:id')
    async byId(@Param.path('id') id: string): Promise<IsolationProject> {
        return await this.projects.findById(id);
    }

    @Post()
    async create(@Body(ProjectCreateBody) body: ProjectCreateBody): Promise<IsolationProject> {
        return await this.projects.create(body);
    }

    @Patch('/:id')
    async update(@Param.path('id') id: string, @Body(ProjectUpdateBody) body: ProjectUpdateBody): Promise<IsolationProject> {
        return await this.projects.updateById(id, body);
    }

    @Delete('/:id')
    async remove(@Param.path('id') id: string): Promise<IsolationProject> {
        return await this.projects.deleteById(id);
    }
}

/**
 * The projects, on a route that asks for no login: what a public page of a tenant looks like.
 */
@Controller('/isolation-public-projects')
class IsolationPublicProjectController {
    constructor(
        @InjectRepository(IsolationProject)
        private readonly projects: Repository<IsolationProject>
    ) {}

    @Get()
    @Auth.skip()
    async list(): Promise<IsolationProject[]> {
        return await this.projects.findAll();
    }
}

@Controller('/isolation-tasks')
class IsolationTaskController {
    constructor(
        @InjectRepository(IsolationTask)
        private readonly tasks: Repository<IsolationTask>
    ) {}

    @Post()
    async create(@Body(TaskCreateBody) body: TaskCreateBody): Promise<IsolationTask> {
        return await this.tasks.create(body);
    }
}

@Controller('/isolation-bulletins')
class IsolationBulletinController {
    constructor(
        @InjectRepository(IsolationBulletin)
        private readonly bulletins: Repository<IsolationBulletin>
    ) {}

    @Get()
    async list(): Promise<IsolationBulletin[]> {
        return await this.bulletins.findAll();
    }

    @Patch('/:id')
    async update(@Param.path('id') id: string, @Body(BulletinUpdateBody) body: BulletinUpdateBody): Promise<IsolationBulletin> {
        return await this.bulletins.updateById(id, body);
    }

    @Delete('/:id')
    async remove(@Param.path('id') id: string): Promise<IsolationBulletin> {
        return await this.bulletins.deleteById(id);
    }
}

@WebsocketController({ eventPrefix: 'isolation:' })
class IsolationWsController {
    constructor(
        @InjectRepository(IsolationProject)
        private readonly projects: Repository<IsolationProject>
    ) {}

    @WebsocketRoute('projects')
    async names(): Promise<string[]> {
        return (await this.projects.findAll()).map(p => p.name);
    }
}

/**
 * Somebody who can log in, with the token they log in with.
 */
type Account = {
    /**
     * The user.
     */
    user: JwtUser,
    /**
     * Their bearer token.
     */
    token: string
};

/**
 * How a request is made: who sends it, and which tenant it names where.
 */
type CallOptions = {
    /**
     * The bearer token to send, if any.
     */
    token?: string,
    /**
     * The api key to send, if any.
     */
    apiKey?: string,
    /**
     * The tenant named in the header, if any.
     */
    tenant?: string,
    /**
     * The tenant named in the query, if any.
     */
    queryTenant?: string,
    /**
     * The method, GET by default.
     */
    method?: string,
    /**
     * The body, sent as json.
     */
    body?: object
};

const entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, ApiKey, IsolationProject, IsolationTask, IsolationBulletin];

const websocketOptions: WebsocketOptionsInput = {
    messageRetentionInMs: Ms.DAY,
    timeoutInMs: 5000,
    handlerInMs: 5000,
    isAllowedToConnect: () => true
};

/**
 * The cases, against an application keeping its data in the given data source.
 * @param name - The name of the data source.
 * @param dataSourceClass - The data source.
 */
function describeTenantIsolationOverHttp(name: string, dataSourceClass: Newable<DataSourceInterface>): void {
    describe(`evaluation/01-data-layer multi-tenancy - one tenant cannot reach another, on ${name}`, () => {
        const tenantA: string = UUIDUtilities.generate();
        const tenantB: string = UUIDUtilities.generate();

        let server: StartedTestServer | undefined;
        let baseUrl: string;
        const sockets: Socket[] = [];

        // a member of a, a member of b, and a member of both holding a key bound to a
        let alice: Account;
        let bob: Account;
        let carol: Account;
        let carolsKeyForA: string;

        let alpha: IsolationProject;
        let beta: IsolationProject;
        let sharedBulletin: IsolationBulletin;

        const tenants: () => TenantServiceInterface = () => inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
        const projects: () => Repository<IsolationProject> = () => inject(repositoryTokenFor(IsolationProject));
        const bulletins: () => Repository<IsolationBulletin> = () => inject(repositoryTokenFor(IsolationBulletin));

        /**
         * Creates a user who can log in, makes them a member of the given tenants and logs them in.
         * @param who - What sets the user's email apart.
         * @param memberOf - The tenants they are a member of.
         * @returns The user and their token.
         */
        async function createAccount(who: string, memberOf: string[]): Promise<Account> {
            const email: string = `${who}-${UUIDUtilities.generate()}@isolation.test`;
            const user: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser)).create({ email, roles: [Roles.USER] });
            await inject<Repository<PasswordCredentials, PasswordCredentialsCreateData>>(repositoryTokenFor(PasswordCredentials))
                .create({ password: 'secure123', userId: user.id });
            for (const tenantId of memberOf) {
                await tenants().runAs(
                    tenantId,
                    async () => await inject(DefaultTestServerMembershipRepository).create({ tenantId, userId: user.id, roles: [Roles.USER] })
                );
            }
            const authData: JwtAuthData<Roles> = await inject<AuthServiceInterface>(ZIBRI_DI_TOKENS.AUTH_SERVICE)
                .login(PasswordAuthenticator<Roles>, JwtAuthStrategy<Roles>, { email, password: 'secure123' }, undefined);
            return { user, token: authData.accessToken.value };
        }

        /**
         * Sends a request.
         * @param path - The path, below the base url.
         * @param options - Who sends it and which tenant it names.
         * @returns The response.
         */
        async function call(path: string, options: CallOptions): Promise<Response> {
            const headers: Record<string, string> = {};
            if (options.token != undefined) {
                headers['authorization'] = `Bearer ${options.token}`;
            }
            if (options.apiKey != undefined) {
                headers['x-api-key'] = options.apiKey;
            }
            if (options.tenant != undefined) {
                headers['x-tenant-id'] = options.tenant;
            }
            if (options.body != undefined) {
                headers['content-type'] = 'application/json';
            }
            const query: string = options.queryTenant == undefined ? '' : `${path.includes('?') ? '&' : '?'}x-tenant-id=${options.queryTenant}`;
            return await fetch(`${baseUrl}${path}${query}`, {
                method: options.method ?? 'GET',
                headers,
                body: options.body == undefined ? undefined : JsonUtilities.stringify(options.body)
            });
        }

        /**
         * Reads the names of the projects a list answered with.
         * @param res - The response of the list.
         * @returns The names.
         */
        async function namesOf(res: Response): Promise<string[]> {
            expect(res.status).toBe(200);
            return (await res.json() as IsolationProject[]).map(p => p.name);
        }

        /**
         * Opens a socket as an account.
         * @param account - Who connects.
         * @returns The connected socket.
         */
        async function connect(account: Account): Promise<Socket> {
            const socket: Socket = await new Promise<Socket>((resolve, reject) => {
                const opened: Socket = io(baseUrl, { auth: { offset: 0 }, extraHeaders: { authorization: `Bearer ${account.token}` } });
                sockets.push(opened);
                opened.once('connect', () => resolve(opened));
                opened.once('connect_error', reject);
            });
            // until the server has taken the connection in, which it does after the client hears it is connected
            // eslint-disable-next-line typescript/no-unsafe-assignment
            const websocketService: WebsocketServiceInterface<SocketIOWebsocketConnection> = inject(ZIBRI_DI_TOKENS.WEBSOCKET_SERVICE);
            await waitUntil(async () => (await websocketService.getConnections()).some(c => c.id === socket.id));
            return socket;
        }

        beforeAll(async () => {
            server = await startTestServer({
                dataSources: [dataSourceClass],
                authStrategies: [JwtAuthStrategy, ApiKeyAuthStrategy],
                controllers: [
                    IsolationProjectController,
                    IsolationPublicProjectController,
                    IsolationTaskController,
                    IsolationBulletinController
                ],
                websocketControllers: [IsolationWsController],
                providers: [
                    ...defaultTestServerProviders,
                    defineProvider({ token: ZIBRI_DI_TOKENS.WEBSOCKET_OPTIONS_INPUT, useValue: websocketOptions })
                ],
                // the posture this is worth testing under: every route asks for a login unless it says
                // otherwise, so the only anonymous callers are the routes that declared themselves public
                defaultAuth: 'requireLogin'
            });
            baseUrl = await server.start();

            alice = await createAccount('alice', [tenantA]);
            bob = await createAccount('bob', [tenantB]);
            carol = await createAccount('carol', [tenantA, tenantB]);
            carolsKeyForA = (await inject<AuthServiceInterface>(ZIBRI_DI_TOKENS.AUTH_SERVICE).createApiKey(
                carol.user.id,
                { name: 'bound to a', roles: [Roles.USER], expiresAt: undefined, tenantId: tenantA, clientAuthentication: undefined, requireDpop: false },
                undefined
            )).key;

            alpha = await tenants().runAs(tenantA, async () => await projects().create({ name: 'alpha plan', tasks: [{ title: 'alpha task' }] }));
            beta = await tenants().runAs(tenantB, async () => await projects().create({ name: 'beta plan', tasks: [{ title: 'beta task' }] }));
            sharedBulletin = await bulletins().create({ text: 'for everyone' });
            await tenants().runAs(tenantA, async () => await bulletins().create({ text: 'for a' }));
        }, 60000);

        afterAll(async () => {
            for (const socket of sockets.splice(0)) {
                socket.disconnect();
            }
            // guarded so a failed beforeAll reports the real cause instead of a shutdown TypeError
            await server?.shutdown();
        }, 30000);

        describe('reading', () => {
            it('answers a list with the rows of the tenant the request acts in, and no others', async () => {
                // both directions, because a narrowing that answered with the first tenant it found
                // would pass one of them
                const ofA: string[] = await namesOf(await call('/isolation-projects', { token: alice.token, tenant: tenantA }));
                const ofB: string[] = await namesOf(await call('/isolation-projects', { token: bob.token, tenant: tenantB }));

                expect(ofA).toContain('alpha plan');
                expect(ofA).not.toContain('beta plan');
                expect(ofB).toContain('beta plan');
                expect(ofB).not.toContain('alpha plan');
            });

            it('counts the rows of the tenant alone in the total of a page', async () => {
                const res: Response = await call('/isolation-projects/paginated', { token: alice.token, tenant: tenantA });
                const page: PaginationResult<IsolationProject> = await res.json() as PaginationResult<IsolationProject>;

                // a total counting every tenant's rows beside a page of one tenant's says how many
                // the others hold, which the page itself does not
                expect(page.items.map(p => p.name)).not.toContain('beta plan');
                expect(page.totalAmount).toBe(page.items.length);
            });

            it('answers a row of another tenant exactly like a row that does not exist', async () => {
                const other: Response = await call(`/isolation-projects/${beta.id}`, { token: alice.token, tenant: tenantA });
                const missing: Response = await call(`/isolation-projects/${UUIDUtilities.generate()}`, { token: alice.token, tenant: tenantA });

                // not 403: an id that exists elsewhere and one that exists nowhere have to be
                // indistinguishable, or a guarded route tells which ids are real
                expect(other.status).toBe(404);
                expect(missing.status).toBe(other.status);
            });

            it('finds nothing when a filter names another tenant outright', async () => {
                const res: Response = await call(`/isolation-projects/filtered?tenantId=${tenantB}`, { token: alice.token, tenant: tenantA });

                expect(await namesOf(res)).toEqual([]);
            });

            it('hands a row back with the related rows of its own tenant', async () => {
                const res: Response = await call(`/isolation-projects/${alpha.id}`, { token: alice.token, tenant: tenantA });
                const project: IsolationProject = await res.json() as IsolationProject;

                expect(project.tasks.map(t => t.title)).toEqual(['alpha task']);
            });
        });

        describe('naming another tenant', () => {
            it('refuses a member of one tenant on every route of another, a public one included', async () => {
                // the membership is checked whenever a user is logged in, whatever the route asks of
                // them - a public route reading a tenant's rows still reads them for somebody
                const list: Response = await call('/isolation-projects', { token: alice.token, tenant: tenantB });
                const byId: Response = await call(`/isolation-projects/${beta.id}`, { token: alice.token, tenant: tenantB });
                const publicList: Response = await call('/isolation-public-projects', { token: alice.token, tenant: tenantB });

                expect([list.status, byId.status, publicList.status]).toEqual([403, 403, 403]);
            });

            it('refuses it the same when the tenant is named in the query, the way a link names it', async () => {
                const res: Response = await call('/isolation-projects', { token: alice.token, queryTenant: tenantB });

                expect(res.status).toBe(403);
            });

            it('refuses a request naming one tenant in its header and another in its query', async () => {
                const res: Response = await call('/isolation-projects', { token: alice.token, tenant: tenantA, queryTenant: tenantB });

                // neither of them is the one to pick, and picking either would be a guess
                expect(res.status).toBe(400);
            });

            it('refuses a request naming a tenant that is not a uuid, and one naming none', async () => {
                const notUuid: Response = await call('/isolation-projects', { token: alice.token, tenant: 'acme' });
                const none: Response = await call('/isolation-projects', { token: alice.token });

                expect([notUuid.status, none.status]).toEqual([400, 400]);
            });

            it('is one tenant whichever case its id is written in', async () => {
                const capitals: string = tenantA.toUpperCase();
                const read: Response = await call('/isolation-projects', { token: alice.token, tenant: capitals });
                // sent back as it was read, which names the tenant in the case it is stored in
                const update: Response = await call(`/isolation-projects/${alpha.id}`, {
                    token: alice.token,
                    tenant: capitals,
                    method: 'PATCH',
                    body: { name: 'alpha plan', tenantId: tenantA }
                });

                expect(await namesOf(read)).toContain('alpha plan');
                expect(update.status).toBe(200);
            });
        });

        describe('writing', () => {
            it('refuses a new row for another tenant, and writes nothing there', async () => {
                const name: string = `smuggled ${UUIDUtilities.generate()}`;
                const res: Response = await call('/isolation-projects', {
                    token: alice.token,
                    tenant: tenantA,
                    method: 'POST',
                    body: { name, tenantId: tenantB }
                });

                expect(res.status).toBe(403);
                expect(await namesOf(await call('/isolation-projects', { token: bob.token, tenant: tenantB }))).not.toContain(name);
            });

            it('refuses new related rows for another tenant', async () => {
                const res: Response = await call('/isolation-projects', {
                    token: alice.token,
                    tenant: tenantA,
                    method: 'POST',
                    body: { name: `nested ${UUIDUtilities.generate()}`, tasks: [{ title: 'smuggled task', tenantId: tenantB }] }
                });

                expect(res.status).toBe(403);
            });

            it('refuses to move a row to another tenant, and leaves it where it was', async () => {
                const res: Response = await call(`/isolation-projects/${alpha.id}`, {
                    token: alice.token,
                    tenant: tenantA,
                    method: 'PATCH',
                    body: { tenantId: tenantB }
                });

                expect(res.status).toBe(403);
                expect((await projects().findById(alpha.id, { acrossTenants: true })).tenantId).toBe(tenantA);
            });

            it('answers 404 when changing or deleting a row of another tenant, and leaves it untouched', async () => {
                const update: Response = await call(`/isolation-projects/${beta.id}`, {
                    token: alice.token,
                    tenant: tenantA,
                    method: 'PATCH',
                    body: { name: 'taken over' }
                });
                const remove: Response = await call(`/isolation-projects/${beta.id}`, { token: alice.token, tenant: tenantA, method: 'DELETE' });

                expect([update.status, remove.status]).toEqual([404, 404]);
                expect((await projects().findById(beta.id, { acrossTenants: true })).name).toBe('beta plan');
            });

            it('refuses to point a row at a row of another tenant, the same as at a row that is not there', async () => {
                const intoB: Response = await call('/isolation-tasks', {
                    token: alice.token,
                    tenant: tenantA,
                    method: 'POST',
                    body: { title: 'pointing into b', projectId: beta.id }
                });
                const nowhere: Response = await call('/isolation-tasks', {
                    token: alice.token,
                    tenant: tenantA,
                    method: 'POST',
                    body: { title: 'pointing nowhere', projectId: UUIDUtilities.generate() }
                });

                // a relation into another tenant would be read back with the project, so the write is
                // where it is stopped - and alike for both, so the answer says nothing about which ids
                // exist elsewhere
                expect([intoB.status, nowhere.status]).toEqual([403, 403]);
            });

            it('holds a unique within each tenant, and not across them', async () => {
                const name: string = `website ${UUIDUtilities.generate()}`;
                const inA: Response = await call('/isolation-projects', { token: alice.token, tenant: tenantA, method: 'POST', body: { name } });
                const inB: Response = await call('/isolation-projects', { token: bob.token, tenant: tenantB, method: 'POST', body: { name } });
                const againInA: Response = await call('/isolation-projects', {
                    token: alice.token,
                    tenant: tenantA,
                    method: 'POST',
                    body: { name }
                });

                // another tenant holding a name says nothing about this one, and must not be found out
                // by trying it
                expect([inA.status, inB.status]).toEqual([200, 200]);
                // a name already taken is the caller's to change, not a fault of the server
                expect(againInA.status).toBe(409);
                expect(await projects().count({ where: { name }, acrossTenants: true })).toBe(2);
            });
        });

        describe('credentials', () => {
            it('keeps a key bound to one tenant out of every other, whatever else its user may reach', async () => {
                // carol is a member of both, and the key is what says she gave away a only
                const inB: Response = await call('/isolation-projects', { apiKey: carolsKeyForA, tenant: tenantB });
                const inA: Response = await call('/isolation-projects', { apiKey: carolsKeyForA, tenant: tenantA });
                const naming: Response = await call('/isolation-projects', { apiKey: carolsKeyForA });

                expect(inB.status).toBe(403);
                expect(await namesOf(inA)).toContain('alpha plan');
                // a request naming no tenant acts in the one its key is bound to
                expect(await namesOf(naming)).toContain('alpha plan');
            });

            it('refuses a member whose membership is deactivated, as though there were none', async () => {
                const dave: Account = await createAccount('dave', [tenantA]);
                expect((await call('/isolation-projects', { token: dave.token, tenant: tenantA })).status).toBe(200);

                await tenants().runAs(
                    tenantA,
                    async () => await inject(DefaultTestServerMembershipRepository).updateDeactivatedAt(dave.user.id, new Date(), undefined)
                );

                expect((await call('/isolation-projects', { token: dave.token, tenant: tenantA })).status).toBe(403);
            });
        });

        describe('rows every tenant shares', () => {
            it('shows a row of no tenant to every tenant, and a tenant\'s own row to that tenant alone', async () => {
                const inA: Response = await call('/isolation-bulletins', { token: alice.token, tenant: tenantA });
                const inB: Response = await call('/isolation-bulletins', { token: bob.token, tenant: tenantB });
                const textsInA: string[] = (await inA.json() as IsolationBulletin[]).map(b => b.text);
                const textsInB: string[] = (await inB.json() as IsolationBulletin[]).map(b => b.text);

                expect(textsInA).toEqual(expect.arrayContaining(['for everyone', 'for a']));
                expect(textsInB).toContain('for everyone');
                expect(textsInB).not.toContain('for a');
            });

            it('refuses a member changing or deleting a row every tenant shares, which they can read', async () => {
                const update: Response = await call(`/isolation-bulletins/${sharedBulletin.id}`, {
                    token: alice.token,
                    tenant: tenantA,
                    method: 'PATCH',
                    body: { text: 'changed by a' }
                });
                const remove: Response = await call(`/isolation-bulletins/${sharedBulletin.id}`, {
                    token: alice.token,
                    tenant: tenantA,
                    method: 'DELETE'
                });

                // forbidden rather than not found: the same caller lists it. Changing it would change
                // what every other tenant reads
                expect([update.status, remove.status]).toEqual([403, 403]);
                expect((await bulletins().findById(sharedBulletin.id)).text).toBe('for everyone');
            });
        });

        describe('websockets', () => {
            it('answers a message in the tenant it names, and refuses one naming a tenant the user is no member of', async () => {
                const socket: Socket = await connect(alice);
                const authorization: string = `Bearer ${alice.token}`;

                // each message carries its credential, the way each http request does
                const inA: WebsocketMessage = await socket.timeout(5000)
                    .emitWithAck('isolation:projects', { headers: { authorization, 'x-tenant-id': tenantA } }) as WebsocketMessage;
                const inB: WebsocketMessage = await socket.timeout(5000)
                    .emitWithAck('isolation:projects', { headers: { authorization, 'x-tenant-id': tenantB } }) as WebsocketMessage;

                // per message rather than per connection, so a socket opened for one tenant is no way
                // into another
                expect(inA.data).toContain('alpha plan');
                expect(inA.data).not.toContain('beta plan');
                expect(inB).toMatchObject({ ok: false, status: 403 });
            }, 15000);
        });
    });
}

// each may be left out of the application the other one is booted in
describeTenantIsolationOverHttp('the in memory data source', createInMemoryDataSource({ entities, allowOrphan: true }));

describeTenantIsolationOverHttp('postgres', createTestDataSource({ entities, allowOrphan: true }));