import { afterAll, beforeAll } from 'vitest';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { Album, Artist, describeNestedRelations, Track } from './nested-relations.cases.ts';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { inject } from '../../di/inject.function.ts';
import { Newable } from '../../types/newable.type.ts';
import { Repository } from '../repository/repository.ts';

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({ entities: [...defaultTestServerEntities, Artist, Album, Track] });

let server: StartedTestServer | undefined;
let artists: Repository<Artist>;
let albums: Repository<Album>;
let tracks: Repository<Track>;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
    artists = inject(dataSourceClass).getRepository(Artist);
    albums = inject(dataSourceClass).getRepository(Album);
    tracks = inject(dataSourceClass).getRepository(Track);
}, 15000);

afterAll(async () => {
    await server?.shutdown();
});

describeNestedRelations('the in memory data source', () => artists, () => albums, () => tracks);