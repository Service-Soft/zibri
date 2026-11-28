import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { TestTimeouts } from '../../__testing__/constants';
import { queryPostgres } from '../../__testing__/query-postgres.function';
import { createTestDataSource, defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { Newable } from '../../types/newable.type';
import { PostgresDataSource } from '../data-sources/postgres/postgres-data-source.model';
import { indexName } from '../index-name.function';
import { whereFor } from '../models/where/where-for.function';

/**
 * Belongs to a tenant and declares a unique over some of its rows, so that its table carries indices
 * of both kinds: the tenant's, which nothing declared starts with, and the declared one.
 */
@Entity({
    allowOrphan: true,
    uniques: [{ properties: ['label'], where: whereFor<TwiceListedNote>({ archived: false }) }]
})
class TwiceListedNote extends BaseEntity {
    @Property.string({ format: 'uuid' })
    tenantId!: string;

    @Property.string()
    label!: string;

    @Property.boolean()
    archived!: boolean;
}

let server: StartedTestServer;
let dataSource: PostgresDataSource;

// the same class twice, the way spreading the defaults and then naming one of them again lists it
const dataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [...defaultTestServerEntities, TwiceListedNote, TwiceListedNote],
    repositories: defaultTestServerRepositories
});

describe('an entity listed twice in one data source', () => {
    beforeAll(async () => {
        server = await startTestServer({ dataSources: [dataSourceClass] });
        dataSource = inject(dataSourceClass);
    }, TestTimeouts.postgres.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.postgres.shutdown);

    it('is one entity, with each of its indices created once', async () => {
        const rows: Record<string, unknown>[] = await queryPostgres(
            dataSource,
            'SELECT indexname FROM pg_indexes WHERE tablename = $1',
            ['twice_listed_note']
        );
        const names: string[] = rows.map(r => String(r['indexname']));

        expect(names.filter(n => n === indexName('twice_listed_note', ['tenantId']))).toHaveLength(1);
        expect(names.filter(n => n.startsWith('uq_twice_listed_note_'))).toHaveLength(1);
    });
});