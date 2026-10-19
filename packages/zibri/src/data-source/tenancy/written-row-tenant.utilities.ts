// Kept per transaction, so that a write pointing at a row the same transaction wrote does not read
// that row back to learn its tenant. A row a transaction wrote is that transaction's to change until
// it commits - nobody else sees an inserted row, and an updated one stays locked - and the repository
// refuses moving a row to another tenant, so what is recorded stays true for as long as the
// transaction runs. Keyed by the transaction itself, so it goes when the transaction does; a finished
// transaction refuses being used again.
import { BaseEntity } from '../../entity/base-entity.model';
import { Newable } from '../../types/newable.type';
import { Transaction } from '../transaction/transaction.model';

/**
 * The tenant of each row, by entity and id.
 */
type TenantsByEntity = Map<Newable<BaseEntity>, Map<string, string | undefined>>;

const tenantsByTransaction: WeakMap<Transaction, TenantsByEntity> = new WeakMap();

/**
 * Remembers the tenant of every row a transaction wrote, for the tenant checks of the writes after it.
 */
export class WrittenRowTenantUtilities {

    /**
     * Records the tenant of rows a transaction wrote.
     * @param transaction - The transaction, if the write ran in one. Without one nothing is recorded.
     * @param entityClass - The entity of the rows.
     * @param rows - Each row's id and tenant, undefined for a row of no tenant.
     */
    static record(
        transaction: Transaction | undefined,
        entityClass: Newable<BaseEntity>,
        rows: [string, string | undefined][]
    ): void {
        if (transaction == undefined || !rows.length) {
            return;
        }
        const byEntity: TenantsByEntity = tenantsByTransaction.get(transaction)
            ?? new Map<Newable<BaseEntity>, Map<string, string | undefined>>();
        const byId: Map<string, string | undefined> = byEntity.get(entityClass) ?? new Map<string, string | undefined>();
        for (const [id, tenant] of rows) {
            byId.set(id, tenant);
        }
        byEntity.set(entityClass, byId);
        tenantsByTransaction.set(transaction, byEntity);
    }

    /**
     * Forgets rows a transaction deleted.
     * @param transaction - The transaction, if the delete ran in one.
     * @param entityClass - The entity of the rows.
     * @param ids - Their ids.
     */
    static forget(transaction: Transaction | undefined, entityClass: Newable<BaseEntity>, ids: string[]): void {
        const byId: Map<string, string | undefined> | undefined = transaction == undefined
            ? undefined
            : tenantsByTransaction.get(transaction)?.get(entityClass);
        for (const id of ids) {
            byId?.delete(id);
        }
    }

    /**
     * Finds the tenants of those of the given rows that the transaction wrote.
     * @param transaction - The transaction, if the write asking runs in one.
     * @param entityClass - The entity of the rows.
     * @param ids - Their ids.
     * @returns The tenant of each row the transaction wrote, by id. A row it did not write is absent.
     */
    static findTenants(
        transaction: Transaction | undefined,
        entityClass: Newable<BaseEntity>,
        ids: string[]
    ): Map<string, string | undefined> {
        const byId: Map<string, string | undefined> | undefined = transaction == undefined
            ? undefined
            : tenantsByTransaction.get(transaction)?.get(entityClass);
        const res: Map<string, string | undefined> = new Map();
        for (const id of ids) {
            if (byId?.has(id) === true) {
                res.set(id, byId.get(id));
            }
        }
        return res;
    }
}