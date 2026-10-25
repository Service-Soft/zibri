import { findUpsertTargets } from './find-upsert-targets.function';
import { ForwardingRepositoryDriver } from './forwarding.repository-driver';
import { DriverUpdateAllOptions, RepositoryDriverInterface } from './repository-driver.interface';
import { type RoleServiceInterface } from '../../auth/roles/role-service.interface';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { InternalError } from '../../error-handling/internal-error.model';
import { type LoggerInterface } from '../../logging/logger.interface';
import { DeepPartial } from '../../types/deep-partial.type';
import { Newable } from '../../types/newable.type';
import { RelatedNarrowing } from '../models/related-narrowing.model';
import { UpsertRow } from '../models/upsert-row.model';
import { Where } from '../models/where/where-filter.model';
import { Transaction } from '../transaction/transaction.model';

/**
 * Reports every write to roles to the role service, with the tenants whose roles it wrote, once it is
 * committed.
 *
 * Every check reads the roles from memory, on every instance, so every way a role is written has to
 * reach them: a write reaches the store through this seam however the repository above it got
 * there. Once committed, since reading the roles again before then would find them unchanged. The
 * rows a write changes are read before it, since a role can leave a tenant as well as join one.
 *
 * Every write reports, and does nothing more for any other entity; every read forwards.
 */
export class RoleReportingRepositoryDriver<T extends BaseEntity> extends ForwardingRepositoryDriver<T> {
    constructor(
        inner: RepositoryDriverInterface<T>,
        private readonly entityClass: Newable<T>,
        private readonly logger: LoggerInterface
    ) {
        super(inner);
    }

    private get roleService(): RoleServiceInterface {
        return inject(ZIBRI_DI_TOKENS.ROLE_SERVICE);
    }

    override async save(data: DeepPartial<T>[], transaction: Transaction | undefined, reload: boolean): Promise<T[]> {
        const ids: string[] = data.flatMap(row => typeof row.id === 'string' ? [row.id] : []);
        const before: T[] = ids.length ? await this.findBefore({ id: { oneOf: ids } } as Where<T>, transaction) : [];
        const saved: T[] = await super.save(data, transaction, reload);
        await this.report(transaction, [...before, ...saved]);
        return saved;
    }

    override async insert(data: DeepPartial<T>[], transaction: Transaction | undefined): Promise<T[]> {
        const inserted: T[] = await super.insert(data, transaction);
        await this.report(transaction, inserted);
        return inserted;
    }

    override async updateEach(
        rows: DeepPartial<T>[],
        where: Where<T>,
        transaction: Transaction | undefined,
        related?: RelatedNarrowing
    ): Promise<T[]> {
        const before: T[] = await this.findBefore(where, transaction);
        const updated: T[] = await super.updateEach(rows, where, transaction, related);
        await this.report(transaction, [...before, ...updated]);
        return updated;
    }

    override async remove(ids: string[], transaction: Transaction | undefined): Promise<void> {
        const before: T[] = ids.length ? await this.findBefore({ id: { oneOf: ids } } as Where<T>, transaction) : [];
        await super.remove(ids, transaction);
        await this.report(transaction, before);
    }

    override async updateAll<R extends boolean = false>(options: DriverUpdateAllOptions<T, R>): Promise<R extends true ? T[] : number> {
        const before: T[] = await this.findBefore(options.where, options.transaction);
        const res: R extends true ? T[] : number = await super.updateAll(options);
        // the tenant the rows move to, when the write moves them
        await this.report(options.transaction, [...before, ...'tenantId' in options.data ? [options.data] : []]);
        return res;
    }

    override async upsert(
        identity: string[],
        rows: UpsertRow<T>[],
        transaction: Transaction | undefined,
        reachable: Where<T> | undefined,
        related?: RelatedNarrowing
    ): Promise<T[]> {
        const before: T[] = this.roleService.isRoleEntity(this.entityClass)
            ? await findUpsertTargets(this.inner, identity, rows, transaction)
            : [];
        const written: T[] = await super.upsert(identity, rows, transaction, reachable, related);
        await this.report(transaction, [...before, ...written]);
        return written;
    }

    /**
     * Reads the roles a write is about to change, to know which tenants they belong to before it.
     * @param where - The rows the write changes.
     * @param transaction - The transaction of the write, if any.
     * @returns The rows, none for any other entity.
     */
    private async findBefore(where: Where<T> | undefined, transaction: Transaction | undefined): Promise<T[]> {
        return this.roleService.isRoleEntity(this.entityClass) ? await this.inner.find({ where, transaction }) : [];
    }

    /**
     * Tells the role service that the roles of some tenants changed, once the write is committed.
     * @param transaction - The transaction the write ran in, undefined for one that is committed already.
     * @param rows - The rows written, as they were and as they are.
     */
    private async report(transaction: Transaction | undefined, rows: object[]): Promise<void> {
        if (!this.roleService.isRoleEntity(this.entityClass)) {
            return;
        }
        const tenantIds: Set<string | null> = new Set(rows.map(row => {
            const tenantId: unknown = 'tenantId' in row ? row.tenantId : undefined;
            // eslint-disable-next-line unicorn/no-null
            return typeof tenantId === 'string' ? tenantId : null;
        }));
        const handle: () => Promise<void> = async () => {
            try {
                await this.roleService.handleRolesChanged([...tenantIds]);
            }
            catch (error) {
                // the roles are written either way, so this is worth knowing and not worth failing the
                // write over - every instance reads them again with the next change
                this.logger.error(new InternalError('Could not follow a change of roles', { cause: error }));
            }
        };
        if (transaction == undefined) {
            await handle();
            return;
        }
        transaction.afterCommit(handle);
    }
}