import { afterAll, beforeAll } from 'vitest';
import { createInMemoryDataSource, InMemoryDataSource, InMemoryStore, inMemoryStoreFor, StoredRow } from 'zibri-testing';

import { describeMistypedColumnValues, describeMistypedValues, Gauge, MistypedValueFixture } from './mistyped-values.cases.ts';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { inject } from '../../di/inject.function.ts';
import { Newable } from '../../types/newable.type.ts';

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
    entities: [...defaultTestServerEntities, Gauge]
});

let server: StartedTestServer | undefined;
let fixture: MistypedValueFixture;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
    const store: InMemoryStore = inMemoryStoreFor(dataSourceClass);
    fixture = {
        repository: inject(dataSourceClass).getRepository(Gauge),
        overwrite: (id, column, json) => {
            const row: StoredRow | undefined = store.readRow('gauge', id);
            store.writeRow('gauge', id, { ...row, [column]: json });
            return Promise.resolve();
        }
    };
}, 15000);

afterAll(async () => {
    await server?.shutdown();
});

describeMistypedValues('the in memory data source', () => fixture);

describeMistypedColumnValues('the in memory data source', () => fixture);