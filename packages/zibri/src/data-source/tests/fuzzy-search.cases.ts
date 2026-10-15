import { describe, expect, it } from '@jest/globals';

import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { Repository } from '../repository/repository';

/**
 * The cases every data source answers the same way about searching for something similar. A file per
 * data source runs them against a repository of its own.
 *
 * A similarity is the one filter whose cost is invisible from the outside: the same rows come back
 * whether an index answered it or the whole table was read. So what these pin is the other half -
 * which properties a search is accepted for at all - together with the rows it returns, which have to
 * be the same wherever the search ran.
 */

/**
 * What a contact is filed under, which is one of a fixed set.
 */
export enum ContactKind {
    PERSON = 'person',
    COMPANY = 'company'
}

/**
 * A contact, which is searched for by name.
 */
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class Contact extends BaseEntity {
    /**
     * Groups the contacts of one test, so the cases do not read each other's rows.
     */
    @Property.string({ format: 'uuid' })
    batch!: string;

    /**
     * What the contact is called, which is what somebody searches by.
     */
    @Property.string()
    name!: string;

    /**
     * Which kind of contact it is.
     */
    @Property.string({ enum: ContactKind })
    kind!: ContactKind;

    /**
     * What somebody wrote about them, which is written far more often than it is searched.
     */
    @Property.string({ fuzzySearchable: false, required: false })
    notes?: string;
}

/**
 * A contact as it is created, which is the entity without what the framework fills in.
 */
type ContactData = Omit<Contact, keyof BaseEntity>;

const CLOSE_MATCH: string = 'Miller Holdings';
const NEAR_MATCH: string = 'Millar Holding';
const names: string[] = [CLOSE_MATCH, NEAR_MATCH, 'Schmidt GmbH'];
const KIND_IS_REFUSED: string = 'Contact.kind';

/**
 * Runs the cases against one data source.
 * @param dataSourceName - The name of the data source, for the describe block.
 * @param repositoryOf - Resolves the repository, once the test server is up.
 */
export function describeFuzzySearch(dataSourceName: string, repositoryOf: () => Repository<Contact>): void {
    describe(`searching for something similar on ${dataSourceName}`, () => {

        /**
         * Stores one batch of contacts, so that a case reads only its own rows.
         * @returns The batch the contacts were stored under.
         */
        async function storeContacts(): Promise<string> {
            const batch: string = UUIDUtilities.generate();
            const data: ContactData[] = names.map(name => ({ batch, name, kind: ContactKind.COMPANY, notes: name }));
            await Promise.all(data.map(async c => await repositoryOf().create(c)));
            return batch;
        }

        it('finds the values that are similar to what was searched for', async () => {
            const batch: string = await storeContacts();

            const found: Contact[] = await repositoryOf().findAll({
                where: { batch, name: { fuzzyLike: { value: 'Miller Holding' } } }
            });

            expect(found.map(c => c.name).sort()).toEqual([NEAR_MATCH, CLOSE_MATCH]);
        });

        it('leaves out the values that are not similar enough', async () => {
            const batch: string = await storeContacts();

            const found: Contact[] = await repositoryOf().findAll({
                where: { batch, name: { fuzzyLike: { value: 'Miller Holding', minSimilarity: 90 } } }
            });

            expect(found.map(c => c.name)).toEqual([]);
        });

        it('answers a similarity below the trigram threshold with the same rows as one above it', async () => {
            const batch: string = await storeContacts();

            // the two are answered by different statements on a data source that has an index to
            // reach, and the widening is the only thing the caller is allowed to notice.
            // "Millar Holding" is the row between the two: it shares four of "Miller"'s seven
            // trigrams, which is a similarity of 0.22
            const loose: Contact[] = await repositoryOf().findAll({
                where: { batch, name: { fuzzyLike: { value: 'Miller', minSimilarity: 10 } } }
            });
            const tight: Contact[] = await repositoryOf().findAll({
                where: { batch, name: { fuzzyLike: { value: 'Miller', minSimilarity: 30 } } }
            });

            expect(loose.map(c => c.name).sort()).toEqual([NEAR_MATCH, CLOSE_MATCH]);
            expect(tight.map(c => c.name)).toEqual([CLOSE_MATCH]);
        });

        it('refuses a search of a property that holds one of a fixed set of values', async () => {
            await expect(repositoryOf().findAll({
                where: { kind: { fuzzyLike: { value: 'companies' } } }
            })).rejects.toThrow(KIND_IS_REFUSED);
        });

        it('refuses a search of a property that holds a uuid', async () => {
            await expect(repositoryOf().findAll({
                where: { batch: { fuzzyLike: { value: 'a1b2c3' } } }
            })).rejects.toThrow('Contact.batch');
        });

        it('refuses a search of a property that declares itself unsearchable', async () => {
            await expect(repositoryOf().findAll({
                where: { notes: { fuzzyLike: { value: 'Miller' } } }
            })).rejects.toThrow('fuzzySearchable: false');
        });

        it('refuses a search that is one option of several', async () => {
            // a branch that cannot be answered is not made acceptable by another branch that can:
            // an or returns the rows of every branch, so the unanswerable one is still asked
            await expect(repositoryOf().findAll({
                where: [{ name: { fuzzyLike: { value: 'Miller' } } }, { kind: { fuzzyLike: { value: 'companies' } } }]
            })).rejects.toThrow(KIND_IS_REFUSED);
        });
    });
}