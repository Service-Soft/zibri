/* eslint-disable unicorn/no-null */
import { beforeEach, describe, expect, it } from '@jest/globals';

import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { Repository } from '../repository/repository';
import { UniqueConstraintViolationError } from '../unique-constraint-violation.error';

/**
 * The cases every data source answers the same way about a unique property that may hold no value: a
 * row holding none takes nothing up, so any number of them are stored side by side. A file per data
 * source runs them against a repository of its own.
 */

/**
 * A row whose code, when it has one, no other row holds.
 */
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true, uniques: [['label', 'variant']] })
export class OptionalCode extends BaseEntity {
    /**
     * The code, which a row may have none of.
     */
    @Property.string({ unique: true, required: false })
    code?: string | null;

    /**
     * A label, unique together with the variant.
     */
    @Property.string({ required: false })
    label?: string | null;

    /**
     * A variant, which a row may have none of.
     */
    @Property.string({ required: false })
    variant?: string | null;
}

/**
 * Runs every case against the rows of one data source.
 * @param dataSourceName - The data source, for the name of the cases.
 * @param repositoryOf - Reads the repository, once the data source is started.
 */
export function describeNullableUnique(dataSourceName: string, repositoryOf: () => Repository<OptionalCode>): void {
    describe(`a unique property that may hold no value, on ${dataSourceName}`, () => {
        beforeEach(async () => {
            await repositoryOf().deleteAll({});
        });

        it('stores any number of rows holding no value for it', async () => {
            await repositoryOf().createAll([{ code: null }, { code: null }]);
            await repositoryOf().create({});

            expect(await repositoryOf().count({ where: { code: null } })).toBe(3);
        });

        it('stores rows holding a value for only part of a unique group', async () => {
            await repositoryOf().createAll([{ label: 'a', variant: null }, { label: 'a', variant: null }]);
            await repositoryOf().create({ label: 'a', variant: null });

            expect(await repositoryOf().count({ where: { variant: null } })).toBe(3);
        });

        it('still refuses a value another row holds', async () => {
            await repositoryOf().create({ code: 'a' });

            await expect(repositoryOf().create({ code: 'a' })).rejects.toThrow(UniqueConstraintViolationError);
        });
    });
}