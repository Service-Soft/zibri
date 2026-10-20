import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PostgresDataSource } from './data-sources/postgres/postgres-typeorm-data-source.model.ts';
import { ValKeyDataSource } from './data-sources/val-key/val-key-data-source.model.ts';
import { MigrationEntity } from './migration/migration-entity.model.ts';
import { Repository } from './repository/repository.ts';
import { createTestDataSource, defaultTestServerEntities } from '../__testing__/test-server/create-test-data-source.function.ts';
import { createTestValKeyDataSource } from '../__testing__/test-server/create-test-val-key-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function.ts';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator.ts';
import { inject } from '../di/inject.function.ts';
import { BaseEntity } from '../entity/base-entity.model.ts';
import { Entity } from '../entity/decorators/entity.decorator.ts';
import { Property } from '../entity/decorators/property.decorator.ts';
import { Newable } from '../types/newable.type.ts';

/**
 * Lives in both data sources on purpose, eg. Postgres owns it and valkey caches it.
 */
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
class SharedSession extends BaseEntity {
    @Property.string()
    token!: string;
}

/**
 * Only ever part of the postgres data source.
 */
@Entity({ tenant: 'shared', allowOrphan: true })
class PostgresOnlyItem extends BaseEntity {
    @Property.string()
    value!: string;
}

/**
 * Ends up in two data sources without allowing it, which an app must not start with.
 */
@Entity({ tenant: 'shared', allowOrphan: true })
class AccidentallySharedItem extends BaseEntity {
    @Property.string()
    value!: string;
}

const postgresDataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [...defaultTestServerEntities, SharedSession, PostgresOnlyItem]
});

const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource({
    entities: [MigrationEntity, SharedSession]
});

describe('entity ownership', () => {
    let server: StartedTestServer;

    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [postgresDataSourceClass, valKeyDataSourceClass]
        });
    }, 30000);

    afterAll(async () => {
        await server.shutdown();
    }, 15000);

    it('resolves an entity of a single data source without naming it', () => {
        const repository: Repository<PostgresOnlyItem> = inject(repositoryTokenFor(PostgresOnlyItem));

        expect(repository.dataSource).toBe(inject(postgresDataSourceClass));
        // naming the data source explicitly has to give the very same repository
        expect(inject(repositoryTokenFor(PostgresOnlyItem, postgresDataSourceClass))).toBe(repository);
    });

    it('resolves a duplicated entity per data source', () => {
        const fromPostgres: Repository<SharedSession> = inject(repositoryTokenFor(SharedSession, postgresDataSourceClass));
        const fromValKey: Repository<SharedSession> = inject(repositoryTokenFor(SharedSession, valKeyDataSourceClass));

        expect(fromPostgres).not.toBe(fromValKey);
        expect(fromPostgres.dataSource).toBe(inject(postgresDataSourceClass));
        expect(fromValKey.dataSource).toBe(inject(valKeyDataSourceClass));
    });

    it('keeps the data of a duplicated entity in the data source it was written to', async () => {
        const fromPostgres: Repository<SharedSession> = inject(repositoryTokenFor(SharedSession, postgresDataSourceClass));
        const fromValKey: Repository<SharedSession> = inject(repositoryTokenFor(SharedSession, valKeyDataSourceClass));

        await fromPostgres.create({ token: 'in-postgres' });

        expect((await fromPostgres.findAll()).map(s => s.token)).toEqual(['in-postgres']);
        expect(await fromValKey.findAll()).toEqual([]);

        await fromValKey.create({ token: 'in-valkey' });

        expect((await fromValKey.findAll()).map(s => s.token)).toEqual(['in-valkey']);
        expect((await fromPostgres.findAll()).map(s => s.token)).toEqual(['in-postgres']);

        await fromPostgres.deleteAll({});
        await fromValKey.deleteAll({});
    });

    it('throws with guidance when a duplicated entity is injected without a data source', () => {
        expect(() => inject(repositoryTokenFor(SharedSession)))
            .toThrow(/is part of multiple data sources/);
        expect(() => inject(repositoryTokenFor(SharedSession)))
            .toThrow(/@InjectRepository\(SharedSession, /);
    });

    it('runs the migrations of each data source against its own migration entity', () => {
        const fromPostgres: Repository<MigrationEntity> = inject(repositoryTokenFor(MigrationEntity, postgresDataSourceClass));
        const fromValKey: Repository<MigrationEntity> = inject(repositoryTokenFor(MigrationEntity, valKeyDataSourceClass));

        expect(fromPostgres.dataSource).toBe(inject(postgresDataSourceClass));
        expect(fromValKey.dataSource).toBe(inject(valKeyDataSourceClass));
    });

    // has to stay the last test of this block: the app is expected to fail while it initializes,
    // which leaves the test server without a usable app for anything after it
    it('refuses to start when an entity is part of multiple data sources without allowing it', async () => {
        await expect(server.reInit({
            dataSources: [
                createTestDataSource({ entities: [...defaultTestServerEntities, AccidentallySharedItem] }),
                createTestValKeyDataSource({ entities: [MigrationEntity, AccidentallySharedItem] })
            ]
        })).rejects.toThrow(/"AccidentallySharedItem" is part of multiple data sources/);
    }, 15000);
});