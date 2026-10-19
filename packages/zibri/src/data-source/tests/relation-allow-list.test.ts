import { afterAll, beforeAll } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { describeRelationAllowList, Genre, Playlist, RelationAllowListRepositories, Track } from './relation-allow-list.cases';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';

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