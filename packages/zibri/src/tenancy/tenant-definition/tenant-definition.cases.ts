import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { RecordingEmailTransport } from 'zibri-testing';

import { JwtUser } from '../../__testing__/mocks/entities/jwt-user.entity';
import { MemberRoles } from '../../__testing__/mocks/entities/member-roles.enum';
import { Roles } from '../../__testing__/mocks/entities/roles.enum';
import { TestMembership } from '../../__testing__/mocks/entities/test-membership.entity';
import { TestRole } from '../../__testing__/mocks/entities/test-role.entity';
import { TestTenant } from '../../__testing__/mocks/entities/test-tenant.entity';
import { DefaultTestServerMembershipRepository } from '../../__testing__/test-server/membership-repository';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { AuditEntry } from '../../audit/audit-entry.model';
import { OtpTwoFactorMethod } from '../../auth/2fa/methods/otp/otp.two-factor-method';
import { AuthController } from '../../auth/auth-controller/auth-controller.model';
import { PasswordCredentials, PasswordCredentialsCreateData } from '../../auth/authenticators/password/password-credentials.model';
import { PasswordAuthenticator } from '../../auth/authenticators/password/password.authenticator';
import { Auth } from '../../auth/decorators/auth.decorator';
import { CurrentUserProfile } from '../../auth/models/current-user-profile.model';
import { ApiKeyAuthStrategy } from '../../auth/strategies/api-key/api-key.auth-strategy';
import { ApiKey } from '../../auth/strategies/api-key/api-key.model';
import { JwtAuthStrategy } from '../../auth/strategies/jwt/jwt.auth-strategy';
import { DataSourceInterface } from '../../data-source/data-sources/data-source.interface';
import { Where } from '../../data-source/models/where/where-filter.model';
import { Repository } from '../../data-source/repository/repository';
import { EntityWriteObserverRegistry } from '../../data-source/write-observers/entity-write-observer.registry';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider } from '../../di/models/di-provider.model';
import { EmailConfigInput } from '../../email/models/email-config.model';
import { EmailPriority } from '../../email/models/email-priority.enum';
import { EmailStatus } from '../../email/models/email-status.enum';
import { Email } from '../../email/models/email.model';
import { BaseEntity } from '../../entity/base-entity.model';
import { BaseTenantEntity } from '../../entity/base-tenant-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { TenantDeactivatedError } from '../../error-handling/errors/tenant-deactivated.error';
import { Event, EventStatus } from '../../event/event.model';
import { OnAppInit } from '../../global/on-app-init.interface';
import { AuditAction, AuditOutcome, AuditReason } from '../../logging/audit-event.model';
import { Log } from '../../logging/log.model';
import { type LoggerInterface } from '../../logging/logger.interface';
import { BaseFunctionThreadJobWorkerData, BaseThreadJobWorkerData } from '../../multithreading/models/base-thread-job-worker-data.model';
import { ThreadJobEntity } from '../../multithreading/models/thread-job-entity.model';
import { ThreadJobStatus } from '../../multithreading/models/thread-job-status.enum';
import { MultithreadingService } from '../../multithreading/services/multithreading.service';
import { Controller } from '../../routing/decorators/controller.decorator';
import { Get } from '../../routing/decorators/get.decorator';
import { Newable } from '../../types/newable.type';
import { FsUtilities } from '../../utilities/fs.utilities';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { type TenantServiceInterface } from '../tenant-service.interface';
import { TenantDeletion } from './tenant-deletion.model';

declare module '../../event/event-service.interface' {
    interface ZibriEventMap {
        // eslint-disable-next-line sonar/no-duplicate-string
        'tenant-test.happened': { n: number }
    }
}

/**
 * A thread job, whichever kind it is.
 */
type AnyThreadJobEntity = ThreadJobEntity<BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>, unknown>;

const PASSWORD: string = 'correct horse battery staple';

/**
 * A project of a tenant, which its tasks point at.
 */
@Entity({ allowOrphan: true })
export class TenantTestProject extends BaseTenantEntity() {
    @Property.string()
    name!: string;

    @Property.oneToMany({ target: () => TenantTestTask, inverseSide: 'project' })
    tasks!: TenantTestTask[];
}

/**
 * A task of a project, deleted before the project it points at.
 */
@Entity({ allowOrphan: true })
export class TenantTestTask extends BaseTenantEntity() {
    @Property.string()
    title!: string;

    @Property.manyToOne({ target: () => TenantTestProject, joinColumn: 'projectId', inverseSide: 'tasks' })
    project!: TenantTestProject;

    @Property.string({ format: 'uuid' })
    projectId!: string;
}

@Controller('/auth', { allowOrphan: true, versions: 'all' })
class TenantTestAuthController extends AuthController({
        strategies: [JwtAuthStrategy],
        authenticators: [PasswordAuthenticator],
        twoFactorMethods: [OtpTwoFactorMethod],
        currentUserRoute: true
    }) {}

@Controller('/projects', { allowOrphan: true })
class TenantTestProjectController {
    @Auth.isLoggedIn()
    @Get('/')
    async count(): Promise<{ count: number }> {
        return { count: await inject<Repository<TenantTestProject>>(repositoryTokenFor(TenantTestProject)).count({}) };
    }

    @Auth.skip()
    @Get('/public')
    open(): { ok: boolean } {
        return { ok: true };
    }
}

/**
 * Whether a write to a task is refused, as an instance stopping halfway through a deletion leaves it.
 */
let tasksRefuseWrites: boolean = false;

/**
 * Refuses writes to tasks while `tasksRefuseWrites` is set. Registered while the application starts, as every
 * observer is.
 */
class TaskWriteRefusal implements OnAppInit {

    onAppInit(): void {
        inject(EntityWriteObserverRegistry).register(TenantTestTask, {
            properties: ['id'],
            validateWrite: () => tasksRefuseWrites ? Promise.reject(new Error('The instance stopped.')) : Promise.resolve()
        });
    }
}

/**
 * Describes deactivating and deleting tenants on the given data sources.
 * @param dataSourceName - The name of the data sources, for the suite.
 * @param dataSources - The data sources, which declare the defaults of the test server, `TestTenant`, `TenantDeletion`,
 * `ApiKey`, `TenantTestProject` and `TenantTestTask`.
 * @param startTimeoutInMs - How long starting the server may take.
 * @param shutdownTimeoutInMs - How long shutting it down may take.
 */
export function describeTenants(
    dataSourceName: string,
    dataSources: Newable<DataSourceInterface>[],
    startTimeoutInMs: number,
    shutdownTimeoutInMs: number
): void {
    describe(`deactivating and deleting tenants, on ${dataSourceName}`, () => {
        const transport: RecordingEmailTransport = new RecordingEmailTransport();
        let server: StartedTestServer | undefined;
        let baseUrl: string;

        beforeAll(async () => {
            server = await startTestServer({
                dataSources,
                authStrategies: [JwtAuthStrategy, ApiKeyAuthStrategy],
                authenticators: [PasswordAuthenticator],
                twoFactorMethods: [OtpTwoFactorMethod],
                controllers: [TenantTestAuthController, TenantTestProjectController],
                providers: [
                    ...defaultTestServerProviders,
                    defineProvider({
                        token: ZIBRI_DI_TOKENS.EMAIL_CONFIG,
                        useFactory: (): EmailConfigInput => ({
                            maxEmailsPerHour: 1000,
                            defaultSender: 'Ada',
                            failedRetentionInMs: 'forever'
                        })
                    }),
                    defineProvider({ token: ZIBRI_DI_TOKENS.EMAIL_TRANSPORT, useValue: transport }),
                    defineProvider({ token: TaskWriteRefusal, useClass: TaskWriteRefusal }),
                    // the queue of thread jobs itself, which the test server stands in for otherwise
                    defineProvider({ token: ZIBRI_DI_TOKENS.MULTITHREADING_SERVICE, useClass: MultithreadingService })
                ]
            });
            baseUrl = await server.start();
        }, startTimeoutInMs);

        afterAll(async () => {
            await server?.shutdown();
        }, shutdownTimeoutInMs);

        function tenants(): TenantServiceInterface {
            return inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
        }

        function users(): Repository<JwtUser> {
            return inject(repositoryTokenFor(JwtUser));
        }

        /**
         * A tenant with a member who logs in with a password, an admin of it.
         */
        type Tenant = {
            tenantId: string,
            user: JwtUser
        };

        async function createTenant(): Promise<Tenant> {
            const tenant: TestTenant = await inject(repositoryTokenFor(TestTenant)).create({ name: `tenant ${UUIDUtilities.generate()}` });
            const user: JwtUser = await users().create({ email: `${UUIDUtilities.generate()}@tenants.test`, roles: [Roles.USER] });
            await inject<Repository<PasswordCredentials, PasswordCredentialsCreateData>>(repositoryTokenFor(PasswordCredentials))
                .create({ userId: user.id, password: PASSWORD });
            await tenants().runAs(tenant.id, async () => await inject(DefaultTestServerMembershipRepository)
                .create({ tenantId: tenant.id, userId: user.id, roles: [MemberRoles.ADMIN] }));
            return { tenantId: tenant.id, user };
        }

        async function logIn(email: string): Promise<string> {
            const res: Response = await fetch(`${baseUrl}/auth/login`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ email, password: PASSWORD })
            });
            expect(res.status).toBe(200);
            return (await res.json() as { accessToken: { value: string } }).accessToken.value;
        }

        async function get(path: string, tenantId: string, accessToken?: string): Promise<Response> {
            return await fetch(`${baseUrl}${path}`, {
                headers: { 'x-tenant-id': tenantId, ...accessToken == undefined ? {} : { authorization: `Bearer ${accessToken}` } }
            });
        }

        async function status(path: string, tenantId: string, accessToken?: string): Promise<number> {
            const res: Response = await get(path, tenantId, accessToken);
            await res.body?.cancel();
            return res.status;
        }

        async function auditEvents(): Promise<unknown[]> {
            await inject<LoggerInterface>(ZIBRI_DI_TOKENS.LOGGER).flush();
            return (await inject(repositoryTokenFor(Log)).findAll({ acrossTenants: true })).map(l => l.context.metadata?.['audit']);
        }

        async function waitForDeletion(tenantId: string): Promise<TenantDeletion> {
            for (let attempt: number = 0; attempt < 200; attempt++) {
                const deletion: TenantDeletion | undefined = await tenants().findTenantDeletion?.(tenantId);
                if (deletion?.finishedAt != undefined) {
                    return deletion;
                }
                await new Promise(resolve => setTimeout(resolve, 50));
            }
            throw new Error(`The deletion of ${tenantId} did not finish.`);
        }

        describe('deactivating', () => {
            it('refuses every request for the tenant, logged in or not, until it is reactivated', async () => {
                const { tenantId, user } = await createTenant();
                const token: string = await logIn(user.email);
                expect(await status('/projects', tenantId, token)).toBe(200);

                await tenants().deactivateTenant?.(tenantId);

                expect(await status('/projects', tenantId, token)).toBe(403);
                expect(await status('/projects/public', tenantId)).toBe(403);
                expect(await auditEvents()).toContainEqual(expect.objectContaining({
                    action: AuditAction.AUTHORIZATION,
                    outcome: AuditOutcome.FAILURE,
                    reason: AuditReason.TENANT_DEACTIVATED
                }));

                await tenants().reactivateTenant?.(tenantId);

                expect(await status('/projects', tenantId, token)).toBe(200);
                expect(await auditEvents()).toEqual(expect.arrayContaining([
                    { action: AuditAction.TENANT_DEACTIVATED, outcome: AuditOutcome.SUCCESS },
                    { action: AuditAction.TENANT_REACTIVATED, outcome: AuditOutcome.SUCCESS }
                ]));
            });

            it('lets the user log in, and leaves the tenant out of what GET /me answers', async () => {
                const { tenantId, user } = await createTenant();
                const other: Tenant = await createTenant();
                await tenants().runAs(other.tenantId, async () => await inject(DefaultTestServerMembershipRepository)
                    .create({ tenantId: other.tenantId, userId: user.id, roles: [MemberRoles.USER] }));

                await tenants().deactivateTenant?.(tenantId);

                const token: string = await logIn(user.email);
                const res: Response = await get('/auth/me', tenantId, token);
                expect(res.status).toBe(200);
                expect((await res.json() as CurrentUserProfile).memberships.map(m => m.tenantId)).toEqual([other.tenantId]);
            });

            it('is seen at once however the tenant is written', async () => {
                const { tenantId, user } = await createTenant();
                const token: string = await logIn(user.email);
                expect(await status('/projects', tenantId, token)).toBe(200);

                await inject<Repository<TestTenant>>(repositoryTokenFor(TestTenant)).updateById(tenantId, { deactivatedAt: new Date() });

                expect(await status('/projects', tenantId, token)).toBe(403);
            });

            it('deletes the work queued for the tenant, and refuses queuing more', async () => {
                const { tenantId } = await createTenant();
                const other: Tenant = await createTenant();
                const queue: (id: string) => Promise<void> = async id => await tenants().runAs(id, async () => {
                    await inject(ZIBRI_DI_TOKENS.EMAIL_SERVICE).queue({
                        // eslint-disable-next-line sonar/no-duplicate-string
                        recipients: ['ada@example.com'],
                        subject: 'queued',
                        html: '<p></p>'
                    });
                    await inject(ZIBRI_DI_TOKENS.EVENT_SERVICE).emit('tenant-test.happened', { n: 1 });
                    await inject<Repository<AnyThreadJobEntity>>(repositoryTokenFor(ThreadJobEntity)).create({
                        queuedAtMs: Date.now(),
                        status: ThreadJobStatus.IN_QUEUE,
                        priority: false,
                        progress: 0,
                        attempts: 0,
                        timeoutInMs: 60000,
                        workerData: { filePath: FsUtilities.getPath(__dirname, 'nothing.worker.js') }
                    });
                });
                await queue(tenantId);
                await queue(other.tenantId);

                await tenants().deactivateTenant?.(tenantId);

                const left: (id: string) => Promise<[number, number, ThreadJobStatus[]]> = async id => await tenants().runAs(
                    id,
                    async () => [
                        await inject(repositoryTokenFor(Email)).count({ where: { status: EmailStatus.QUEUED, tenantId: id } }),
                        await inject(repositoryTokenFor(Event)).count({ where: { status: EventStatus.CREATED, tenantId: id } }),
                        (await inject<Repository<AnyThreadJobEntity>>(repositoryTokenFor(ThreadJobEntity))
                            .findAll({ where: { tenantId: id } })).map(job => job.status)
                    ]
                );
                expect(await left(tenantId)).toEqual([0, 0, [ThreadJobStatus.CANCELLED]]);
                expect(await left(other.tenantId)).toEqual([1, 1, [ThreadJobStatus.IN_QUEUE]]);

                await expect(tenants().runAs(tenantId, async () => await inject(ZIBRI_DI_TOKENS.EMAIL_SERVICE)
                    .queue({ recipients: ['ada@example.com'], subject: 'later', html: '<p></p>' })))
                    .rejects.toThrow(TenantDeactivatedError);
                await expect(tenants().runAs(
                    tenantId,
                    async () => await inject(ZIBRI_DI_TOKENS.EVENT_SERVICE).emit('tenant-test.happened', { n: 2 })
                )).rejects.toThrow(TenantDeactivatedError);
            });

            it('answers false for a tenant nobody declared', async () => {
                expect(await tenants().resolveIsDeactivated?.(UUIDUtilities.generate())).toBe(false);
            });
        });

        describe('deleting', () => {
            /**
             * Creates the rows a tenant has besides its member: a project with tasks, a role of its own, an api key
             * bound to it, a queued email and its audit trail.
             * @param tenant - The tenant.
             */
            async function fill(tenant: Tenant): Promise<void> {
                await tenants().runAs(tenant.tenantId, async () => {
                    const project: TenantTestProject = await inject<Repository<TenantTestProject>>(repositoryTokenFor(TenantTestProject))
                        .create({ name: 'roadmap' });
                    await inject<Repository<TenantTestTask>>(repositoryTokenFor(TenantTestTask)).createAll([
                        { title: 'plan', projectId: project.id },
                        { title: 'ship', projectId: project.id }
                    ]);
                    await inject<Repository<TestRole>>(repositoryTokenFor(TestRole))
                        .create({
                            name: `reviewer-${UUIDUtilities.generate()}`,
                            level: 'tenant',
                            permissions: [],
                            tenantId: tenant.tenantId,
                            description: undefined
                        });
                    await inject<Repository<Email>>(repositoryTokenFor(Email))
                        .create({
                            recipients: ['ada@example.com'],
                            subject: 'kept',
                            html: '<p></p>',
                            status: EmailStatus.SENT,
                            priority: EmailPriority.NORMAL,
                            persist: true,
                            sender: 'Ada'
                        });
                });
                await inject(ZIBRI_DI_TOKENS.AUTH_SERVICE).createApiKey(
                    tenant.user.id,
                    {
                        name: 'bound',
                        permissions: [],
                        expiresAt: undefined,
                        tenantId: tenant.tenantId,
                        clientAuthentication: undefined,
                        requireDpop: false
                    },
                    undefined
                );
            }

            /**
             * Counts the rows a tenant has.
             * @param tenantId - The tenant.
             * @returns The rows of each entity.
             */
            async function countRows(tenantId: string): Promise<Record<string, number>> {
                const ofTenant: Where<BaseEntity> = Object.fromEntries([['tenantId', tenantId]]);
                const of: (entity: Newable<BaseEntity>) => Promise<number> = async entity => await inject<Repository<BaseEntity>>(
                    repositoryTokenFor(entity)
                ).count({ where: ofTenant, acrossTenants: true, unscoped: true });
                await inject(ZIBRI_DI_TOKENS.AUDIT_SERVICE).flush();
                return {
                    projects: await of(TenantTestProject),
                    tasks: await of(TenantTestTask),
                    memberships: await of(TestMembership),
                    roles: await of(TestRole),
                    emails: await of(Email),
                    apiKeys: await of(ApiKey),
                    tenants: await inject<Repository<TestTenant>>(repositoryTokenFor(TestTenant)).count({ where: { id: tenantId } }),
                    auditEntries: await of(AuditEntry)
                };
            }

            it('refuses deleting a tenant that is active', async () => {
                const { tenantId } = await createTenant();

                await expect(tenants().deleteTenant?.(tenantId)).rejects.toThrow('needs to be deactivated before it is deleted');
                expect(await tenants().findTenantDeletion?.(tenantId)).toBeUndefined();
            });

            it('deletes every row of the tenant, and nothing of another, and keeps its audit trail', async () => {
                const tenant: Tenant = await createTenant();
                const other: Tenant = await createTenant();
                await fill(tenant);
                await fill(other);
                const otherBefore: Record<string, number> = await countRows(other.tenantId);

                await tenants().deactivateTenant?.(tenant.tenantId);
                await tenants().deleteTenant?.(tenant.tenantId);
                const deletion: TenantDeletion = await waitForDeletion(tenant.tenantId);

                const left: Record<string, number> = await countRows(tenant.tenantId);
                expect({ ...left, auditEntries: undefined }).toEqual({
                    projects: 0,
                    tasks: 0,
                    memberships: 0,
                    roles: 0,
                    emails: 0,
                    apiKeys: 0,
                    tenants: 0,
                    auditEntries: undefined
                });
                expect(left['auditEntries']).toBeGreaterThan(0);
                expect(deletion).toMatchObject({ deletingEntity: null, deletedRows: expect.any(Number) });
                expect(deletion.deletedRows).toBeGreaterThanOrEqual(8);
                expect({ ...await countRows(other.tenantId), auditEntries: undefined }).toEqual({
                    ...otherBefore,
                    auditEntries: undefined
                });
                // the users stay, as they are shared
                expect(await users().findOne({ where: { id: tenant.user.id }, required: false })).toBeDefined();
                expect(await auditEvents()).toContainEqual({ action: AuditAction.TENANT_DELETED, outcome: AuditOutcome.SUCCESS });
            });

            it('goes on with a deletion that stopped halfway, where it stopped', async () => {
                const tenant: Tenant = await createTenant();
                await fill(tenant);
                await tenants().deactivateTenant?.(tenant.tenantId);

                tasksRefuseWrites = true;
                try {
                    const started: TenantDeletion | undefined = await tenants().deleteTenant?.(tenant.tenantId);
                    expect(started?.finishedAt).toBeNull();
                    // the run that started it stops at the tasks, which come first
                    await tenants().resumeTenantDeletions?.();
                    expect((await tenants().findTenantDeletion?.(tenant.tenantId))?.finishedAt).toBeNull();
                    expect((await countRows(tenant.tenantId))['tasks']).toBe(2);
                }
                finally {
                    tasksRefuseWrites = false;
                }

                await tenants().resumeTenantDeletions?.();
                await waitForDeletion(tenant.tenantId);
                expect(await countRows(tenant.tenantId)).toMatchObject({ projects: 0, tasks: 0, memberships: 0, tenants: 0 });
            });

            it('answers the deletion that runs when it is started again', async () => {
                const tenant: Tenant = await createTenant();
                await tenants().deactivateTenant?.(tenant.tenantId);

                const first: TenantDeletion | undefined = await tenants().deleteTenant?.(tenant.tenantId);
                const again: TenantDeletion | undefined = await tenants().deleteTenant?.(tenant.tenantId);

                expect(again?.id).toBe(first?.id);
                await waitForDeletion(tenant.tenantId);
            });
        });
    });
}