import { PostgresDataSource } from '../data-source/data-sources/postgres/postgres-data-source.model';
import { Transaction } from '../data-source/transaction/transaction.model';

/**
 * Runs a statement written by hand on a postgres data source, for a test that asks the catalog or sets
 * a table up the repository has no form for.
 * @param dataSource - The data source.
 * @param sql - The statement, with `$1` style placeholders.
 * @param values - What it binds, in the order of its placeholders.
 * @param transaction - The transaction to run it in.
 * @returns The rows it read or returned.
 */
export async function queryPostgres(
    dataSource: PostgresDataSource,
    sql: string,
    values: unknown[] = [],
    transaction?: Transaction
): Promise<Record<string, unknown>[]> {
    const parameters: Record<string, unknown> = Object.fromEntries(values.map((value, i) => [`p${i + 1}`, value]));
    return await dataSource.runStatement({ sql: sql.replaceAll(/\$(\d+)/g, ':p$1'), parameters }, transaction);
}