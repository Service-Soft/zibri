import { afterAll, beforeAll, describe, expect, it, vi, MockInstance } from 'vitest';

import { PostgresDataSource, PostgresOptions } from './postgres-typeorm-data-source.model.ts';
import { defaultTestServerEntities } from '../../../__testing__/test-server/create-test-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function.ts';
import { BaseEntity } from '../../../entity/base-entity.model.ts';
import { Logger } from '../../../logging/logger.ts';
import { Newable } from '../../../types/newable.type.ts';
import { OmitStrict } from '../../../types/omit-strict.type.ts';
import { DataSource } from '../../decorators/data-source.decorator.ts';
import { SchemaManagement } from '../../models/schema-management.model.ts';

/**
 * The database a data source built now connects to.
 *
 * Read when the data source is built rather than when its class is, so that a re-init after this
 * changed connects somewhere else on the same server.
 */
let databaseName: string = 'db';

/**
 * A database whose character type counts only ascii as a letter.
 */
const ASCII_ONLY_DATABASE: string = 'ascii_only_words';

/**
 * The start of what the data source logs about such a database.
 */
const ASCII_ONLY: string = 'which counts only ascii as a letter';

@DataSource()
class CharacterTypeDataSource extends PostgresDataSource {
    override options: OmitStrict<PostgresOptions, 'type' | 'entities'> = {
        host: 'localhost',
        username: 'postgres',
        password: 'password',
        database: databaseName,
        ssl: false
    };

    entities: Newable<BaseEntity>[] = defaultTestServerEntities;

    schemaManagement: SchemaManagement = 'synchronize';
}

describe('a database that counts only ascii as a letter', () => {
    let server: StartedTestServer;
    // on the class rather than on an instance: the warning is written while the application starts,
    // before a test can reach the logger it starts with
    const warn: MockInstance<Logger['warn']> = vi.spyOn(Logger.prototype, 'warn');

    beforeAll(async () => {
        server = await startTestServer({ dataSources: [CharacterTypeDataSource] });
        // from template0, which is the template a database of another character type has to come
        // from. Owned by the application's role, which is what lets it install the trigram extension
        await server.runAsSuperuser(CharacterTypeDataSource, [
            `CREATE DATABASE ${ASCII_ONLY_DATABASE} OWNER postgres TEMPLATE template0 ENCODING 'UTF8'`
            // cspell:disable-next-line
            + ' LOCALE_PROVIDER libc LC_COLLATE \'C\' LC_CTYPE \'C\''
        ]);
    }, 90000);

    afterAll(async () => {
        warn.mockRestore();
        await server?.shutdown();
    }, 30000);

    it('boots without a warning on a database of a unicode character type', () => {
        // the first boot ran on the image's own database, which is en_US.utf8
        expect(warn).not.toHaveBeenCalledWith(expect.stringContaining(ASCII_ONLY));
    });

    it('boots, and says so, on a database whose character type is C', async () => {
        databaseName = ASCII_ONLY_DATABASE;
        warn.mockClear();

        await server.reInit();

        expect(warn).toHaveBeenCalledWith(expect.stringContaining(ASCII_ONLY));
    }, 60000);
});