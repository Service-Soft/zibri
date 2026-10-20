import { afterAll, beforeAll } from 'vitest';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { describeRelationAllowList, Genre, Playlist, RelationAllowListRepositories, Track } from './relation-allow-list.cases.ts';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { inject } from '../../di/inject.function.ts';
import { Newable } from '../../types/newable.type.ts';

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
    entities: [...defaultTestServerEntities, Playlist, Track, Genre]
});

let server: StartedTestServer | undefined;
let repositories: RelationAllowListRepositories;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
    const dataSource: InMemoryDataSource = inject(dataSourceClass);
    repositories = { playlists: dataSource.getRepository(Playlist), genres: dataSource.getRepository(Genre) };
}, 15000);

afterAll(async () => {
    await server?.shutdown();
});

describeRelationAllowList('the in memory data source', () => repositories);