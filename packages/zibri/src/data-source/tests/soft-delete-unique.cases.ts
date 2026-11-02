import { describe, expect, it } from '@jest/globals';

import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { SoftDeleteEntity } from '../change-sets/models/soft-delete-entity.model';
import { SoftDeleteRepository } from '../change-sets/soft-delete-repository';
import { whereFor } from '../models/where/where-for.function';
import { UniqueConstraintViolationError } from '../unique-constraint-violation.error';

/**
 * The cases every data source answers the same way about a key held by the live rows of an entity
 * that soft deletes. A file per data source runs them against repositories of its own.
 */

/**
 * An address unique among the live rows: a plain key would keep a soft deleted row holding it
 * forever, so a user could never register again with an address they once deleted.
 */
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class LiveAccount extends SoftDeleteEntity {
    /**
     * The address, unique among the live rows.
     */
    @Property.string({ unique: { where: whereFor<LiveAccount>({ deleted: false }) } })
    email!: string;
}

/**
 * The same where no column is unique on its own: one address per group, among live rows.
 */
@Entity({
    tenant: 'shared',
    allowOrphan: true,
    allowDuplicate: true,
    uniques: [{ properties: ['group', 'email'], where: whereFor<LiveMember>({ deleted: false }) }]
})
export class LiveMember extends SoftDeleteEntity {
    /**
     * The group the member belongs to.
     */
    @Property.string()
    group!: string;

    /**
     * The address, unique within its group among the live rows.
     */
    @Property.string()
    email!: string;
}

/**
 * What the data source a runner hands the cases has to hold.
 */
export const softDeleteUniqueEntities: (typeof LiveAccount | typeof LiveMember)[] = [LiveAccount, LiveMember];

/**
 * The repositories of one data source.
 */
export type SoftDeleteUniqueRepositories = {
    /**
     * The accounts.
     */
    accounts: SoftDeleteRepository<LiveAccount>,
    /**
     * The members.
     */
    members: SoftDeleteRepository<LiveMember>
};

/**
 * Runs every case against the repositories of one data source.
 * @param dataSourceName - The data source, for the name of the cases.
 * @param reposOf - Reads the repositories, once the data source is started.
 */
export function describeSoftDeleteUnique(dataSourceName: string, reposOf: () => SoftDeleteUniqueRepositories): void {
    describe(`a key held by the live rows of an entity that soft deletes, on ${dataSourceName}`, () => {
        it('lets a value be used again once the row holding it was soft deleted', async () => {
            const email: string = `${UUIDUtilities.generate()}@example.com`;
            const created: LiveAccount = await reposOf().accounts.create({ email });
            await reposOf().accounts.deleteById(created.id);

            await expect(reposOf().accounts.create({ email })).resolves.toBeDefined();
        });

        // narrowing which rows a key covers is not dropping it, which a fix only making the case above
        // pass would do
        it('still refuses two live rows holding the same value', async () => {
            const email: string = `${UUIDUtilities.generate()}@example.com`;
            await reposOf().accounts.create({ email });

            await expect(reposOf().accounts.create({ email })).rejects.toThrow(UniqueConstraintViolationError);
        });

        it('applies the same to a group declared on the entity', async () => {
            const email: string = `${UUIDUtilities.generate()}@example.com`;
            const created: LiveMember = await reposOf().members.create({ group: 'a', email });

            // another group is a different row of the key, deleted or not
            await expect(reposOf().members.create({ group: 'b', email })).resolves.toBeDefined();
            await expect(reposOf().members.create({ group: 'a', email })).rejects.toThrow(UniqueConstraintViolationError);

            await reposOf().members.deleteById(created.id);
            await expect(reposOf().members.create({ group: 'a', email })).resolves.toBeDefined();
        });
    });
}