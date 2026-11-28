import { Repository } from '../../data-source/repository/repository';
import { type RepositoryTransaction } from '../../data-source/transaction/repository-transaction.type';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { BadRequestError } from '../../error-handling/errors/bad-request.error';
import { InternalError } from '../../error-handling/internal-error.model';
import { $ts } from '../../localization/translate.function';
import { Ms } from '../../utilities/ms';
import { type PositionedRow, type PositionPlacement } from './models/position-placement.model';
import { type TaskPlacementOptions } from './models/task-placement-options.model';
import { Task } from './models/task.model';

/**
 * What a placing run under its lease answered, told apart from a lease that was not taken.
 */
type LeasedPlacement<T> = {
    /**
     * What the placing answered.
     */
    value: T
};

/**
 * The places of the tasks in a column, and of the columns on a board, as fractional positions: a row is ordered by
 * its number, so moving one between two others writes a number between theirs, and that row alone.
 */
export abstract class ProjectPositionUtilities {
    /**
     * The gap between two rows placed one after the other, and the place of the first row.
     */
    static readonly STEP: number = 1024;

    /**
     * Resolves where a task goes in a column, and writes the other tasks of the column spread out again when their
     * positions ran out of precision. Run it inside `withPlacementLease` of the column.
     * @param columnId - The column.
     * @param taskId - The task moved, left out of the others, or undefined for a new one.
     * @param afterTaskId - The task to put it after, null for first, undefined for last.
     * @param options - The transaction to read and write in, and whether to reach past what the caller sees.
     * @returns Where it goes.
     * @throws A BadRequestError for a task to put it after that is not in the column.
     */
    static async resolveTaskPlacement(
        columnId: string,
        taskId: string | undefined,
        afterTaskId: string | null | undefined,
        options: TaskPlacementOptions
    ): Promise<PositionPlacement> {
        const tasks: Repository<Task> = inject(repositoryTokenFor(Task));
        // the positions of the column, which a move reads in full rather than its two neighbours: the same read is
        // what spreads them out again when they ran out of precision, and a row of two values is little to read
        const others: PositionedRow[] = await tasks.findAll({
            where: taskId == undefined ? { columnId } : { columnId, id: { notOneOf: [taskId] } },
            select: { id: true, position: true },
            order: { position: 'ASC', id: 'ASC' },
            limit: 'all',
            unscoped: options.unscoped,
            transaction: options.transaction
        });
        const placement: PositionPlacement | undefined = this.resolvePlacement(others, afterTaskId);
        if (placement == undefined) {
            throw new BadRequestError($ts`The task to put it after needs to be another task of the same column.`);
        }
        if (!placement.respread.length) {
            return placement;
        }
        const write: (transaction: RepositoryTransaction) => Promise<void> = async transaction => {
            await Promise.all(placement.respread.map(async row => await tasks.updateById(
                row.id,
                { position: row.position },
                { transaction, unscoped: options.unscoped }
            )));
        };
        await (options.transaction == undefined
            ? tasks.dataSource.runInTransaction(write, { maxAttempts: 3 })
            : write(options.transaction));
        return placement;
    }

    /**
     * Places a row among others: after the row of an id, first, or last.
     * @param ordered - The other rows, in their order.
     * @param afterId - The id of the row to place it after, null to place it first, undefined to place it last.
     * @returns Where it goes, or undefined when no row of the id is among them.
     */
    static resolvePlacement(ordered: PositionedRow[], afterId: string | null | undefined): PositionPlacement | undefined {
        const index: number = afterId === undefined
            ? ordered.length - 1
            : afterId === null ? -1 : ordered.findIndex(row => row.id === afterId);
        if (afterId != undefined && index < 0) {
            return undefined;
        }
        const position: number | undefined = this.resolveBetween(ordered[index]?.position, ordered[index + 1]?.position);
        if (position != undefined) {
            return { position, respread: [] };
        }
        // the gap ran out of precision: every row is spread out again, leaving a step free for the one placed, which
        // writes the rows of the column once in a long while rather than one row less often
        const spread: number[] = this.resolveSpread(ordered.length + 1);
        const respread: PositionedRow[] = ordered
            .map((row, i) => ({ id: row.id, position: spread[i <= index ? i : i + 1] ?? 0 }))
            .filter((row, i) => row.position !== ordered[i]?.position);
        return { position: spread[index + 1] ?? 0, respread };
    }

    /**
     * Resolves a place between two neighbours: after the last row when nothing follows, before the first when nothing
     * precedes, and halfway between two rows otherwise.
     * @param before - The place of the row to follow, undefined to put it first.
     * @param after - The place of the row to precede, undefined to put it last.
     * @returns The place, or undefined when no number lies between the two, which a column that ran out of precision
     * answers once its rows were placed between each other often enough.
     */
    static resolveBetween(before: number | undefined, after: number | undefined): number | undefined {
        if (after == undefined) {
            const res: number = (before ?? 0) + this.STEP;
            return before == undefined || res > before ? res : undefined;
        }
        // above 0, so that what is put first again and again halves towards it rather than going below every row
        const lower: number = before ?? 0;
        const res: number = lower + ((after - lower) / 2);
        // a double holds about 52 halvings of one gap: then the middle is one of the two ends
        return res > lower && res < after ? res : undefined;
    }

    /**
     * Resolves the places of rows spread out again, each a step after the one before.
     * @param count - How many rows there are.
     * @returns Their places, in their order.
     */
    static resolveSpread(count: number): number[] {
        return Array.from({ length: count }, (_, index) => (index + 1) * this.STEP);
    }

    /**
     * Runs the placing of a row among others while no other placing among the same rows runs, on any instance.
     * @param key - What the rows are, such as the column of the tasks.
     * @param work - The placing: reading the rows, and writing the row placed.
     * @returns What the work answered.
     */
    static async withPlacementLease<T>(key: string, work: () => Promise<T>): Promise<T> {
        // two moves into one column at once would each read the same neighbours and write the same position. In turn,
        // the second reads what the first wrote, so no two rows share a position, and only one spreads them out again
        const res: LeasedPlacement<T> | undefined = await inject(ZIBRI_DI_TOKENS.LEASE_SERVICE).withLease(
            { key: `zi.projects.positions:${key}`, leaseInMs: Ms.MINUTE, mode: 'wait', acquireTimeoutInMs: Ms.SECOND * 30 },
            async () => ({ value: await work() })
        );
        if (res == undefined) {
            throw new InternalError(`The lease on the positions of ${key} was waited for and not taken.`);
        }
        return res.value;
    }
}