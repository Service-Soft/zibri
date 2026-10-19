import { afterAll, beforeAll } from '@jest/globals';

import { describeRelationAllowList, Genre, Playlist, RelationAllowListRepositories, Track } from './relation-allow-list.cases';
import { createTestDataSource, defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
import { createTestValKeyDataSource } from '../../__testing__/test-server/create-test-val-key-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';
import { PostgresDataSource } from '../data-sources/postgres/postgres-typeorm-data-source.model';
import { ValKeyDataSource } from '../data-sources/val-key/val-key-data-source.model';
import { MigrationEntity } from '../migration/migration-entity.model';

const postgresDataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [...defaultTestServerEntities, Playlist, Track, Genre]
});

const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource({
    entities: [MigrationEntity, Playlist, Track, Genre]
});

let server: StartedTestServer | undefined;
let postgres: RelationAllowListRepositories;
let valKey: RelationAllowListRepositories;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [postgresDataSourceClass, valKeyDataSourceClass] });
    const postgresDataSource: PostgresDataSource = inject(postgresDataSourceClass);
    const valKeyDataSource: ValKeyDataSource = inject(valKeyDataSourceClass);
    postgres = { playlists: postgresDataSource.getRepository(Playlist), genres: postgresDataSource.getRepository(Genre) };
    valKey = { playlists: valKeyDataSource.getRepository(Playlist), genres: valKeyDataSource.getRepository(Genre) };
}, 30000);

afterAll(async () => {
    await server?.shutdown();
}, 30000);

describeRelationAllowList('postgres', () => postgres);

describeRelationAllowList('valkey', () => valKey);