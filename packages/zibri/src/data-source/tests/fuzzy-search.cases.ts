/* cspell:disable */
/* eslint-disable sonarjs/no-duplicate-string */
import { describe, expect, it } from 'vitest';

import { BaseEntity } from '../../entity/base-entity.model.ts';
import { Entity } from '../../entity/decorators/entity.decorator.ts';
import { Property } from '../../entity/decorators/property.decorator.ts';
import { BadRequestError } from '../../error-handling/errors/bad-request.error.ts';
import { KeysetPage, PaginationResult } from '../../open-api/pagination-result.model.ts';
import { UUIDUtilities } from '../../utilities/uuid.utilities.ts';
import { FindAllPaginatedOptions } from '../models/options/find-all-paginated-options.model.ts';
import { Repository } from '../repository/repository.ts';

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

        it('counts a letter outside of ascii as a letter', async () => {
            const batch: string = UUIDUtilities.generate();
            await repositoryOf().createAll(['Müller', 'Möller'].map(name => ({ batch, name, kind: ContactKind.PERSON })));

            // "müller" and "möller" share four of their ten trigrams. Read as ascii alone, both are
            // the words "m" and "ller", which makes them identical
            const found: Contact[] = await repositoryOf().findAll({
                where: { batch, name: { fuzzyLike: { value: 'Müller', minSimilarity: 90 } } }
            });

            expect(found.map(c => c.name)).toEqual(['Müller']);
        });

        it('orders a search by how similar each value is, the most similar first', async () => {
            const batch: string = await storeContacts();

            // "Miller Holdings" shares 14 of the 17 trigrams the two hold between them (0.82),
            // "Millar Holding" 12 of 18 (0.67)
            const found: Contact[] = await repositoryOf().findAll({
                where: { batch, name: { fuzzyLike: { value: 'Miller Holding' } } },
                order: { name: { similarTo: 'Miller Holding' } }
            });

            expect(found.map(c => c.name)).toEqual([CLOSE_MATCH, NEAR_MATCH]);
        });

        it('orders every row by similarity, the ones similar to nothing last', async () => {
            const batch: string = await storeContacts();

            const found: Contact[] = await repositoryOf().findAll({
                where: { batch },
                order: { name: { similarTo: NEAR_MATCH } }
            });

            expect(found.map(c => c.name)).toEqual([NEAR_MATCH, CLOSE_MATCH, 'Schmidt GmbH']);
        });

        it('orders a property that keeps no index by similarity', async () => {
            const batch: string = await storeContacts();

            // an order sorts what the filter already found, so it asks for no index of its own
            const found: Contact[] = await repositoryOf().findAll({
                where: { batch },
                order: { notes: { similarTo: NEAR_MATCH } }
            });

            expect(found.map(c => c.notes)).toEqual([NEAR_MATCH, CLOSE_MATCH, 'Schmidt GmbH']);
        });

        it('pages an order by similarity', async () => {
            const batch: string = await storeContacts();

            const page: PaginationResult<Contact> = await repositoryOf().findAllPaginated(2, 2, {
                where: { batch },
                order: { name: { similarTo: NEAR_MATCH } }
            });

            expect(page.items.map(c => c.name)).toEqual(['Schmidt GmbH']);
            expect(page.totalAmount).toBe(3);
        });

        it('walks an order by similarity by cursor, handing back every row once', async () => {
            const batch: string = await storeContacts();
            // a second row exactly as similar as the first: the cursor has to tell the two apart by
            // their ids, which is the one place "exactly as similar" is compared
            await repositoryOf().create({ batch, name: NEAR_MATCH, kind: ContactKind.PERSON });

            const seen: string[] = [];
            const walked: string[] = [];
            let cursor: string | undefined = undefined;
            do {
                const page: KeysetPage<Contact> = await repositoryOf().findAllAfter(cursor, 1, {
                    where: { batch },
                    order: { name: { similarTo: NEAR_MATCH } }
                });
                expect(page.totalAmount).toBe(4);
                seen.push(...page.items.map(c => c.id));
                walked.push(...page.items.map(c => c.name));
                cursor = page.nextCursor;
            }
            while (cursor != undefined && seen.length < 10);

            expect(new Set(seen).size).toBe(4);
            expect(walked).toEqual([NEAR_MATCH, NEAR_MATCH, CLOSE_MATCH, 'Schmidt GmbH']);
        });

        it('keeps the search a walk ordered by similarity was started with', async () => {
            const batch: string = await storeContacts();

            // the position past the cursor is a second condition on `name` next to the caller's
            // search, so the row similar to nothing stays out however far the walk goes
            const options: FindAllPaginatedOptions<Contact> = {
                where: { batch, name: { fuzzyLike: { value: 'Miller Holding' } } },
                order: { name: { similarTo: 'Miller Holding' } }
            };
            const first: KeysetPage<Contact> = await repositoryOf().findAllAfter(undefined, 1, options);
            const second: KeysetPage<Contact> = await repositoryOf().findAllAfter(first.nextCursor, 1, options);
            const third: KeysetPage<Contact> = await repositoryOf().findAllAfter(second.nextCursor, 1, options);

            expect([...first.items, ...second.items].map(c => c.name)).toEqual([CLOSE_MATCH, NEAR_MATCH]);
            expect(third.items).toEqual([]);
            expect(third.totalAmount).toBe(2);
        });

        it('refuses a cursor carried to a walk ordered by similarity to another search', async () => {
            const batch: string = await storeContacts();

            const first: KeysetPage<Contact> = await repositoryOf().findAllAfter(undefined, 1, {
                where: { batch },
                order: { name: { similarTo: NEAR_MATCH } }
            });

            // a position among the rows most similar to one search is none among those similar to another
            await expect(repositoryOf().findAllAfter(first.nextCursor, 1, {
                where: { batch },
                order: { name: { similarTo: CLOSE_MATCH } }
            })).rejects.toThrow(BadRequestError);
        });

        it('refuses an order by similarity of a property that holds one of a fixed set of values', async () => {
            await expect(repositoryOf().findAll({
                order: { kind: { similarTo: 'companies' } }
            })).rejects.toThrow(KIND_IS_REFUSED);
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