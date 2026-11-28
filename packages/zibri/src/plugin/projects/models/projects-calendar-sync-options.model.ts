import { type Task } from './task.model';

/**
 * How the projects plugin writes the due dates of tasks into calendars.
 */
export type ProjectsCalendarSyncOptions = {
    /**
     * The url of the page of a task in your frontend, which its event links back to, such as
     * `https://app.example.com/projects/<projectId>/tasks/<id>`.
     */
    readonly taskUrl: (task: Task) => string
};
