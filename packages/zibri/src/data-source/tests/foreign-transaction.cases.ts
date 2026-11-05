import { describe, expect, it } from '@jest/globals';

import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { DataSourceInterface } from '../data-sources/data-source.interface';
import { MigrationEntity } from '../migration/migration-entity.model';
import { Repository } from '../repository/repository';
import { Transaction } from '../transaction/transaction.model';

/**
 * Two data sources of one kind, and the repository of the same entity in each.
 */
export type ForeignTransactionPair = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    first: DataSourceInterface,
    // eslint-disable-next-line jsdoc/require-jsdoc
    firstRepository: Repository<MigrationEntity>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    second: DataSourceInterface,
    // eslint-disable-next-line jsdoc/require-jsdoc
    secondRepository: Repository<MigrationEntity>
};

/**
 * A row of the entity, named so the cases can find it.
 * @param name - The name.
 * @returns The row.
 */
function migration(name: string): Pick<MigrationEntity, 'name' | 'version' | 'ranAt'> {
    return { name, version: '1.0.0', ranAt: new Date() };
}

/**
 * The cases of a transaction handed to a repository of a data source that did not start it.
 * @param dataSourceName - The kind of data source, as the cases name it.
 * @param pairOf - The two data sources and their repositories.
 */
export function describeForeignTransaction(dataSourceName: string, pairOf: () => ForeignTransactionPair): void {
    describe(`a transaction handed to another data source, on ${dataSourceName}`, () => {
        it('is refused by a write, and the row lands in neither data source', async () => {
            const { first, firstRepository, secondRepository } = pairOf();
            const name: string = `foreign-${UUIDUtilities.generate()}`;
            const transaction: Transaction = await first.startTransaction();

            try {
                await expect(secondRepository.create(migration(name), { transaction })).rejects.toThrow(/did not start/);
            }
            finally {
                await transaction.commit();
            }

            expect(await secondRepository.findOne({ where: { name }, required: false })).toBeUndefined();
            expect(await firstRepository.findOne({ where: { name }, required: false })).toBeUndefined();
        });

        it('is refused by a read, which would otherwise read the rows of the data source that started it', async () => {
            const { first, firstRepository, secondRepository } = pairOf();
            const name: string = `foreign-${UUIDUtilities.generate()}`;
            await firstRepository.create(migration(name));
            const transaction: Transaction = await first.startTransaction();

            try {
                await expect(secondRepository.findOne({ where: { name }, transaction, required: false })).rejects.toThrow(/did not start/);
            }
            finally {
                await transaction.rollback();
                await firstRepository.deleteAll({ name });
            }
        });

        it('is taken by the data source that started it', async () => {
            const { second, secondRepository } = pairOf();
            const name: string = `own-${UUIDUtilities.generate()}`;
            const transaction: Transaction = await second.startTransaction();

            await secondRepository.create(migration(name), { transaction });
            await transaction.commit();

            expect(await secondRepository.findOne({ where: { name } })).toMatchObject({ name });
            await secondRepository.deleteAll({ name });
        });
    });
}