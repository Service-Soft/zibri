import { AsyncLocalStorage } from 'node:async_hooks';

import { BaseEntity } from '../../entity/base-entity.model';
import { InternalError } from '../../error-handling/internal-error.model';
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
     * Refuses a change to rows of an append only entity, other than pruning them.
     * @param entityClass - The entity being written.
     * @param operation - What is being done to its rows.
     * @throws When the entity is append only.
     */
    static validateChangeable(entityClass: Newable<BaseEntity>, operation: 'update' | 'delete'): void {
        if (!this.isAppendOnly(entityClass)) {
            return;
        }
        if (operation === 'delete' && pruning.getStore() === entityClass) {
            return;
        }
        throw new InternalError([
            `The rows of "${entityClass.name}" are append only, and are only created.`,
            'They are removed with prune of their repository.'
        ]);
    }

    /**
     * Refuses to prune an entity whose rows are removed with `deleteAll`.
     * @param entityClass - The entity.
     * @throws When the entity is not append only.
     */
    static validatePrunable(entityClass: Newable<BaseEntity>): void {
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