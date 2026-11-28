import { type RepositoryTransaction } from '../../../data-source/transaction/repository-transaction.type';
import { type TaskCalendarSyncRequestData } from '../models/task-calendar-sync-request-data.model';

/**
 * Interface for the service writing the due dates of tasks into the calendars of their projects, one way, retried
 * while the server of a calendar cannot be reached. A task with a due date that is not done has an event in the
 * calendar that applies to its project; any other task has none.
 */
export interface TaskCalendarSyncServiceInterface {
    /**
     * Queues requests to sync, such as for the tasks a write changed, in the transaction of the write.
     * @param requests - The requests, each in its tenant.
     * @param transaction - The transaction of the write, if any.
     */
    queueRequests: (requests: TaskCalendarSyncRequestData[], transaction: RepositoryTransaction | undefined) => Promise<void>,
    /**
     * Tells the instance that syncs the calendars that requests were queued, once they are committed.
     */
    wakeUp: () => Promise<void>,
    /**
     * Runs one pass over the requests that are due, of every tenant.
     * @returns Whether it ran any.
     */
    syncDueRequests: () => Promise<boolean>,
    /**
     * Syncs one task of the active tenant as it is now: writes its event into the calendar of its project, and
     * removes it from every other calendar it is in.
     * @param taskId - The id of the task, which may be deleted.
     * @throws HttpClientError when the server of a calendar refuses the event or cannot be reached.
     */
    syncTask: (taskId: string) => Promise<void>
}