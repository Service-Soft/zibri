import { AsyncLocalStorage } from 'node:async_hooks';

import { BaseEntity } from '../../entity/base-entity.model';
import { ArchivedEntityUtilities } from '../../entity/utilities/archived-entity.utilities';
import { ConflictError } from '../../error-handling/errors/conflict.error';
import { InternalError } from '../../error-handling/internal-error.model';
import { $ts } from '../../localization/translate.function';
import { Newable } from '../../types/newable.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';

/**
 * The entity whose rows are being pruned, while that runs.
 */
const pruning: AsyncLocalStorage<Newable<BaseEntity>> = new AsyncLocalStorage();

/**
 * Says when a row of an entity declared `appendOnly` or `chained` may be changed or removed.
 */
export class AppendOnlyUtilities {
    /**
     * Runs work that prunes rows of an append only entity, which is the one way its rows are removed.
     * @param entityClass - The entity.
     * @param work - The work.
     * @returns What the work resolves.
     */
    static async runPruning<R>(entityClass: Newable<BaseEntity>, work: () => Promise<R>): Promise<R> {
        return await pruning.run(entityClass, work);
    }

    /**
     * Refuses a change to rows of an append only entity, other than pruning them. The rows of an archived
     * entity are deleted once their retention ended, which its write observer judges row by row.
     * @param entityClass - The entity being written.
     * @param operation - What is being done to its rows.
     * @throws A ConflictError for an update of an archived entity, an InternalError for any other change
     * of an append only one.
     */
    static validateChangeable(entityClass: Newable<BaseEntity>, operation: 'update' | 'delete'): void {
        if (!this.isAppendOnly(entityClass)) {
            return;
        }
        if (operation === 'delete' && (pruning.getStore() === entityClass || ArchivedEntityUtilities.isArchived(entityClass))) {
            return;
        }
        // a conflict rather than a mistake of the code: a user may well ask to change a document of the archive
        if (ArchivedEntityUtilities.isArchived(entityClass)) {
            throw new ConflictError($ts`The rows of ${entityClass.name} are archived, and are never changed.`);
        }
        throw new InternalError([
            `The rows of "${entityClass.name}" are append only, and are only created.`,
            'They are removed with prune of their repository.'
        ]);
    }

    /**
     * Refuses to prune an entity whose rows are removed with `deleteAll`, and an archived one, whose rows
     * are pruned by the archive once their retention ended.
     * @param entityClass - The entity.
     * @throws When the entity is not append only, or is archived.
     */
    static validatePrunable(entityClass: Newable<BaseEntity>): void {
        // refused before anything is written: pruning a chain moves its start first, and would leave rows
        // whose retention has not ended behind its start, where no check reads them
        if (ArchivedEntityUtilities.isArchived(entityClass)) {
            throw new InternalError([
                `The rows of "${entityClass.name}" are archived, and are pruned once their retention ended.`,
                'Prune them with prune of ZIBRI_DI_TOKENS.ARCHIVE_SERVICE.'
            ]);
        }
        if (this.isAppendOnly(entityClass)) {
            return;
        }
        throw new InternalError([
            `"${entityClass.name}" is not append only, so its rows are not pruned.`,
            'Remove them with deleteAll.'
        ]);
    }

    /**
     * Whether an entity is declared `appendOnly`, which `chained` implies.
     * @param entityClass - The entity.
     * @returns True when its rows are only created.
     */
    static isAppendOnly(entityClass: Newable<BaseEntity>): boolean {
        return MetadataUtilities.getEntityMetadata(entityClass)?.appendOnly === true;
    }
}