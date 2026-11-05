import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { InMemoryDataSource, zibriFrameworkEntities } from 'zibri-testing';

import { Repository } from './repository';
import { RepositoryClass } from './repository-class.type';
import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { Newable } from '../../types/newable.type';
import { DataSource } from '../decorators/data-source.decorator';
import { UnboundedReturnError } from '../unbounded-return.error';

// the most rows a call without a limit hands back was
// 10,000 on every data source

/**
 * The most rows a call without a limit hands back on the data source below.
 */
const MAX_ROWS: number = 3;

@Entity({ tenant: 'shared' })
class Tag extends BaseEntity {
    @Property.string()
    name!: string;
}

/**
 * A data source that hands back few rows without a limit.
 */
@DataSource()
class FewRowsDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = [...new Set([...zibriFrameworkEntities, ...defaultTestServerEntities, Tag])];
    override readonly repositories: RepositoryClass[] = defaultTestServerRepositories;
    override readonly maxRowsWithoutLimit: number = MAX_ROWS;
}

describe('the most rows a data source hands back without a limit', () => {
    let server: StartedTestServer;
    let tags: Repository<Tag>;

    beforeAll(async () => {
        server = await startTestServer({ dataSources: [FewRowsDataSource] });
        tags = inject(repositoryTokenFor(Tag));
        await tags.createAll(Array.from({ length: MAX_ROWS + 1 }, (_, i) => ({ name: `tag ${i}` })));
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('refuses a read without a limit past it, and hands back every row with `limit: \'all\'`', async () => {
        await expect(tags.findAll()).rejects.toThrow(`matched more than ${MAX_ROWS} rows`);
        expect(await tags.findAll({ limit: 'all' })).toHaveLength(MAX_ROWS + 1);
    });

    it('refuses an update and a delete handing back more rows than it, and writes none of them', async () => {
        await expect(tags.updateAll({}, { name: 'renamed' }, { returnUpdated: true })).rejects.toThrow(UnboundedReturnError);
        await expect(tags.deleteAll({}, { returnDeleted: true })).rejects.toThrow(UnboundedReturnError);

        expect(await tags.count({ where: { name: 'renamed' } })).toBe(0);
        expect(await tags.count()).toBe(MAX_ROWS + 1);
    });
});