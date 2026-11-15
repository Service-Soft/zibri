import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { MeasuredRowStore } from './measured-row-store.model';
import { MeasuredRow } from './measured-row.model';
import { ChangeProfile, SeededFingerprint, SeededTable } from './seeded-table.model';
import { DataSourceInterface } from '../../../data-source/data-sources/data-source.interface';
import { Repository } from '../../../data-source/repository/repository';
import { inject } from '../../../di/inject.function';
import { Newable } from '../../../types/newable.type';
import { TestTimeouts } from '../../constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../test-server/start-test-server.function';

// the backup measurements compare a restored data source with the table it was filled from. Its rows
// were once stored under ids of the table, which a create replaces with ids of its own: deleting the
// changed rows by those ids then deleted nothing, and every restore of a data source looked wrong

const CHANGES: ChangeProfile = { updatedShare: 0.05, deletedShare: 0.03, insertedShare: 0.05, movedShare: 0.05 };

const dataSourceClass: Newable<DataSourceInterface> = createInMemoryDataSource({
    entities: [...defaultTestServerEntities, MeasuredRow],
    repositories: defaultTestServerRepositories
});

let server: StartedTestServer | undefined;
let repository: Repository<MeasuredRow>;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
    repository = inject(dataSourceClass).getRepository(MeasuredRow);
}, TestTimeouts.inMemory.start);

beforeEach(async () => {
    await repository.deleteAll({});
});

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.inMemory.shutdown);

describe('MeasuredRowStore', () => {
    it('keeps a data source holding what its table holds, through every change', async () => {
        const table: SeededTable = new SeededTable(3, 2 * 1024 * 1024, CHANGES.insertedShare * 3);
        const store: MeasuredRowStore = new MeasuredRowStore(repository);
        await store.writeRows(table.resolveRows());
        const before: SeededFingerprint = table.resolveFingerprint();
        expect(await store.resolveFingerprint()).toEqual(before);

        for (const round of [1, 2, 3]) {
            await store.applyChanges(table.applyChanges(CHANGES, round));
        }

        const after: SeededFingerprint = table.resolveFingerprint();
        // the changes changed something, or the comparison below would say nothing
        expect(after).not.toEqual(before);
        expect(await store.resolveFingerprint()).toEqual(after);
    }, 60000);

    // the rows are read by the ids the store knows of, which a row it does not know of has none of
    it('tells a data source holding a row more than its table apart from it', async () => {
        const table: SeededTable = new SeededTable(5, 64 * 1024, 0);
        const store: MeasuredRowStore = new MeasuredRowStore(repository);
        await store.writeRows(table.resolveRows());

        await repository.create({ rowId: 1_000_000, version: 1, text: 'not of the table' });

        expect(await store.resolveFingerprint()).not.toEqual(table.resolveFingerprint());
    });
});