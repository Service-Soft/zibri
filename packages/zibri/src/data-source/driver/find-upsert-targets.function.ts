import { RepositoryDriverInterface } from './repository-driver.interface';
import { BaseEntity } from '../../entity/base-entity.model';
import { UpsertRow } from '../models/upsert-row.model';
import { Where } from '../models/where/where-filter.model';
import { type RepositoryTransaction } from '../transaction/repository-transaction.type';
import { Transaction } from '../transaction/transaction.model';

/**
 * Finds the rows already there that an upsert meets: those sharing the identity of a row written,
 * found by the first of its columns and matched on the rest.
 * @param driver - The driver to read through.
 * @param identity - The columns identifying a row.
 * @param rows - The rows of the upsert.
 * @param transaction - The transaction of the upsert, if any.
 * @returns The rows, as they are.
 */
export async function findUpsertTargets<T extends BaseEntity, X extends RepositoryTransaction = Transaction>(
    driver: RepositoryDriverInterface<T, X>,
    identity: string[],
    rows: UpsertRow<T>[],
    transaction: X | undefined
): Promise<T[]> {
    const [first] = identity;
    if (first == undefined) {
        return [];
    }
    const stored: T[] = await driver.find({
        where: { [first]: { oneOf: rows.map(row => Reflect.get(row.create, first)) } } as Where<T>,
        transaction
    });
    return stored.filter(row => findUpsertRowOf(identity, rows, row) != undefined);
}

/**
 * Finds the row of an upsert that meets a row already there.
 * @param identity - The columns identifying a row.
 * @param rows - The rows of the upsert.
 * @param stored - The row already there.
 * @returns The row of the upsert, undefined when none shares its identity.
 */
export function findUpsertRowOf<T extends BaseEntity>(identity: string[], rows: UpsertRow<T>[], stored: T): UpsertRow<T> | undefined {
    return rows.find(row => identity.every(key => Reflect.get(row.create, key) === Reflect.get(stored, key)));
}