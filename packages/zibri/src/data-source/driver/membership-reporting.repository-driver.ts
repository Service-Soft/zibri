import { DriverFindAndCountOptions, DriverFindOptions, DriverStreamOptions, DriverUpdateAllOptions, RepositoryDriverInterface } from './repository-driver.interface.ts';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../di/inject.function.ts';
import { BaseEntity } from '../../entity/base-entity.model.ts';
import { InternalError } from '../../error-handling/internal-error.model.ts';
import { type LoggerInterface } from '../../logging/logger.interface.ts';
import { PaginationResult } from '../../open-api/pagination-result.model.ts';
import { ChangedMembership } from '../../tenancy/membership/changed-membership.model.ts';
import { type MembershipServiceInterface } from '../../tenancy/membership/membership-service.interface.ts';
import { DeepPartial } from '../../types/deep-partial.type.ts';
import { Newable } from '../../types/newable.type.ts';
import { UpsertRow } from '../models/upsert-row.model.ts';
import { Where } from '../models/where/where-filter.model.ts';
import { TenantUtilities } from '../tenancy/tenant.utilities.ts';
import { Transaction } from '../transaction/transaction.model.ts';

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

    // eslint-disable-next-line jsdoc-js/require-jsdoc
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

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async insert(data: DeepPartial<T>[], transaction: Transaction | undefined): Promise<T[]> {
        const inserted: T[] = await this.inner.insert(data, transaction);
        // new rows were nobody's before, so only who they belong to now is reported
        if (this.membershipService.isMembershipEntity(this.entityClass)) {
            await this.report(inserted, transaction);
        }
        return inserted;
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async updateEach(rows: DeepPartial<T>[], where: Where<T>, transaction: Transaction | undefined): Promise<T[]> {
        if (!this.membershipService.isMembershipEntity(this.entityClass)) {
            return await this.inner.updateEach(rows, where, transaction);
        }
        // as a save: a stored row can move to another user, who is no member there any more
        const before: T[] = await this.inner.find({ where, transaction });
        const updated: T[] = await this.inner.updateEach(rows, where, transaction);
        await this.report([...before, ...updated], transaction);
        return updated;
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async find(options: DriverFindOptions<T>): Promise<T[]> {
        return await this.inner.find(options);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async findOne(options: DriverFindOptions<T>): Promise<T | undefined> {
        return await this.inner.findOne(options);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async count(options: DriverFindOptions<T>): Promise<number> {
        return await this.inner.count(options);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async findAndCount(options: DriverFindAndCountOptions<T>): Promise<PaginationResult<T>> {
        return await this.inner.findAndCount(options);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    stream(options: DriverStreamOptions<T>): AsyncIterable<T> {
        return this.inner.stream(options);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async remove(ids: string[], transaction: Transaction | undefined): Promise<void> {
        if (!this.membershipService.isMembershipEntity(this.entityClass)) {
            await this.inner.remove(ids, transaction);
            return;
        }
        // read first, as a save is: a remove is handed ids, and who stops being a member where is
        // only on the rows
        const before: T[] = ids.length ? await this.inner.find({ where: { id: { oneOf: ids } } as Where<T>, transaction }) : [];
        await this.inner.remove(ids, transaction);
        await this.report(before, transaction);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async findIds(options: DriverFindOptions<T>): Promise<string[]> {
        return await this.inner.findIds(options);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
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

    // eslint-disable-next-line jsdoc-js/require-jsdoc
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