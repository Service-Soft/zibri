import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

import { denyAll, scopeFor } from './entity-scope.model';
import { JwtTestAuthController } from '../../__testing__/mocks/controllers/jwt-test-auth.controller';
import { JwtUser } from '../../__testing__/mocks/entities/jwt-user.entity';
import { Roles } from '../../__testing__/mocks/entities/roles.enum';
import { TestPlatformPermissions } from '../../__testing__/mocks/entities/test-permissions.model';
import { createTestDataSource, defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { PasswordCredentials, PasswordCredentialsCreateData } from '../../auth/authenticators/password/password-credentials.model';
import { Auth } from '../../auth/decorators/auth.decorator';
import { type CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtRefreshToken } from '../../auth/strategies/jwt/jwt-refresh-token.model';
import { AlsUtilities } from '../../context/als.utilities';
import { type HttpRequestContext } from '../../context/request/http-request.context';
import { ZIBRI_REQUEST_CONTEXT_TOKENS } from '../../context/request/request-context-token.model';
import { type WebsocketRequestContext } from '../../context/request/websocket-request.context';
import { PostgresDataSource } from '../../data-source/data-sources/postgres/postgres-data-source.model';
import { PaginationResult } from '../../data-source/models/pagination-result.model';
import { Repository } from '../../data-source/repository/repository';
import { InjectRepository, repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { inject } from '../../di/inject.function';
import { UnauthorizedError } from '../../error-handling/errors/unauthorized.error';
import { $ts } from '../../localization/translate.function';
import { Body } from '../../routing/decorators/body.decorator';
import { Controller } from '../../routing/decorators/controller.decorator';
import { Delete } from '../../routing/decorators/delete.decorator';
import { Get } from '../../routing/decorators/get.decorator';
import { Param } from '../../routing/decorators/param.decorator';
import { Patch } from '../../routing/decorators/patch.decorator';
import { Post } from '../../routing/decorators/post.decorator';
import { Newable } from '../../types/newable.type';
import { JsonUtilities } from '../../utilities/json.utilities';
import { BaseEntity } from '../base-entity.model';
import { Entity } from '../decorators/entity.decorator';
import { Property } from '../decorators/property.decorator';

// over real http against real logins, because what is worth knowing is whether two accounts are kept
// apart across every way of reaching a table - a list, a single row, an update, a delete and a
// create - rather than only on the routes somebody remembered to decorate. A list is where it
// matters most: a route decorator needs an id in the path, so a list was left to filter itself and
// one missing filter leaked the table

/**
 * Accounts the document scope answers with nothing for, set by the tests that need one.
 */
const suspended: Set<string> = new Set<string>();

/**
 * The requesting user, for a property default that fills in who a row belongs to.
 * @returns The requesting user, if there is one.
 */
async function currentUser(): Promise<CurrentUser | undefined> {
    const context: HttpRequestContext | WebsocketRequestContext | undefined = AlsUtilities.getCurrentRequestContext();
    return await context?.get(ZIBRI_REQUEST_CONTEXT_TOKENS.CURRENT_USER);
}

/**
 * Every row belongs to one user, and there is nothing here for a caller who is not one.
 */
@Entity({
    tenant: 'shared',
    scope: {
        restrictedTo: scopeFor<OwnedInvoice>(ctx => {
            if (!ctx.currentUser) {
                throw new UnauthorizedError($ts`Invoices belong to a user, and this caller is not one.`);
            }
            return { userId: ctx.currentUser.id };
        })
    }
})
class OwnedInvoice extends BaseEntity {
    @Property.string()
    title!: string;

    // filled in by the property rather than by the scope: a filter says which rows a caller may see,
    // it cannot supply a value, and a default is where a value comes from
    @Property.string({ format: 'uuid', default: async () => (await currentUser())?.id ?? '' })
    userId!: string;
}

/**
 * The same restriction, with an administrator left unrestricted.
 *
 * Returning undefined is how a scope says it does not narrow this caller, which is what lets one
 * route serve both an owner and somebody who oversees all of them.
 */
@Entity({
    tenant: 'shared',
    scope: {
        restrictedTo: scopeFor<OwnedReport>(ctx => {
            if (!ctx.currentUser) {
                throw new UnauthorizedError($ts`Reports belong to a user, and this caller is not one.`);
            }
            return ctx.currentUser.platformPermissions.includes(TestPlatformPermissions.ADMIN) ? undefined : { userId: ctx.currentUser.id };
        })
    }
})
class OwnedReport extends BaseEntity {
    @Property.string()
    title!: string;

    @Property.string({ format: 'uuid', default: async () => (await currentUser())?.id ?? '' })
    userId!: string;
}

/**
 * A row that belongs to several users at once, the shape websocket rooms use.
 */
@Entity({
    tenant: 'shared',
    scope: {
        restrictedTo: scopeFor<SharedRoom>(ctx => {
            if (!ctx.currentUser) {
                throw new UnauthorizedError($ts`Rooms belong to their members, and this caller is not one.`);
            }
            return { userIds: { includes: [ctx.currentUser.id] } };
        })
    }
})
class SharedRoom extends BaseEntity {
    @Property.string()
    name!: string;

    @Property.array({ items: { type: 'string', format: 'uuid' } })
    userIds!: string[];
}

/**
 * Rows that are public and rows that belong to somebody, in one table.
 *
 * The case a fixed declaration cannot express: anonymous callers see the published ones, a logged in
 * caller sees those and their own, an administrator sees everything, and a suspended account sees
 * nothing at all without being refused outright.
 */
@Entity({
    tenant: 'shared',
    scope: {
        restrictedTo: scopeFor<PublishedDocument>(ctx => {
            if (!ctx.currentUser) {
                return { isPublic: true };
            }
            if (ctx.currentUser.platformPermissions.includes(TestPlatformPermissions.ADMIN)) {
                return undefined;
            }
            return suspended.has(ctx.currentUser.id) ? denyAll : [{ isPublic: true }, { userId: ctx.currentUser.id }];
        })
    }
})
class PublishedDocument extends BaseEntity {
    @Property.string()
    title!: string;

    @Property.boolean()
    isPublic!: boolean;

    @Property.string({ format: 'uuid', default: async () => (await currentUser())?.id ?? '' })
    userId!: string;
}

class InvoiceCreateBody {
    @Property.string()
    title!: string;

    @Property.string({ format: 'uuid', required: false })
    userId?: string;
}

class InvoiceUpdateBody {
    @Property.string({ required: false })
    title?: string;

    @Property.string({ format: 'uuid', required: false })
    userId?: string;
}

@Auth.isLoggedIn()
@Controller('/invoices')
class OwnedInvoiceController {
    constructor(
        @InjectRepository(OwnedInvoice)
        private readonly invoices: Repository<OwnedInvoice>,
        @InjectRepository(OwnedReport)
        private readonly reports: Repository<OwnedReport>,
        @InjectRepository(SharedRoom)
        private readonly rooms: Repository<SharedRoom>
    ) {}

    // deliberately without a filter of its own: this is what a developer writes for a list, and there
    // is nothing on the route to forget
    @Get()
    async list(): Promise<OwnedInvoice[]> {
        return await this.invoices.findAll();
    }

    @Get('/paginated')
    async paginated(): Promise<PaginationResult<OwnedInvoice>> {
        return await this.invoices.findAllPaginated(1, 50);
    }

    @Get('/reports')
    async listReports(): Promise<OwnedReport[]> {
        return await this.reports.findAll();
    }

    @Get('/rooms')
    async listRooms(): Promise<SharedRoom[]> {
        return await this.rooms.findAll();
    }

    // the handler brings a filter of its own, which the scope has to narrow rather than replace
    @Get('/filtered')
    async filtered(@Param.query('title') title: string): Promise<OwnedInvoice[]> {
        return await this.invoices.findAll({ where: { title } });
    }

    // the escape hatch, next to the permission check that is what actually decides who may call this
    @Get('/admin/all')
    @Auth.hasPlatformPermission(TestPlatformPermissions.ADMIN)
    async listAll(): Promise<OwnedInvoice[]> {
        return await this.invoices.findAll({ unscoped: ['restrictedTo'] });
    }

    // last of the GETs, because "/:id" matches anything a more specific route did not claim first
    @Get('/:id')
    async byId(@Param.path('id') id: string): Promise<OwnedInvoice> {
        return await this.invoices.findById(id);
    }

    @Post()
    async create(@Body(InvoiceCreateBody) body: Partial<OwnedInvoice>): Promise<OwnedInvoice> {
        return await this.invoices.create(body);
    }

    @Patch('/:id')
    async update(
        @Param.path('id') id: string,
        @Body(InvoiceUpdateBody) body: Partial<OwnedInvoice>
    ): Promise<OwnedInvoice> {
        return await this.invoices.updateById(id, body);
    }

    @Delete('/:id')
    async remove(@Param.path('id') id: string): Promise<OwnedInvoice> {
        return await this.invoices.deleteById(id);
    }
}

/**
 * The documents, on routes that do not require a login of their own.
 *
 * What an anonymous caller gets is the scope's business rather than the route's, which is the whole
 * point of the mixed case.
 */
@Controller('/documents')
class PublishedDocumentController {
    constructor(
        @InjectRepository(PublishedDocument)
        private readonly documents: Repository<PublishedDocument>
    ) {}

    @Get()
    @Auth.skip()
    async list(): Promise<PublishedDocument[]> {
        return await this.documents.findAll();
    }
}

/**
 * A public route reaching an entity whose scope needs a user.
 */
@Controller('/public-invoices')
class PublicInvoiceController {
    constructor(
        @InjectRepository(OwnedInvoice)
        private readonly invoices: Repository<OwnedInvoice>
    ) {}

    @Get()
    @Auth.skip()
    async list(): Promise<OwnedInvoice[]> {
        return await this.invoices.findAll();
    }
}

type TokenResponseBody = {
    /**
     * The account the tokens are for.
     */
    userId: string,
    /**
     * The bearer token.
     */
    accessToken: {
        /**
         * The token itself.
         */
        value: string
    }
};

let server: StartedTestServer | undefined;
let baseUrl: string;
let userRepository: Repository<JwtUser>;
let credentialsRepository: Repository<PasswordCredentials, PasswordCredentialsCreateData>;
let refreshTokenRepository: Repository<JwtRefreshToken>;
let invoiceRepository: Repository<OwnedInvoice>;
let reportRepository: Repository<OwnedReport>;
let roomRepository: Repository<SharedRoom>;
let documentRepository: Repository<PublishedDocument>;

let alice: JwtUser;
let bob: JwtUser;
let aliceToken: string;
let bobToken: string;
let rootToken: string;

const password: string = 'secure123';

const dataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [...defaultTestServerEntities, OwnedInvoice, OwnedReport, SharedRoom, PublishedDocument],
    repositories: defaultTestServerRepositories
});

/**
 * Creates an account and logs it in over http.
 * @param email - The address to register.
 * @param roles - The roles the account holds.
 * @returns The account and its bearer token.
 */
async function register(email: string, roles: Roles[]): Promise<{ user: JwtUser, token: string }> {
    const user: JwtUser = await userRepository.create({ email, roles });
    await credentialsRepository.create({ password, userId: user.id });

    const res: Response = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JsonUtilities.stringify({ email, password })
    });
    expect(res.status).toBe(200);
    const body: TokenResponseBody = await res.json() as TokenResponseBody;
    return { user, token: body.accessToken.value };
}

/**
 * Calls one of the invoice routes as a logged in caller.
 * @param path - The route below the controller's base route.
 * @param token - The caller's bearer token.
 * @param init - Method and body, for the writes.
 * @returns The raw response, since most assertions here are about the status.
 */
async function call(path: string, token: string, init: RequestInit = {}): Promise<Response> {
    return await fetch(`${baseUrl}/invoices${path}`, {
        ...init,
        headers: {
            authorization: `Bearer ${token}`,
            ...init.body == undefined ? {} : { 'content-type': 'application/json' },
            ...init.headers
        }
    });
}

/**
 * Lists the documents, optionally as somebody.
 * @param token - The caller's bearer token, or nothing for an anonymous request.
 * @returns The titles that came back.
 */
async function listDocuments(token?: string): Promise<string[]> {
    const res: Response = await fetch(`${baseUrl}/documents`, {
        headers: token == undefined ? {} : { authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(200);
    return (await res.json() as PublishedDocument[]).map(d => d.title).sort();
}

beforeAll(async () => {
    server = await startTestServer({
        dataSources: [dataSourceClass],
        controllers: [
            JwtTestAuthController,
            OwnedInvoiceController,
            PublishedDocumentController,
            PublicInvoiceController
        ],
        // the posture this is worth testing under: everything requires a login unless it says
        // otherwise, so the only anonymous callers here are the routes that declared themselves public
        defaultAuth: 'isLoggedIn'
    });
    baseUrl = await server.start();
    userRepository = inject(repositoryTokenFor(JwtUser));
    credentialsRepository = inject(repositoryTokenFor(PasswordCredentials));
    refreshTokenRepository = inject(repositoryTokenFor(JwtRefreshToken));
    invoiceRepository = inject(repositoryTokenFor(OwnedInvoice));
    reportRepository = inject(repositoryTokenFor(OwnedReport));
    roomRepository = inject(repositoryTokenFor(SharedRoom));
    documentRepository = inject(repositoryTokenFor(PublishedDocument));
}, 60000);

afterAll(async () => {
    // guarded so a failed beforeAll reports the real cause instead of a shutdown TypeError
    await server?.shutdown();
}, 30000);

beforeEach(async () => {
    suspended.clear();
    // unscoped, because these run outside a request and the entities are scoped - which is itself
    // one of the things asserted below
    await invoiceRepository.deleteAll({}, { unscoped: true });
    await reportRepository.deleteAll({}, { unscoped: true });
    await roomRepository.deleteAll({}, { unscoped: true });
    await documentRepository.deleteAll({}, { unscoped: true });
    await refreshTokenRepository.deleteAll({});
    await credentialsRepository.deleteAll({});
    await userRepository.deleteAll({});

    ({ user: alice, token: aliceToken } = await register('alice-ownership@example.com', [Roles.USER]));
    ({ user: bob, token: bobToken } = await register('bob-ownership@example.com', [Roles.USER]));
    ({ token: rootToken } = await register('root-ownership@example.com', [Roles.ADMIN]));
    // a quarter of a second alone, and past jest's five while other suites run a postgres of their
    // own: seven deletes, three accounts and three logins before every test
}, 30000);

/**
 * Seeds one invoice for each of the two ordinary accounts.
 * @returns Alice's invoice and Bob's invoice.
 */
async function seedOnePerUser(): Promise<{ aliceInvoice: OwnedInvoice, bobInvoice: OwnedInvoice }> {
    const aliceInvoice: OwnedInvoice = await invoiceRepository.create(
        { title: 'alice rent', userId: alice.id },
        { unscoped: true }
    );
    const bobInvoice: OwnedInvoice = await invoiceRepository.create(
        { title: 'bob rent', userId: bob.id },
        { unscoped: true }
    );
    return { aliceInvoice, bobInvoice };
}

describe('An entity scope - rows restricted to what the caller may see', () => {

    describe('reading', () => {
        it('answers a list with only the caller\'s own rows', async () => {
            const { aliceInvoice, bobInvoice }: Awaited<ReturnType<typeof seedOnePerUser>> = await seedOnePerUser();

            const forAlice: Response = await call('', aliceToken);
            const forBob: Response = await call('', bobToken);

            // the handler passes no filter at all, which is what every list handler looks like: a
            // route decorator needs an id in the path, so a list could only be scoped by hand.
            //
            // Both directions, because a scope that simply returned the first row would pass one
            expect(forAlice.status).toBe(200);
            expect((await forAlice.json() as OwnedInvoice[]).map(i => i.id)).toEqual([aliceInvoice.id]);
            expect((await forBob.json() as OwnedInvoice[]).map(i => i.id)).toEqual([bobInvoice.id]);
        });

        it('counts only the caller\'s own rows in a paginated result', async () => {
            await seedOnePerUser();

            const res: Response = await call('/paginated', aliceToken);
            const body: PaginationResult<OwnedInvoice> = await res.json() as PaginationResult<OwnedInvoice>;

            // the total used to be taken from the caller's own filter alone, so a scoped page of
            // items sat next to a count of every row that exists - a leak the page itself is not
            expect(body.items).toHaveLength(1);
            expect(body.totalAmount).toBe(1);
        });

        it('serves a row the caller owns', async () => {
            const { aliceInvoice }: Awaited<ReturnType<typeof seedOnePerUser>> = await seedOnePerUser();

            // the control: without it a scope that denied everything would pass every assertion here
            const res: Response = await call(`/${aliceInvoice.id}`, aliceToken);

            expect(res.status).toBe(200);
        });

        it('answers 404 for a row somebody else owns', async () => {
            const { bobInvoice }: Awaited<ReturnType<typeof seedOnePerUser>> = await seedOnePerUser();

            const res: Response = await call(`/${bobInvoice.id}`, aliceToken);

            // not 403: an id that exists and an id that does not have to be indistinguishable, or a
            // guarded route becomes a way to find out which ids are real
            expect(res.status).toBe(404);
        });

        it('answers 404 for a row that does not exist, exactly as for one it may not see', async () => {
            const { bobInvoice }: Awaited<ReturnType<typeof seedOnePerUser>> = await seedOnePerUser();

            const missing: Response = await call('/00000000-0000-4000-8000-000000000999', aliceToken);
            const forbidden: Response = await call(`/${bobInvoice.id}`, aliceToken);

            expect(missing.status).toBe(forbidden.status);
        });
    });

    describe('writing', () => {
        it('refuses to create a row that names somebody else as its owner', async () => {
            const res: Response = await call('', aliceToken, {
                method: 'POST',
                body: JsonUtilities.stringify({ title: 'planted', userId: bob.id })
            });

            // the read half on its own is a rule that only looks enforced: a caller who can create
            // rows they may not see can then read them back entirely legitimately
            expect(res.status).toBe(403);
            expect(await invoiceRepository.findAll({ unscoped: true })).toHaveLength(0);
        });

        it('lets the property\'s own default supply the owner', async () => {
            const res: Response = await call('', aliceToken, {
                method: 'POST',
                body: JsonUtilities.stringify({ title: 'mine' })
            });
            const body: OwnedInvoice = await res.json() as OwnedInvoice;

            // the default runs inside the save hook, which is *after* nothing and *before* the scope
            // check - so the value the check sees is the value being stored
            expect(res.status).toBe(200);
            expect(body.userId).toBe(alice.id);
        });

        it('answers 404 when updating a row somebody else owns, and leaves it untouched', async () => {
            const { bobInvoice }: Awaited<ReturnType<typeof seedOnePerUser>> = await seedOnePerUser();

            const res: Response = await call(`/${bobInvoice.id}`, aliceToken, {
                method: 'PATCH',
                body: JsonUtilities.stringify({ title: 'taken over' })
            });

            expect(res.status).toBe(404);
            const stored: OwnedInvoice = await invoiceRepository.findById(bobInvoice.id, { unscoped: true });
            expect(stored.title).toBe('bob rent');
        });

        it('refuses to move a row out of the caller\'s own reach', async () => {
            const { aliceInvoice }: Awaited<ReturnType<typeof seedOnePerUser>> = await seedOnePerUser();

            const res: Response = await call(`/${aliceInvoice.id}`, aliceToken, {
                method: 'PATCH',
                body: JsonUtilities.stringify({ userId: bob.id })
            });

            expect(res.status).toBe(403);
            const stored: OwnedInvoice = await invoiceRepository.findById(aliceInvoice.id, { unscoped: true });
            expect(stored.userId).toBe(alice.id);
        });

        it('allows an update that does not touch what the scope keys on', async () => {
            const { aliceInvoice }: Awaited<ReturnType<typeof seedOnePerUser>> = await seedOnePerUser();

            const res: Response = await call(`/${aliceInvoice.id}`, aliceToken, {
                method: 'PATCH',
                body: JsonUtilities.stringify({ title: 'renamed' })
            });

            // the change carries no userId at all. Judging it against the whole condition would
            // refuse every ordinary update, because a partial change never satisfies a filter on a
            // column it does not carry
            expect(res.status).toBe(200);
        });

        it('answers 404 when deleting a row somebody else owns, and leaves it in place', async () => {
            const { bobInvoice }: Awaited<ReturnType<typeof seedOnePerUser>> = await seedOnePerUser();

            const res: Response = await call(`/${bobInvoice.id}`, aliceToken, { method: 'DELETE' });

            expect(res.status).toBe(404);
            await expect(invoiceRepository.findById(bobInvoice.id, { unscoped: true })).resolves.toBeDefined();
        });

        it('deletes a row the caller owns', async () => {
            const { aliceInvoice }: Awaited<ReturnType<typeof seedOnePerUser>> = await seedOnePerUser();

            const res: Response = await call(`/${aliceInvoice.id}`, aliceToken, { method: 'DELETE' });

            expect(res.status).toBe(200);
            await expect(
                invoiceRepository.findById(aliceInvoice.id, { unscoped: true, required: false })
            ).resolves.toBeUndefined();
        });
    });

    describe('callers the scope refuses', () => {
        it('refuses an anonymous request when the scope says a user is required', async () => {
            await seedOnePerUser();

            const res: Response = await fetch(`${baseUrl}/public-invoices`);

            // the scope threw, and it is the scope's decision rather than the framework's - an
            // entity whose rows all belong to somebody has nothing to offer a caller who is nobody
            expect(res.status).toBe(401);
        });

        it('refuses a read made outside any request', async () => {
            await seedOnePerUser();

            // a cron job, a migration, a startup task. The scope is told there is no user and refuses
            // for the same reason it refuses an anonymous request
            await expect(invoiceRepository.findAll()).rejects.toThrow(UnauthorizedError);
        });

        it('serves the same read when it says unscoped', async () => {
            await seedOnePerUser();

            await expect(invoiceRepository.findAll({ unscoped: true })).resolves.toHaveLength(2);
        });
    });

    describe('callers the scope does not narrow', () => {
        it('restricts an ordinary caller', async () => {
            await reportRepository.createAll(
                [{ title: 'alice report', userId: alice.id }, { title: 'bob report', userId: bob.id }],
                { unscoped: true }
            );

            const res: Response = await call('/reports', aliceToken);

            expect(await res.json()).toHaveLength(1);
        });

        it('does not restrict one the scope returned nothing for', async () => {
            await reportRepository.createAll(
                [{ title: 'alice report', userId: alice.id }, { title: 'bob report', userId: bob.id }],
                { unscoped: true }
            );

            const res: Response = await call('/reports', rootToken);

            // the same route, and the reason returning undefined is worth having: an administrative
            // view does not need a second endpoint that quietly forgets to check anything
            expect(await res.json()).toHaveLength(2);
        });

        it('lets a route ask to be unscoped, guarded by its own role check', async () => {
            await seedOnePerUser();

            const asAdmin: Response = await call('/admin/all', rootToken);
            const asUser: Response = await call('/admin/all', aliceToken);

            expect(await asAdmin.json()).toHaveLength(2);
            // the escape hatch is not the guard. The role check next to it is
            expect(asUser.status).toBe(403);
        });
    });

    describe('a row that belongs to several users', () => {
        it('answers a list with the rows the caller is a member of', async () => {
            await roomRepository.createAll(
                [
                    { name: 'both', userIds: [alice.id, bob.id] },
                    { name: 'bob only', userIds: [bob.id] }
                ],
                { unscoped: true }
            );

            const res: Response = await call('/rooms', aliceToken);
            const body: SharedRoom[] = await res.json() as SharedRoom[];

            expect(body.map(r => r.name)).toEqual(['both']);
        });
    });

    describe('public rows and owned rows in one table', () => {
        beforeEach(async () => {
            await documentRepository.createAll(
                [
                    { title: 'announcement', isPublic: true, userId: bob.id },
                    { title: 'alice draft', isPublic: false, userId: alice.id },
                    { title: 'bob draft', isPublic: false, userId: bob.id }
                ],
                { unscoped: true }
            );
        });

        it('shows an anonymous caller only the public ones', async () => {
            expect(await listDocuments()).toEqual(['announcement']);
        });

        it('shows a logged in caller the public ones and their own', async () => {
            expect(await listDocuments(aliceToken)).toEqual(['alice draft', 'announcement']);
        });

        it('shows a caller the scope does not narrow everything', async () => {
            expect(await listDocuments(rootToken)).toEqual(['alice draft', 'announcement', 'bob draft']);
        });

        it('shows a caller the scope denied nothing at all, without refusing them', async () => {
            suspended.add(alice.id);

            // denyAll rather than a throw: this caller is inside the application and simply has no
            // rows, which is an empty list and not an error
            expect(await listDocuments(aliceToken)).toEqual([]);
        });
    });

    describe('what the caller asked for is kept', () => {
        it('narrows a filter the handler already applied rather than replacing it', async () => {
            await invoiceRepository.createAll(
                [
                    { title: 'keep', userId: alice.id },
                    { title: 'drop', userId: alice.id },
                    { title: 'keep', userId: bob.id }
                ],
                { unscoped: true }
            );

            const res: Response = await call('/filtered?title=keep', aliceToken);
            const body: OwnedInvoice[] = await res.json() as OwnedInvoice[];

            // both conditions have to hold at once. Applying the scope instead of the handler's
            // filter would answer with alice's "drop" as well, and applying the handler's filter
            // instead of the scope would answer with bob's "keep"
            expect(body.map(i => i.userId)).toEqual([alice.id]);
            expect(body.map(i => i.title)).toEqual(['keep']);
        });
    });
});