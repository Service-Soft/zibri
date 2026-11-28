import { type EventTypeFor } from '../../../event/event-type-for.type';
import { type TaskEventData } from './task-event-data.model';

/**
 * Which changes of tasks are emitted as events, each under a type your `ZibriEventMap` declares with a
 * `TaskEventData`. A change left out is emitted as no event.
 */
export type ProjectEventNames = {
    /**
     * A task created.
     */
    taskCreated?: EventTypeFor<TaskEventData>,
    /**
     * A task moved into another column.
     */
    taskMoved?: EventTypeFor<TaskEventData>,
    /**
     * The due date of a task set, changed or removed, also when it is created with one.
     */
    taskDueDateChanged?: EventTypeFor<TaskEventData>,
    /**
     * A task done: moved into a column whose tasks are done, or in a column that became one.
     */
    taskDone?: EventTypeFor<TaskEventData>
};
