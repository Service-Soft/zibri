import { DriverFindAndCountOptions, DriverFindOptions, DriverStreamOptions, DriverUpdateAllOptions, RepositoryDriverInterface } from './repository-driver.interface';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { InternalError } from '../../error-handling/internal-error.model';
import { type LoggerInterface } from '../../logging/logger.interface';
import { PaginationResult } from '../../open-api/pagination-result.model';
import { ChangedMembership } from '../../tenancy/membership/changed-membership.model';
import { type MembershipServiceInterface } from '../../tenancy/membership/membership-service.interface';
import { DeepPartial } from '../../types/deep-partial.type';
import { Newable } from '../../types/newable.type';
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
 * Every method forwards, and does nothing more for any other entity.
 */
export class MembershipReportingRepositoryDriver<T extends BaseEntity> implements RepositoryDriverInterface<T> {
    constructor(
        private readonly inner: RepositoryDriverInterface<T>,
        private readonly entityClass: Newable<T>,
        private readonly logger: LoggerInterface
    ) {}

    private get membershipService(): MembershipServiceInterface {
        return inject(ZIBRI_DI_TOKENS.MEMBERSHIP_SERVICE);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async save(data: DeepPartial<T>[], transaction: Transaction | undefined, reload: boolean): Promise<T[]> {
        if (!this.membershipService.isMembershipEntity(this.entityClass)) {
            return await this.inner.save(data, transaction, reload);
        }
        // a save of a stored row can move it to another user, who is no member there any more
        const ids: string[] = data.flatMap(row => typeof row.id === 'string' ? [row.id] : []);
        const before: T[] = ids.length ? await this.inner.find({ where: { id: { oneOf: ids } } as Where<T>, transaction }) : [];
        const saved: T[] = await this.inner.save(data, transaction, reload);
        await this.report([...before, ...saved], transaction);
        return saved;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async find(options: DriverFindOptions<T>): Promise<T[]> {
        return await this.inner.find(options);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findOne(options: DriverFindOptions<T>): Promise<T | undefined> {
        return await this.inner.findOne(options);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async count(options: DriverFindOptions<T>): Promise<number> {
        return await this.inner.count(options);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findAndCount(options: DriverFindAndCountOptions<T>): Promise<PaginationResult<T>> {
        return await this.inner.findAndCount(options);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    stream(options: DriverStreamOptions<T>): AsyncIterable<T> {
        return this.inner.stream(options);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async remove(entities: T[], transaction: Transaction | undefined): Promise<T[]> {
        const removed: T[] = await this.inner.remove(entities, transaction);
        if (this.membershipService.isMembershipEntity(this.entityClass)) {
            await this.report(removed, transaction);
        }
        return removed;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async updateAll<R extends boolean = false>(options: DriverUpdateAllOptions<T, R>): Promise<R extends true ? T[] : number> {
        if (!this.membershipService.isMembershipEntity(this.entityClass)) {
            return await this.inner.updateAll(options);
        }
        // read first, since an update hands back how many rows it changed rather than which
        const before: T[] = await this.inner.find({ where: options.where, transaction: options.transaction });
        const res: R extends true ? T[] : number = await this.inner.updateAll(options);
        const movedTo: unknown = 'userId' in options.data ? options.data.userId : undefined;
        await this.report(
            [...before, ...typeof movedTo === 'string' ? before.map(row => ({ ...row, userId: movedTo })) : []],
            options.transaction
        );
        return res;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async upsert(
        identity: string[],
        rows: UpsertRow<T>[],
        transaction: Transaction | undefined,
        reachable: Where<T> | undefined
    ): Promise<T[]> {
        const written: T[] = await this.inner.upsert(identity, rows, transaction, reachable);
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