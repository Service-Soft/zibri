import { afterAll, beforeAll } from 'vitest';

import { describeRelationAllowList, Genre, Playlist, RelationAllowListRepositories, Track } from './relation-allow-list.cases.ts';
import { createTestDataSource, defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { createTestValKeyDataSource } from '../../__testing__/test-server/create-test-val-key-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { inject } from '../../di/inject.function.ts';
import { Newable } from '../../types/newable.type.ts';
import { PostgresDataSource } from '../data-sources/postgres/postgres-typeorm-data-source.model.ts';
import { ValKeyDataSource } from '../data-sources/val-key/val-key-data-source.model.ts';
import { MigrationEntity } from '../migration/migration-entity.model.ts';

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