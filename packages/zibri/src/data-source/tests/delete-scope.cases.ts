import { afterEach, describe, expect, it } from '@jest/globals';

import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { scopeFor } from '../../entity/models/entity-scope.model';
import { ConflictError } from '../../error-handling/errors/conflict.error';
import { Newable } from '../../types/newable.type';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { RepositoryHooks } from '../hooks/repository-hooks.model';
import { Repository } from '../repository/repository';

/**
 * The cases every data source answers the same way about a delete whose rows leave the caller's
 * reach between the read that found them and the statement that removes them. A file per data source
 * runs them against a repository of its own, with {@link deleteScopeHooks} provided.
 */

/**
 * A note the caller may see only while it is Ada's.
 */
@Entity({
    tenant: 'shared',
    allowOrphan: true,
    allowDuplicate: true,
    scope: { restrictedTo: scopeFor<OwnedNote>(() => ({ owner: 'ada' })) }
})
export class OwnedNote extends BaseEntity {
    /**
     * Whose note it is.
     */
    @Property.string()
    owner!: string;

    /**
     * What sets one test's notes apart from the next.
     */
    @Property.string()
    tag!: string;
}

/**
 * What another caller does to a row between the read a delete makes and the statement that removes
 * it, or undefined while nobody does anything.
 */
let inBetween: ((id: string) => Promise<void>) | undefined;

/**
 * Runs {@link inBetween} where it lands: in the before delete hook, which every delete runs after it
 * read the row and before it removes it.
 */
export const deleteScopeHooks: RepositoryHooks = {
    beforeDelete: async (row, entity, wrapped) => {
        await wrapped(row, entity);
        const watched: Newable<BaseEntity> = OwnedNote;
        if (entity === watched) {
            await inBetween?.(row.id);
        }
    }
};

/**
 * Runs every case against the notes of one data source.
 * @param dataSourceName - The data source, for the name of the cases.
 * @param notesOf - Reads the repository, once the data source is started.
 */
export function describeDeleteScope(dataSourceName: string, notesOf: () => Repository<OwnedNote>): void {
    /**
     * Hands the note with the given id to somebody else, as another caller does.
     * @param id - The note.
     */
    async function handToGrace(id: string): Promise<void> {
        await notesOf().updateById(id, { owner: 'grace' }, { unscoped: true });
    }

    // 01 §D8: the rows were read under the scope and removed by id afterwards, so a row another caller
    // handed to somebody else in between was deleted by a caller who could no longer see it
    describe(`a delete whose rows leave the caller's reach after they were read, on ${dataSourceName}`, () => {
        afterEach(() => {
            inBetween = undefined;
        });

        it('deletes a row that stayed', async () => {
            const note: OwnedNote = await notesOf().create({ owner: 'ada', tag: UUIDUtilities.generate() });

            await notesOf().deleteById(note.id);

            expect(await notesOf().findById(note.id, { unscoped: true, required: false })).toBeUndefined();
        });

        it('refuses to delete a row that left, and keeps it', async () => {
            const note: OwnedNote = await notesOf().create({ owner: 'ada', tag: UUIDUtilities.generate() });
            inBetween = handToGrace;

            await expect(notesOf().deleteById(note.id)).rejects.toThrow(ConflictError);

            expect((await notesOf().findById(note.id, { unscoped: true })).owner).toBe('grace');
        });

        // 01 §D13: the condition of a deleteById is checked by the read before the hook, and again by
        // the store as it removes the row - which is what this one is about
        it('refuses to delete a row whose condition stopped holding after it was read, and keeps it', async () => {
            const tag: string = UUIDUtilities.generate();
            const note: OwnedNote = await notesOf().create({ owner: 'ada', tag });
            inBetween = async id => {
                await notesOf().updateById(id, { tag: 'retagged' }, { unscoped: true });
            };

            await expect(notesOf().deleteById(note.id, { where: { tag } })).rejects.toThrow(ConflictError);

            expect((await notesOf().findById(note.id, { unscoped: true })).tag).toBe('retagged');
        });

        it('deletes none of a batch when one of its rows left', async () => {
            const tag: string = UUIDUtilities.generate();
            await notesOf().createAll([{ owner: 'ada', tag }, { owner: 'ada', tag }]);
            let moved: boolean = false;
            inBetween = async id => {
                if (!moved) {
                    moved = true;
                    await handToGrace(id);
                }
            };

            await expect(notesOf().deleteAll({ tag }, { returnDeleted: true })).rejects.toThrow(ConflictError);

            expect(await notesOf().findAll({ where: { tag }, unscoped: true })).toHaveLength(2);
        });

        it('deletes none of a batch when one of its rows is gone', async () => {
            const tag: string = UUIDUtilities.generate();
            await notesOf().createAll([{ owner: 'ada', tag }, { owner: 'ada', tag }]);
            let gone: boolean = false;
            inBetween = async id => {
                if (!gone) {
                    gone = true;
                    await notesOf().deleteById(id);
                }
            };

            await expect(notesOf().deleteAll({ tag }, { returnDeleted: true })).rejects.toThrow(ConflictError);

            expect(await notesOf().findAll({ where: { tag }, unscoped: true })).toHaveLength(1);
        });
    });
}
