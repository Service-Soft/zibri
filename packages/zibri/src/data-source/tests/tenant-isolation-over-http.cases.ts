import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { io, Socket } from 'socket.io-client';

import { JwtUser } from '../../__testing__/mocks/entities/jwt-user.entity';
import { MemberRoles } from '../../__testing__/mocks/entities/member-roles.enum';
import { Roles } from '../../__testing__/mocks/entities/roles.enum';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
import { DefaultTestServerMembershipRepository } from '../../__testing__/test-server/membership-repository';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { waitUntil } from '../../__testing__/wait-until.function';
import { type AuthServiceInterface } from '../../auth/auth-service.interface';
import { PasswordCredentials, PasswordCredentialsCreateData } from '../../auth/authenticators/password/password-credentials.model';
import { PasswordAuthenticator } from '../../auth/authenticators/password/password.authenticator';
import { JwtAuthData } from '../../auth/strategies/jwt/jwt-auth-data.model';
import { JwtAuthStrategy } from '../../auth/strategies/jwt/jwt.auth-strategy';
import { InjectRepository, repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider } from '../../di/models/di-provider.model';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { Route } from '../../routing/controller-route-configuration.model';
import { Body } from '../../routing/decorators/body.decorator';
import { Controller } from '../../routing/decorators/controller.decorator';
import { Delete } from '../../routing/decorators/delete.decorator';
import { Get } from '../../routing/decorators/get.decorator';
import { Param } from '../../routing/decorators/param.decorator';
import { Patch } from '../../routing/decorators/patch.decorator';
import { Post } from '../../routing/decorators/post.decorator';
import { TenantServiceInterface } from '../../tenancy/tenant-service.interface';
import { Newable } from '../../types/newable.type';
import { JsonUtilities } from '../../utilities/json.utilities';
import { Ms } from '../../utilities/ms';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { WebsocketController } from '../../websocket/decorators/websocket-controller.decorator';
import { WebsocketRoute } from '../../websocket/decorators/websocket-route.decorator';
import { SocketIOWebsocketConnection } from '../../websocket/models/connection/socket-io-websocket-connection.model';
import { WebsocketMessage } from '../../websocket/models/websocket-message.model';
import { WebsocketOptionsInput } from '../../websocket/models/websocket-options.model';
import { type WebsocketServiceInterface } from '../../websocket/services/websocket-service.interface';
import { DataSourceInterface } from '../data-sources/data-source.interface';
import { PaginationResult } from '../models/pagination-result.model';
import { Repository } from '../repository/repository';

// over real http and websockets, against real logins, from the side of somebody who belongs to one
// tenant and wants what another one holds: no way of reaching a table reaches past the tenant a
// request acts in - a list, a page and its total, a row by id, a filter naming the other tenant
// outright, a write naming it, a relation pointing into it, a message on a socket. Every handler is
// written the way an application writes one, without a filter of its own, because the handler
// nobody remembered to guard is the one this is for. How the tenant is read off a request is in
// tenancy/tenant.service.test.ts; the repository's own cases are in ./tenant-isolation.cases.ts.
//
// Run on the store that needs no container and on Postgres: the narrowing is the repository's, and
// what each store does with the filter it is handed is the other half of it.

const PROJECTS_PATH: Route = '/isolation-projects';
const TASKS_PATH: Route = '/isolation-tasks';
const BULLETINS_PATH: Route = '/isolation-bulletins';

/**
 * A row of one tenant, holding other rows of it.
 */
@Entity({ defaultRelations: { tasks: true } })
class IsolationProject extends BaseEntity {
    /**
     * The tenant the project belongs to.
     */
    @Property.string({ format: 'uuid' })
    tenantId!: string;

    // unique within each tenant: two tenants may both have a project of the same name
    /**
     * What the project is called, unique within its tenant.
     */
    @Property.string({ unique: true })
    name!: string;

    /**
     * The tasks of the project, read with it unless asked otherwise.
     */
    @Property.oneToMany({ target: () => IsolationTask, inverseSide: 'project' })
    tasks!: IsolationTask[];
}

/**
 * A row of one tenant, pointing at another row of it.
 */
@Entity()
class IsolationTask extends BaseEntity {
    /**
     * The tenant the task belongs to.
     */
    @Property.string({ format: 'uuid' })
    tenantId!: string;

    /**
     * What the task is called.
     */
    @Property.string()
    title!: string;

    /**
     * The project the task belongs to, when there is one.
     */
    @Property.manyToOne({ target: () => IsolationProject, joinColumn: 'projectId', inverseSide: 'tasks' })
    project?: IsolationProject;

    /**
     * The foreign key of the project.
     */
    @Property.string({ format: 'uuid', required: false })
    projectId?: string | null;
}

/**
 * A row of one tenant, or of none - and then every tenant reads it.
 */
@Entity()
class IsolationBulletin extends BaseEntity {
    /**
     * The tenant the bulletin belongs to, or none when every tenant reads it.
     */
    @Property.string({ format: 'uuid', required: false })
    tenantId?: string | null;

    /**
     * What the bulletin says.
     */
    @Property.string()
    text!: string;
}

/**
 * A task a caller sends along with a new project.
 */
class TaskBody {
    /**
     * What the task is called.
     */
    @Property.string()
    title!: string;

    /**
     * The tenant the caller names for the task, if any.
     */
    @Property.string({ format: 'uuid', required: false })
    tenantId?: string;
}

/**
 * What a caller sends to create a project.
 */
class ProjectCreateBody {
    /**
     * What the project is called.
     */
    @Property.string()
    name!: string;

    /**
     * The tenant the caller names for the project, if any.
     */
    @Property.string({ format: 'uuid', required: false })
    tenantId?: string;

    /**
     * The tasks to create along with the project, if any.
     */
    @Property.array({ items: { type: 'object', cls: () => TaskBody }, required: false })
    tasks?: TaskBody[];
}

/**
 * What a caller sends to change a project.
 */
class ProjectUpdateBody {
    /**
     * The new name, if it changes.
     */
    @Property.string({ required: false })
    name?: string;

    /**
     * The tenant the caller moves the project to, if any.
     */
    @Property.string({ format: 'uuid', required: false })
    tenantId?: string;
}

/**
 * What a caller sends to create a task.
 */
class TaskCreateBody {
    /**
     * What the task is called.
     */
    @Property.string()
    title!: string;

    /**
     * The project the task points at, if any.
     */
    @Property.string({ format: 'uuid', required: false })
    projectId?: string;
}

/**
 * What a caller sends to change a bulletin.
 */
class BulletinUpdateBody {
    /**
     * The new text.
     */
    @Property.string()
    text!: string;
}

/**
 * Projects over http, every handler written without a tenant filter of its own.
 */
@Controller(PROJECTS_PATH)
class IsolationProjectController {
    constructor(
        @InjectRepository(IsolationProject)
        private readonly projects: Repository<IsolationProject>
    ) {}

    /**
     * Lists every project.
     * @returns The projects the repository answers with.
     */
    @Get()
    async list(): Promise<IsolationProject[]> {
        return await this.projects.findAll();
    }

    /**
     * Reads the first page of projects.
     * @returns The page, with the total the repository counts.
     */
    @Get('/paginated')
    async paginated(): Promise<PaginationResult<IsolationProject>> {
        return await this.projects.findAllPaginated(1, 50);
    }

    // the handler passes on what the caller asked for, the way a search endpoint does
    /**
     * Lists the projects of the tenant the caller names.
     * @param tenantId - The tenant the caller asks for.
     * @returns The projects the repository answers with.
     */
    @Get('/filtered')
    async filtered(@Param.query('tenantId', { type: 'string', format: 'uuid' }) tenantId: string): Promise<IsolationProject[]> {
        return await this.projects.findAll({ where: { tenantId } });
    }

    // last of the GETs, because "/:id" matches anything a more specific route did not claim first
    /**
     * Reads a project by its id.
     * @param id - The id of the project.
     * @returns The project, with its tasks.
     */
    @Get('/:id')
    async byId(@Param.path('id') id: string): Promise<IsolationProject> {
        return await this.projects.findById(id);
    }

    /**
     * Creates a project from what the caller sent.
     * @param body - The project, with any tenant and tasks the caller names.
     * @returns The created project.
     */
    @Post()
    async create(@Body(ProjectCreateBody) body: ProjectCreateBody): Promise<IsolationProject> {
        return await this.projects.create(body);
    }

    /**
     * Changes a project by its id.
     * @param id - The id of the project.
     * @param body - What to change.
     * @returns The changed project.
     */
    @Patch('/:id')
    async update(@Param.path('id') id: string, @Body(ProjectUpdateBody) body: ProjectUpdateBody): Promise<IsolationProject> {
        return await this.projects.updateById(id, body);
    }

    /**
     * Deletes a project by its id.
     * @param id - The id of the project.
     * @returns The deleted project.
     */
    @Delete('/:id')
    async remove(@Param.path('id') id: string): Promise<IsolationProject> {
        return await this.projects.deleteById(id);
    }
}

/**
 * Tasks over http, the handler written without a tenant filter of its own.
 */
@Controller(TASKS_PATH)
class IsolationTaskController {
    constructor(
        @InjectRepository(IsolationTask)
        private readonly tasks: Repository<IsolationTask>
    ) {}

    /**
     * Creates a task from what the caller sent.
     * @param body - The task, with the project it points at.
     * @returns The created task.
     */
    @Post()
    async create(@Body(TaskCreateBody) body: TaskCreateBody): Promise<IsolationTask> {
        return await this.tasks.create(body);
    }
}

/**
 * Bulletins over http, every handler written without a tenant filter of its own.
 */
@Controller(BULLETINS_PATH)
class IsolationBulletinController {
    constructor(
        @InjectRepository(IsolationBulletin)
        private readonly bulletins: Repository<IsolationBulletin>
    ) {}

    /**
     * Lists every bulletin.
     * @returns The bulletins the repository answers with.
     */
    @Get()
    async list(): Promise<IsolationBulletin[]> {
        return await this.bulletins.findAll();
    }

    /**
     * Changes the text of a bulletin by its id.
     * @param id - The id of the bulletin.
     * @param body - The new text.
     * @returns The changed bulletin.
     */
    @Patch('/:id')
    async update(@Param.path('id') id: string, @Body(BulletinUpdateBody) body: BulletinUpdateBody): Promise<IsolationBulletin> {
        return await this.bulletins.updateById(id, body);
    }

    /**
     * Deletes a bulletin by its id.
     * @param id - The id of the bulletin.
     * @returns The deleted bulletin.
     */
    @Delete('/:id')
    async remove(@Param.path('id') id: string): Promise<IsolationBulletin> {
        return await this.bulletins.deleteById(id);
    }
}

/**
 * Projects over websockets, the handler written without a tenant filter of its own.
 */
@WebsocketController({ eventPrefix: 'isolation:' })
class IsolationWsController {
    constructor(
        @InjectRepository(IsolationProject)
        private readonly projects: Repository<IsolationProject>
    ) {}

    /**
     * Lists the names of every project.
     * @returns The names of the projects the repository answers with.
     */
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
     * The tenant named in the header, if any.
     */
    tenant?: string,
    /**
     * The method, GET by default.
     */
    method?: string,
    /**
     * The body, sent as json.
     */
    body?: object
};

/**
 * What the data source a runner hands the cases has to hold.
 */
export const tenantIsolationOverHttpEntities: Newable<BaseEntity>[] = [
    ...defaultTestServerEntities,
    IsolationProject,
    IsolationTask,
    IsolationBulletin
];

const websocketOptions: WebsocketOptionsInput = {
    messageRetentionInMs: Ms.DAY,
    timeoutInMs: 5000,
    handlerTimeoutInMs: 5000,
    isAllowedToConnect: () => true
};

/**
 * The cases, against an application keeping its data in the given data source.
 * @param name - The name of the data source.
 * @param dataSourceClass - The data source.
 */
export function describeTenantIsolationOverHttp(name: string, dataSourceClass: Newable<DataSourceInterface>): void {
    describe(`one tenant cannot reach another, over http, on ${name}`, () => {
        const tenantA: string = UUIDUtilities.generate();
        const tenantB: string = UUIDUtilities.generate();

        let server: StartedTestServer | undefined;
        let baseUrl: string;
        const sockets: Socket[] = [];

        // a member of a, and a member of b
        let alice: Account;
        let bob: Account;

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
                    async () => await inject(DefaultTestServerMembershipRepository).create({
                        tenantId,
                        userId: user.id,
                        roles: [MemberRoles.USER]
                    })
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
            if (options.tenant != undefined) {
                headers['x-tenant-id'] = options.tenant;
            }
            if (options.body != undefined) {
                headers['content-type'] = 'application/json';
            }
            return await fetch(`${baseUrl}${path}`, {
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
                authStrategies: [JwtAuthStrategy],
                controllers: [
                    IsolationProjectController,
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
                defaultAuth: 'isLoggedIn'
            });
            baseUrl = await server.start();

            alice = await createAccount('alice', [tenantA]);
            bob = await createAccount('bob', [tenantB]);

            alpha = await tenants().runAs(
                tenantA,
                async () => await projects().create({ name: 'alpha plan', tasks: [{ title: 'alpha task' }] })
            );
            beta = await tenants().runAs(
                tenantB,
                async () => await projects().create({ name: 'beta plan', tasks: [{ title: 'beta task' }] })
            );
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
                const ofA: string[] = await namesOf(await call(PROJECTS_PATH, { token: alice.token, tenant: tenantA }));
                const ofB: string[] = await namesOf(await call(PROJECTS_PATH, { token: bob.token, tenant: tenantB }));

                expect(ofA).toContain(alpha.name);
                expect(ofA).not.toContain(beta.name);
                expect(ofB).toContain(beta.name);
                expect(ofB).not.toContain(alpha.name);
            });

            it('counts the rows of the tenant alone in the total of a page', async () => {
                const res: Response = await call(`${PROJECTS_PATH}/paginated`, { token: alice.token, tenant: tenantA });
                const page: PaginationResult<IsolationProject> = await res.json() as PaginationResult<IsolationProject>;

                // a total counting every tenant's rows beside a page of one tenant's says how many
                // the others hold, which the page itself does not
                expect(page.items.map(p => p.name)).not.toContain(beta.name);
                expect(page.totalAmount).toBe(page.items.length);
            });

            it('answers a row of another tenant exactly like a row that does not exist', async () => {
                const other: Response = await call(`${PROJECTS_PATH}/${beta.id}`, { token: alice.token, tenant: tenantA });
                const missing: Response = await call(`${PROJECTS_PATH}/${UUIDUtilities.generate()}`, {
                    token: alice.token,
                    tenant: tenantA
                });

                // not 403: an id that exists elsewhere and one that exists nowhere have to be
                // indistinguishable, or a guarded route tells which ids are real
                expect(other.status).toBe(404);
                expect(missing.status).toBe(other.status);
            });

            it('finds nothing when a filter names another tenant outright', async () => {
                const res: Response = await call(`${PROJECTS_PATH}/filtered?tenantId=${tenantB}`, { token: alice.token, tenant: tenantA });

                expect(await namesOf(res)).toEqual([]);
            });

            it('hands a row back with the related rows of its own tenant', async () => {
                const res: Response = await call(`${PROJECTS_PATH}/${alpha.id}`, { token: alice.token, tenant: tenantA });
                const project: IsolationProject = await res.json() as IsolationProject;

                expect(project.tasks.map(t => t.title)).toEqual(['alpha task']);
            });
        });

        describe('writing', () => {
            it('refuses a new row for another tenant, and writes nothing there', async () => {
                const name: string = `smuggled ${UUIDUtilities.generate()}`;
                const res: Response = await call(PROJECTS_PATH, {
                    token: alice.token,
                    tenant: tenantA,
                    method: 'POST',
                    body: { name, tenantId: tenantB }
                });

                expect(res.status).toBe(403);
                expect(await namesOf(await call(PROJECTS_PATH, { token: bob.token, tenant: tenantB }))).not.toContain(name);
            });

            it('refuses new related rows for another tenant', async () => {
                const res: Response = await call(PROJECTS_PATH, {
                    token: alice.token,
                    tenant: tenantA,
                    method: 'POST',
                    body: { name: `nested ${UUIDUtilities.generate()}`, tasks: [{ title: 'smuggled task', tenantId: tenantB }] }
                });

                expect(res.status).toBe(403);
            });

            it('refuses to move a row to another tenant, and leaves it where it was', async () => {
                const res: Response = await call(`${PROJECTS_PATH}/${alpha.id}`, {
                    token: alice.token,
                    tenant: tenantA,
                    method: 'PATCH',
                    body: { tenantId: tenantB }
                });

                expect(res.status).toBe(403);
                expect((await projects().findById(alpha.id, { acrossTenants: true })).tenantId).toBe(tenantA);
            });

            it('answers 404 when changing or deleting a row of another tenant, and leaves it untouched', async () => {
                const update: Response = await call(`${PROJECTS_PATH}/${beta.id}`, {
                    token: alice.token,
                    tenant: tenantA,
                    method: 'PATCH',
                    body: { name: 'taken over' }
                });
                const remove: Response = await call(`${PROJECTS_PATH}/${beta.id}`, {
                    token: alice.token,
                    tenant: tenantA,
                    method: 'DELETE'
                });

                expect([update.status, remove.status]).toEqual([404, 404]);
                expect((await projects().findById(beta.id, { acrossTenants: true })).name).toBe(beta.name);
            });

            it('refuses to point a row at a row of another tenant, the same as at a row that is not there', async () => {
                const intoB: Response = await call(TASKS_PATH, {
                    token: alice.token,
                    tenant: tenantA,
                    method: 'POST',
                    body: { title: 'pointing into b', projectId: beta.id }
                });
                const nowhere: Response = await call(TASKS_PATH, {
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
                const inA: Response = await call(PROJECTS_PATH, { token: alice.token, tenant: tenantA, method: 'POST', body: { name } });
                const inB: Response = await call(PROJECTS_PATH, { token: bob.token, tenant: tenantB, method: 'POST', body: { name } });
                const againInA: Response = await call(PROJECTS_PATH, {
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

        describe('rows every tenant shares', () => {
            it('shows a row of no tenant to every tenant, and a tenant\'s own row to that tenant alone', async () => {
                const inA: Response = await call(BULLETINS_PATH, { token: alice.token, tenant: tenantA });
                const inB: Response = await call(BULLETINS_PATH, { token: bob.token, tenant: tenantB });
                const textsInA: string[] = (await inA.json() as IsolationBulletin[]).map(b => b.text);
                const textsInB: string[] = (await inB.json() as IsolationBulletin[]).map(b => b.text);

                expect(textsInA).toEqual(expect.arrayContaining([sharedBulletin.text, 'for a']));
                expect(textsInB).toContain(sharedBulletin.text);
                expect(textsInB).not.toContain('for a');
            });

            it('refuses a member changing or deleting a row every tenant shares, which they can read', async () => {
                const update: Response = await call(`${BULLETINS_PATH}/${sharedBulletin.id}`, {
                    token: alice.token,
                    tenant: tenantA,
                    method: 'PATCH',
                    body: { text: 'changed by a' }
                });
                const remove: Response = await call(`${BULLETINS_PATH}/${sharedBulletin.id}`, {
                    token: alice.token,
                    tenant: tenantA,
                    method: 'DELETE'
                });

                // forbidden rather than not found: the same caller lists it. Changing it would change
                // what every other tenant reads
                expect([update.status, remove.status]).toEqual([403, 403]);
                expect((await bulletins().findById(sharedBulletin.id)).text).toBe(sharedBulletin.text);
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
                expect(inA.data).toContain(alpha.name);
                expect(inA.data).not.toContain(beta.name);
                expect(inB).toMatchObject({ ok: false, status: 403 });
            }, 15000);
        });
    });
}