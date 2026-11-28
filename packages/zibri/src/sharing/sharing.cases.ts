import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { RecordingEmailTransport } from 'zibri-testing';

import { compileTsxTemplate } from '../__testing__/compile-tsx-template.function';
import { JwtUser } from '../__testing__/mocks/entities/jwt-user.entity';
import { MemberRoles } from '../__testing__/mocks/entities/member-roles.enum';
import { Roles } from '../__testing__/mocks/entities/roles.enum';
import { TestInvitation } from '../__testing__/mocks/entities/test-invitation.entity';
import { TestMembership } from '../__testing__/mocks/entities/test-membership.entity';
import { DefaultTestServerMembershipRepository } from '../__testing__/test-server/membership-repository';
import { defaultTestServerProviders, rolesAndPermissionsProviders, TestServerRole } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { OtpTwoFactorMethod } from '../auth/2fa/methods/otp/otp.two-factor-method';
import { type AuthServiceInterface } from '../auth/auth-service.interface';
import { AuthController } from '../auth/auth-controller/auth-controller.model';
import { LoginLinkEmailTemplate } from '../auth/authenticators/login-link/login-link-email-template.model';
import { LoginLinkAuthenticator } from '../auth/authenticators/login-link/login-link.authenticator';
import { PasswordAuthenticator } from '../auth/authenticators/password/password.authenticator';
import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { InvitationEmailTemplate } from '../auth/invitation/invitation-email-template.model';
import { type AnyLevelPermissions } from '../auth/models/any-level-permissions.model';
import { definePermissions, definePlatformPermissions } from '../auth/roles/define-permissions.function';
import { type Permission } from '../auth/roles/permission.type';
import { type PlatformPermission } from '../auth/roles/platform-permission.type';
import { ZIBRI_PERMISSIONS, ZIBRI_PLATFORM_PERMISSIONS } from '../auth/roles/zibri-permissions.model';
import { ApiKeyAuthStrategy } from '../auth/strategies/api-key/api-key.auth-strategy';
import { CreatedApiKey } from '../auth/strategies/api-key/created-api-key.model';
import { JwtAuthStrategy } from '../auth/strategies/jwt/jwt.auth-strategy';
import { DataSourceInterface } from '../data-source/data-sources/data-source.interface';
import { PaginationResult } from '../data-source/models/pagination-result.model';
import { Repository } from '../data-source/repository/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { defineProvider } from '../di/models/di-provider.model';
import { EmailConfigInput } from '../email/models/email-config.model';
import { BaseEntity } from '../entity/base-entity.model';
import { BaseTenantEntity } from '../entity/base-tenant-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { scopeFor } from '../entity/models/entity-scope.model';
import { InternalError } from '../error-handling/internal-error.model';
import { Controller } from '../routing/decorators/controller.decorator';
import { Get } from '../routing/decorators/get.decorator';
import { Param } from '../routing/decorators/param.decorator';
import { type TenantServiceInterface } from '../tenancy/tenant-service.interface';
import { Newable } from '../types/newable.type';
import { UUIDUtilities } from '../utilities/uuid.utilities';
import { RowShare } from './row-share.model';
import { ShareByEmailResult } from './share-by-email.model';
import { type ShareServiceInterface } from './share-service.interface';

/**
 * The cases every data source answers the same way about rows shared with selected people: a caller without the
 * full access of a shareable entity reads the rows shared with them, the rows below those and the rows belonging to
 * them, and nothing else. A file per data source runs them against data sources of its own.
 */

// eslint-disable-next-line typescript/typedef
const Permissions = definePermissions([...ZIBRI_PERMISSIONS, 'projects.read'] as const);

// eslint-disable-next-line typescript/typedef
const PlatformPermissions = definePlatformPermissions([...ZIBRI_PLATFORM_PERMISSIONS, 'projects.read-all'] as const);

const PROJECTS_FULL_ACCESS: AnyLevelPermissions = {
    permission: Permissions.PROJECTS_READ,
    platformPermission: PlatformPermissions.PROJECTS_READ_ALL
};

const roles: TestServerRole[] = [
    { name: Roles.USER, level: 'platform', permissions: [], description: undefined },
    { name: Roles.ADMIN, level: 'platform', permissions: [PlatformPermissions.PROJECTS_READ_ALL], description: undefined },
    // the guests of a tenant: a role without the permission, which sees what is shared with its holders
    { name: MemberRoles.USER, level: 'tenant', permissions: [], description: undefined },
    { name: MemberRoles.ADMIN, level: 'tenant', permissions: [Permissions.PROJECTS_READ], description: undefined }
];

/**
 * A project of a tenant, with projects below it to any depth.
 */
@Entity({ allowOrphan: true, shareable: { fullAccess: PROJECTS_FULL_ACCESS, parent: 'parent', roles: ['viewer', 'commenter', 'editor'] } })
export class SharedProject extends BaseTenantEntity() {
    @Property.string()
    name!: string;

    @Property.string({ format: 'uuid', required: false })
    parentId?: string | null;

    @Property.manyToOne({ target: () => SharedProject, joinColumn: 'parentId', inverseSide: 'children', required: false })
    parent?: SharedProject;

    @Property.oneToMany({ target: () => SharedProject, inverseSide: 'parent', required: false })
    children?: SharedProject[];

    @Property.oneToMany({ target: () => SharedTask, inverseSide: 'project', required: false })
    tasks?: SharedTask[];
}

/**
 * A task of a project, seen by whoever sees the project.
 */
@Entity({ allowOrphan: true, sharedThrough: 'project' })
export class SharedTask extends BaseTenantEntity() {
    @Property.string()
    title!: string;

    @Property.boolean()
    done!: boolean;

    @Property.string({ format: 'uuid' })
    projectId!: string;

    @Property.manyToOne({ target: () => SharedProject, joinColumn: 'projectId', inverseSide: 'tasks' })
    project!: SharedProject;

    @Property.oneToMany({ target: () => SharedComment, inverseSide: 'task', required: false })
    comments?: SharedComment[];
}

/**
 * A comment on a task, seen by whoever sees the project of the task.
 */
@Entity({ allowOrphan: true, sharedThrough: 'task' })
export class SharedComment extends BaseTenantEntity() {
    @Property.string()
    text!: string;

    @Property.string({ format: 'uuid' })
    taskId!: string;

    @Property.manyToOne({ target: () => SharedTask, joinColumn: 'taskId', inverseSide: 'comments' })
    task!: SharedTask;
}

/**
 * A document shared one by one, whose drafts nobody but code past the scopes reads.
 */
@Entity({
    allowOrphan: true,
    shareable: { fullAccess: Permissions.PROJECTS_READ, roles: ['reader'] },
    scope: { restrictedTo: scopeFor<SharedDocument>(() => ({ draft: false })) }
})
export class SharedDocument extends BaseTenantEntity() {
    @Property.string()
    title!: string;

    @Property.boolean()
    draft!: boolean;
}

/**
 * The entities the cases need beside those of the test server, for a data source to declare.
 */
export const sharingEntities: Newable<BaseEntity>[] = [RowShare, SharedProject, SharedTask, SharedComment, SharedDocument];

/**
 * The work a request of a case runs, by the id its route is called with.
 */
const probes: Map<string, () => Promise<unknown>> = new Map();

/**
 * Runs the work of a case inside a request of its caller, and the routes requiring a role on a row.
 */
@Controller('/share-probes', { allowOrphan: true })
class ShareProbeController {
    @Auth.isLoggedIn()
    @Get('/:id')
    async run(@Param.path('id') id: string): Promise<{ value: unknown }> {
        const probe: (() => Promise<unknown>) | undefined = probes.get(id);
        if (probe == undefined) {
            throw new InternalError(`No probe ${id}.`);
        }
        return { value: await probe() };
    }

    @Auth.requireShareRole(SharedProject, 'commenter', 'projectId')
    @Get('/projects/:projectId/comment')
    comment(@Param.path('projectId') projectId: string): { projectId: string } {
        return { projectId };
    }

    @Auth.requireShareRole(SharedTask, 'editor', 'taskId')
    @Get('/tasks/:taskId/edit')
    edit(@Param.path('taskId') taskId: string): { taskId: string } {
        return { taskId };
    }
}

/**
 * The auth routes, answering invitations, with an account without a password logged in by its link.
 */
@Controller('/auth', { allowOrphan: true, versions: 'all' })
class SharingTestAuthController extends AuthController({
        strategies: [JwtAuthStrategy],
        authenticators: [PasswordAuthenticator, LoginLinkAuthenticator],
        twoFactorMethods: [OtpTwoFactorMethod],
        invitationRoutes: true
    }) {}

/**
 * How a case calls a route: as somebody, in a tenant.
 */
type Caller = {
    /**
     * The user.
     */
    user: JwtUser,
    /**
     * The headers their requests send.
     */
    headers: Record<string, string>
};

/**
 * Thrown when the request running the work of a case was refused, with its status.
 */
class ProbeRefusal extends Error {
    constructor(readonly status: number) {
        super(`refused with ${status}`);
    }
}

/**
 * The rows of a tenant the cases read: two trees of projects, the tasks of some and a comment on each task.
 */
type Tree = {
    internal: SharedProject,
    marketing: SharedProject,
    blog: SharedProject,
    drafts: SharedProject,
    finance: SharedProject,
    customer: SharedProject,
    marketingTask: SharedTask,
    blogTask: SharedTask,
    financeTask: SharedTask,
    marketingComment: SharedComment,
    financeComment: SharedComment
};

/**
 * Describes sharing rows with selected people on the given data sources.
 * @param dataSourceName - The name of the data sources, for the suite.
 * @param dataSources - The data sources, which declare the test server's entities, `sharingEntities`, `ApiKey`,
 * `LoginLinkToken` and `TestInvitation`, and list its repository.
 * @param startTimeoutInMs - How long starting the server may take.
 * @param shutdownTimeoutInMs - How long shutting it down may take.
 */
export function describeSharing(
    dataSourceName: string,
    dataSources: Newable<DataSourceInterface>[],
    startTimeoutInMs: number,
    shutdownTimeoutInMs: number
): void {
    describe(`sharing rows, on ${dataSourceName}`, () => {
        const transport: RecordingEmailTransport = new RecordingEmailTransport();
        let server: StartedTestServer | undefined;
        let baseUrl: string;
        const tenantId: string = UUIDUtilities.generate();
        const otherTenantId: string = UUIDUtilities.generate();

        beforeAll(async () => {
            server = await startTestServer({
                dataSources,
                authStrategies: [JwtAuthStrategy, ApiKeyAuthStrategy],
                authenticators: [PasswordAuthenticator, LoginLinkAuthenticator],
                twoFactorMethods: [OtpTwoFactorMethod],
                controllers: [ShareProbeController, SharingTestAuthController],
                providers: [
                    ...defaultTestServerProviders,
                    ...rolesAndPermissionsProviders(
                        { permissions: Object.values(Permissions), platformPermissions: Object.values(PlatformPermissions) },
                        roles
                    ),
                    defineProvider({
                        token: ZIBRI_DI_TOKENS.INVITATION_OPTIONS,
                        useValue: {
                            acceptInvitationUrl: 'https://app.example.com/invitation',
                            invitationEmail: compileTsxTemplate<InvitationEmailTemplate>(
                                'export const Email = ({ link, invitation }) => <a href={link}>{invitation.name}</a>;'
                            ),
                            tokenExpiresInMs: 60000,
                            onExpiredToken: 'refuse'
                        }
                    }),
                    defineProvider({
                        token: ZIBRI_DI_TOKENS.LOGIN_LINK_OPTIONS,
                        useValue: {
                            loginLinkUrl: 'https://app.example.com/login-link',
                            loginLinkEmail: compileTsxTemplate<LoginLinkEmailTemplate>('export const Email = ({ loginLink }) => <a href={loginLink}></a>;')
                        }
                    }),
                    defineProvider({
                        token: ZIBRI_DI_TOKENS.EMAIL_CONFIG,
                        useFactory: (): EmailConfigInput => ({ maxEmailsPerHour: 1000, defaultSender: 'Ada', failedRetentionInMs: 'forever' })
                    }),
                    defineProvider({ token: ZIBRI_DI_TOKENS.EMAIL_TRANSPORT, useValue: transport })
                ]
            });
            baseUrl = await server.start();
        }, startTimeoutInMs);

        afterAll(async () => {
            await server?.shutdown();
        }, shutdownTimeoutInMs);

        function shares(): ShareServiceInterface {
            return inject(ZIBRI_DI_TOKENS.SHARE_SERVICE);
        }

        function tenants(): TenantServiceInterface {
            return inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
        }

        function projects(): Repository<SharedProject> {
            return inject(repositoryTokenFor(SharedProject));
        }

        function tasks(): Repository<SharedTask> {
            return inject(repositoryTokenFor(SharedTask));
        }

        function comments(): Repository<SharedComment> {
            return inject(repositoryTokenFor(SharedComment));
        }

        function documents(): Repository<SharedDocument> {
            return inject(repositoryTokenFor(SharedDocument));
        }

        function rowShares(): Repository<RowShare> {
            return inject(repositoryTokenFor(RowShare));
        }

        /**
         * Runs work in a tenant, outside every request.
         * @param work - The work.
         * @param tenant - The tenant, the one of the suite unless given.
         * @returns What it answers.
         */
        async function inTenant<T>(work: () => Promise<T>, tenant: string = tenantId): Promise<T> {
            return await tenants().runAs(tenant, work);
        }

        /**
         * Creates a user with the given roles, and an api key acting as them.
         * @param platformRoles - The roles of their own.
         * @param memberships - The roles they hold, by tenant.
         * @returns The caller, in the tenant of the suite.
         */
        async function createCaller(platformRoles: Roles[], memberships: Record<string, MemberRoles[]>): Promise<Caller> {
            const user: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser))
                .create({ email: `${UUIDUtilities.generate()}@sharing.test`, roles: platformRoles });
            for (const [tenant, memberRoles] of Object.entries(memberships)) {
                await inTenant(
                    async () => await inject(DefaultTestServerMembershipRepository).create({ tenantId: tenant, userId: user.id, roles: memberRoles }),
                    tenant
                );
            }
            const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
            const permissions: (Permission | PlatformPermission)[] = await authService.resolveUserPermissions(user, undefined);
            const created: CreatedApiKey = await authService.createApiKey(
                user.id,
                { name: 'cases', permissions, expiresAt: undefined, tenantId: undefined, clientAuthentication: undefined, requireDpop: false },
                undefined
            );
            return { user, headers: { 'x-api-key': created.key, 'x-tenant-id': tenantId } };
        }

        async function createGuest(): Promise<Caller> {
            return await createCaller([Roles.USER], { [tenantId]: [MemberRoles.USER] });
        }

        /**
         * Runs work inside a request of a caller.
         * @param caller - Who asks.
         * @param work - The work, whose answer is sent as json.
         * @param tenant - The tenant the request is for, the one of the suite unless given.
         * @returns What the work answered, as it arrives.
         * @throws A ProbeRefusal when the request was refused.
         */
        async function as<T>(caller: Caller, work: () => Promise<T>, tenant: string = tenantId): Promise<T> {
            const id: string = UUIDUtilities.generate();
            probes.set(id, work);
            try {
                const res: Response = await fetch(`${baseUrl}/share-probes/${id}`, { headers: { ...caller.headers, 'x-tenant-id': tenant } });
                if (res.status !== 200) {
                    await res.body?.cancel();
                    throw new ProbeRefusal(res.status);
                }
                // what the work answered, which the case typed
                return (await res.json() as { value: T }).value;
            }
            finally {
                probes.delete(id);
            }
        }

        /**
         * Runs work inside a request of a caller, and answers the status it was refused with.
         * @param caller - Who asks.
         * @param work - The work.
         * @returns The status, 200 when it was not refused.
         */
        async function statusAs(caller: Caller, work: () => Promise<unknown>): Promise<number> {
            try {
                await as(caller, work);
                return 200;
            }
            catch (error) {
                if (error instanceof ProbeRefusal) {
                    return error.status;
                }
                throw error;
            }
        }

        async function call(caller: Caller, path: string): Promise<number> {
            const res: Response = await fetch(`${baseUrl}${path}`, { headers: caller.headers });
            await res.body?.cancel();
            return res.status;
        }

        async function createProject(name: string, parentId?: string, tenant: string = tenantId): Promise<SharedProject> {
            return await inTenant(async () => await projects().create({ tenantId: tenant, name, parentId: parentId ?? null }, { unscoped: true }), tenant);
        }

        async function createTask(title: string, projectId: string): Promise<SharedTask> {
            return await inTenant(async () => await tasks().create({ tenantId, title, done: false, projectId }, { unscoped: true }));
        }

        async function createComment(text: string, taskId: string): Promise<SharedComment> {
            return await inTenant(async () => await comments().create({ tenantId, text, taskId }, { unscoped: true }));
        }

        async function share(projectId: string, userId: string, role: string, tenant: string = tenantId): Promise<RowShare> {
            return await inTenant(async () => await shares().share(SharedProject, projectId, userId, role, undefined), tenant);
        }

        /**
         * Creates the rows of a tenant the cases read, and shares Marketing with a guest as a viewer, and the blog
         * below it as an editor.
         * @param guest - The guest.
         * @returns The rows.
         */
        async function createTree(guest: Caller): Promise<Tree> {
            const internal: SharedProject = await createProject('Internal');
            const marketing: SharedProject = await createProject('Marketing', internal.id);
            const blog: SharedProject = await createProject('SEO blog', marketing.id);
            const drafts: SharedProject = await createProject('Drafts', blog.id);
            const finance: SharedProject = await createProject('Finance', internal.id);
            const customer: SharedProject = await createProject('Customer GmbH');
            const marketingTask: SharedTask = await createTask('Plan the campaign', marketing.id);
            const blogTask: SharedTask = await createTask('Write the first post', blog.id);
            const financeTask: SharedTask = await createTask('File the taxes', finance.id);
            const marketingComment: SharedComment = await createComment('Next week', marketingTask.id);
            const financeComment: SharedComment = await createComment('Due in July', financeTask.id);
            await share(marketing.id, guest.user.id, 'viewer');
            await share(blog.id, guest.user.id, 'editor');
            return { internal, marketing, blog, drafts, finance, customer, marketingTask, blogTask, financeTask, marketingComment, financeComment };
        }

        function sorted(ids: string[]): string[] {
            return [...ids].sort();
        }

        describe('a caller without full access', () => {
            let guest: Caller;
            let tree: Tree;

            beforeAll(async () => {
                guest = await createGuest();
                tree = await createTree(guest);
            }, startTimeoutInMs);

            it('reads exactly the rows shared with them and the rows below those', async () => {
                const ids: string[] = await as(guest, async () => (await projects().findAll()).map(p => p.id));

                expect(sorted(ids)).toEqual(sorted([tree.marketing.id, tree.blog.id, tree.drafts.id]));
            });

            it('finds a row seen by its id, and is answered 404 for one it does not see', async () => {
                expect(await as(guest, async () => (await projects().findById(tree.drafts.id)).name)).toBe('Drafts');
                expect(await statusAs(guest, async () => await projects().findById(tree.finance.id))).toBe(404);
                expect(await statusAs(guest, async () => await projects().findById(tree.internal.id))).toBe(404);
            });

            it('pages and counts the rows it sees alone, combined with its own filter', async () => {
                const page: { ids: string[], total: number } = await as(guest, async () => {
                    const found: PaginationResult<SharedProject> = await projects().findAllPaginated(1, 2, { order: { name: 'ASC' } });
                    return { ids: found.items.map(p => p.id), total: found.totalAmount };
                });
                expect(page).toEqual({ ids: [tree.drafts.id, tree.marketing.id], total: 3 });
                expect(await as(guest, async () => await projects().count())).toBe(3);
                expect(await as(guest, async () => (await projects().findAll({ where: { name: { like: '%n%' } } })).map(p => p.name).sort()))
                    .toEqual(['Marketing']);
            });

            it('resolves the relations to the rows it sees alone', async () => {
                const read: { parent: string | null, children: string[], tasks: string[] } = await as(guest, async () => {
                    const marketing: SharedProject = await projects().findById(tree.marketing.id, { relations: ['parent', 'children', 'tasks'] });
                    return {
                        parent: marketing.parent?.id ?? null,
                        children: (marketing.children ?? []).map(c => c.id),
                        tasks: (marketing.tasks ?? []).map(t => t.id)
                    };
                });

                expect(read).toEqual({ parent: null, children: [tree.blog.id], tasks: [tree.marketingTask.id] });
            });

            it('reads the rows belonging to a row it sees, through one relation and through two, and no others', async () => {
                const read: { tasks: string[], comments: string[] } = await as(guest, async () => ({
                    tasks: (await tasks().findAll()).map(t => t.id),
                    comments: (await comments().findAll()).map(c => c.id)
                }));

                expect(sorted(read.tasks)).toEqual(sorted([tree.marketingTask.id, tree.blogTask.id]));
                expect(read.comments).toEqual([tree.marketingComment.id]);
                expect(await statusAs(guest, async () => await comments().findById(tree.financeComment.id))).toBe(404);
                expect(await as(guest, async () => await tasks().count({ where: { project: { where: { name: 'Finance' } } } }))).toBe(0);
            });

            it('writes within what it sees, and is refused outside of it', async () => {
                const created: string = await as(guest, async () => (await tasks().create({ tenantId, title: 'Draft a post', done: false, projectId: tree.drafts.id })).id);
                expect(await as(guest, async () => (await tasks().findById(created)).title)).toBe('Draft a post');

                expect(await statusAs(guest, async () => await tasks().create({ tenantId, title: 'Pay', done: false, projectId: tree.finance.id }))).toBe(403);
                expect(await statusAs(guest, async () => await projects().updateById(tree.finance.id, { name: 'Mine' }))).toBe(404);
                expect(await statusAs(guest, async () => await projects().deleteById(tree.customer.id))).toBe(404);
                expect(await statusAs(guest, async () => await projects().create({ tenantId, name: 'A root of my own', parentId: null }))).toBe(403);
                expect(await statusAs(guest, async () => await tasks().updateById(tree.marketingTask.id, { projectId: tree.finance.id }))).toBe(403);
            });

            it('creates a row below a row it sees, and sees it in the same request and after', async () => {
                const seen: { id: string, inRequest: string[] } = await as(guest, async () => {
                    const created: SharedProject = await projects().create({ tenantId, name: 'Newsletter', parentId: tree.marketing.id });
                    return { id: created.id, inRequest: (await projects().findAll({ where: { name: 'Newsletter' } })).map(p => p.id) };
                });

                expect(seen.inRequest).toEqual([seen.id]);
                expect(await as(guest, async () => (await projects().findById(seen.id)).name)).toBe('Newsletter');
            });

            it('is told it has no full access', async () => {
                expect(await as(guest, async () => await shares().resolveHasFullAccess(SharedComment))).toBe(false);
            });
        });

        describe('a caller with full access', () => {
            it('reads every row of the tenant, by a permission of their membership or of their own', async () => {
                const guest: Caller = await createGuest();
                const tree: Tree = await createTree(guest);
                const manager: Caller = await createCaller([Roles.USER], { [tenantId]: [MemberRoles.ADMIN] });
                const operator: Caller = await createCaller([Roles.ADMIN], { [tenantId]: [MemberRoles.USER] });

                for (const caller of [manager, operator]) {
                    const ids: string[] = await as(caller, async () => (await projects().findAll({ limit: 'all' })).map(p => p.id));
                    expect(ids).toEqual(expect.arrayContaining([tree.internal.id, tree.finance.id, tree.customer.id]));
                    expect(await as(caller, async () => (await comments().findById(tree.financeComment.id)).text)).toBe('Due in July');
                    expect(await as(caller, async () => await shares().resolveHasFullAccess(SharedTask))).toBe(true);
                }
            });
        });

        describe('roles', () => {
            let guest: Caller;
            let tree: Tree;

            beforeAll(async () => {
                guest = await createGuest();
                tree = await createTree(guest);
            }, startTimeoutInMs);

            it('resolves the highest role along the rows above a row', async () => {
                const resolved: (string | undefined)[] = await inTenant(async () => await Promise.all(
                    [tree.marketing, tree.blog, tree.drafts, tree.finance].map(async p => await shares().resolveRole(SharedProject, p.id, guest.user.id))
                ));

                expect(resolved).toEqual(['viewer', 'editor', 'editor', undefined]);
            });

            it('lets a route through on a role high enough, a higher one on a row below included', async () => {
                // a viewer of Marketing, an editor of the blog below it
                expect(await call(guest, `/share-probes/projects/${tree.marketing.id}/comment`)).toBe(403);
                expect(await call(guest, `/share-probes/projects/${tree.blog.id}/comment`)).toBe(200);
                expect(await call(guest, `/share-probes/projects/${tree.drafts.id}/comment`)).toBe(200);
                expect(await call(guest, `/share-probes/projects/${tree.finance.id}/comment`)).toBe(404);
            });

            it('takes the role on a row of an entity shared through a relation from the row it belongs to', async () => {
                expect(await call(guest, `/share-probes/tasks/${tree.blogTask.id}/edit`)).toBe(200);
                expect(await call(guest, `/share-probes/tasks/${tree.marketingTask.id}/edit`)).toBe(403);
                expect(await call(guest, `/share-probes/tasks/${tree.financeTask.id}/edit`)).toBe(404);
            });

            it('lets a caller with full access through without a share', async () => {
                const manager: Caller = await createCaller([Roles.USER], { [tenantId]: [MemberRoles.ADMIN] });

                expect(await call(manager, `/share-probes/projects/${tree.finance.id}/comment`)).toBe(200);
                expect(await call(manager, `/share-probes/tasks/${tree.financeTask.id}/edit`)).toBe(200);
            });

            it('checks a role in the handler the way the route does', async () => {
                expect(await statusAs(guest, async () => await shares().validateRole(SharedProject, tree.marketing.id, 'viewer'))).toBe(200);
                expect(await statusAs(guest, async () => await shares().validateRole(SharedProject, tree.marketing.id, 'editor'))).toBe(403);
                expect(await statusAs(guest, async () => await shares().validateRole(SharedProject, tree.customer.id, 'viewer'))).toBe(404);
            });

            it('refuses a role the entity does not declare', async () => {
                await expect(share(tree.customer.id, guest.user.id, 'owner')).rejects.toMatchObject({ status: 400 });
            });
        });

        describe('taking a share away', () => {
            it('ends access with the next request, and keeps the account and membership seeing nothing', async () => {
                const guest: Caller = await createGuest();
                const tree: Tree = await createTree(guest);
                expect(await as(guest, async () => (await projects().findAll()).length)).toBe(3);

                await inTenant(async () => await shares().unshare(SharedProject, tree.blog.id, guest.user.id, undefined));
                expect(sorted(await as(guest, async () => (await projects().findAll()).map(p => p.id))))
                    .toEqual(sorted([tree.marketing.id, tree.blog.id, tree.drafts.id]));
                expect(await call(guest, `/share-probes/projects/${tree.blog.id}/comment`)).toBe(403);

                await inTenant(async () => await shares().unshare(SharedProject, tree.marketing.id, guest.user.id, undefined));
                expect(await as(guest, async () => ({
                    projects: (await projects().findAll()).length,
                    tasks: (await tasks().findAll()).length,
                    comments: (await comments().findAll()).length
                }))).toEqual({ projects: 0, tasks: 0, comments: 0 });
                const membership: TestMembership | undefined = await inTenant(
                    async () => await inject(DefaultTestServerMembershipRepository).findOne({ where: { userId: guest.user.id }, required: false })
                );
                expect(membership?.roles).toEqual([MemberRoles.USER]);
            });
        });

        describe('deleting a row', () => {
            it('deletes its shares and those of the rows deleted with it', async () => {
                const guest: Caller = await createGuest();
                const tree: Tree = await createTree(guest);
                await share(tree.drafts.id, guest.user.id, 'commenter');

                await inTenant(async () => await projects().deleteById(tree.blog.id, { unscoped: true }));

                const left: string[] = await inTenant(async () => (await rowShares().findAll({ where: { userId: guest.user.id } })).map(s => s.rowId));
                expect(left).toEqual([tree.marketing.id]);
            });

            it('deletes the shares of a user deleted for good', async () => {
                const guest: Caller = await createGuest();
                await createTree(guest);

                await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser)).deleteById(guest.user.id);

                expect(await rowShares().findAll({ where: { userId: guest.user.id }, acrossTenants: true })).toEqual([]);
            });
        });

        describe('a parent', () => {
            it('is refused when it is the row itself or a row below it', async () => {
                const guest: Caller = await createGuest();
                const tree: Tree = await createTree(guest);

                await expect(inTenant(async () => await projects().updateById(tree.marketing.id, { parentId: tree.drafts.id }, { unscoped: true })))
                    .rejects.toMatchObject({ status: 400 });
                await expect(inTenant(async () => await projects().updateById(tree.marketing.id, { parentId: tree.marketing.id }, { unscoped: true })))
                    .rejects.toMatchObject({ status: 400 });
                await inTenant(async () => await projects().updateById(tree.drafts.id, { parentId: tree.customer.id }, { unscoped: true }));
                expect(await as(guest, async () => (await projects().findAll()).length)).toBe(2);
            });
        });

        describe('sharing by email', () => {
            const operator: CurrentUser = {
                id: UUIDUtilities.generate(),
                email: 'operator@sharing.test',
                deactivatedAt: undefined,
                permissions: [],
                platformPermissions: [PlatformPermissions.AUTH_ASSIGN_ROLE_IN_ANY_TENANT_WITH_ANY_PERMISSION]
            };

            async function shareByEmail(projectId: string, email: string, withoutPassword: boolean): Promise<ShareByEmailResult<TestInvitation>> {
                return await inTenant(async () => await shares().shareByEmail<TestInvitation>(operator, SharedProject, projectId, email, 'commenter', {
                    name: 'Grace',
                    roles: [MemberRoles.USER],
                    createOn: 'accept',
                    declinable: true,
                    expiresInMs: undefined,
                    withoutPassword
                }, undefined));
            }

            async function readToken(email: string): Promise<string> {
                await inject(ZIBRI_DI_TOKENS.EMAIL_SERVICE).sendQueuedEmails();
                const html: string = transport.sends.filter(sent => sent.recipients.includes(email)).at(-1)?.html ?? '';
                const token: string | undefined = /invitation\/([\da-f]+)/.exec(html)?.[1];
                if (token == undefined) {
                    throw new Error(`No invitation was mailed to ${email}.`);
                }
                return token;
            }

            async function accept(body: object): Promise<Response> {
                return await fetch(`${baseUrl}/auth/accept-invitation`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify(body)
                });
            }

            it('invites an email without an account, which gets the account, the guest membership and the share on accepting', async () => {
                const project: SharedProject = await createProject('Website');
                const email: string = `${UUIDUtilities.generate()}@customer.test`;

                const result: ShareByEmailResult<TestInvitation> = await shareByEmail(project.id, email, true);
                expect(result.share).toBeUndefined();
                expect(result.invitation?.rowShares).toEqual([{ entity: 'shared_project', rowId: project.id, role: 'commenter' }]);

                const res: Response = await accept({ token: await readToken(email) });
                expect(res.status).toBe(200);
                const accessToken: string = (await res.json() as { accessToken: { value: string } }).accessToken.value;

                const user: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser)).findOne({ where: { email } });
                const membership: TestMembership | undefined = await inTenant(
                    async () => await inject(DefaultTestServerMembershipRepository).findOne({ where: { userId: user.id }, required: false })
                );
                expect(membership?.roles).toEqual([MemberRoles.USER]);
                expect(await inTenant(async () => await shares().resolveRole(SharedProject, project.id, user.id))).toBe('commenter');
                const customer: Caller = { user, headers: { authorization: `Bearer ${accessToken}` } };
                expect(await as(customer, async () => (await projects().findAll()).map(p => p.id))).toEqual([project.id]);
            });

            it('invites an email to an account with a password', async () => {
                const project: SharedProject = await createProject('Shop');
                const email: string = `${UUIDUtilities.generate()}@customer.test`;
                await shareByEmail(project.id, email, false);

                expect((await accept({ token: await readToken(email), password: 'correct horse battery staple' })).status).toBe(204);

                const user: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser)).findOne({ where: { email } });
                expect(await inTenant(async () => await shares().resolveRole(SharedProject, project.id, user.id))).toBe('commenter');
            });

            it('shares with a member of the tenant at once', async () => {
                const guest: Caller = await createGuest();
                const project: SharedProject = await createProject('Brochure');

                const result: ShareByEmailResult<TestInvitation> = await shareByEmail(project.id, guest.user.email, false);

                expect(result.invitation).toBeUndefined();
                expect(result.share).toMatchObject({ rowId: project.id, userId: guest.user.id, role: 'commenter' });
            });

            it('refuses a row the tenant does not hold', async () => {
                const elsewhere: SharedProject = await createProject('Elsewhere', undefined, otherTenantId);

                await expect(shareByEmail(elsewhere.id, `${UUIDUtilities.generate()}@customer.test`, false)).rejects.toMatchObject({ status: 404 });
            });
        });

        describe('tenants', () => {
            it('keeps the shares of one tenant out of another', async () => {
                const guest: Caller = await createCaller([Roles.USER], { [tenantId]: [MemberRoles.USER], [otherTenantId]: [MemberRoles.USER] });
                const tree: Tree = await createTree(guest);
                const elsewhere: SharedProject = await createProject('Elsewhere', undefined, otherTenantId);
                const otherManager: Caller = await createCaller([Roles.USER], { [otherTenantId]: [MemberRoles.ADMIN] });

                expect(await as(guest, async () => (await projects().findAll()).length, otherTenantId)).toBe(0);
                const seenElsewhere: string[] = await as(otherManager, async () => (await projects().findAll({ limit: 'all' })).map(p => p.id), otherTenantId);
                expect(seenElsewhere).toContain(elsewhere.id);
                expect(seenElsewhere).not.toContain(tree.marketing.id);
                await expect(share(tree.marketing.id, guest.user.id, 'viewer', otherTenantId)).rejects.toMatchObject({ status: 404 });
            });
        });

        describe('an entity with a scope of its own', () => {
            it('narrows the rows shared by both', async () => {
                const guest: Caller = await createGuest();
                const [published, draft, unshared] = await inTenant(async () => await documents().createAll([
                    { tenantId, title: 'Offer', draft: false },
                    { tenantId, title: 'Offer, next version', draft: true },
                    { tenantId, title: 'Price list', draft: false }
                ], { unscoped: true }));
                if (published == undefined || draft == undefined || unshared == undefined) {
                    throw new Error('The documents were not created.');
                }
                await inTenant(async () => {
                    await shares().share(SharedDocument, published.id, guest.user.id, 'reader', undefined);
                    await shares().share(SharedDocument, draft.id, guest.user.id, 'reader', undefined);
                });
                const manager: Caller = await createCaller([Roles.USER], { [tenantId]: [MemberRoles.ADMIN] });

                expect(await as(guest, async () => (await documents().findAll()).map(d => d.id))).toEqual([published.id]);
                expect(sorted(await as(manager, async () => (await documents().findAll({ limit: 'all' })).map(d => d.id))))
                    .toEqual(expect.arrayContaining([published.id, unshared.id]));
                expect(await as(manager, async () => (await documents().findAll({ where: { id: draft.id } })).length)).toBe(0);
            });
        });
    });
}
