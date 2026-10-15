import { BaseMembership } from './base-membership.model';
import { ChangedMembership } from './changed-membership.model';
import { isMembershipRepository, MembershipRepositoryInterface } from './membership-repository.interface';
import { MembershipServiceInterface } from './membership-service.interface';
import { type UserServiceInterface } from '../../auth/user/user-service.interface';
import { Repository } from '../../data-source/repository/repository';
import { Transaction } from '../../data-source/transaction/transaction.model';
import { Inject } from '../../di/decorators/inject.decorator';
import { Injectable } from '../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { getAllInstantiatedValues } from '../../di/get-all-instantiated-values.function';
import { getDiTokenName } from '../../di/get-di-token-name.function';
import { getRegisteredProvidersOfVariant } from '../../di/get-registered-providers-of-variant.function';
import { inject } from '../../di/inject.function';
import { DiProvider } from '../../di/models/di-provider.model';
import { DiVariants } from '../../di/models/di-variant.model';
import { BaseEntity } from '../../entity/base-entity.model';
import { InternalError } from '../../error-handling/internal-error.model';
import { AfterAppInit } from '../../global/after-app-init.interface';
import { OnAppInit } from '../../global/on-app-init.interface';
import { type LoggerInterface } from '../../logging/logger.interface';
import { Newable } from '../../types/newable.type';
import { type BaseWebsocketConnection } from '../../websocket/models/connection/base-websocket-connection.model';
import { type WebsocketServiceInterface } from '../../websocket/services/websocket-service.interface';
import { type TenantServiceInterface } from '../tenant-service.interface';

/**
 * Default membership service implementation of Zibri, reading the memberships from the one class
 * marked with `@MembershipRepo()`.
 */
@Injectable({ register: 'onUse' })
export class MembershipService implements MembershipServiceInterface, OnAppInit, AfterAppInit {

    private repository: MembershipRepositoryInterface<string, BaseMembership<string>> | undefined;

    private get userService(): UserServiceInterface {
        return inject(ZIBRI_DI_TOKENS.USER_SERVICE);
    }

    private get websocketService(): WebsocketServiceInterface<BaseWebsocketConnection> {
        return inject(ZIBRI_DI_TOKENS.WEBSOCKET_SERVICE);
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
                `Several classes are marked with @MembershipRepo: ${providers.map(p => getDiTokenName(p.token)).join(', ')}.`,
                'The memberships of an application are read from one place. Keep one of them.'
            ]);
        }
        const [provider] = providers;
        if (provider != undefined) {
            const repository: unknown = inject(provider.token);
            if (!isMembershipRepository(repository)) {
                throw new InternalError(
                    // eslint-disable-next-line stylistic/max-len
                    `Invalid class marked with @MembershipRepo: ${getDiTokenName(provider.token)} needs to implement MembershipRepositoryInterface`
                );
            }
            this.repository = repository;
            this.logger.info(`configures the membership repository ${getDiTokenName(provider.token)}`);
        }

        // among what the application has actually built, for the reason UserService gives. This
        // service answers the same questions as a repository, so it is left out by itself
        const undecorated: unknown = getAllInstantiatedValues()
            .find(value => value !== this && value !== this.repository && isMembershipRepository(value));
        if (undecorated != undefined && typeof undecorated === 'object') {
            throw new InternalError(
                // eslint-disable-next-line stylistic/max-len
                `The class "${undecorated.constructor.name}" seems to be a membership repository but has not been decorated with @MembershipRepo()`
            );
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
                'No class is marked with @MembershipRepo.',
                'A logged in user acts in a tenant through their membership in it, which holds their roles there.',
                'Declare a membership entity, eg. one extending BaseMembershipEntity(Roles),',
                'and mark its repository with @MembershipRepo().'
            ]);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findMembership<Role extends string, T extends BaseMembership<Role>>(userId: string, tenantId: string): Promise<T | undefined> {
        const repository: MembershipRepositoryInterface<string, BaseMembership<string>> | undefined = this.repository;
        if (repository == undefined) {
            return undefined;
        }
        // in that tenant, so a repository reading a data source finds the membership there whichever
        // tenant the caller happens to be in
        const membership: BaseMembership<string> | undefined = await this.tenantService.runAs(
            tenantId,
            async () => await repository.findMembership(userId, tenantId)
        );
        // left out here rather than by every caller, so that no check asking whether a user belongs
        // to a tenant can forget it
        return (membership?.deactivatedAt == undefined ? membership : undefined) as T | undefined;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findMemberships<Role extends string, T extends BaseMembership<Role>>(userId: string): Promise<T[]> {
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
        await this.tenantService.runAs(tenantId, async () => await repository.updateDeactivatedAt(userId, deactivatedAt, transaction));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async deleteMembership(userId: string, tenantId: string, transaction: Transaction | undefined): Promise<void> {
        const repository: MembershipRepositoryInterface<string, BaseMembership<string>> = this.getRepository();
        await this.tenantService.runAs(tenantId, async () => await repository.deleteMembership(userId, transaction));
    }

    /**
     * Gets the repository memberships are written to.
     * @returns The repository.
     * @throws When the application has none, which only an application without users can start with.
     */
    private getRepository(): MembershipRepositoryInterface<string, BaseMembership<string>> {
        if (this.repository == undefined) {
            throw new InternalError('No class is marked with @MembershipRepo, so there is nowhere to write a membership to.');
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
    isMembershipEntity(entityClass: Newable<BaseEntity>): boolean {
        // only a repository of this framework writes through the data layer that reports writes. One
        // reading memberships from anywhere else reports its own changes
        return this.repository instanceof Repository && this.repository.entityClass === entityClass;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async handleMembershipsChanged(memberships: ChangedMembership[]): Promise<void> {
        if (!memberships.length) {
            return;
        }
        await this.websocketService.updateTenantRooms(memberships);
    }
}