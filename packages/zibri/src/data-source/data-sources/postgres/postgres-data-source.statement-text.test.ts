import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { PostgresDataSource } from './postgres-data-source.model';
import { TestTimeouts } from '../../../__testing__/constants';
import { queryPostgres } from '../../../__testing__/query-postgres.function';
import { createTestDataSource, defaultTestServerEntities, defaultTestServerRepositories } from '../../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { inject } from '../../../di/inject.function';
import { BaseEntity } from '../../../entity/base-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { Newable } from '../../../types/newable.type';

// What the data source writes into a statement as text reaches the server as it was written. A
// default is a literal inside the DDL, and the DDL used to be turned from `$1` placeholders into named
// ones and back by a regex, which took a `$1` in the text for a placeholder

@Entity({ tenant: 'shared', tableName: 'price_tag', allowOrphan: true })
class PriceTag extends BaseEntity {
    @Property.string()
    name!: string;

    @Property.string({ default: 'costs $1', required: false })
    label?: string;

    /**
     * A default that is a function of when the row is written, which a column cannot run.
     */
    @Property.date({ default: () => new Date(), required: false })
    printedAt?: Date;
}

const dataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [...defaultTestServerEntities, PriceTag],
    repositories: defaultTestServerRepositories
});

let server: StartedTestServer | undefined;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
}, TestTimeouts.postgres.start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.postgres.shutdown);

describe('the text of a statement the data source writes', () => {
    it('keeps a $1 inside a default as text', async () => {
        const [column] = await queryPostgres(
            inject(dataSourceClass),
            'SELECT column_default FROM information_schema.columns WHERE table_name = $1 AND column_name = $2',
            ['price_tag', 'label']
        );

        expect(String(column?.['column_default'])).toContain('\'costs $1\'');
    });

    // a constant default reaches the column, for the writes the application never runs. One that is a
    // function of the moment a row is written cannot, and declaring the moment the class was evaluated
    // instead would be a wrong answer looking like a right one
    it('leaves a default the column cannot hold to the application', async () => {
        const [column] = await queryPostgres(
            inject(dataSourceClass),
            'SELECT column_default FROM information_schema.columns WHERE table_name = $1 AND column_name = $2',
            ['price_tag', 'printedAt']
        );

        expect(column?.['column_default'] ?? undefined).toBeUndefined();
    });
});