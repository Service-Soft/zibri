/* eslint-disable jsdoc/require-jsdoc */
import { setTimeout as sleep } from 'node:timers/promises';

import { describe, expect, it } from '@jest/globals';

import { type AuditCheckpoint } from '../../audit/audit-checkpoint.model';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { Repository } from '../repository/repository';
import { SpanningTransactionCommitError } from '../transaction/spanning-transaction-commit.error';
import { SpanningTransaction } from '../transaction/spanning-transaction.model';
import { TransactionAlreadyFinishedError } from '../transaction/transaction-already-finished.error';
import { Transaction } from '../transaction/transaction.model';

/**
 * The cases every pair of data sources answers the same way about one transaction across both: it
 * commits in both or in neither, and what it wrote in the one that committed is undone when the other
 * one fails. A file per kind of data source runs them.
 */

@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class SpanLabel extends BaseEntity {
    @Property.string()
    name!: string;

    @Property.manyToMany({ target: () => SpanCard, inverseSide: 'labels', joinTable: false, required: false })
    cards?: SpanCard[];
}

@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class SpanCard extends BaseEntity {
    /**
     * The rows one test wrote, so that what a read finds is not mixed up with another test's rows.
     */
    @Property.string()
    batch!: string;

    @Property.string()
    name!: string;

    @Property.manyToMany({ target: () => SpanLabel, inverseSide: 'cards', joinTable: true, required: false })
    labels?: SpanLabel[];
}

@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class SpanEntry extends BaseEntity {
    @Property.string()
    batch!: string;

    @Property.string()
    name!: string;
}

type SpanCardData = {
    batch: string,
    name: string,
    labels?: Pick<SpanLabel, 'id'>[]
};

/**
 * The repositories the cases run against, each in one of two data sources.
 */
export type SpanningTransactionRepositories = {
    /**
     * The cards, in one data source.
     */
    cards: Repository<SpanCard, SpanCardData>,
    /**
     * The labels a card names, in the same data source.
     */
    labels: Repository<SpanLabel, Pick<SpanLabel, 'name'>>,
    /**
     * The entries, in the other one.
     */
    entries: Repository<SpanEntry, Pick<SpanEntry, 'batch' | 'name'>>,
    /**
     * The name of the data source of the cards.
     */
    cardsDataSourceName: string,
    /**
     * The name of the data source of the entries.
     */
    entriesDataSourceName: string
};

/**
 * How long the transaction of each data source may sit idle in the case that lets one run out, long
 * enough for a write and short enough to wait out.
 */
const IDLE_TIMEOUT_IN_MS: number = 1000;

/**
 * The names of the cards of a batch, as they are stored now.
 * @param cards - The repository of the cards.
 * @param batch - The batch.
 * @returns The names, sorted.
 */
async function findCardNames(cards: Repository<SpanCard, SpanCardData>, batch: string): Promise<string[]> {
    return (await cards.findAll({ where: { batch } })).map(card => card.name).sort();
}

/**
 * The names of the labels a card names, as they are stored now.
 * @param cards - The repository of the cards.
 * @param id - The id of the card.
 * @returns The names, sorted.
 */
async function findLabelNames(cards: Repository<SpanCard, SpanCardData>, id: string): Promise<string[]> {
    const card: SpanCard = await cards.findById(id, { relations: ['labels'] });
    return (card.labels ?? []).map(label => label.name).sort();
}

export function describeSpanningTransaction(dataSourcesName: string, repositoriesOf: () => SpanningTransactionRepositories): void {
    describe(`a spanning transaction, on ${dataSourcesName}`, () => {
        it('is kept from what takes a transaction of one data source, and from the repository of a chained entity', () => {
            const takes: (transaction: Transaction) => boolean = transaction => !transaction.isFinished;
            const checkpointsIn: (repository: Repository<AuditCheckpoint>, transaction: SpanningTransaction) => Promise<unknown> = async (
                repository,
                transaction
            ) => {
                // @ts-expect-error a row of a chain cannot be restored, so its repository takes no spanning transaction
                return await repository.findAll({ transaction });
            };
            // @ts-expect-error a data source's own operations take only its own transactions
            expect(takes(new SpanningTransaction())).toBe(true);
            expect(checkpointsIn).toBeInstanceOf(Function);
        });

        it('commits the writes in every data source it reached, and none of them is seen before', async () => {
            const { cards, entries } = repositoriesOf();
            const batch: string = UUIDUtilities.generate();
            const transaction: SpanningTransaction = new SpanningTransaction();

            await cards.create({ batch, name: 'card' }, { transaction });
            await entries.create({ batch, name: 'entry' }, { transaction });
            expect(await findCardNames(cards, batch)).toEqual([]);
            expect(await entries.findAll({ where: { batch } })).toEqual([]);

            await transaction.commit();

            expect(transaction.isFinished).toBe(true);
            expect(await findCardNames(cards, batch)).toEqual(['card']);
            expect((await entries.findAll({ where: { batch } })).map(entry => entry.name)).toEqual(['entry']);
        });

        it('reads its own writes in each data source before it commits', async () => {
            const { cards, entries } = repositoriesOf();
            const batch: string = UUIDUtilities.generate();
            const transaction: SpanningTransaction = new SpanningTransaction();

            try {
                await cards.create({ batch, name: 'card' }, { transaction });
                await entries.create({ batch, name: 'entry' }, { transaction });

                expect((await cards.findAll({ where: { batch }, transaction })).map(card => card.name)).toEqual(['card']);
                expect((await entries.findAll({ where: { batch }, transaction })).map(entry => entry.name)).toEqual(['entry']);
            }
            finally {
                await transaction.rollback();
            }
        });

        it('rolls back in every data source it reached', async () => {
            const { cards, entries } = repositoriesOf();
            const batch: string = UUIDUtilities.generate();
            const transaction: SpanningTransaction = new SpanningTransaction();

            await cards.create({ batch, name: 'card' }, { transaction });
            await entries.create({ batch, name: 'entry' }, { transaction });
            await transaction.rollback();

            expect(await findCardNames(cards, batch)).toEqual([]);
            expect(await entries.findAll({ where: { batch } })).toEqual([]);
        });

        it('is refused once it is committed', async () => {
            const { cards } = repositoriesOf();
            const batch: string = UUIDUtilities.generate();
            const transaction: SpanningTransaction = new SpanningTransaction();
            await cards.create({ batch, name: 'card' }, { transaction });
            await transaction.commit();

            await expect(cards.create({ batch, name: 'late' }, { transaction })).rejects.toThrow(TransactionAlreadyFinishedError);
            await expect(transaction.commit()).rejects.toThrow(TransactionAlreadyFinishedError);
            expect(await findCardNames(cards, batch)).toEqual(['card']);
        });

        it('runs the work waiting for its commit once every data source committed, and never on a rollback', async () => {
            const { cards, entries } = repositoriesOf();
            const batch: string = UUIDUtilities.generate();
            const committed: SpanningTransaction = new SpanningTransaction();
            const rolledBack: SpanningTransaction = new SpanningTransaction();
            const ran: string[] = [];

            for (const [transaction, name] of [[committed, 'committed'], [rolledBack, 'rolled back']] as const) {
                await cards.create({ batch, name }, { transaction });
                await entries.create({ batch, name }, { transaction });
                transaction.afterCommit(async () => {
                    // the entry is the write of the data source reached last, so seeing it is seeing every one
                    ran.push(`${name} after commit: ${(await entries.findAll({ where: { batch, name } })).length}`);
                });
                transaction.afterFinish(async isCommitted => {
                    ran.push(`${name} after finish: ${String(isCommitted)}`);
                    await Promise.resolve();
                });
            }
            await committed.commit();
            await rolledBack.rollback();

            expect(ran).toEqual([
                'committed after finish: true',
                'committed after commit: 1',
                'rolled back after finish: false'
            ]);
        });

        it('restores a data source that committed when the last one fails to, and names the one that failed', async () => {
            const { cards, labels, entries, entriesDataSourceName } = repositoriesOf();
            const batch: string = UUIDUtilities.generate();
            const red: SpanLabel = await labels.create({ name: 'red' });
            const blue: SpanLabel = await labels.create({ name: 'blue' });
            const kept: SpanCard = await cards.create({ batch, name: 'kept', labels: [{ id: red.id }] });
            const removed: SpanCard = await cards.create({ batch, name: 'removed', labels: [{ id: blue.id }] });
            const transaction: SpanningTransaction = new SpanningTransaction({ idleTimeoutInMs: IDLE_TIMEOUT_IN_MS });
            const ran: string[] = [];
            transaction.afterCommit(async () => {
                ran.push('after commit');
                await Promise.resolve();
            });
            transaction.afterFinish(async isCommitted => {
                ran.push(`after finish: ${String(isCommitted)}`);
                await Promise.resolve();
            });

            // the entries first: the data source reached first commits last, so the cards' one commits
            // before it and is what gets restored when it fails
            await entries.create({ batch, name: 'entry' }, { transaction });
            await cards.create({ batch, name: 'created' }, { transaction });
            await cards.updateById(kept.id, { name: 'changed', labels: [{ id: blue.id }] }, { transaction });
            await cards.deleteById(removed.id, { transaction });
            // the cards' transaction kept busy while the entries' one sits idle past its timeout, which
            // ends it, so that the last commit fails after the cards' one landed. Kept busy by a write,
            // which every store counts as the transaction doing something
            await sleep(IDLE_TIMEOUT_IN_MS * 0.6);
            await cards.create({ batch, name: 'busy' }, { transaction });
            await sleep(IDLE_TIMEOUT_IN_MS * 0.6);

            const commit: Promise<void> = transaction.commit();

            await expect(commit).rejects.toThrow(SpanningTransactionCommitError);
            await commit.catch((error: unknown) => {
                expect(error).toMatchObject({ dataSourceName: entriesDataSourceName, restoreFailures: [] });
            });
            expect(await findCardNames(cards, batch)).toEqual(['kept', 'removed']);
            expect(await findLabelNames(cards, kept.id)).toEqual(['red']);
            expect(await findLabelNames(cards, removed.id)).toEqual(['blue']);
            expect(await entries.findAll({ where: { batch } })).toEqual([]);
            expect(ran).toEqual(['after finish: false']);
        }, 15000);

        it('rolls back every data source when the first commit fails, and names the one that failed', async () => {
            const { cards, entries, cardsDataSourceName } = repositoriesOf();
            const batch: string = UUIDUtilities.generate();
            const transaction: SpanningTransaction = new SpanningTransaction({ idleTimeoutInMs: IDLE_TIMEOUT_IN_MS });

            // the entries first, which commit last: the cards' transaction, run out, is the first to commit
            await entries.create({ batch, name: 'entry' }, { transaction });
            await cards.create({ batch, name: 'card' }, { transaction });
            await sleep(IDLE_TIMEOUT_IN_MS * 0.6);
            await entries.create({ batch, name: 'busy' }, { transaction });
            await sleep(IDLE_TIMEOUT_IN_MS * 0.6);

            const commit: Promise<void> = transaction.commit();

            await expect(commit).rejects.toThrow(SpanningTransactionCommitError);
            await commit.catch((error: unknown) => {
                expect(error).toMatchObject({ dataSourceName: cardsDataSourceName, restoreFailures: [] });
            });
            expect(await findCardNames(cards, batch)).toEqual([]);
            expect(await entries.findAll({ where: { batch } })).toEqual([]);
        }, 15000);
    });
}