import { beforeAll, afterAll, describe, it, expect } from '@jest/globals';

import { Repository } from './repository';
import { createTestDataSource, defaultTestServerEntities } from '../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { inject } from '../di/inject.function';
import { BaseEntity } from '../entity/base-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { OmitStrict } from '../types/omit-strict.type';

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

describe('repository', () => {
    let server: StartedTestServer;

    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [createTestDataSource({ entities: [...defaultTestServerEntities, VisitStats] })]
        });
    }, 15000);

    afterAll(async () => {
        await server?.shutdown();
    });

    it('create', async () => {
        const repo: Repository<VisitStats> = inject(repositoryTokenFor(VisitStats));
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