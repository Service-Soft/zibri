import { AlsUtilities } from '../../context/als.utilities';
import { BaseEntity } from '../../entity/base-entity.model';
import { EntityMetadata } from '../../entity/decorators/entity.decorator';
import { isUnscoped } from '../../entity/models/entity-scope.model';
import { NotFoundError } from '../../error-handling/errors/not-found.error';
import { InternalError } from '../../error-handling/internal-error.model';
import { $ts } from '../../localization/translate.function';
import { DeepPartial } from '../../types/deep-partial.type';
import { Newable } from '../../types/newable.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { DataSourceInterface } from '../data-sources/data-source.interface';
import { BaseRepositoryOptions } from '../models/options/base-repository-options.model';
import { resolveOutOfScopeError } from '../scopes/resolve-out-of-scope-error.function';
import { TenantOwnership, TenantRowData, TenantUtilities } from '../tenancy/tenant.utilities';
import { WrittenRowTenantUtilities } from '../tenancy/written-row-tenant.utilities';

/**
 * Refuses the writes of a repository that point rows at rows they may not point at: rows of another
 * tenant, rows the caller may not see, and rows that are not there.
 *
 * A row only ever references rows of its own tenant, and a row of no tenant only rows of none.
 * That is what keeps a read through a relation inside one tenant without narrowing it: every
 * relation between two rows was written by a call that was checked here.
 */
export class ReferenceValidator<T extends BaseEntity> {
    constructor(
        private readonly entityClass: Newable<T>,
        private readonly entityMetadata: EntityMetadata<T>,
        private readonly dataSource: DataSourceInterface
    ) {}

    /**
     * Refuses a write that points a row at a row of another tenant, or at a row the caller may not
     * see.
     *
     * A row pointed at has to be one the caller may see as well, the way a row they create has to
     * be, since the rows a relation holds are read back by whoever may see the row holding it. One
     * read per entity pointed at, across every row of the write.
     * @param rows - The data of each row being written, with the tenant the row belongs to.
     * @param options - The options of the write, for its transaction and `unscoped`.
     * @throws When a row points at a row of another tenant, at one the caller may
     * not see, or at one that is not there.
     */
    async validate(rows: TenantRowData[], options: BaseRepositoryOptions | undefined): Promise<void> {
        const expected: Map<Newable<BaseEntity>, Map<string, Set<string | undefined>>> = new Map();
        for (const { data, rowTenant } of rows) {
            for (const { target, ids } of TenantUtilities.resolveReferences(data, this.entityClass, rowTenant)) {
                const byId: Map<string, Set<string | undefined>> = expected.get(target) ?? new Map<string, Set<string | undefined>>();
                for (const id of ids) {
                    byId.set(id, (byId.get(id) ?? new Set()).add(rowTenant));
                }
                expected.set(target, byId);
            }
        }

        await Promise.all([...expected].map(async ([target, byId]) => {
            // a row of no tenant pointing at rows of no tenant is what every application without
            // tenants does on every write, and there is nothing to compare - unless the rows pointed
            // at are ones this caller may not see
            const targetMetadata: EntityMetadata | undefined = MetadataUtilities.getEntityMetadata(target);
            const everyRowShared: boolean = [...byId.values()].every(tenants => tenants.size === 1 && tenants.has(undefined));
            const targetScoped: boolean = targetMetadata?.scope?.restrictedTo != undefined
                && !isUnscoped('restrictedTo', options?.unscoped);
            if (targetMetadata?.tenant === 'shared' && everyRowShared && !targetScoped) {
                return;
            }
            // a row this transaction wrote is known already, which is every row a write creates along
            // with its own - their key names the row the same write just stored
            const tenantOfId: Map<string, string | undefined> = WrittenRowTenantUtilities.findTenants(
                options?.transaction,
                target,
                [...byId.keys()]
            );
            const unknown: string[] = [...byId.keys()].filter(id => !tenantOfId.has(id));
            // through the repository of the rows pointed at, under the scopes the call is not exempt
            // from: a row the caller may not see is not there as far as they are concerned
            const found: BaseEntity[] = unknown.length
                ? await this.dataSource.getRepository(target).findAll({
                    where: { id: { oneOf: unknown } },
                    acrossTenants: true,
                    unscoped: options?.unscoped,
                    limit: 'all',
                    transaction: options?.transaction
                })
                : [];
            for (const row of found) {
                tenantOfId.set(row.id, TenantUtilities.resolveTenantOf(row, target));
            }
            for (const [id, tenants] of byId) {
                // refused alike whether the row is another tenant's, hidden from the caller or not
                // there at all, so the answer says nothing about which ids exist elsewhere
                const tenant: string | undefined = tenantOfId.get(id);
                if (!tenantOfId.has(id) || tenants.size !== 1 || !tenants.has(tenant)) {
                    throw resolveOutOfScopeError(this.entityClass);
                }
            }
        }));
    }

    /**
     * Resolves the tenant the rows an update changes belong to, when the update points them at other
     * rows and so has to be checked against it.
     * @param options - The options of the update.
     * @param readRow - Reads the row being changed, when nothing else says which tenant it belongs to.
     * Absent for an update of several rows, which may belong to several tenants.
     * @returns The tenant of the changed rows, undefined for rows of no tenant.
     * @throws When an update of several rows of possibly several tenants points them at other rows.
     */
    async resolveTenantOfUpdated(
        options: BaseRepositoryOptions | undefined,
        readRow?: () => Promise<T>
    ): Promise<string | undefined> {
        const ownership: TenantOwnership | undefined = TenantUtilities.resolveOwnership(this.entityClass, this.entityMetadata);
        if (ownership == undefined) {
            return undefined;
        }
        if (ownership.required && options?.acrossTenants !== true) {
            return AlsUtilities.getCurrentTenant();
        }
        if (readRow == undefined) {
            throw new InternalError([
                `This update of several "${this.entityClass.name}" rows points them at other rows, and they may belong to several tenants.`,
                'A row only ever points at rows of its own tenant, so update the rows of each tenant as that tenant.'
            ]);
        }
        return TenantUtilities.resolveTenantOf(await readRow(), this.entityClass);
    }

    /**
     * Resolves the tenant of each row an update of several rows changes, for checking what it points
     * them at: the active one where every row belongs to it, read for all of them at once otherwise.
     * @param rows - The data of each row, with its id.
     * @param options - The options of the update.
     * @param readStored - Reads the rows as they are stored, by their id.
     * @returns The data of each row with the tenant the row belongs to.
     */
    async resolveTenantsOfUpdated(
        rows: DeepPartial<T>[],
        options: BaseRepositoryOptions | undefined,
        readStored: () => Promise<Map<string, T>>
    ): Promise<TenantRowData[]> {
        // read once for every row that needs it, and only when one does
        let stored: Promise<Map<string, T>> | undefined;
        const readOnce: () => Promise<Map<string, T>> = async () => {
            stored ??= readStored();
            return await stored;
        };
        return await Promise.all(rows.map(async data => ({
            data,
            rowTenant: await this.resolveTenantOfUpdated(options, async () => {
                const row: T | undefined = (await readOnce()).get(String(data.id));
                if (row == undefined) {
                    throw new NotFoundError($ts`Could not find ${this.entityClass.name} with id "${String(data.id)}".`);
                }
                return row;
            })
        })));
    }
}