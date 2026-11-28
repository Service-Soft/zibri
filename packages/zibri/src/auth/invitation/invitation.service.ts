import { randomBytes } from 'node:crypto';

import { type AuditServiceInterface } from '../../audit/audit-service.interface';
import { FrameworkColumnUtilities } from '../../data-source/migration/framework-column.utilities';
import { Repository } from '../../data-source/repository/repository';
import { type RepositoryTransaction } from '../../data-source/transaction/repository-transaction.type';
import { Injectable } from '../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { getAllInstantiatedValues } from '../../di/get-all-instantiated-values.function';
import { getDiTokenName } from '../../di/get-di-token-name.function';
import { getRegisteredProvidersOfVariant } from '../../di/get-registered-providers-of-variant.function';
import { inject } from '../../di/inject.function';
import { DiProvider } from '../../di/models/di-provider.model';
import { DiVariants } from '../../di/models/di-variant.model';
import { EmailPriority } from '../../email/models/email-priority.enum';
import { BadRequestError } from '../../error-handling/errors/bad-request.error';
import { ConflictError } from '../../error-handling/errors/conflict.error';
import { ForbiddenError } from '../../error-handling/errors/forbidden.error';
import { NotFoundError } from '../../error-handling/errors/not-found.error';
import { UnauthorizedError } from '../../error-handling/errors/unauthorized.error';
import { InternalError } from '../../error-handling/internal-error.model';
import { OnAppInit } from '../../global/on-app-init.interface';
import { runInLocale } from '../../localization/run-in-locale.function';
import { $ts } from '../../localization/translate.function';
import { AuditAction, AuditOutcome } from '../../logging/audit-event.model';
import { AuditUtilities } from '../../logging/audit.utilities';
import { type BaseMembership } from '../../tenancy/membership/base-membership.model';
import { type MembershipServiceInterface } from '../../tenancy/membership/membership-service.interface';
import { type PendingRowShare } from '../../sharing/pending-row-share.model';
import { type RowShareGrant } from '../../sharing/row-share-grant.model';
import { type BaseTenantDefinition } from '../../tenancy/tenant-definition/base-tenant-definition.model';
import { type TenantServiceInterface } from '../../tenancy/tenant-service.interface';
import { TsxUtilities } from '../../tsx/tsx.utilities';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { type AuthServiceInterface } from '../auth-service.interface';
import { LoginLinkAuthenticator } from '../authenticators/login-link/login-link.authenticator';
import { type CurrentUser } from '../decorators/current-user.decorator';
import { type HashString } from '../hash/hash.utilities';
import { Sha256HashStrategy } from '../hash/strategies/sha256.hash-strategy';
import { BaseUser } from '../models/base-user.model';
import { type RoleServiceInterface } from '../roles/role-service.interface';
import { UserKindUtilities } from '../user/user-kind.utilities';
import { type UserServiceInterface } from '../user/user-service.interface';
import { BaseInvitation } from './base-invitation.model';
import { InvitationAcceptance } from './invitation-acceptance.model';
import { InvitationCreateData } from './invitation-create-data.model';
import { InvitationOptions } from './invitation-options.model';
import { isInvitationRepository, InvitationRepositoryInterface } from './invitation-repository.interface';
import { InvitationServiceInterface } from './invitation-service.interface';
import { InvitationTokenValidity } from './invitation-token-validity.model';

/**
 * What an invitation row is created with: its token as it is mailed, before the hook hashes it.
 */
type InvitationRowCreateData = Omit<BaseInvitation, 'id' | 'token'> & {
    /**
     * The token as it is generated and mailed out.
     */
    token: string
};

/**
 * The repository invitations are kept in.
 */
type InvitationRepository = Repository<BaseInvitation, InvitationRowCreateData> & InvitationRepositoryInterface<BaseInvitation>;

/**
 * Checks whether a value is the repository of an invitation entity, which is what the framework writes invitations
 * through.
 * @param value - The value to check.
 * @returns True for a repository carrying the mark of InvitationRepositoryInterface.
 */
function isInvitationEntityRepository(value: unknown): value is InvitationRepository {
    return value instanceof Repository && isInvitationRepository(value);
}

/**
 * Where a link of an invitation stands.
 */
type TokenState = 'valid' | 'expired' | 'renewed' | 'refused';

/**
 * The account accepting an invitation.
 */
type AcceptingUser = {
    /**
     * The account.
     */
    user: BaseUser<string>,
    /**
     * Whether accepting logs it in, as the invitation created it without a password.
     */
    logsIn: boolean
};

/**
 * Default invitation service implementation of Zibri, keeping the invitations in the one invitation repository, such
 * as one extending `BaseInvitationRepository()`.
 */
@Injectable({ register: 'onUse' })
export class InvitationService implements InvitationServiceInterface, OnAppInit {

    private repository: InvitationRepository | undefined;

    private options: InvitationOptions | undefined;

    private get tenantService(): TenantServiceInterface {
        return inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
    }

    private get membershipService(): MembershipServiceInterface {
        return inject(ZIBRI_DI_TOKENS.MEMBERSHIP_SERVICE);
    }

    private get userService(): UserServiceInterface {
        return inject(ZIBRI_DI_TOKENS.USER_SERVICE);
    }

    private get roleService(): RoleServiceInterface {
        return inject(ZIBRI_DI_TOKENS.ROLE_SERVICE);
    }

    private get authService(): AuthServiceInterface {
        return inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
    }

    private get auditService(): AuditServiceInterface {
        return inject(ZIBRI_DI_TOKENS.AUDIT_SERVICE);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    get isEnabled(): boolean {
        // read off the providers rather than the repository found on init, so it is answered before that ran too
        return getRegisteredProvidersOfVariant(DiVariants.INVITATION_REPO).length > 0;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    onAppInit(): void {
        const providers: DiProvider<unknown>[] = getRegisteredProvidersOfVariant(DiVariants.INVITATION_REPO);
        if (providers.length > 1) {
            throw new InternalError([
                `Several invitation repositories are listed: ${providers.map(p => getDiTokenName(p.token)).join(', ')}.`,
                'The invitations of an application are kept in one place. Keep one of them.'
            ]);
        }
        const [provider] = providers;
        // among what the application has actually built, for the reason UserService gives
        const unlisted: unknown = getAllInstantiatedValues()
            .find(value => value !== (provider == undefined ? undefined : inject(provider.token)) && isInvitationRepository(value));
        if (unlisted != undefined && typeof unlisted === 'object') {
            throw new InternalError([
                `The class "${unlisted.constructor.name}" is an invitation repository, but no data source lists it in its repositories.`,
                'Declare it with @RepositoryFor(Invitation), and list it in the repositories of the data source that declares Invitation.'
            ]);
        }
        // an application without one has no invitations, and is asked for nothing
        if (provider == undefined) {
            return;
        }
        const repository: unknown = inject(provider.token);
        // registered under the variant by its data source, which lists repository classes only
        if (!isInvitationEntityRepository(repository)) {
            throw new InternalError(
                `Invalid invitation repository: ${getDiTokenName(provider.token)} needs to extend BaseInvitationRepository<Invitation>()`
            );
        }
        this.repository = repository;
        this.options = this.validateOptions(inject(ZIBRI_DI_TOKENS.INVITATION_OPTIONS));
        // an invitation that ended is refused either way, and the cleanup is what keeps the table to the open ones
        if (MetadataUtilities.getEntityMetadata(repository.entityClass)?.expiresBy !== 'expiresAt') {
            throw new InternalError([
                `${repository.entityClass.name} is an invitation entity, and its rows expire by their "expiresAt".`,
                'Declare it with @Entity({ expiresBy: \'expiresAt\' }).'
            ]);
        }
    }

    /**
     * Refuses options that cannot send an invitation.
     * @param options - What the application provided.
     * @returns The options.
     * @throws When they are missing, or name no link.
     */
    private validateOptions(options: InvitationOptions | undefined): InvitationOptions {
        if (options == undefined) {
            throw new InternalError([
                'An invitation repository is listed, and ZIBRI_DI_TOKENS.INVITATION_OPTIONS is not provided.',
                'Provide it with the link and the email an invitation is sent with, how long a link works and what an expired one does.'
            ]);
        }
        if (!options.acceptInvitationUrl) {
            throw new InternalError('ZIBRI_DI_TOKENS.INVITATION_OPTIONS names no acceptInvitationUrl for its links to point to.');
        }
        if (!(options.tokenExpiresInMs > 0)) {
            throw new InternalError('The tokenExpiresInMs of ZIBRI_DI_TOKENS.INVITATION_OPTIONS needs to be more than 0.');
        }
        return options;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async invite<T extends BaseInvitation>(
        caller: CurrentUser,
        data: InvitationCreateData<T>,
        transaction: RepositoryTransaction | undefined
    ): Promise<T> {
        const repository: InvitationRepository = this.getRepository();
        const { email, tenantId, roles, createOn, declinable, expiresInMs, locale, withoutPassword = false, rowShares = [], ...own } = data;
        return await this.audited(AuditAction.INVITATION_CREATED, tenantId, email, caller.id, transaction, async () => {
            // the account it creates has no other way in than a link
            if (withoutPassword && !this.authService.authenticators.some(a => a === LoginLinkAuthenticator || a.prototype instanceof LoginLinkAuthenticator)) {
                throw new BadRequestError(
                    $ts`An invitation without a password logs its account in by a link, which needs LoginLinkAuthenticator among the authenticators of the application.`
                );
            }
            // a locale given, which a table without the column, of a schema the data source does not manage, would drop.
            // One that is not given is the one of the request, which an invitation of 3.2 was sent in as well
            if (locale != undefined) {
                FrameworkColumnUtilities.validatePresent('Inviting in a locale', repository.entityClass, 'locale');
            }
            await this.tenantService.validateNotDeactivated?.(tenantId);
            if (this.roleService.validateMayAssign == undefined) {
                throw new InternalError(
                    'Inviting somebody needs validateMayAssign of the RoleService, to check the roles of the invitation.'
                );
            }
            await this.roleService.validateMayAssign(caller, roles, tenantId, transaction);
            const user: BaseUser<string> | undefined = await this.userService.findByEmail(email, { required: false, transaction });
            // an invitation is accepted by a person, who logs in or sets a password to: the memberships of a service
            // account are given to it directly
            if (user != undefined) {
                UserKindUtilities.validatePerson(user);
            }
            if (tenantId != undefined && user != undefined && await this.findMembership(user.id, tenantId, transaction) != undefined) {
                throw new ConflictError($ts`The user is a member of the tenant already.`);
            }
            if (await this.findOpenInvitation(email, tenantId, transaction) != undefined) {
                throw new ConflictError($ts`The email has an open invitation there already.`);
            }
            const pendingShares: PendingRowShare[] = await this.resolvePendingShares(tenantId, rowShares, transaction);

            const token: string = this.generateToken();
            const now: number = Date.now();
            const created: BaseInvitation = await repository.create({
                ...own,
                email,
                tenantId: tenantId ?? null,
                roles,
                invitedBy: caller.id,
                createOn,
                declinable,
                token,
                tokenExpiresAt: new Date(now + this.getOptions().tokenExpiresInMs),
                expiresAt: expiresInMs == undefined ? null : new Date(now + expiresInMs),
                createdUserId: null,
                // the language of the account the email has before the one of the inviter's request. Kept rather than
                // read again, as the link is mailed again and followed outside this request
                locale: locale ?? user?.locale ?? inject(ZIBRI_DI_TOKENS.LOCALIZE_SERVICE).resolveSupportedLocale(undefined),
                withoutPassword,
                rowShares: pendingShares.length ? pendingShares : null
            }, { transaction, acrossTenants: true });

            const invitation: BaseInvitation = createOn === 'invite'
                ? await this.createAtInvite(created, user, transaction)
                : created;
            await this.sendInvitation(invitation, token);
            return invitation as T;
        });
    }

    /**
     * Creates what an invitation with `createOn` `'invite'` creates when it is sent: the account, if the email has
     * none, and the membership.
     * @param invitation - The invitation, as it was stored.
     * @param user - The account of its email, if it has one.
     * @param transaction - The transaction to write in, if any.
     * @returns The invitation, with the account it created.
     */
    private async createAtInvite(
        invitation: BaseInvitation,
        user: BaseUser<string> | undefined,
        transaction: RepositoryTransaction | undefined
    ): Promise<BaseInvitation> {
        if (user == undefined) {
            // an invitation to the application gives its platform roles to the account it creates. One that exists
            // gets them once it accepts: there is nothing about it to manage before
            const created: BaseUser<string> = await this.createInvitedUser(invitation, transaction);
            invitation = await this.getRepository().updateById(
                invitation.id,
                { createdUserId: created.id },
                { transaction, acrossTenants: true }
            );
            user = created;
        }
        if (invitation.tenantId != undefined) {
            await this.membershipService.resolveMembership(user.id, invitation.tenantId, transaction);
            await this.membershipService.updateRoles(user.id, invitation.tenantId, invitation.roles, transaction);
        }
        return invitation;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resend(id: string, transaction: RepositoryTransaction | undefined): Promise<void> {
        const invitation: BaseInvitation = await this.findById(id, transaction);
        await this.audited(
            AuditAction.INVITATION_RESENT,
            invitation.tenantId ?? undefined,
            invitation.email,
            undefined,
            transaction,
            async () => {
                await this.renewToken(invitation, transaction);
            }
        );
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async revoke(id: string, transaction: RepositoryTransaction | undefined): Promise<void> {
        const invitation: BaseInvitation = await this.findById(id, transaction);
        await this.audited(
            AuditAction.INVITATION_REVOKED,
            invitation.tenantId ?? undefined,
            invitation.email,
            undefined,
            transaction,
            async () => {
                await this.end(invitation, true, transaction);
            }
        );
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findInvitations<T extends BaseInvitation>(): Promise<T[]> {
        // the rows of no tenant are seen in every tenant, and are not the invitations of one
        const tenantId: string | null = this.tenantService.getActiveTenantId() ?? null;
        return await this.getRepository().findAll({ where: { tenantId }, limit: 'all', acrossTenants: true }) as T[];
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveTokenValidity(token: string): Promise<InvitationTokenValidity> {
        const invitation: BaseInvitation | undefined = await this.findByToken(token, undefined);
        const state: TokenState | undefined = invitation == undefined ? undefined : await this.resolveTokenState(invitation);
        if (invitation == undefined || state !== 'valid') {
            return { isValid: false, renewed: state === 'renewed', requiresLogin: false, declinable: false, withoutPassword: false };
        }
        const requiresLogin: boolean = await this.findAccountToLogInAs(invitation, undefined) != undefined;
        return {
            isValid: true,
            renewed: false,
            email: invitation.email,
            tenantId: invitation.tenantId ?? undefined,
            requiresLogin,
            declinable: invitation.declinable,
            withoutPassword: !requiresLogin && invitation.withoutPassword === true
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async accept(token: string, acceptance: InvitationAcceptance, transaction: RepositoryTransaction | undefined): Promise<void> {
        await this.acceptForLogin(token, acceptance, transaction);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async acceptForLogin(
        token: string,
        acceptance: InvitationAcceptance,
        transaction: RepositoryTransaction | undefined
    ): Promise<string | undefined> {
        const invitation: BaseInvitation = await this.findWorkingInvitation(token, transaction);
        return await this.audited(
            AuditAction.INVITATION_ACCEPTED,
            invitation.tenantId ?? undefined,
            invitation.email,
            acceptance.loggedInUserId,
            transaction,
            async () => {
                // a link stays valid while its tenant is deactivated, and works once it is reactivated
                await this.tenantService.validateNotDeactivated?.(invitation.tenantId ?? undefined);
                const accepting: AcceptingUser = await this.resolveAcceptingUser(invitation, acceptance, transaction);
                const user: BaseUser<string> = accepting.user;
                // again on accepting: the email may have become the one of a service account since the invitation
                UserKindUtilities.validatePerson(user);
                await this.giveRoles(invitation, user, transaction);
                await this.createPendingShares(invitation, user, transaction);
                // the link reached the address, which is what verifying it proves
                if (user.emailVerifiedAt == undefined && user.email === invitation.email) {
                    await this.userService.updateEmail(user.id, user.email, new Date(), transaction);
                }
                await this.claim(invitation, transaction);
                return accepting.logsIn ? user.id : undefined;
            }
        );
    }

    /**
     * Resolves the account accepting an invitation: the one the email has, which has to be logged in, or the one
     * the invitation created or creates now, which sets its password, or is logged in by the link without one.
     * @param invitation - The invitation.
     * @param acceptance - Who accepts, and with what.
     * @param transaction - The transaction to write in, if any.
     * @returns The account, and whether accepting logs it in.
     * @throws An UnauthorizedError while nobody is logged in as an account the email has, a ForbiddenError while
     * somebody else is, a BadRequestError for a password missing or given where it is not taken.
     */
    private async resolveAcceptingUser(
        invitation: BaseInvitation,
        acceptance: InvitationAcceptance,
        transaction: RepositoryTransaction | undefined
    ): Promise<AcceptingUser> {
        const existing: BaseUser<string> | undefined = await this.findAccountToLogInAs(invitation, transaction);
        if (existing != undefined) {
            // a link forwarded to somebody else adds no account but the one of the email to the tenant
            if (acceptance.loggedInUserId == undefined) {
                throw new UnauthorizedError($ts`Log in as the account of the invited email to accept the invitation.`);
            }
            if (acceptance.loggedInUserId !== existing.id) {
                throw new ForbiddenError($ts`The invitation is for another account.`);
            }
            if (acceptance.password != undefined) {
                throw new BadRequestError($ts`The account has a password already, so accepting takes none.`);
            }
            return { user: existing, logsIn: false };
        }
        const withoutPassword: boolean = invitation.withoutPassword === true;
        const password: string | undefined = acceptance.password;
        const setPassword: AuthServiceInterface['setPassword'] = this.authService.setPassword?.bind(this.authService);
        if (withoutPassword && password != undefined) {
            throw new BadRequestError($ts`The invitation creates its account without a password, so accepting takes none.`);
        }
        if (!withoutPassword && password == undefined) {
            throw new BadRequestError($ts`A password is required for the account the invitation creates.`);
        }
        if (!withoutPassword && setPassword == undefined) {
            throw new InternalError('Accepting an invitation needs setPassword of the AuthService, to set the password of its account.');
        }
        const user: BaseUser<string> = await this.findUserOf(invitation, transaction)
            ?? await this.createInvitedUser(invitation, transaction);
        // the locale the person accepting chose replaces the one of the invitation, which the account was created
        // in, and one the application does not support refuses the acceptance, in its transaction
        if (acceptance.locale != undefined) {
            if (this.userService.updateLocale == undefined) {
                throw new InternalError('Accepting an invitation in a locale needs updateLocale of the UserService.');
            }
            await this.userService.updateLocale(user.id, acceptance.locale, transaction);
        }
        // only an invitation without a password gets here without both: the link it came with is how its account gets
        // in, now and as often as it asks for one
        if (password == undefined || setPassword == undefined) {
            return { user, logsIn: true };
        }
        await setPassword(user.id, { password, requireChange: false }, transaction);
        return { user, logsIn: false };
    }

    /**
     * Gives the roles of an invitation as it is accepted: the membership of one to a tenant, unless it was created
     * when the invitation was sent, or the platform roles of one to the application.
     * @param invitation - The invitation.
     * @param user - The account accepting it.
     * @param transaction - The transaction to write in, if any.
     */
    private async giveRoles(
        invitation: BaseInvitation,
        user: BaseUser<string>,
        transaction: RepositoryTransaction | undefined
    ): Promise<void> {
        if (invitation.tenantId == undefined) {
            const roles: string[] = [...new Set([...user.roles, ...invitation.roles])];
            if (roles.length !== user.roles.length) {
                await this.userService.updateRoles(user.id, roles, transaction);
            }
            return;
        }
        // created with what an administrator may have changed since, which is theirs to keep
        if (invitation.createOn === 'invite') {
            return;
        }
        const membership: BaseMembership<string> = await this.membershipService
            .resolveMembership(user.id, invitation.tenantId, transaction);
        await this.membershipService.updateRoles(
            user.id,
            invitation.tenantId,
            [...new Set([...membership.roles, ...invitation.roles])],
            transaction
        );
    }

    /**
     * Validates the rows an invitation shares, as it is sent, in the tenant it is to.
     * @param tenantId - The tenant of the invitation, undefined for one to the application.
     * @param grants - The rows it shares.
     * @param transaction - The transaction to read in, if any.
     * @returns The shares, as the invitation stores them.
     * @throws A BadRequestError for shares of an invitation to no tenant, and what the share service throws.
     */
    private async resolvePendingShares(
        tenantId: string | undefined,
        grants: RowShareGrant[],
        transaction: RepositoryTransaction | undefined
    ): Promise<PendingRowShare[]> {
        if (!grants.length) {
            return [];
        }
        if (tenantId == undefined) {
            throw new BadRequestError($ts`An invitation sharing rows needs to be to a tenant.`);
        }
        return await this.tenantService.runAs(
            tenantId,
            async () => await inject(ZIBRI_DI_TOKENS.SHARE_SERVICE).resolvePendingShares(grants, transaction)
        );
    }

    /**
     * Creates the shares an invitation carries for the account accepting it, in the transaction of the acceptance.
     * @param invitation - The invitation.
     * @param user - The account accepting it.
     * @param transaction - The transaction to write in, if any.
     */
    private async createPendingShares(
        invitation: BaseInvitation,
        user: BaseUser<string>,
        transaction: RepositoryTransaction | undefined
    ): Promise<void> {
        const pending: PendingRowShare[] = invitation.rowShares ?? [];
        const tenantId: string | null | undefined = invitation.tenantId;
        if (!pending.length || tenantId == undefined) {
            return;
        }
        await this.tenantService.runAs(
            tenantId,
            async () => await inject(ZIBRI_DI_TOKENS.SHARE_SERVICE).createPendingShares(user.id, pending, invitation.invitedBy, transaction)
        );
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async decline(token: string, transaction: RepositoryTransaction | undefined): Promise<void> {
        const invitation: BaseInvitation = await this.findWorkingInvitation(token, transaction);
        await this.audited(
            AuditAction.INVITATION_DECLINED,
            invitation.tenantId ?? undefined,
            invitation.email,
            undefined,
            transaction,
            async () => {
                if (!invitation.declinable) {
                    throw new ForbiddenError($ts`The invitation cannot be declined.`);
                }
                await this.end(invitation, false, transaction);
            }
        );
    }

    /**
     * Ends an invitation that was not accepted, with what it created when it was sent: the membership, and the
     * account while it belongs to no tenant and no other invitation is open for its email.
     * @param invitation - The invitation.
     * @param byId - Whether it is ended by its id, rather than by its token.
     * @param transaction - The transaction to write in, if any.
     */
    private async end(invitation: BaseInvitation, byId: boolean, transaction: RepositoryTransaction | undefined): Promise<void> {
        if (byId) {
            await this.getRepository().deleteById(invitation.id, { transaction, acrossTenants: true });
        }
        else {
            await this.claim(invitation, transaction);
        }
        if (invitation.createOn !== 'invite') {
            return;
        }
        const user: BaseUser<string> | undefined = await this.findUserOf(invitation, transaction);
        if (user == undefined) {
            return;
        }
        if (invitation.tenantId != undefined) {
            await this.membershipService.deleteMembership(user.id, invitation.tenantId, transaction);
        }
        // an account somebody verified the email of was taken up, by whatever way they got in: what every way of
        // taking up an account asks for first, and the one sign of it every application has
        if (
            invitation.createdUserId !== user.id
            || user.emailVerifiedAt != undefined
            || await this.findOpenInvitation(invitation.email, false, transaction) != undefined
        ) {
            return;
        }
        if ((await this.findMemberships(user.id)).length) {
            return;
        }
        if (this.userService.deleteUser == undefined) {
            throw new InternalError('Undoing an invitation needs deleteUser of the UserService, to delete the account it created.');
        }
        await this.userService.deleteUser(user.id, transaction);
    }

    /**
     * Finds an invitation by the token of its link, and refuses a link that does not work.
     * @param token - The token.
     * @param transaction - The transaction to read in, if any.
     * @returns The invitation.
     * @throws An UnauthorizedError when the token is unknown, the link expired, or the invitation ended.
     */
    private async findWorkingInvitation(token: string, transaction: RepositoryTransaction | undefined): Promise<BaseInvitation> {
        const invitation: BaseInvitation | undefined = await this.findByToken(token, transaction);
        if (invitation == undefined) {
            throw new UnauthorizedError($ts`Link invalid`);
        }
        const state: TokenState = await this.resolveTokenState(invitation);
        if (state === 'renewed') {
            throw new UnauthorizedError($ts`Link expired. A new link was sent to the invited email.`);
        }
        if (state !== 'valid') {
            throw new UnauthorizedError($ts`Link expired`);
        }
        return invitation;
    }

    /**
     * Resolves where the link of an invitation stands, and renews a link that expired, as the options say.
     *
     * A renewal is written on its own, outside the transaction of the request: the request is refused, and a
     * rollback would take the new link back.
     * @param invitation - The invitation.
     * @returns Whether the link works, the invitation ended, or the link was renewed or refused.
     */
    private async resolveTokenState(invitation: BaseInvitation): Promise<TokenState> {
        const now: number = Date.now();
        if (invitation.expiresAt != undefined && new Date(invitation.expiresAt).getTime() <= now) {
            this.record(
                AuditAction.INVITATION_EXPIRED,
                AuditOutcome.SUCCESS,
                invitation.tenantId ?? undefined,
                invitation.email,
                undefined
            );
            return 'expired';
        }
        if (new Date(invitation.tokenExpiresAt).getTime() > now) {
            return 'valid';
        }
        if (this.getOptions().onExpiredToken === 'refuse') {
            return 'refused';
        }
        // once for each link: whoever follows it again finds a token nothing has any more
        const renewed: boolean = await this.renewToken(invitation, undefined);
        if (renewed) {
            this.record(AuditAction.INVITATION_RESENT, AuditOutcome.SUCCESS, invitation.tenantId ?? undefined, invitation.email, undefined);
        }
        return renewed ? 'renewed' : 'refused';
    }

    /**
     * Gives an invitation a new link and mails it, unless its link was replaced in the meantime.
     * @param invitation - The invitation, as it was read.
     * @param transaction - The transaction to write in, if any.
     * @returns Whether this call replaced the link.
     */
    private async renewToken(invitation: BaseInvitation, transaction: RepositoryTransaction | undefined): Promise<boolean> {
        const token: string = this.generateToken();
        // compared with the token it was read with, so two requests following one link mail one new link
        const updated: number = await this.getRepository().updateAll(
            { id: invitation.id, token: invitation.token },
            { token, tokenExpiresAt: new Date(Date.now() + this.getOptions().tokenExpiresInMs) },
            { transaction, acrossTenants: true }
        );
        if (updated === 0) {
            return false;
        }
        await this.sendInvitation(invitation, token);
        return true;
    }

    /**
     * Deletes an invitation that is answered, as the only one doing so.
     * @param invitation - The invitation, as it was read.
     * @param transaction - The transaction to write in, if any.
     * @throws An UnauthorizedError when it was answered or its link replaced in the meantime.
     */
    private async claim(invitation: BaseInvitation, transaction: RepositoryTransaction | undefined): Promise<void> {
        const deleted: number = await this.getRepository().deleteAll({
            id: invitation.id,
            token: invitation.token
        }, { transaction, acrossTenants: true });
        if (deleted === 0) {
            throw new UnauthorizedError($ts`Link invalid`);
        }
    }

    /**
     * Finds the account an invitation is accepted by with a login: the one of its email, unless the invitation or
     * another open one created it and it waits for its password.
     * @param invitation - The invitation.
     * @param transaction - The transaction to read in, if any.
     * @returns The account, or undefined when accepting sets the password of the account.
     */
    private async findAccountToLogInAs(
        invitation: BaseInvitation,
        transaction: RepositoryTransaction | undefined
    ): Promise<BaseUser<string> | undefined> {
        const user: BaseUser<string> | undefined = await this.findUserOf(invitation, transaction);
        if (user == undefined || invitation.createdUserId === user.id) {
            return undefined;
        }
        // created by another invitation to the same email that is still open: nobody has logged in as it yet
        const creating: number = await this.getRepository().count({ where: { createdUserId: user.id }, transaction, acrossTenants: true });
        return creating > 0 ? undefined : user;
    }

    /**
     * Finds the account of an invitation: the one it created, or the one of its email.
     * @param invitation - The invitation.
     * @param transaction - The transaction to read in, if any.
     * @returns The account, or undefined while the email has none.
     */
    private async findUserOf(
        invitation: BaseInvitation,
        transaction: RepositoryTransaction | undefined
    ): Promise<BaseUser<string> | undefined> {
        return invitation.createdUserId != undefined
            ? await this.userService.findById(invitation.createdUserId, { required: false, transaction })
            : await this.userService.findByEmail(invitation.email, { required: false, transaction });
    }

    /**
     * Creates the account of an invitation through the repository of the application, and gives an invitation to
     * the application its platform roles.
     * @param invitation - The invitation.
     * @param transaction - The transaction to write in, if any.
     * @returns The account.
     */
    private async createInvitedUser(invitation: BaseInvitation, transaction: RepositoryTransaction | undefined): Promise<BaseUser<string>> {
        // in the locale of the invitation, which a user created without one gets, rather than in the one of the
        // request: that is the inviter's when the account is created as the invitation is sent
        const user: BaseUser<string> = await runInLocale(
            invitation.locale,
            async () => await this.getRepository().createInvitedUser(invitation, transaction)
        );
        if (invitation.tenantId == undefined && invitation.roles.length) {
            const roles: string[] = [...new Set([...user.roles, ...invitation.roles])];
            await this.userService.updateRoles(user.id, roles, transaction);
            return { ...user, roles };
        }
        return user;
    }

    /**
     * Mails an invitation its link.
     * @param invitation - The invitation.
     * @param token - The token of the link.
     */
    private async sendInvitation(invitation: BaseInvitation, token: string): Promise<void> {
        const options: InvitationOptions = this.getOptions();
        const url: string = `${options.acceptInvitationUrl}/${token}`;
        const link: string = invitation.tenantId == undefined ? url : await this.tenantService.resolveTenantUrl(url, invitation.tenantId);
        const tenant: BaseTenantDefinition | undefined = invitation.tenantId == undefined
            ? undefined
            : await this.tenantService.findTenant?.(invitation.tenantId);
        // in the locale the invitation was sent in, whoever renews its link
        await runInLocale(
            invitation.locale,
            async () => await this.inTenantOf(
                invitation.tenantId ?? undefined,
                async () => await inject(ZIBRI_DI_TOKENS.EMAIL_SERVICE).queue({
                    recipients: [invitation.email],
                    subject: $ts`Invitation`,
                    html: TsxUtilities.renderEmail(options.invitationEmail, { link, invitation, tenant }),
                    priority: EmailPriority.HIGH,
                    // the body carries the token in the clear, for the reason the password reset mail gives
                    persist: false
                })
            )
        );
    }

    /**
     * Finds an invitation by its id, as the repository reads it in the active tenant.
     * @param id - The id.
     * @param transaction - The transaction to read in, if any.
     * @returns The invitation.
     * @throws A NotFoundError when there is none.
     */
    private async findById(id: string, transaction: RepositoryTransaction | undefined): Promise<BaseInvitation> {
        const invitation: BaseInvitation | undefined = await this.getRepository().findOne({ where: { id }, transaction, required: false });
        if (invitation == undefined) {
            throw new NotFoundError($ts`Could not find invitation with id "${id}".`);
        }
        return invitation;
    }

    /**
     * Finds an invitation by the token of its link, in whichever tenant it is.
     * @param token - The token.
     * @param transaction - The transaction to read in, if any.
     * @returns The invitation, or undefined for an unknown token.
     */
    private async findByToken(token: string, transaction: RepositoryTransaction | undefined): Promise<BaseInvitation | undefined> {
        // hashed to be searched for, because that is how it is stored
        const hash: HashString = await inject(ZIBRI_DI_TOKENS.HASH_SERVICE).hash(token, { strategy: Sha256HashStrategy });
        return await this.getRepository().findOne({ where: { token: hash }, transaction, required: false, acrossTenants: true });
    }

    /**
     * Finds the open invitation of an email to a tenant or to the application, or anywhere.
     * @param email - The email.
     * @param tenantId - The tenant, undefined for the application only, false for anywhere.
     * @param transaction - The transaction to read in, if any.
     * @returns The invitation, or undefined when there is none.
     */
    private async findOpenInvitation(
        email: string,
        tenantId: string | undefined | false,
        transaction: RepositoryTransaction | undefined
    ): Promise<BaseInvitation | undefined> {
        return await this.getRepository().findOne({
            where: tenantId === false ? { email } : { email, tenantId: tenantId ?? null },
            transaction,
            required: false,
            acrossTenants: true
        });
    }

    /**
     * Finds the membership of a user in a tenant, deactivated or not.
     * @param userId - The user.
     * @param tenantId - The tenant.
     * @param transaction - The transaction to read in, if any.
     * @returns The membership, or undefined when there is none.
     */
    private async findMembership(
        userId: string,
        tenantId: string,
        transaction: RepositoryTransaction | undefined
    ): Promise<object | undefined> {
        if (this.membershipService.findMembership == undefined) {
            throw new InternalError('Inviting somebody to a tenant needs findMembership of the MembershipService.');
        }
        return await this.membershipService.findMembership(userId, tenantId, transaction);
    }

    /**
     * Finds the memberships of a user in every tenant, deactivated or not.
     * @param userId - The user.
     * @returns The memberships.
     */
    private async findMemberships(userId: string): Promise<object[]> {
        if (this.membershipService.findMemberships == undefined) {
            throw new InternalError('Undoing an invitation needs findMemberships of the MembershipService.');
        }
        return await this.membershipService.findMemberships(userId);
    }

    /**
     * Does something to an invitation, recording that it happened or why it did not, in the tenant of the
     * invitation.
     * @param action - What is done.
     * @param tenantId - The tenant of the invitation, undefined for one to the application.
     * @param email - The invited email.
     * @param userId - Who does it, if known.
     * @param transaction - The transaction it writes in, if any.
     * @param work - Does it.
     * @returns What the work answers.
     */
    private async audited<T>(
        action: AuditAction,
        tenantId: string | undefined,
        email: string,
        userId: string | undefined,
        transaction: RepositoryTransaction | undefined,
        work: () => Promise<T>
    ): Promise<T> {
        try {
            const result: T = await work();
            this.record(action, AuditOutcome.SUCCESS, tenantId, email, userId, transaction);
            return result;
        }
        catch (error) {
            this.record(action, AuditOutcome.FAILURE, tenantId, email, userId, undefined, error);
            throw error;
        }
    }

    /**
     * Records what happened to an invitation, in the tenant of the invitation.
     * @param action - What happened.
     * @param outcome - Whether it did.
     * @param tenantId - The tenant of the invitation, undefined for one to the application.
     * @param email - The invited email.
     * @param userId - Who did it, if known.
     * @param transaction - The transaction it wrote in, if any.
     * @param error - Why it did not, for a failure.
     */
    private record(
        action: AuditAction,
        outcome: AuditOutcome,
        tenantId: string | undefined,
        email: string,
        userId: string | undefined,
        transaction?: RepositoryTransaction,
        error?: unknown
    ): void {
        void this.inTenantOf(tenantId, () => {
            this.auditService.record({
                action,
                outcome,
                ...error == undefined ? {} : { reason: AuditUtilities.resolveReason(error) },
                subject: email,
                userId
            }, transaction);
            return Promise.resolve();
        });
    }

    /**
     * Runs something in the tenant of an invitation, or as it is for one to the application.
     * @param tenantId - The tenant, if any.
     * @param work - What to run.
     * @returns What it answers.
     */
    private async inTenantOf<T>(tenantId: string | undefined, work: () => Promise<T>): Promise<T> {
        return tenantId == undefined ? await work() : await this.tenantService.runAs(tenantId, work);
    }

    private generateToken(): string {
        // kept here, because the stored value is the hash, for the reason PasswordAuthenticator gives
        return randomBytes(16).toString('hex');
    }

    private getRepository(): InvitationRepository {
        if (this.repository == undefined) {
            throw new InternalError([
                'No invitation repository is listed, so there are no invitations.',
                'Declare an invitation entity extending BaseInvitationEntity(), and its repository with',
                // eslint-disable-next-line stylistic/max-len
                '@RepositoryFor(Invitation) extending BaseInvitationRepository<Invitation>(), and list it in the repositories of the data source.'
            ]);
        }
        return this.repository;
    }

    private getOptions(): InvitationOptions {
        if (this.options == undefined) {
            throw new InternalError('ZIBRI_DI_TOKENS.INVITATION_OPTIONS is not provided, so no invitation can be sent.');
        }
        return this.options;
    }
}