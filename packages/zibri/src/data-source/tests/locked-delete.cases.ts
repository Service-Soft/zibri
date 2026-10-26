/* eslint-disable jsdoc/require-jsdoc */
import { describe, expect, it } from '@jest/globals';

import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { ConflictError } from '../../error-handling/errors/conflict.error';
import { NotFoundError } from '../../error-handling/errors/not-found.error';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { SoftDeleteEntity } from '../change-sets/models/soft-delete-entity.model';
import { SoftDeleteRepository } from '../change-sets/soft-delete-repository';
import { Repository } from '../repository/repository';

/**
 * The cases every data source answers the same way about deleting a row on a condition, and a row
 * whose entity declares `optimisticLocking`. A file per data source runs them against repositories of
 * its own.
 */

@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class LockedCompany extends BaseEntity {
    @Property.string({ optimisticLocking: true })
    name!: string;

    /**
     * Groups the companies of one case, so the cases do not delete each other's rows.
     */
    @Property.string({ format: 'uuid' })
    tag!: string;

    @Property.oneToMany({ target: () => LockedOffice, inverseSide: 'company' })
    offices!: LockedOffice[];
}

@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class LockedOffice extends BaseEntity {
    // locked as well, which a delete taking it along with its company does not ask about
    @Property.string({ optimisticLocking: true })
    city!: string;

    @Property.manyToOne({ target: () => LockedCompany, joinColumn: 'companyId', inverseSide: 'offices' })
    company!: LockedCompany;

    @Property.string({ format: 'uuid' })
    companyId!: string;
}

@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class LockedArchive extends SoftDeleteEntity {
    @Property.string({ optimisticLocking: true })
    name!: string;
}

export const lockedDeleteEntities: (typeof LockedCompany | typeof LockedOffice | typeof LockedArchive)[] = [
    LockedCompany,
    LockedOffice,
    LockedArchive
];

/**
 * The repositories of one data source.
 */
export type LockedDeleteRepositories = {
    companies: Repository<LockedCompany>,
    offices: Repository<LockedOffice>,
    archives: SoftDeleteRepository<LockedArchive>
};

/**
 * Runs every case against the repositories of one data source.
 * @param dataSourceName - The data source, for the name of the cases.
 * @param reposOf - Reads the repositories, once the data source is started.
 */
export function describeLockedDelete(dataSourceName: string, reposOf: () => LockedDeleteRepositories): void {
    // 01 §D13: a delete took no condition and no relations, and a locked property stopped nothing on it
    describe(`a delete on a condition, and of a row with a locked property, on ${dataSourceName}`, () => {
        it('deletes the row only while the condition holds, and answers a stale one with a conflict', async () => {
            const company: LockedCompany = await reposOf().companies.create({ name: 'Acme', tag: UUIDUtilities.generate() });

            await expect(reposOf().companies.deleteById(company.id, { where: { name: 'Acme Inc' } })).rejects.toThrow(ConflictError);
            expect((await reposOf().companies.findById(company.id)).name).toBe('Acme');

            await reposOf().companies.deleteById(company.id, { where: { name: 'Acme' } });
            expect(await reposOf().companies.findById(company.id, { required: false })).toBeUndefined();
        });

        it('answers a row that is not there as missing, whatever the condition', async () => {
            await expect(reposOf().companies.deleteById(UUIDUtilities.generate(), { where: { name: 'Acme' } })).rejects.toThrow(NotFoundError);
        });

        it('refuses a delete that does not say what the locked property was, and deletes regardless when told to', async () => {
            const tag: string = UUIDUtilities.generate();
            const company: LockedCompany = await reposOf().companies.create({ name: 'Acme', tag });

            await expect(reposOf().companies.deleteById(company.id)).rejects.toThrow(/LockedCompany\.name declares optimistic locking/);
            await expect(reposOf().companies.deleteAll({ tag })).rejects.toThrow(/LockedCompany\.name declares optimistic locking/);
            expect(await reposOf().companies.count({ where: { tag } })).toBe(1);

            expect(await reposOf().companies.deleteAll({ tag, name: undefined })).toBe(1);
        });

        it('hands back the relations asked for of the row it deleted', async () => {
            const company: LockedCompany = await reposOf().companies.create({
                name: 'Acme',
                tag: UUIDUtilities.generate(),
                offices: [{ city: 'Berlin' }, { city: 'Paris' }]
            });

            const deleted: LockedCompany = await reposOf().companies.deleteById(company.id, { where: { name: undefined }, relations: ['offices'] });

            expect(deleted.offices.map(o => o.city).sort()).toEqual(['Berlin', 'Paris']);
        });

        it('deletes the locked rows of a relation along with their owner, and when a save leaves them out', async () => {
            const tag: string = UUIDUtilities.generate();
            const [left, deleted] = await reposOf().companies.createAll([
                { name: 'Left', tag, offices: [{ city: 'Berlin' }] },
                { name: 'Deleted', tag, offices: [{ city: 'Paris' }] }
            ]);

            await reposOf().companies.updateById(left?.id ?? '', { offices: [] });
            await reposOf().companies.deleteById(deleted?.id ?? '', { where: { name: 'Deleted' } });

            expect(await reposOf().offices.count({ where: { companyId: { oneOf: [left?.id ?? '', deleted?.id ?? ''] } } })).toBe(0);
        });

        it('soft deletes a row with a locked property only when told what it was, and while it still is', async () => {
            const archive: LockedArchive = await reposOf().archives.create({ name: '2024' });

            await expect(reposOf().archives.deleteById(archive.id)).rejects.toThrow(/LockedArchive\.name declares optimistic locking/);
            await expect(reposOf().archives.deleteById(archive.id, { where: { name: '2023' } })).rejects.toThrow(ConflictError);
            await reposOf().archives.deleteById(archive.id, { where: { name: '2024' } });

            expect((await reposOf().archives.findById(archive.id, { deleted: 'include' })).deleted).toBe(true);
        });
    });
}
