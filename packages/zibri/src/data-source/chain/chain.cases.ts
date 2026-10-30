import { describe, expect, it } from '@jest/globals';

import { BaseChainedEntity } from './base-chained-entity.model';
import { ChainAnchor, ChainAnchorCreateData } from './chain-anchor.model';
import { ChainServiceInterface } from './chain-service.interface';
import { ChainVerification } from './chain-verification.model';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { Newable } from '../../types/newable.type';
import { OmitStrict } from '../../types/omit-strict.type';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { RepositoryDriverInterface } from '../driver/repository-driver.interface';
import { dataSourceNow } from '../models/data-source-now.function';
import { Repository } from '../repository/repository';

/**
 * The cases every data source answers the same way about an entity declared `chained: true`. A file
 * per data source runs them against an entity of its own.
 */

/**
 * A note of a team, chained per team.
 */
@Entity({ allowOrphan: true, chained: true })
export class ChainedNote extends BaseChainedEntity {
    /**
     * The team, or null for a note of no team.
     */
    @Property.string({ format: 'uuid', required: false })
    tenantId?: string | null;
    /**
     * What it says.
     */
    @Property.string()
    text!: string;
    /**
     * When it was written.
     */
    @Property.date()
    writtenAt!: Date;
}

/**
 * The same note, kept in a second data source.
 */
@Entity({ allowOrphan: true, chained: true })
export class SecondChainedNote extends ChainedNote {}

/**
 * The data a note is created with.
 */
export type ChainedNoteCreateData = OmitStrict<ChainedNote, 'id' | 'chainSequence' | 'chainHash'>;

/**
 * Runs every case against one data source.
 * @param dataSourceName - The data source, for the name of the cases.
 * @param noteClass - The note entity that data source declares.
 */
export function describeChain(dataSourceName: string, noteClass: Newable<ChainedNote>): void {
    /**
     * The repository of the notes.
     * @returns The repository.
     */
    function notes(): Repository<ChainedNote, ChainedNoteCreateData> {
        return inject(repositoryTokenFor(noteClass));
    }

    /**
     * What writes the notes past the repository, the way someone with access to the data source does.
     * @returns The driver.
     */
    function store(): RepositoryDriverInterface<ChainedNote> {
        return notes()['driver'];
    }

    /**
     * The chain service.
     * @returns The service.
     */
    function chains(): ChainServiceInterface {
        return inject(ZIBRI_DI_TOKENS.CHAIN_SERVICE);
    }

    /**
     * Writes notes of a team.
     * @param tenantId - The team, or null.
     * @param texts - What each says.
     * @returns The notes, in the order written.
     */
    async function write(tenantId: string | null, ...texts: string[]): Promise<ChainedNote[]> {
        return await notes().createAll(texts.map(text => ({ tenantId, text, writtenAt: new Date() })), { acrossTenants: true });
    }

    /**
     * The notes of a team, in the order of their chain.
     * @param tenantId - The team.
     * @returns The notes.
     */
    async function chainOf(tenantId: string): Promise<ChainedNote[]> {
        return await notes().findAll({ where: { tenantId }, order: { chainSequence: 'ASC' }, acrossTenants: true });
    }

    describe(`a chained entity, on ${dataSourceName}`, () => {
        it('links the notes of each team in a run of their own, and of no team in one of theirs', async () => {
            const team: string = UUIDUtilities.generate();
            const other: string = UUIDUtilities.generate();
            await write(team, 'first', 'second');
            await write(other, 'elsewhere');
            await write(team, 'third');
            // eslint-disable-next-line unicorn/no-null
            await write(null, 'of no team');

            expect((await chainOf(team)).map(n => [n.chainSequence, n.text])).toEqual([[1, 'first'], [2, 'second'], [3, 'third']]);
            expect((await chainOf(other)).map(n => n.chainSequence)).toEqual([1]);
            const verification: ChainVerification = await chains().resolveChainVerification(noteClass, team);
            const newest: ChainedNote | undefined = (await chainOf(team)).at(-1);
            expect(verification).toEqual({ intact: true, newestSequence: 3, newestHash: newest?.chainHash });
            expect(await chains().resolveChainVerification(noteClass, undefined)).toMatchObject({ intact: true });
        });

        it('tells a note that was changed past the repository', async () => {
            const team: string = UUIDUtilities.generate();
            const [, second] = await write(team, 'first', 'second', 'third');

            await store().updateAll({ where: { id: second?.id }, data: { text: 'rewritten' } });

            expect(await chains().resolveChainVerification(noteClass, team))
                .toEqual({ intact: false, brokenAtSequence: 2, reason: 'The row is not as it was written.' });
        });

        it('tells a note that was removed past the repository', async () => {
            const team: string = UUIDUtilities.generate();
            const [, second] = await write(team, 'first', 'second', 'third');

            await store().remove([String(second?.id)], undefined, undefined);

            expect(await chains().resolveChainVerification(noteClass, team))
                .toEqual({ intact: false, brokenAtSequence: 3, reason: 'The rows from 2 to 2 are missing.' });
        });

        it('tells a note that was slipped in past the repository', async () => {
            const team: string = UUIDUtilities.generate();
            const [first] = await write(team, 'first');

            await store().insert(
                [
                    {
                        id: UUIDUtilities.generate(),
                        tenantId: team,
                        text: 'slipped in',
                        writtenAt: new Date(),
                        chainSequence: 2,
                        chainHash: first?.chainHash ?? ''
                    }
                ],
                undefined
            );

            expect(await chains().resolveChainVerification(noteClass, team))
                .toEqual({ intact: false, brokenAtSequence: 2, reason: 'The row is not as it was written.' });
        });

        it('refuses to change or delete a note through the repository', async () => {
            const team: string = UUIDUtilities.generate();
            const [first] = await write(team, 'first');

            await expect(notes().updateById(String(first?.id), { text: 'rewritten' }, { acrossTenants: true }))
                .rejects.toThrow('are append only, and are only created');
            await expect(notes().deleteAll({ tenantId: team }, { acrossTenants: true }))
                .rejects.toThrow('are append only, and are only created');
            expect(await chains().resolveChainVerification(noteClass, team)).toMatchObject({ intact: true, newestSequence: 1 });
        });

        it('refuses a note that takes the time of the data source, which is known only once it is written', async () => {
            await expect(notes().create(
                { tenantId: UUIDUtilities.generate(), text: 'now', writtenAt: dataSourceNow() },
                { acrossTenants: true }
            )).rejects.toThrow('cannot take one');
        });

        it('removes the old notes of each team from the start of its chain, and the chain still holds and goes on', async () => {
            const team: string = UUIDUtilities.generate();
            const old: Date = new Date(Date.now() - 60_000);
            await notes().createAll([
                { tenantId: team, text: 'old', writtenAt: old },
                { tenantId: team, text: 'old too', writtenAt: old },
                { tenantId: team, text: 'new', writtenAt: new Date() },
                // old, but after a new one, so it stays until the one before it goes
                { tenantId: team, text: 'old after new', writtenAt: old }
            ], { acrossTenants: true });

            const removed: number = await notes().prune({ tenantId: team, writtenAt: { before: new Date(Date.now() - 30_000) } });

            expect(removed).toBe(2);
            expect((await chainOf(team)).map(n => n.text)).toEqual(['new', 'old after new']);
            expect(await chains().resolveChainVerification(noteClass, team)).toMatchObject({ intact: true, newestSequence: 4 });
            await write(team, 'after the pruning');
            expect(await chains().resolveChainVerification(noteClass, team)).toMatchObject({ intact: true, newestSequence: 5 });
        });

        it('links after the anchor once every note of a chain was removed', async () => {
            const team: string = UUIDUtilities.generate();
            await notes().createAll([{ tenantId: team, text: 'old', writtenAt: new Date(Date.now() - 60_000) }], { acrossTenants: true });
            await notes().prune({ tenantId: team, writtenAt: { before: new Date() } });

            await write(team, 'after everything was removed');

            expect((await chainOf(team)).map(n => n.chainSequence)).toEqual([2]);
            expect(await chains().resolveChainVerification(noteClass, team)).toMatchObject({ intact: true, newestSequence: 2 });
        });

        it('tells an anchor that was not written by the application', async () => {
            const team: string = UUIDUtilities.generate();
            await notes().createAll([
                { tenantId: team, text: 'old', writtenAt: new Date(Date.now() - 60_000) },
                { tenantId: team, text: 'new', writtenAt: new Date() }
            ], { acrossTenants: true });
            await notes().prune({ tenantId: team, writtenAt: { before: new Date(Date.now() - 30_000) } });
            const anchors: Repository<ChainAnchor, ChainAnchorCreateData> = inject(repositoryTokenFor(ChainAnchor));
            const anchor: ChainAnchor = await anchors.findOne({ where: { chain: team } });

            // what removing the newest note as well and moving the anchor along would take
            await anchors.updateById(anchor.id, { sequence: 2 });

            expect(await chains().resolveChainVerification(noteClass, team))
                .toEqual({ intact: false, brokenAtSequence: 2, reason: 'Where the chain starts was not written by this application.' });
        });

        it('tells notes removed from the start of a chain without an anchor', async () => {
            const team: string = UUIDUtilities.generate();
            const [first] = await write(team, 'first', 'second');

            await store().remove([String(first?.id)], undefined, undefined);

            expect(await chains().resolveChainVerification(noteClass, team))
                .toEqual({ intact: false, brokenAtSequence: 2, reason: 'The rows from 1 to 1 are missing.' });
        });

        it('keeps one run when several writers add to a chain at once', async () => {
            const team: string = UUIDUtilities.generate();

            await Promise.all(Array.from({ length: 4 }, async (_, i) => await write(team, `writer ${i} first`, `writer ${i} second`)));

            expect((await chainOf(team)).map(n => n.chainSequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
            expect(await chains().resolveChainVerification(noteClass, team)).toMatchObject({ intact: true, newestSequence: 8 });
        });
    });
}