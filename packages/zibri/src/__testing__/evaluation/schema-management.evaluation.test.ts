import { describe, expect, it } from '@jest/globals';

import { PostgresDataSource, PostgresOptions } from '../../data-source/data-sources/postgres/postgres-typeorm-data-source.model';
import { DataSource } from '../../data-source/decorators/data-source.decorator';
import { SchemaManagement } from '../../data-source/models/schema-management.model';
import { BaseEntity } from '../../entity/base-entity.model';
import { Newable } from '../../types/newable.type';
import { OmitStrict } from '../../types/omit-strict.type';
import { defaultTestServerEntities } from '../test-server/create-test-data-source.function';
import { startTestServer } from '../test-server/start-test-server.function';

/**
 * Executable form of evaluation/01-data-layer.md C1.
 *
 * A file of its own, and it has to be. `@DataSource` registers into the static GlobalRegistry when
 * the decorator runs and nothing takes it back out ([05 D10](../../../../evaluation/05-di-metadata-and-packaging.md)),
 * so a test that declares a data source it never boots leaves it visible to every test declared after
 * it in the same file. `bootstrap.evaluation.test.ts` already spends its one allowance on D10, which
 * is why that one is kept last there. Jest gives every file its own module registry, so the cheapest
 * way to have a second is a second file.
 *
 * The finding itself was `synchronize` being opt *out*: a data source that never mentioned it, and
 * shipped no migrations, still got TypeORM's ALTER/DROP on every boot - which is how a renamed
 * property drops a column, and its data, on the next deploy. Saying who manages the schema is now
 * required, so the case that could only be caught at compile time is caught there. What is left to
 * assert at runtime is the contradiction: naming migrations as the owner and then having none.
 */

describe('evaluation/01-data-layer C1 - schema management must be stated, not assumed', () => {

    it('refuses to boot a data source that names migrations as its schema owner and has none', async () => {
        @DataSource()
        class EvalUnmanagedDataSource extends PostgresDataSource {

            override options: OmitStrict<PostgresOptions, 'type' | 'entities'> = {
                host: 'localhost',
                username: 'postgres',
                password: 'password',
                database: 'db',
                ssl: false
            };

            entities: Newable<BaseEntity>[] = defaultTestServerEntities;

            schemaManagement: SchemaManagement = 'migrations';
        }

        // nothing would ever create a table, so the first query would be where anybody found out.
        // `external` is the value that says an empty migration list is deliberate
        await expect(startTestServer({ dataSources: [EvalUnmanagedDataSource] }))
            .rejects.toThrow(/no migrations/);
    }, 90000);
});