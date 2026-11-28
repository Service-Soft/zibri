import { type NewRecurringTask } from '../models/new-recurring-task.model';
import { type RecurringTaskChange } from '../models/recurring-task-change.model';
import { type RecurringTask } from '../models/recurring-task.model';
import { type Task } from '../models/task.model';

/**
 * Interface for the service of the recurring tasks of the projects of the active tenant: writing them as the caller of
 * a request, an editor of their project, and creating the occurrences that are due as the application.
 */
export interface RecurringTaskServiceInterface {
    /**
     * Finds the recurring tasks of a project the caller sees.
     * @param projectId - The id of the project.
     * @returns The recurring tasks, by title.
     */
    findRecurringTasks: (projectId: string) => Promise<RecurringTask[]>,
    /**
     * Finds a recurring task of a project the caller sees.
     * @param recurringTaskId - The id of the recurring task.
     * @returns The recurring task.
     */
    findRecurringTask: (recurringTaskId: string) => Promise<RecurringTask>,
    /**
     * Creates a recurring task in a project that is not archived. It creates no occurrence due before the day it is
     * created on.
     * @param projectId - The id of the project.
     * @param recurringTask - The recurring task.
     * @returns The recurring task.
     */
    createRecurringTask: (projectId: string, recurringTask: NewRecurringTask) => Promise<RecurringTask>,
    /**
     * Changes a recurring task. The occurrences created before keep what they were created with.
     * @param recurringTaskId - The id of the recurring task.
     * @param change - What changes.
     * @returns The recurring task.
     */
    updateRecurringTask: (recurringTaskId: string, change: RecurringTaskChange) => Promise<RecurringTask>,
    /**
     * Deletes a recurring task. The tasks created for it stay, an occurrence of nothing.
     * @param recurringTaskId - The id of the recurring task.
     */
    deleteRecurringTask: (recurringTaskId: string) => Promise<void>,
    /**
     * Creates the occurrences of every recurring task of the active tenant whose due date lies within its lead time of
     * a moment, each once, in the first column of its project whose tasks are not done. A paused one and one of an
     * archived project create nothing. Runs as the application, past what any caller sees.
     * @param now - The moment, whose day in the time zone of each recurring task its lead time counts from.
     * @returns The tasks created.
     */
    createDueOccurrences: (now: Date) => Promise<Task[]>
}
