import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PasswordCredentials, PasswordCredentialsCreateData } from '../../auth/authenticators/password/password-credentials.model.ts';
import { Auth } from '../../auth/decorators/auth.decorator.ts';
import { type BaseUser } from '../../auth/models/base-user.model.ts';
import { JwtRefreshToken } from '../../auth/strategies/jwt/jwt-refresh-token.model.ts';
import { AlsUtilities } from '../../context/als.utilities.ts';
import { type HttpRequestContext } from '../../context/request/http-request.context.ts';
import { ZIBRI_REQUEST_CONTEXT_TOKENS } from '../../context/request/request-context-token.model.ts';
import { type WebsocketRequestContext } from '../../context/request/websocket-request.context.ts';
import { PostgresDataSource } from '../../data-source/data-sources/postgres/postgres-typeorm-data-source.model.ts';
import { Repository } from '../../data-source/repository/repository.ts';
import { InjectRepository, repositoryTokenFor } from '../../di/decorators/inject-repository.decorator.ts';
import { inject } from '../../di/inject.function.ts';
import { BaseEntity } from '../../entity/base-entity.model.ts';
import { Entity } from '../../entity/decorators/entity.decorator.ts';
import { Property } from '../../entity/decorators/property.decorator.ts';
import { denyAll, scopeFor } from '../../entity/models/entity-scope.model.ts';
import { UnauthorizedError } from '../../error-handling/errors/unauthorized.error.ts';
import { $ts } from '../../localization/translate.function.ts';
import { PaginationResult } from '../../open-api/pagination-result.model.ts';
import { Body } from '../../routing/decorators/body.decorator.ts';
import { Controller } from '../../routing/decorators/controller.decorator.ts';
import { Delete } from '../../routing/decorators/delete.decorator.ts';
import { Get } from '../../routing/decorators/get.decorator.ts';
import { Param } from '../../routing/decorators/param.decorator.ts';
import { Patch } from '../../routing/decorators/patch.decorator.ts';
import { Post } from '../../routing/decorators/post.decorator.ts';
import { Newable } from '../../types/newable.type.ts';
import { JsonUtilities } from '../../utilities/json.utilities.ts';
import { JwtTestAuthController } from '../mocks/controllers/jwt-test-auth.controller.ts';
import { JwtUser } from '../mocks/entities/jwt-user.entity.ts';
import { Roles } from '../mocks/entities/roles.enum.ts';
import { createTestDataSource, defaultTestServerEntities } from '../test-server/create-test-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../test-server/start-test-server.function.ts';

/**
 * Executable form of evaluation/03-auth-and-security.md A2, the row level half.
 *
 * Driven over real http against real logins, because the finding is not about one call: it is about
 * whether the framework can be relied on to keep two accounts apart across *every* way of reaching a
 * table - a list, a single row, an update, a delete and a create - rather than only the routes
 * somebody remembered to decorate. The list endpoints are the reason it is a MAJOR: an endpoint
 * decorator needs an id in the path, so `GET /invoices` was left to filter itself and one missing
 * filter was a cross-account leak.
 *
 * Every expectation describes the fixed behavior, so this file is red until the finding is closed.
 * See ./README.md for why.
 */

/**
 * Accounts the document scope answers with nothing for, set by the tests that need one.
 */
const suspended: Set<string> = new Set<string>();

/**
 * The requesting user, for a property default that fills in who a row belongs to.
 * @returns The requesting user, if there is one.
 */
async function currentUser(): Promise<BaseUser<string> | undefined> {
    const context: HttpRequestContext | WebsocketRequestContext | undefined = AlsUtilities.getCurrentRequestContext();
    return await context?.get(ZIBRI_REQUEST_CONTEXT_TOKENS.CURRENT_USER);
}

/**
 * Every row belongs to one user, and there is nothing here for a caller who is not one.
 */
@Entity({
    tenant: 'shared',
    scope: {
        restrictedTo: scopeFor<EvaluationInvoice>(ctx => {
            if (!ctx.currentUser) {
                throw new UnauthorizedError($ts`Invoices belong to a user, and this caller is not one.`);
            }
            return { userId: ctx.currentUser.id };
        })
    }
})
class EvaluationInvoice extends BaseEntity {
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
        restrictedTo: scopeFor<EvaluationReport>(ctx => {
            if (!ctx.currentUser) {
                throw new UnauthorizedError($ts`Reports belong to a user, and this caller is not one.`);
            }
            return ctx.currentUser.roles.includes(Roles.ADMIN) ? undefined : { userId: ctx.currentUser.id };
        })
    }
})
class EvaluationReport extends BaseEntity {
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
        restrictedTo: scopeFor<EvaluationRoom>(ctx => {
            if (!ctx.currentUser) {
                throw new UnauthorizedError($ts`Rooms belong to their members, and this caller is not one.`);
            }
            return { userIds: { includes: [ctx.currentUser.id] } };
        })
    }
})
class EvaluationRoom extends BaseEntity {
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
        restrictedTo: scopeFor<EvaluationDocument>(ctx => {
            if (!ctx.currentUser) {
                return { isPublic: true };
            }
            if (ctx.currentUser.roles.includes(Roles.ADMIN)) {
                return undefined;
            }
            if (suspended.has(ctx.currentUser.id)) {
                return denyAll;
            }
            return [{ isPublic: true }, { userId: ctx.currentUser.id }];
        })
    }
})
class EvaluationDocument extends BaseEntity {
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
@Controller('/evaluation-invoices')
class EvaluationInvoiceController {
    constructor(
        @InjectRepository(EvaluationInvoice)
        private readonly invoices: Repository<EvaluationInvoice>,
        @InjectRepository(EvaluationReport)
        private readonly reports: Repository<EvaluationReport>,
        @InjectRepository(EvaluationRoom)
        private readonly rooms: Repository<EvaluationRoom>
    ) {}

    // deliberately without a filter of its own. That is the whole point of the finding: this is what
    // a developer writes for a list, and there is nothing on the route to forget
    @Get()
    async list(): Promise<EvaluationInvoice[]> {
        return await this.invoices.findAll();
    }

    @Get('/paginated')
    async paginated(): Promise<PaginationResult<EvaluationInvoice>> {
        return await this.invoices.findAllPaginated(1, 50);
    }

    @Get('/reports')
    async listReports(): Promise<EvaluationReport[]> {
        return await this.reports.findAll();
    }

    @Get('/rooms')
    async listRooms(): Promise<EvaluationRoom[]> {
        return await this.rooms.findAll();
    }

    // the handler brings a filter of its own, which the scope has to narrow rather than replace
    @Get('/filtered')
    async filtered(@Param.query('title') title: string): Promise<EvaluationInvoice[]> {
        return await this.invoices.findAll({ where: { title } });
    }

    // the escape hatch, next to the role check that is what actually decides who may call this
    @Get('/admin/all')
    @Auth.hasPlatformRole([Roles.ADMIN])
    async listAll(): Promise<EvaluationInvoice[]> {
        return await this.invoices.findAll({ unscoped: ['restrictedTo'] });
    }

    // last of the GETs, because "/:id" matches anything a more specific route did not claim first
    @Get('/:id')
    async byId(@Param.path('id') id: string): Promise<EvaluationInvoice> {
        return await this.invoices.findById(id);
    }

    @Post()
    async create(@Body(InvoiceCreateBody) body: Partial<EvaluationInvoice>): Promise<EvaluationInvoice> {
        return await this.invoices.create(body);
    }

    @Patch('/:id')
    async update(
        @Param.path('id') id: string,
        @Body(InvoiceUpdateBody) body: Partial<EvaluationInvoice>
    ): Promise<EvaluationInvoice> {
        return await this.invoices.updateById(id, body);
    }

    @Delete('/:id')
    async remove(@Param.path('id') id: string): Promise<EvaluationInvoice> {
        return await this.invoices.deleteById(id);
    }
}

/**
 * The documents, on routes that do not require a login of their own.
 *
 * What an anonymous caller gets is the scope's business rather than the route's, which is the whole
 * point of the mixed case.
 */
@Controller('/evaluation-documents')
class EvaluationDocumentController {
    constructor(
        @InjectRepository(EvaluationDocument)
        private readonly documents: Repository<EvaluationDocument>
    ) {}

    @Get()
    @Auth.skip()
    async list(): Promise<EvaluationDocument[]> {
        return await this.documents.findAll();
    }
}

/**
 * A public route reaching an entity whose scope needs a user.
 */
@Controller('/evaluation-public-invoices')
class EvaluationPublicInvoiceController {
    constructor(
        @InjectRepository(EvaluationInvoice)
        private readonly invoices: Repository<EvaluationInvoice>
    ) {}

    @Get()
    @Auth.skip()
    async list(): Promise<EvaluationInvoice[]> {
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
let invoiceRepository: Repository<EvaluationInvoice>;
let reportRepository: Repository<EvaluationReport>;
let roomRepository: Repository<EvaluationRoom>;
let documentRepository: Repository<EvaluationDocument>;

let alice: JwtUser;
let bob: JwtUser;
let aliceToken: string;
let bobToken: string;
let rootToken: string;

const password: string = 'secure123';

const dataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [...defaultTestServerEntities, EvaluationInvoice, EvaluationReport, EvaluationRoom, EvaluationDocument]
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
    const headers: Headers = new Headers({
        authorization: `Bearer ${token}`,
        ...init.body == undefined ? {} : { 'content-type': 'application/json' }
    });
    // a Headers instance or a list of pairs loses its entries when spread into an object
    for (const [name, value] of new Headers(init.headers)) {
        headers.set(name, value);
    }
    return await fetch(`${baseUrl}/evaluation-invoices${path}`, { ...init, headers });
}

/**
 * Lists the documents, optionally as somebody.
 * @param token - The caller's bearer token, or nothing for an anonymous request.
 * @returns The titles that came back.
 */
async function listDocuments(token?: string): Promise<string[]> {
    const res: Response = await fetch(`${baseUrl}/evaluation-documents`, {
        headers: token == undefined ? {} : { authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(200);
    return (await res.json() as EvaluationDocument[]).map(d => d.title).sort();
}

beforeAll(async () => {
    server = await startTestServer({
        dataSources: [dataSourceClass],
        controllers: [
            JwtTestAuthController,
            EvaluationInvoiceController,
            EvaluationDocumentController,
            EvaluationPublicInvoiceController
        ],
        // the posture this is worth testing under: everything requires a login unless it says
        // otherwise, so the only anonymous callers here are the routes that declared themselves public
        defaultAuth: 'requireLogin'
    });
    baseUrl = await server.start();
    userRepository = inject(repositoryTokenFor(JwtUser));
    credentialsRepository = inject(repositoryTokenFor(PasswordCredentials));
    refreshTokenRepository = inject(repositoryTokenFor(JwtRefreshToken));
    invoiceRepository = inject(repositoryTokenFor(EvaluationInvoice));
    reportRepository = inject(repositoryTokenFor(EvaluationReport));
    roomRepository = inject(repositoryTokenFor(EvaluationRoom));
    documentRepository = inject(repositoryTokenFor(EvaluationDocument));
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
});

/**
 * Seeds one invoice for each of the two ordinary accounts.
 * @returns Alice's invoice and Bob's invoice.
 */
async function seedOnePerUser(): Promise<{ aliceInvoice: EvaluationInvoice, bobInvoice: EvaluationInvoice }> {
    const aliceInvoice: EvaluationInvoice = await invoiceRepository.create(
        { title: 'alice rent', userId: alice.id },
        { unscoped: true }
    );
    const bobInvoice: EvaluationInvoice = await invoiceRepository.create(
        { title: 'bob rent', userId: bob.id },
        { unscoped: true }
    );
    return { aliceInvoice, bobInvoice };
}

describe('evaluation/03-auth-and-security A2 - rows must be restricted to what the caller may see', () => {

    describe('reading', () => {
        it('answers a list with only the caller\'s own rows', async () => {
            const { aliceInvoice, bobInvoice }: Awaited<ReturnType<typeof seedOnePerUser>> = await seedOnePerUser();

            const forAlice: Response = await call('', aliceToken);
            const forBob: Response = await call('', bobToken);

            // the broken-object-level-authorization half of the finding. The handler passes no filter
            // at all, which is what every list handler looked like: an endpoint decorator needed an id
            // in the path, so a list could only be scoped by hand and one omission leaked the table.
            //
            // Both directions, because a scope that simply returned the first row would pass one
            expect(forAlice.status).toBe(200);
            expect((await forAlice.json() as EvaluationInvoice[]).map(i => i.id)).toEqual([aliceInvoice.id]);
            expect((await forBob.json() as EvaluationInvoice[]).map(i => i.id)).toEqual([bobInvoice.id]);
        });

        it('counts only the caller\'s own rows in a paginated result', async () => {
            await seedOnePerUser();

            const res: Response = await call('/paginated', aliceToken);
            const body: PaginationResult<EvaluationInvoice> = await res.json() as PaginationResult<EvaluationInvoice>;

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
            const body: EvaluationInvoice = await res.json() as EvaluationInvoice;

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
            const stored: EvaluationInvoice = await invoiceRepository.findById(bobInvoice.id, { unscoped: true });
            expect(stored.title).toBe('bob rent');
        });

        it('refuses to move a row out of the caller\'s own reach', async () => {
            const { aliceInvoice }: Awaited<ReturnType<typeof seedOnePerUser>> = await seedOnePerUser();

            const res: Response = await call(`/${aliceInvoice.id}`, aliceToken, {
                method: 'PATCH',
                body: JsonUtilities.stringify({ userId: bob.id })
            });

            expect(res.status).toBe(403);
            const stored: EvaluationInvoice = await invoiceRepository.findById(aliceInvoice.id, { unscoped: true });
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

            const res: Response = await fetch(`${baseUrl}/evaluation-public-invoices`);

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
            const body: EvaluationRoom[] = await res.json() as EvaluationRoom[];

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
            const body: EvaluationInvoice[] = await res.json() as EvaluationInvoice[];

            // both conditions have to hold at once. Applying the scope instead of the handler's
            // filter would answer with alice's "drop" as well, and applying the handler's filter
            // instead of the scope would answer with bob's "keep"
            expect(body.map(i => i.userId)).toEqual([alice.id]);
            expect(body.map(i => i.title)).toEqual(['keep']);
        });
    });
});