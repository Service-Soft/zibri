import { beforeAll, afterAll, describe, it, expect } from '@jest/globals';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';

import { DataSource } from './decorators';
import { inject } from '../di';
import { PostgresDataSource, PostgresOptions } from './data-sources';
import { MigrationEntity } from './migration';
import { POSTGRES_TEST_IMAGE } from '../__testing__';
import { BaseEntity } from '../entity/base-entity.model';
import { Newable, OmitStrict } from '../types';
import { Repository } from './repository';
import { Entity, Property } from '../entity';

@Entity()
class VisitStats extends BaseEntity {
    @Property.number()
    count!: number;

    @Property.number()
    countFirstVisit!: number;

    @Property.string()
    targetSite!: string;

    @Property.string({ required: false })
    referrer: string | undefined;

    @Property.string()
    domain!: string;

    @Property.date()
    date!: Date;
}

@DataSource()
class TestDataSource extends PostgresDataSource {
    options: PostgresOptions = {
        host: 'localhost',
        username: 'postgres',
        password: 'password',
        database: 'db',
        synchronize: true
    };
    entities: Newable<BaseEntity>[] = [MigrationEntity, VisitStats];
}

describe('repository', () => {
    let container: StartedPostgreSqlContainer;
    let ds: TestDataSource;

    beforeAll(async () => {
        container = await new PostgreSqlContainer(POSTGRES_TEST_IMAGE)
            .withDatabase('db')
            .withUsername('postgres')
            .withPassword('password')
            .start();
        ds = inject(TestDataSource);
        ds.options = {
            ...ds.options,
            port: container.getMappedPort(5432)
        };
        await ds.init();
    }, 20000);

    afterAll(async () => {
        await container.stop();
    });

    it('create', async () => {
        const repo: Repository<VisitStats> = ds.getRepository(VisitStats);
        const visitStats: OmitStrict<VisitStats, 'id'> = {
            count: 1,
            countFirstVisit: 0,
            targetSite: '/test',
            referrer: 'google.de',
            date: new Date(),
            domain: 'localhost'
        };
        await repo.create(visitStats);
        expect((await repo.findAll()).length).toBe(1);
    });
});