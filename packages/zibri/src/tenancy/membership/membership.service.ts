import { BaseMembership } from './base-membership.model';
import { MembershipEventWriteObserver } from './membership-event.write-observer';
import { isMembershipRepository, MembershipRepositoryInterface } from './membership-repository.interface';
import { MembershipServiceInterface } from './membership-service.interface';
import { MembershipWriteObserver } from './membership.write-observer';
import { type AuditServiceInterface } from '../../audit/audit-service.interface';
import { RoleUtilities } from '../../auth/roles/role.utilities';
import { type UserServiceInterface } from '../../auth/user/user-service.interface';
import { Repository } from '../../data-source/repository/repository';
import { Transaction } from '../../data-source/transaction/transaction.model';
import { EntityWriteObserverRegistry } from '../../data-source/write-observers/entity-write-observer.registry';
import { Inject } from '../../di/decorators/inject.decorator';
import { Injectable } from '../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { getAllInstantiatedValues } from '../../di/get-all-instantiated-values.function';
import { getDiTokenName } from '../../di/get-di-token-name.function';
import { getRegisteredProvidersOfVariant } from '../../di/get-registered-providers-of-variant.function';
import { inject } from '../../di/inject.function';
import { DiProvider } from '../../di/models/di-provider.model';
import { DiVariants } from '../../di/models/di-variant.model';
import { InternalError } from '../../error-handling/internal-error.model';
import { FrameworkEventNames } from '../../event/framework-event-names.model';
import { AfterAppInit } from '../../global/after-app-init.interface';
import { OnAppInit } from '../../global/on-app-init.interface';
import { AuditAction, AuditOutcome } from '../../logging/audit-event.model';
import { AuditUtilities } from '../../logging/audit.utilities';
import { type LoggerInterface } from '../../logging/logger.interface';
import { Newable } from '../../types/newable.type';
import { type TenantServiceInterface } from '../tenant-service.interface';

/**
 * Default membership service implementation of Zibri, reading the memberships from the one
 * membership repository, such as one extending `BaseMembershipRepository()`.
 */
@Injectable({ register: 'onUse' })
export class MembershipService implements MembershipServiceInterface, OnAppInit, AfterAppInit {

    private repository: MembershipRepositoryInterface<string, BaseMembership<string>> | undefined;

    /**
     * The membership repository, as the repository of its entity.
     */
    private entityRepository: Repository<BaseMembership<string>> | undefined;

    private get userService(): UserServiceInterface {
        return inject(ZIBRI_DI_TOKENS.USER_SERVICE);
    }

    private get auditService(): AuditServiceInterface {
        return inject(ZIBRI_DI_TOKENS.AUDIT_SERVICE);
    }

    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        private readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.TENANT_SERVICE)
        private readonly tenantService: TenantServiceInterface
    ) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    onAppInit(): void {
        const providers: DiProvider<unknown>[] = getRegisteredProvidersOfVariant(DiVariants.MEMBERSHIP_REPO);
        if (providers.length > 1) {
            throw new InternalError([
                `Several membership repositories are listed: ${providers.map(p => getDiTokenName(p.token)).join(', ')}.`,
                'The memberships of an application are read from one place. Keep one of them.'
            ]);
        }
        const [provider] = providers;
        if (provider != undefined) {
            const repository: unknown = inject(provider.token);
            // registered under the variant by its data source, which lists repository classes only
            if (!(repository instanceof Repository) || !isMembershipRepository(repository)) {
                const tokenName: string = getDiTokenName(provider.token);
                throw new InternalError(
                    `Invalid membership repository: ${tokenName} needs to extend BaseMembershipRepository<Membership>()`
                );
            }
            this.repository = repository;
            this.entityRepository = repository;
            inject(EntityWriteObserverRegistry).register(
                repository.entityClass,
                // given the role service here rather than resolving it per write (01 §Q3)
                new MembershipWriteObserver(this.tenantService, inject(ZIBRI_DI_TOKENS.ROLE_SERVICE))
            );
            // only when the application named one, since each costs every write to memberships a read
            // before it and an event
            const names: FrameworkEventNames = inject(ZIBRI_DI_TOKENS.FRAMEWORK_EVENT_NAMES);
            if (names.membershipStarted != undefined || names.membershipEnded != undefined) {
                inject(EntityWriteObserverRegistry).register(
                    repository.entityClass,
                    new MembershipEventWriteObserver(repository.entityClass, names, this)
                );
            }
            this.logger.info(`configures the membership repository ${getDiTokenName(provider.token)}`);
        }

        // among what the application has actually built, for the reason UserService gives
        const unlisted: unknown = getAllInstantiatedValues()
            .find(value => value !== this.repository && isMembershipRepository(value));
        if (unlisted != undefined && typeof unlisted === 'object') {
            throw new InternalError([
                `The class "${unlisted.constructor.name}" is a membership repository, but no data source lists it in its repositories.`,
                'Declare it with @RepositoryFor(Membership), and list it in the repositories of the data source that declares Membership.'
            ]);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    afterAppInit(): void {
        // after init rather than on it, once the user service has found its repositories. The roles
        // of a logged in user live on their membership, and every request of theirs in a tenant is
        // refused without one - so an application with users needs a place to read memberships from,
        // and is told while it starts rather than by its first refused request
        if (this.repository == undefined && this.userService.userRepositories.length) {
            throw new InternalError([
                'No membership repository is listed.',
                'A logged in user acts in a tenant through their membership in it, which holds their roles there.',
                'Declare a membership entity, eg. one extending BaseMembershipEntity<MemberRole>(), and its repository with',
                // eslint-disable-next-line stylistic/max-len
                '@RepositoryFor(Membership) extending BaseMembershipRepository<Membership>(), and list it in the repositories of the data source.'
            ]);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findActiveMembership<Role extends string, T extends BaseMembership<Role>>(
        userId: string,
        tenantId: string,
        transaction?: Transaction
    ): Promise<T | undefined> {
        const repository: MembershipRepositoryInterface<string, BaseMembership<string>> | undefined = this.repository;
        if (repository == undefined) {
            return undefined;
        }
        // in that tenant, so a repository reading a data source finds the membership there whichever
        // tenant the caller happens to be in
        const membership: BaseMembership<string> | undefined = await this.tenantService.runAs(
            tenantId,
            async () => await repository.findMembership(userId, tenantId, transaction)
        );
        // left out here rather than by every caller, so that no check asking whether a user belongs
        // to a tenant can forget it
        return (membership?.deactivatedAt == undefined ? membership : undefined) as T | undefined;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findActiveMemberships<Role extends string, T extends BaseMembership<Role>>(userId: string): Promise<T[]> {
        const memberships: BaseMembership<string>[] = await this.repository?.findMemberships(userId) ?? [];
        return memberships.filter(m => m.deactivatedAt == undefined) as T[];
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveMembership<Role extends string, T extends BaseMembership<Role>>(
        userId: string,
        tenantId: string,
        transaction: Transaction | undefined
    ): Promise<T> {
        const repository: MembershipRepositoryInterface<string, BaseMembership<string>> = this.getRepository();
        return await this.tenantService.runAs(tenantId, async () => await repository.resolveMembership(userId, transaction)) as T;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async updateDeactivatedAt(
        userId: string,
        tenantId: string,
        deactivatedAt: Date | null,
        transaction: Transaction | undefined
    ): Promise<void> {
        const repository: MembershipRepositoryInterface<string, BaseMembership<string>> = this.getRepository();
        await this.audited(
            deactivatedAt == undefined ? AuditAction.MEMBERSHIP_REACTIVATED : AuditAction.MEMBERSHIP_DEACTIVATED,
            userId,
            tenantId,
            async () => await repository.updateDeactivatedAt(userId, deactivatedAt, transaction)
        );
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async deleteMembership(userId: string, tenantId: string, transaction: Transaction | undefined): Promise<void> {
        const repository: MembershipRepositoryInterface<string, BaseMembership<string>> = this.getRepository();
        await this.audited(
            AuditAction.MEMBERSHIP_DELETED,
            userId,
            tenantId,
            async () => await repository.deleteMembership(userId, transaction)
        );
    }

    /**
     * Changes a membership in its tenant, recording that it happened or why it did not.
     *
     * Recorded because losing a tenant is losing every role in it, which is recorded when it happens
     * one role at a time.
     * @param action - The change.
     * @param userId - The id of the member.
     * @param tenantId - The tenant of the membership, which the entry is recorded in.
     * @param change - Makes the change.
     */
    private async audited(action: AuditAction, userId: string, tenantId: string, change: () => Promise<void>): Promise<void> {
        await this.tenantService.runAs(tenantId, async () => {
            try {
                await change();
                this.auditService.record({ action, outcome: AuditOutcome.SUCCESS, userId });
            }
            catch (error) {
                this.auditService.record({ action, outcome: AuditOutcome.FAILURE, reason: AuditUtilities.resolveReason(error), userId });
                throw error;
            }
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async updateRoles(userId: string, tenantId: string, roles: string[], transaction: Transaction | undefined): Promise<void> {
        const repository: MembershipRepositoryInterface<string, BaseMembership<string>> = this.getRepository();
        await this.tenantService.runAs(tenantId, async () => await repository.updateRoles(userId, roles, transaction));
    }

    /**
     * Gets the repository memberships are written to.
     * @returns The repository.
     * @throws When the application has none, which only an application without users can start with.
     */
    private getRepository(): MembershipRepositoryInterface<string, BaseMembership<string>> {
        if (this.repository == undefined) {
            throw new InternalError('No membership repository is listed, so there is nowhere to write a membership to.');
        }
        return this.repository;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async deleteMemberships(userIds: string[], transaction: Transaction): Promise<void> {
        if (!userIds.length) {
            return;
        }
        await this.repository?.deleteMemberships(userIds, transaction);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findUnknownRoles(known: string[], findTenantRoles: (tenantId: string) => Promise<string[]>): Promise<string[]> {
        // the entity of a data source only, for the reason onAppInit gives
        if (this.entityRepository == undefined) {
            return [];
        }
        // the store hands out the memberships holding a role every tenant does not share, and only
        // their tenants' own roles are asked for
        return await RoleUtilities.resolveUnknownRoles(
            this.entityRepository.stream({
                where: { roles: RoleUtilities.whereHoldingUnknownRoles(known) },
                unscoped: true,
                acrossTenants: true,
                autoDecrypt: false
            }),
            known,
            findTenantRoles
        );
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async isRoleHeld(role: string, tenantId: string | undefined): Promise<boolean> {
        // the entity of a data source only, for the reason onAppInit gives
        if (this.entityRepository == undefined) {
            return false;
        }
        return await this.entityRepository.count({
            where: { roles: { includes: [role] }, ...tenantId == undefined ? {} : { tenantId } },
            unscoped: true,
            acrossTenants: true
        }) > 0;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    findMembershipEntityClass(): Newable<BaseMembership<string>> | undefined {
        return this.entityRepository?.entityClass;
    }
}