import { beforeEach, describe, expect, it } from '@jest/globals';

import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { Repository } from '../repository/repository';

/**
 * The cases every data source answers the same way about reading one row without a filter: the row,
 * when the table holds one, and nothing when it holds none. A file per data source runs them against
 * a repository of its own.
 */

/**
 * A table holding at most one row, the way a single row of settings or progress is kept.
 */
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class SingleRow extends BaseEntity {
    /**
     * What the row holds.
     */
    @Property.string()
    value!: string;
}

/**
 * Runs every case against the rows of one data source.
 * @param dataSourceName - The data source, for the name of the cases.
 * @param repositoryOf - Reads the repository, once the data source is started.
 */
export function describeUnfilteredFindOne(dataSourceName: string, repositoryOf: () => Repository<SingleRow>): void {
    describe(`reading one row without a filter, on ${dataSourceName}`, () => {
        beforeEach(async () => {
            await repositoryOf().deleteAll({});
        });

        it('finds the row the table holds', async () => {
            await repositoryOf().create({ value: 'the only one' });

            await expect(repositoryOf().findOne({ required: false })).resolves.toMatchObject({ value: 'the only one' });
        });

        it('finds nothing in a table holding nothing', async () => {
            await expect(repositoryOf().findOne({ required: false })).resolves.toBeUndefined();
        });
    });
}