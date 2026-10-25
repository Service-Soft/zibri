import { ForwardingRepositoryDriver } from './forwarding.repository-driver';
import { DriverUpdateAllOptions, RepositoryDriverInterface } from './repository-driver.interface';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { InternalError } from '../../error-handling/internal-error.model';
import { type LoggerInterface } from '../../logging/logger.interface';
import { ChangedMembership } from '../../tenancy/membership/changed-membership.model';
import { type MembershipServiceInterface } from '../../tenancy/membership/membership-service.interface';
import { DeepPartial } from '../../types/deep-partial.type';
import { Newable } from '../../types/newable.type';
import { RelatedNarrowing } from '../models/related-narrowing.model';
import { UpsertRow } from '../models/upsert-row.model';
import { Where } from '../models/where/where-filter.model';
import { TenantUtilities } from '../tenancy/tenant.utilities';
import { Transaction } from '../transaction/transaction.model';

/**
 * Reports every write to memberships to the membership service, once it is committed.
 *
 * What follows memberships - which tenants' websocket broadcasts a connection receives - has to
 * follow every way a membership is written, and a write reaches the store through this seam however
 * the repository above it got there. Once committed, since following a write that is rolled back
 * would hand a user the broadcasts of a tenant they never joined.
 *
 * Every write reports, and does nothing more for any other entity; every read forwards.
 */
export class MembershipReportingRepositoryDriver<T extends BaseEntity> extends ForwardingRepositoryDriver<T> {
    constructor(
        inner: RepositoryDriverInterface<T>,
        private readonly entityClass: Newable<T>,
        private readonly logger: LoggerInterface
    ) {
        super(inner);
    }

    private get membershipService(): MembershipServiceInterface {
        return inject(ZIBRI_DI_TOKENS.MEMBERSHIP_SERVICE);
    }

    override async save(data: DeepPartial<T>[], transaction: Transaction | undefined, reload: boolean): Promise<T[]> {
        if (!this.membershipService.isMembershipEntity(this.entityClass)) {
            return await super.save(data, transaction, reload);
        }
        // a save of a stored row can move it to another user, who is no member there any more
        const ids: string[] = data.flatMap(row => typeof row.id === 'string' ? [row.id] : []);
        const before: T[] = ids.length ? await this.inner.find({ where: { id: { oneOf: ids } } as Where<T>, transaction }) : [];
        const saved: T[] = await super.save(data, transaction, reload);
        await this.report([...before, ...saved], transaction);
        return saved;
    }

    override async insert(data: DeepPartial<T>[], transaction: Transaction | undefined): Promise<T[]> {
        const inserted: T[] = await super.insert(data, transaction);
        // new rows were nobody's before, so only who they belong to now is reported
        if (this.membershipService.isMembershipEntity(this.entityClass)) {
            await this.report(inserted, transaction);
        }
        return inserted;
    }

    override async updateEach(
        rows: DeepPartial<T>[],
        where: Where<T>,
        transaction: Transaction | undefined,
        related?: RelatedNarrowing
    ): Promise<T[]> {
        if (!this.membershipService.isMembershipEntity(this.entityClass)) {
            return await super.updateEach(rows, where, transaction, related);
        }
        // as a save: a stored row can move to another user, who is no member there any more
        const before: T[] = await this.inner.find({ where, transaction });
        const updated: T[] = await super.updateEach(rows, where, transaction, related);
        await this.report([...before, ...updated], transaction);
        return updated;
    }

    override async remove(ids: string[], transaction: Transaction | undefined): Promise<void> {
        if (!this.membershipService.isMembershipEntity(this.entityClass)) {
            await super.remove(ids, transaction);
            return;
        }
        // read first, as a save is: a remove is handed ids, and who stops being a member where is
        // only on the rows
        const before: T[] = ids.length ? await this.inner.find({ where: { id: { oneOf: ids } } as Where<T>, transaction }) : [];
        await super.remove(ids, transaction);
        await this.report(before, transaction);
    }

    override async updateAll<R extends boolean = false>(options: DriverUpdateAllOptions<T, R>): Promise<R extends true ? T[] : number> {
        if (!this.membershipService.isMembershipEntity(this.entityClass)) {
            return await super.updateAll(options);
        }
        // read first, since an update hands back how many rows it changed rather than which
        const before: T[] = await this.inner.find({ where: options.where, transaction: options.transaction });
        const res: R extends true ? T[] : number = await super.updateAll(options);
        const movedTo: unknown = 'userId' in options.data ? options.data.userId : undefined;
        await this.report(
            [...before, ...typeof movedTo === 'string' ? before.map(row => ({ ...row, userId: movedTo })) : []],
            options.transaction
        );
        return res;
    }

    override async upsert(
        identity: string[],
        rows: UpsertRow<T>[],
        transaction: Transaction | undefined,
        reachable: Where<T> | undefined,
        related?: RelatedNarrowing
    ): Promise<T[]> {
        const written: T[] = await super.upsert(identity, rows, transaction, reachable, related);
        if (this.membershipService.isMembershipEntity(this.entityClass)) {
            await this.report(written, transaction);
        }
        return written;
    }

    /**
     * Hands the users and tenants of the written memberships to the membership service, once the
     * write is committed.
     * @param rows - The memberships as they were and as they are now.
     * @param transaction - The transaction the write ran in, undefined for one that is committed already.
     */
    private async report(rows: object[], transaction: Transaction | undefined): Promise<void> {
        const changed: Map<string, ChangedMembership> = new Map();
        for (const row of rows) {
            const userId: unknown = 'userId' in row ? row.userId : undefined;
            const tenantId: string | undefined = TenantUtilities.resolveTenantOf(row, this.entityClass);
            if (typeof userId === 'string' && tenantId != undefined) {
                changed.set(`${userId}:${tenantId}`, { userId, tenantId });
            }
        }
        if (!changed.size) {
            return;
        }

        const handle: () => Promise<void> = async () => {
            try {
                await this.membershipService.handleMembershipsChanged([...changed.values()]);
            }
            catch (error) {
                // the memberships are written either way, so this is worth knowing and not worth
                // failing the write over - a connection catches up when it reconnects
                this.logger.error(new InternalError('Could not follow a change of memberships', { cause: error }));
            }
        };
        if (transaction == undefined) {
            await handle();
            return;
        }
        transaction.afterCommit(handle);
    }
}