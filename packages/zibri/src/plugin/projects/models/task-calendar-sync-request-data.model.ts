import { type TaskCalendarSyncRequest } from './task-calendar-sync-request.model';

/**
 * A request to sync the calendars as it is queued: its tenant, and what it is about.
 */
export type TaskCalendarSyncRequestData = Pick<TaskCalendarSyncRequest, 'tenantId' | 'scope'> & {
    /**
     * The id of the task or of the project, or null for the tenant.
     */
    scopeId: string | null
};
