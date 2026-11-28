import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { RecordingEmailTransport } from 'zibri-testing';

import { compileTsxTemplate } from '../../__testing__/compile-tsx-template.function';
import { JwtUser } from '../../__testing__/mocks/entities/jwt-user.entity';
import { MemberRoles } from '../../__testing__/mocks/entities/member-roles.enum';
import { Roles } from '../../__testing__/mocks/entities/roles.enum';
import { TestInvitation } from '../../__testing__/mocks/entities/test-invitation.entity';
import { TestMembership } from '../../__testing__/mocks/entities/test-membership.entity';
import { TestServerInvitationRepository } from '../../__testing__/test-server/invitation-repository';
import { DefaultTestServerMembershipRepository } from '../../__testing__/test-server/membership-repository';
import { defaultTestServerProviders, rolesAndPermissionsProviders, TestServerRole } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { CronJobEntity, CreateCronJobEntityData } from '../../cron/cron-job-entity.model';
import { ExpiredRowsCleanupCronJob } from '../../cron/expired-rows-cleanup.cron-job';
import { DataSourceInterface } from '../../data-source/data-sources/data-source.interface';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider, DiProvider } from '../../di/models/di-provider.model';
import { EmailConfigInput } from '../../email/models/email-config.model';
import { ServiceAccountRefusedError } from '../../error-handling/errors/service-account-refused.error';
import { AuditAction, AuditOutcome, AuditReason } from '../../logging/audit-event.model';
import { Log } from '../../logging/log.model';
import { type LoggerInterface } from '../../logging/logger.interface';
import { Controller } from '../../routing/decorators/controller.decorator';
import { type TenantServiceInterface } from '../../tenancy/tenant-service.interface';
import { Newable } from '../../types/newable.type';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { OtpTwoFactorMethod } from '../2fa/methods/otp/otp.two-factor-method';
import { AuthController } from '../auth-controller/auth-controller.model';
import { LoginLinkEmailTemplate } from '../authenticators/login-link/login-link-email-template.model';
import { LoginLinkOptions } from '../authenticators/login-link/login-link-options.model';
import { LoginLinkAuthenticator } from '../authenticators/login-link/login-link.authenticator';
import { PasswordCredentials, PasswordCredentialsCreateData } from '../authenticators/password/password-credentials.model';
import { PasswordAuthenticator } from '../authenticators/password/password.authenticator';
import { CurrentUser } from '../decorators/current-user.decorator';
import { definePermissions, definePlatformPermissions } from '../roles/define-permissions.function';
import { ZIBRI_PERMISSIONS, ZIBRI_PLATFORM_PERMISSIONS } from '../roles/zibri-permissions.model';
import { JwtAuthStrategy } from '../strategies/jwt/jwt.auth-strategy';
import { type UserServiceInterface } from '../user/user-service.interface';
import { InvitationCreateData } from './invitation-create-data.model';
import { InvitationEmailTemplate } from './invitation-email-template.model';
import { InvitationOptions } from './invitation-options.model';
import { InvitationServiceInterface } from './invitation-service.interface';
import { InvitationTokenValidity } from './invitation-token-validity.model';

// eslint-disable-next-line typescript/typedef
const Permissions = definePermissions([...ZIBRI_PERMISSIONS, 'notes.read', 'notes.delete'] as const);

// eslint-disable-next-line typescript/typedef
const PlatformPermissions = definePlatformPermissions([...ZIBRI_PLATFORM_PERMISSIONS, 'reports.read'] as const);

const roles: TestServerRole[] = [
    { name: Roles.USER, level: 'platform', permissions: [], description: undefined },
    { name: Roles.ADMIN, level: 'platform', permissions: [PlatformPermissions.REPORTS_READ], description: undefined },
    { name: MemberRoles.USER, level: 'tenant', permissions: [Permissions.NOTES_READ], description: undefined },
    { name: MemberRoles.ADMIN, level: 'tenant', permissions: [Permissions.NOTES_READ, Permissions.NOTES_DELETE], description: undefined }
];

const PASSWORD: string = 'correct horse battery staple';

const ACCEPT_INVITATION_URL: string = 'https://app.example.com/invitation';

/**
 * The auth routes of the suites, with those answering invitations.
 */
@Controller('/auth', { allowOrphan: true, versions: 'all' })
class InvitationTestAuthController extends AuthController({
        strategies: [JwtAuthStrategy],
        authenticators: [PasswordAuthenticator],
        twoFactorMethods: [OtpTwoFactorMethod],
        invitationRoutes: true
    }) {}

/**
 * The same routes, logging the account of an invitation without a password in by its link.
 */
@Controller('/auth', { allowOrphan: true, versions: 'all' })
class LoginLinkInvitationTestAuthController extends AuthController({
        strategies: [JwtAuthStrategy],
        authenticators: [PasswordAuthenticator, LoginLinkAuthenticator],
        twoFactorMethods: [OtpTwoFactorMethod],
        invitationRoutes: true
    }) {}

const loginLinkOptions: LoginLinkOptions = {
    loginLinkUrl: 'https://app.example.com/login-link',
    loginLinkEmail: compileTsxTemplate<LoginLinkEmailTemplate>('export const Email = ({ loginLink }) => <a href={loginLink}></a>;')
};

/**
 * Describes inviting people, accepting and declining invitations on the given data sources.
 * @param dataSourceName - The name of the data sources, for the suite.
 * @param dataSources - The data sources, which declare `TestInvitation` and list its repository.
 * @param startTimeoutInMs - How long starting the server may take.
 * @param shutdownTimeoutInMs - How long shutting it down may take.
 */
export function describeInvitations(
    dataSourceName: string,
    dataSources: Newable<DataSourceInterface>[],
    startTimeoutInMs: number,
    shutdownTimeoutInMs: number
): void {
    describe(`invitations, on ${dataSourceName}`, () => {
        const transport: RecordingEmailTransport = new RecordingEmailTransport();
        // the application's own value, which a case changes to see the other answer to an expired link
        const options: InvitationOptions = {
            acceptInvitationUrl: ACCEPT_INVITATION_URL,
            invitationEmail: compileTsxTemplate<InvitationEmailTemplate>(
                'export const Email = ({ link, invitation }) => <a href={link}>{invitation.name}</a>;'
            ),
            tokenExpiresInMs: 60000,
            onExpiredToken: 'renew'
        };
        let server: StartedTestServer | undefined;
        let baseUrl: string;
        const providers: DiProvider<unknown>[] = [
            ...defaultTestServerProviders,
            ...rolesAndPermissionsProviders(
                { permissions: Object.values(Permissions), platformPermissions: Object.values(PlatformPermissions) },
                roles
            ),
            defineProvider({ token: ZIBRI_DI_TOKENS.INVITATION_OPTIONS, useValue: options }),
            defineProvider({
                token: ZIBRI_DI_TOKENS.EMAIL_CONFIG,
                useFactory: (): EmailConfigInput => ({
                    maxEmailsPerHour: 1000,
                    defaultSender: 'Ada',
                    failedRetentionInMs: 'forever'
                })
            }),
            defineProvider({ token: ZIBRI_DI_TOKENS.EMAIL_TRANSPORT, useValue: transport })
        ];

        beforeAll(async () => {
            server = await startTestServer({
                dataSources,
                authStrategies: [JwtAuthStrategy],
                authenticators: [PasswordAuthenticator],
                twoFactorMethods: [OtpTwoFactorMethod],
                controllers: [InvitationTestAuthController],
                providers
            });
            baseUrl = await server.start();
        }, startTimeoutInMs);

        afterAll(async () => {
            await server?.shutdown();
        }, shutdownTimeoutInMs);

        beforeEach(() => {
            options.onExpiredToken = 'renew';
        });

        function invitations(): InvitationServiceInterface {
            return inject(ZIBRI_DI_TOKENS.INVITATION_SERVICE);
        }

        function tenants(): TenantServiceInterface {
            return inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
        }

        function users(): Repository<JwtUser> {
            return inject(repositoryTokenFor(JwtUser));
        }

        function newEmail(): string {
            return `${UUIDUtilities.generate()}@invited.test`;
        }

        /**
         * A caller who is no member of any tenant, with the given permissions.
         * @param platformPermissions - What their own roles carry.
         * @param permissions - What their membership in the tenant of the request carries.
         * @returns The caller.
         */
        async function createCaller(
            platformPermissions: CurrentUser['platformPermissions'],
            permissions: CurrentUser['permissions'] = []
        ): Promise<CurrentUser> {
            const user: JwtUser = await users().create({ email: newEmail(), roles: [Roles.USER] });
            return { id: user.id, email: user.email, deactivatedAt: user.deactivatedAt, permissions, platformPermissions };
        }

        /**
         * An operator of the application, who invites into any tenant and to the application.
         * @returns The caller.
         */
        async function createOperator(): Promise<CurrentUser> {
            return await createCaller([
                PlatformPermissions.AUTH_ASSIGN_ROLE_IN_ANY_TENANT_WITH_ANY_PERMISSION,
                PlatformPermissions.AUTH_ASSIGN_PLATFORM_ROLE_WITH_ANY_PERMISSION
            ]);
        }

        /**
         * Creates a user who logs in with a password.
         * @returns The user.
         */
        async function createUserWithPassword(): Promise<JwtUser> {
            const user: JwtUser = await users().create({ email: newEmail(), roles: [Roles.USER] });
            await inject<Repository<PasswordCredentials, PasswordCredentialsCreateData>>(repositoryTokenFor(PasswordCredentials))
                .create({ userId: user.id, password: PASSWORD });
            return user;
        }

        /**
         * Creates a service account through the user service.
         * @param name - The name of the service account.
         * @returns The service account.
         */
        async function createServiceAccount(name: string): Promise<JwtUser> {
            const userService: UserServiceInterface = inject(ZIBRI_DI_TOKENS.USER_SERVICE);
            if (userService.createServiceAccount == undefined) {
                throw new Error('The user service of the test server creates service accounts.');
            }
            return await userService.createServiceAccount(JwtUser, { name, roles: [Roles.USER] }, undefined);
        }

        /**
         * Invites somebody, and reads the token off the mail that was sent.
         * @param caller - Who invites.
         * @param data - What differs from an invitation to a new tenant as a member, created once it is accepted.
         * @returns The invitation, the token and the link that was mailed.
         */
        async function invite(
            caller: CurrentUser,
            data: Partial<InvitationCreateData<TestInvitation>>
        ): Promise<{ invitation: TestInvitation, token: string, link: string }> {
            const invitation: TestInvitation = await invitations().invite<TestInvitation>(caller, {
                name: 'Ada',
                email: newEmail(),
                tenantId: UUIDUtilities.generate(),
                roles: [MemberRoles.USER],
                createOn: 'accept',
                declinable: true,
                expiresInMs: undefined,
                ...data
            }, undefined);
            const { token, link } = await readLastLink(invitation.email);
            return { invitation, token, link };
        }

        /**
         * Reads the link of the last mail sent to an email.
         * @param email - The email.
         * @returns The link and its token.
         */
        async function readLastLink(email: string): Promise<{ token: string, link: string }> {
            await inject(ZIBRI_DI_TOKENS.EMAIL_SERVICE).sendQueuedEmails();
            const html: string = transport.sends.filter(sent => sent.recipients.includes(email)).at(-1)?.html ?? '';
            const link: string | undefined = /href="([^"]+)"/.exec(html)?.[1]?.replaceAll('&amp;', '&');
            const token: string | undefined = /invitation\/([\da-f]+)/.exec(html)?.[1];
            if (link == undefined || token == undefined) {
                throw new Error(`No invitation was mailed to ${email}.`);
            }
            return { token, link };
        }

        function mailsTo(email: string): number {
            return transport.sends.filter(sent => sent.recipients.includes(email)).length;
        }

        async function post(path: string, body: object, accessToken?: string): Promise<Response> {
            return await fetch(`${baseUrl}/auth${path}`, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    ...accessToken == undefined ? {} : { authorization: `Bearer ${accessToken}` }
                },
                body: JSON.stringify(body)
            });
        }

        async function verify(token: string): Promise<InvitationTokenValidity> {
            const res: Response = await post('/verify-invitation-token', { token });
            expect(res.status).toBe(200);
            return await res.json() as InvitationTokenValidity;
        }

        async function logIn(email: string): Promise<string> {
            // named, for the cases with an authenticator beside it
            const res: Response = await post('/login?authenticator=password', { email, password: PASSWORD });
            expect(res.status).toBe(200);
            return (await res.json() as { accessToken: { value: string } }).accessToken.value;
        }

        async function findMembership(userId: string, tenantId: string): Promise<TestMembership | undefined> {
            return await tenants().runAs(
                tenantId,
                async () => await inject(DefaultTestServerMembershipRepository).findOne({ where: { userId }, required: false })
            );
        }

        async function findInvitation(id: string): Promise<TestInvitation | undefined> {
            return await inject(TestServerInvitationRepository).findOne({ where: { id }, required: false, acrossTenants: true });
        }

        async function expireToken(id: string): Promise<void> {
            await inject(TestServerInvitationRepository).updateAll(
                { id },
                { tokenExpiresAt: new Date(Date.now() - 1000) },
                { acrossTenants: true }
            );
        }

        async function runCleanup(): Promise<void> {
            // built by hand, because the test server runs no cron jobs
            const cleanup: ExpiredRowsCleanupCronJob = new ExpiredRowsCleanupCronJob(inject(ZIBRI_DI_TOKENS.DATA_SOURCE_SERVICE));
            const cronJobRepo: Repository<CronJobEntity, CreateCronJobEntityData> = inject(repositoryTokenFor(CronJobEntity));
            await cleanup.init(inject(ZIBRI_DI_TOKENS.LOGGER), cronJobRepo, async () => await Promise.resolve(true));
            await cleanup.onTick();
        }

        async function auditEvents(): Promise<unknown[]> {
            await inject<LoggerInterface>(ZIBRI_DI_TOKENS.LOGGER).flush();
            return (await inject(repositoryTokenFor(Log)).findAll({ acrossTenants: true })).map(l => l.context.metadata?.['audit']);
        }

        describe('to a tenant, created once it is accepted', () => {
            it('creates nothing but the invitation, and mails a link naming the tenant', async () => {
                const { invitation, link } = await invite(await createOperator(), {});

                expect(invitation).toMatchObject({ name: 'Ada', createOn: 'accept', createdUserId: null, roles: [MemberRoles.USER] });
                expect(await users().findOne({ where: { email: invitation.email }, required: false })).toBeUndefined();
                expect(new URL(link).origin + new URL(link).pathname).toMatch(`${ACCEPT_INVITATION_URL}/`);
                expect(new URL(link).searchParams.get('x-tenant-id')).toBe(invitation.tenantId);
                // the token itself is in the mail only
                expect(invitation.token).not.toBe(new URL(link).pathname.split('/').at(-1));
            });

            it('creates the account with its password and the membership with the roles on accepting, and verifies the email', async () => {
                const operator: CurrentUser = await createOperator();
                const { invitation, token } = await invite(operator, {});
                const tenantId: string = invitation.tenantId ?? '';

                expect(await verify(token)).toEqual({
                    isValid: true,
                    renewed: false,
                    email: invitation.email,
                    tenantId,
                    requiresLogin: false,
                    declinable: true,
                    withoutPassword: false
                });
                // eslint-disable-next-line sonar/no-duplicate-string
                expect((await post('/accept-invitation', { token, password: PASSWORD })).status).toBe(204);

                const user: JwtUser = await users().findOne({ where: { email: invitation.email } });
                expect(user.emailVerifiedAt).toBeInstanceOf(Date);
                expect((await findMembership(user.id, tenantId))?.roles).toEqual([MemberRoles.USER]);
                expect(await findInvitation(invitation.id)).toBeUndefined();
                expect(await logIn(invitation.email)).toEqual(expect.any(String));
                expect(TestServerInvitationRepository.createdFor).toContain('Ada');
                expect(await auditEvents()).toEqual(expect.arrayContaining([
                    {
                        action: AuditAction.INVITATION_CREATED,
                        outcome: AuditOutcome.SUCCESS,
                        subject: invitation.email,
                        userId: operator.id
                    },
                    { action: AuditAction.INVITATION_ACCEPTED, outcome: AuditOutcome.SUCCESS, subject: invitation.email }
                ]));
            });

            it('refuses accepting a new account without a password', async () => {
                const { token } = await invite(await createOperator(), {});

                expect((await post('/accept-invitation', { token })).status).toBe(400);
                expect((await verify(token)).isValid).toBe(true);
            });

            it('refuses a link used once', async () => {
                const { token } = await invite(await createOperator(), {});
                expect((await post('/accept-invitation', { token, password: PASSWORD })).status).toBe(204);

                expect((await post('/accept-invitation', { token, password: PASSWORD })).status).toBe(401);
                expect(await verify(token)).toMatchObject({ isValid: false, renewed: false });
            });
        });

        describe('to a tenant, created when it is sent', () => {
            it('creates the account and the membership at once, and sets the password on accepting', async () => {
                const { invitation, token } = await invite(await createOperator(), { createOn: 'invite' });
                const tenantId: string = invitation.tenantId ?? '';
                const user: JwtUser = await users().findOne({ where: { email: invitation.email } });

                expect(invitation.createdUserId).toBe(user.id);
                expect((await findMembership(user.id, tenantId))?.roles).toEqual([MemberRoles.USER]);
                // an administrator manages the membership before the invited person reacts
                await tenants().runAs(
                    tenantId,
                    async () => await inject(DefaultTestServerMembershipRepository).updateRoles(user.id, [MemberRoles.ADMIN], undefined)
                );

                expect(await verify(token)).toMatchObject({ isValid: true, requiresLogin: false });
                expect((await post('/accept-invitation', { token, password: PASSWORD })).status).toBe(204);
                expect((await findMembership(user.id, tenantId))?.roles).toEqual([MemberRoles.ADMIN]);
                expect(await logIn(invitation.email)).toEqual(expect.any(String));
            });

            it('undoes the membership and the account it created when it is revoked', async () => {
                const { invitation, token } = await invite(await createOperator(), { createOn: 'invite' });
                const tenantId: string = invitation.tenantId ?? '';
                const userId: string = invitation.createdUserId ?? '';

                await tenants().runAs(tenantId, async () => await invitations().revoke(invitation.id, undefined));

                expect(await findMembership(userId, tenantId)).toBeUndefined();
                expect(await users().findOne({ where: { id: userId }, required: false })).toBeUndefined();
                expect(await findInvitation(invitation.id)).toBeUndefined();
                expect((await post('/accept-invitation', { token, password: PASSWORD })).status).toBe(401);
                expect(await auditEvents()).toContainEqual({
                    action: AuditAction.INVITATION_REVOKED,
                    outcome: AuditOutcome.SUCCESS,
                    subject: invitation.email
                });
            });

            it('keeps an account that existed, and one another open invitation is for, when one is declined', async () => {
                const operator: CurrentUser = await createOperator();
                const existing: JwtUser = await createUserWithPassword();
                const { invitation: toExisting, token: existingToken } = await invite(
                    operator,
                    { email: existing.email, createOn: 'invite' }
                );
                const { invitation: first, token: firstToken } = await invite(operator, { createOn: 'invite' });
                await invite(operator, { email: first.email, createOn: 'invite' });

                // eslint-disable-next-line sonar/no-duplicate-string
                expect((await post('/decline-invitation', { token: existingToken })).status).toBe(204);
                expect(await findMembership(existing.id, toExisting.tenantId ?? '')).toBeUndefined();
                expect(await users().findOne({ where: { id: existing.id }, required: false })).toBeDefined();

                expect((await post('/decline-invitation', { token: firstToken })).status).toBe(204);
                expect(await users().findOne({ where: { id: first.createdUserId ?? '' }, required: false })).toBeDefined();
            });

            it('keeps the account it created once its email was verified, as somebody took it up', async () => {
                const { invitation } = await invite(await createOperator(), { createOn: 'invite' });
                const tenantId: string = invitation.tenantId ?? '';
                const userId: string = invitation.createdUserId ?? '';
                await inject(ZIBRI_DI_TOKENS.USER_SERVICE).updateEmail(userId, invitation.email, new Date(), undefined);

                await tenants().runAs(tenantId, async () => await invitations().revoke(invitation.id, undefined));

                expect(await findMembership(userId, tenantId)).toBeUndefined();
                expect(await users().findOne({ where: { id: userId }, required: false })).toBeDefined();
            });

            it('refuses declining one that may not be declined', async () => {
                const { invitation, token } = await invite(await createOperator(), { createOn: 'invite', declinable: false });

                expect(await verify(token)).toMatchObject({ isValid: true, declinable: false });
                expect((await post('/decline-invitation', { token })).status).toBe(403);
                expect(await findInvitation(invitation.id)).toBeDefined();
                expect(await findMembership(invitation.createdUserId ?? '', invitation.tenantId ?? '')).toBeDefined();
            });
        });

        describe('to the application only', () => {
            it('gives its platform roles to the account it creates on accepting', async () => {
                const { invitation, token } = await invite(await createOperator(), { tenantId: undefined, roles: [Roles.ADMIN] });

                expect(invitation.tenantId).toBeNull();
                expect((await verify(token)).tenantId).toBeUndefined();
                expect((await post('/accept-invitation', { token, password: PASSWORD })).status).toBe(204);

                expect((await users().findOne({ where: { email: invitation.email } })).roles.sort()).toEqual([Roles.ADMIN, Roles.USER]);
            });

            it('gives them to the account it creates when it is sent', async () => {
                const { invitation } = await invite(
                    await createOperator(),
                    { tenantId: undefined, roles: [Roles.ADMIN], createOn: 'invite' }
                );

                expect((await users().findById(invitation.createdUserId ?? '')).roles.sort()).toEqual([Roles.ADMIN, Roles.USER]);
            });

            it('is listed outside every tenant, and not in one', async () => {
                const { invitation } = await invite(await createOperator(), { tenantId: undefined, roles: [] });
                const { invitation: toTenant } = await invite(await createOperator(), {});

                expect((await invitations().findInvitations()).map(found => found.id)).toContain(invitation.id);
                const inTenant: string[] = await tenants().runAs(
                    toTenant.tenantId ?? '',
                    async () => (await invitations().findInvitations()).map(found => found.id)
                );
                expect(inTenant).toEqual([toTenant.id]);
            });
        });

        describe('an email with an account of its own', () => {
            it('is accepted by that account only, logged in, and without a password', async () => {
                const existing: JwtUser = await createUserWithPassword();
                const other: JwtUser = await createUserWithPassword();
                const { invitation, token } = await invite(await createOperator(), { email: existing.email });

                expect(await verify(token)).toMatchObject({ isValid: true, requiresLogin: true });
                expect((await post('/accept-invitation', { token })).status).toBe(401);
                expect((await post('/accept-invitation', { token }, await logIn(other.email))).status).toBe(403);
                expect((await post('/accept-invitation', { token, password: PASSWORD }, await logIn(existing.email))).status).toBe(400);

                expect((await post('/accept-invitation', { token }, await logIn(existing.email))).status).toBe(204);
                expect((await findMembership(existing.id, invitation.tenantId ?? ''))?.roles).toEqual([MemberRoles.USER]);
            });

            it('refuses inviting a member of the tenant, and an email invited there already', async () => {
                const operator: CurrentUser = await createOperator();
                const existing: JwtUser = await createUserWithPassword();
                const { invitation } = await invite(operator, { email: existing.email, createOn: 'invite' });

                await expect(invite(operator, { email: existing.email, tenantId: invitation.tenantId ?? undefined }))
                    .rejects.toThrow('The user is a member of the tenant already.');
                const { invitation: open } = await invite(operator, {});
                await expect(invite(operator, { email: open.email, tenantId: open.tenantId ?? undefined }))
                    .rejects.toThrow('The email has an open invitation there already.');
            });

            it('refuses the email of a service account, when inviting and when accepting', async () => {
                const operator: CurrentUser = await createOperator();
                const service: JwtUser = await createServiceAccount(`billing-${Date.now()}`);

                await expect(invite(operator, { email: service.email })).rejects.toThrow(ServiceAccountRefusedError);

                // invited while nobody held the email, which a service account was created with since
                const name: string = `reporting-${Date.now()}`;
                const { invitation, token } = await invite(operator, { email: `${name}@service-accounts.invalid` });
                const later: JwtUser = await createServiceAccount(name);
                await expect(invitations().accept(token, { password: undefined, loggedInUserId: later.id }, undefined))
                    .rejects.toThrow(ServiceAccountRefusedError);
                expect(await findMembership(later.id, invitation.tenantId ?? '')).toBeUndefined();
            });
        });

        describe('the roles of an invitation', () => {
            it('are checked like giving them, so nobody invites into more than they may hand out', async () => {
                const tenantId: string = UUIDUtilities.generate();
                const member: CurrentUser = await createCaller(
                    [],
                    [Permissions.AUTH_ASSIGN_ROLE_WITH_OWN_PERMISSIONS, Permissions.NOTES_READ]
                );
                const email: string = newEmail();

                await expect(tenants().runAs(tenantId, async () => await invite(member, { email, tenantId, roles: [MemberRoles.ADMIN] })))
                    .rejects.toThrow('You do not have permission to manage this role.');
                // and in the tenant the request acts in only
                await expect(invite(member, { tenantId, roles: [MemberRoles.USER] })).rejects.toThrow(
                    'You do not have permission to manage this role.'
                );
                expect(await inject(TestServerInvitationRepository).count({ where: { email }, acrossTenants: true })).toBe(0);
                expect(await auditEvents()).toContainEqual({
                    action: AuditAction.INVITATION_CREATED,
                    outcome: AuditOutcome.FAILURE,
                    reason: AuditReason.REFUSED,
                    subject: email,
                    userId: member.id
                });

                const { invitation } = await tenants().runAs(
                    tenantId,
                    async () => await invite(member, { tenantId, roles: [MemberRoles.USER] })
                );
                expect(invitation.tenantId).toBe(tenantId);
            });
        });

        describe('its link', () => {
            it('stops working when it is sent again, and the new one works', async () => {
                const { invitation, token } = await invite(await createOperator(), {});

                await tenants().runAs(invitation.tenantId ?? '', async () => await invitations().resend(invitation.id, undefined));
                const { token: resent } = await readLastLink(invitation.email);

                expect(resent).not.toBe(token);
                expect((await verify(token)).isValid).toBe(false);
                expect((await verify(resent)).isValid).toBe(true);
                expect(await auditEvents()).toContainEqual({
                    action: AuditAction.INVITATION_RESENT,
                    outcome: AuditOutcome.SUCCESS,
                    subject: invitation.email
                });
            });

            it('is renewed once when it expired, with a new link to the invited email', async () => {
                const { invitation, token } = await invite(await createOperator(), {});
                await expireToken(invitation.id);
                const mailed: number = mailsTo(invitation.email);

                expect((await post('/accept-invitation', { token, password: PASSWORD })).status).toBe(401);
                const { token: renewed } = await readLastLink(invitation.email);
                expect(mailsTo(invitation.email)).toBe(mailed + 1);
                // the old link is known to nothing any more, so following it again mails nothing
                expect(await verify(token)).toMatchObject({ isValid: false, renewed: false });
                await readLastLink(invitation.email);
                expect(mailsTo(invitation.email)).toBe(mailed + 1);

                expect((await post('/accept-invitation', { token: renewed, password: PASSWORD })).status).toBe(204);
            });

            it('answers that it was renewed when it is verified', async () => {
                const { invitation, token } = await invite(await createOperator(), {});
                await expireToken(invitation.id);

                expect(await verify(token)).toMatchObject({ isValid: false, renewed: true });
            });

            it('is refused when it expired, and the application renews none', async () => {
                options.onExpiredToken = 'refuse';
                const { invitation, token } = await invite(await createOperator(), {});
                await expireToken(invitation.id);
                const mailed: number = mailsTo(invitation.email);

                expect((await post('/accept-invitation', { token, password: PASSWORD })).status).toBe(401);
                expect(await verify(token)).toMatchObject({ isValid: false, renewed: false });
                await inject(ZIBRI_DI_TOKENS.EMAIL_SERVICE).sendQueuedEmails();
                expect(mailsTo(invitation.email)).toBe(mailed);
                expect(await findInvitation(invitation.id)).toBeDefined();
            });
        });

        describe('an invitation that expires', () => {
            it('is refused once it has ended, recorded as expired, and the cleanup deletes it', async () => {
                const { invitation, token } = await invite(await createOperator(), { expiresInMs: 1 });
                await new Promise(resolve => setTimeout(resolve, 10));

                expect(await verify(token)).toMatchObject({ isValid: false, renewed: false });
                expect((await post('/accept-invitation', { token, password: PASSWORD })).status).toBe(401);
                expect(await auditEvents()).toContainEqual({
                    action: AuditAction.INVITATION_EXPIRED,
                    outcome: AuditOutcome.SUCCESS,
                    subject: invitation.email
                });

                await runCleanup();
                expect(await findInvitation(invitation.id)).toBeUndefined();
            });

            it('lasts while it names no end, which the cleanup leaves alone', async () => {
                const { invitation } = await invite(await createOperator(), { expiresInMs: undefined });

                expect(invitation.expiresAt).toBeNull();
                await runCleanup();
                expect(await findInvitation(invitation.id)).toBeDefined();
            });
        });

        // last, as it builds the application again with what logs in by a link
        describe('without a password', () => {
            it('is refused while no authenticator logs its account in by a link', async () => {
                await expect(invite(await createOperator(), { withoutPassword: true })).rejects.toMatchObject({ status: 400 });
            });

            describe('with LoginLinkAuthenticator', () => {
                beforeAll(async () => {
                    if (server == undefined) {
                        throw new Error('The server of the suite did not start.');
                    }
                    await server.reInit({
                        authenticators: [PasswordAuthenticator, LoginLinkAuthenticator],
                        controllers: [LoginLinkInvitationTestAuthController],
                        providers: [...providers, defineProvider({ token: ZIBRI_DI_TOKENS.LOGIN_LINK_OPTIONS, useValue: loginLinkOptions })]
                    });
                    baseUrl = await server.start();
                }, startTimeoutInMs);

                it('creates the account without a password on accepting, and logs it in by the link', async () => {
                    const { invitation, token } = await invite(await createOperator(), { withoutPassword: true });
                    expect(invitation.withoutPassword).toBe(true);
                    expect(await verify(token)).toMatchObject({ isValid: true, requiresLogin: false, withoutPassword: true });

                    const res: Response = await post('/accept-invitation', { token });

                    expect(res.status).toBe(200);
                    expect((await res.json() as { accessToken: { value: string } }).accessToken.value).toEqual(expect.any(String));
                    const user: JwtUser = await users().findOne({ where: { email: invitation.email } });
                    expect(user.emailVerifiedAt).toBeInstanceOf(Date);
                    expect((await findMembership(user.id, invitation.tenantId ?? ''))?.roles).toEqual([MemberRoles.USER]);
                    expect(await inject<Repository<PasswordCredentials, PasswordCredentialsCreateData>>(
                        repositoryTokenFor(PasswordCredentials)
                    ).findOne({ where: { userId: user.id }, required: false })).toBeUndefined();
                    expect(await auditEvents()).toEqual(expect.arrayContaining([
                        expect.objectContaining({
                            action: AuditAction.INVITATION_ACCEPTED,
                            outcome: AuditOutcome.SUCCESS,
                            subject: invitation.email
                        }),
                        expect.objectContaining({ action: AuditAction.LOGIN_LINK_USED, outcome: AuditOutcome.SUCCESS, userId: user.id }),
                        expect.objectContaining({ action: AuditAction.LOGIN, outcome: AuditOutcome.SUCCESS, userId: user.id })
                    ]));
                    expect((await post('/accept-invitation', { token })).status).toBe(401);
                });

                it('creates the account when it is sent, and logs it in on accepting', async () => {
                    const { invitation, token } = await invite(await createOperator(), { withoutPassword: true, createOn: 'invite' });

                    expect((await post('/accept-invitation', { token })).status).toBe(200);
                    expect(await inject<Repository<PasswordCredentials, PasswordCredentialsCreateData>>(
                        repositoryTokenFor(PasswordCredentials)
                    ).findOne({ where: { userId: invitation.createdUserId ?? '' }, required: false })).toBeUndefined();
                });

                it('refuses a password for the account it creates', async () => {
                    const { token } = await invite(await createOperator(), { withoutPassword: true });

                    expect((await post('/accept-invitation', { token, password: PASSWORD })).status).toBe(400);
                });

                it('is accepted by an email with an account of its own as any other invitation is', async () => {
                    const existing: JwtUser = await createUserWithPassword();
                    const { token } = await invite(await createOperator(), { email: existing.email, withoutPassword: true });

                    expect(await verify(token)).toMatchObject({ requiresLogin: true, withoutPassword: false });
                    expect((await post('/accept-invitation', { token }, await logIn(existing.email))).status).toBe(204);
                });
            });
        });
    });
}