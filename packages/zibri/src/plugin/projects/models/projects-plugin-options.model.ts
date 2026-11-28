import { type ProjectEventNames } from './project-event-names.model';
import { type ProjectInvitee } from './project-invitee.model';
import { type ProjectUser } from './project-user.model';
import { type ProjectsCalendarSyncOptions } from './projects-calendar-sync-options.model';

/**
 * Configuration for the projects plugin.
 */
export type ProjectsPluginOptions = {
    /**
     * The tenant roles somebody invited by sharing a project by email becomes a member with, such as a role `guest`
     * without `projects.read`, which sees only what is shared with its holders.
     */
    readonly guestRoles: string[],
    /**
     * Finds the users of the given ids, each by the name the application shows for them and their email address. A
     * user it leaves out is shown by their id. A caller who does not see every project of the tenant is answered the
     * names alone.
     */
    readonly findUsers: (userIds: string[]) => Promise<Required<ProjectUser>[]>,
    /**
     * How long an invitation sent by sharing a project by email lasts, or undefined for one that lasts until it is
     * answered or revoked.
     */
    readonly invitationExpiresInMs: number | undefined,
    /**
     * How the due dates of tasks are written into the calendar of their project, or undefined for an application
     * that writes them into no calendar. With it, the data source declares `TenantWebDavConnection`,
     * `CalendarEntryLink` and `TaskCalendarSyncRequest`.
     */
    // required although undefined is one of its values: a tenant setting a calendar that nothing syncs into would be
    // a mistake nobody hears of
    readonly calendarSync: ProjectsCalendarSyncOptions | undefined,
    /**
     * The columns of your own of the invitation entity, for an invitation sent by sharing a project by email, such as
     * `{ name: invitee.name }`.
     * @default None
     */
    readonly invitationColumns: (invitee: ProjectInvitee) => object,
    /**
     * Which changes of tasks are emitted as events.
     * @default {}
     */
    readonly eventNames: ProjectEventNames
};
