import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';

import { inject } from '../../di/inject.function';
import { Logger } from '../../logging/logger';
import { JwtUser } from '../mocks/entities/jwt-user.entity';
import { createTestDataSource } from '../test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../test-server/start-test-server.function';

/**
 * Executable form of evaluation/01-data-layer.md C4.
 *
 * The harness connects every data source as a role that owns its database and holds nothing else.
 * That is enough to install pg_trgm, which postgres marks as trusted - so the first boot here does,
 * and every other suite boots on it. What a managed postgres commonly adds is an application role
 * that may create nothing on the database at all, so this file takes that right away from its own
 * role after the first boot and boots again.
 */

const EvalTrigramDataSource: ReturnType<typeof createTestDataSource> = createTestDataSource();

/**
 * The start of what the data source logs when it could not install the extension, up to the filter
 * that stops working.
 */
const COULD_NOT_INSTALL: string = 'Could not install the postgres extension "pg_trgm", so the "fuzzyLike" filter will not work';

/**
 * Runs a statement as the application's own role.
 * @param sql - The statement to run.
 */
async function runStatement(sql: string): Promise<void> {
    await inject(EvalTrigramDataSource).query(JwtUser).connection.query(sql);
}

/**
 * Whether pg_trgm is installed in the application's database.
 * @returns True if it is.
 */
async function isTrigramInstalled(): Promise<boolean> {
    const rows: unknown[] = await inject(EvalTrigramDataSource).query(JwtUser).connection.query(
        'SELECT 1 FROM pg_extension WHERE extname = \'pg_trgm\''
    );
    return rows.length > 0;
}

describe('evaluation/01-data-layer C4 - installing an extension is not a condition of booting', () => {
    let server: StartedTestServer;
    // on the class rather than on an instance: the extension is installed while the application
    // starts, before a test can reach the logger it starts with
    const warn: jest.SpiedFunction<Logger['warn']> = jest.spyOn(Logger.prototype, 'warn');

    beforeAll(async () => {
        server = await startTestServer({ dataSources: [EvalTrigramDataSource] });
        // an owner may take its own privileges away, which is the one way to arrive at this role
        // without a superuser. CREATE on the database is what installing a trusted extension needs
        await runStatement(`
            DO $$ BEGIN
                EXECUTE format('REVOKE CREATE ON DATABASE %I FROM CURRENT_USER', current_database());
            END $$
        `);
    }, 90000);

    afterAll(async () => {
        warn.mockRestore();
        await server?.shutdown();
    }, 30000);

    it('boots as a role that may not create extensions, when the extension is already there', async () => {
        // the data source issues CREATE EXTENSION IF NOT EXISTS without looking in pg_extension
        // first, so this is red if postgres asks for the right to create before it notices the
        // extension exists
        warn.mockClear();

        await server.reInit();

        expect(warn).not.toHaveBeenCalledWith(expect.stringContaining(COULD_NOT_INSTALL), expect.anything());
        expect(await isTrigramInstalled()).toBe(true);
    }, 60000);

    it('boots, and names the one filter that stops working, when the extension is missing and cannot be installed', async () => {
        // CASCADE, because the trigram indexes on the searchable columns are built with its operator
        // class. The role installed it on the first boot, so the role owns it and may drop it
        await runStatement('DROP EXTENSION pg_trgm CASCADE');
        warn.mockClear();

        // refusing to start here would take every feature down over one filter operator
        await server.reInit();

        expect(warn).toHaveBeenCalledWith(expect.stringContaining(COULD_NOT_INSTALL), expect.anything());
        // not vacuous: the boot went ahead without it rather than managing to install it after all
        expect(await isTrigramInstalled()).toBe(false);
    }, 60000);
});