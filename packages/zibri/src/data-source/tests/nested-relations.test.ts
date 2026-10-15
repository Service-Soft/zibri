import { afterAll, beforeAll } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { Album, Artist, describeNestedRelations, Track } from './nested-relations.cases';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';
import { Repository } from '../repository/repository';

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