import { type EventTypeFor } from '../../event/event-type-for.type';
import { FrameworkEventUtilities } from '../../event/framework-event.utilities';
import { type TaskEventData } from './models/task-event-data.model';
import { type Task } from './models/task.model';

/**
 * Emits the changes of tasks as the events the application named for them.
 */
export abstract class ProjectEventUtilities {
    /**
     * Emits a change of tasks, once they are stored, in their tenant.
     * @param type - The type the application named, or undefined for none.
     * @param tasks - The tasks.
     */
    static async emit(type: EventTypeFor<TaskEventData> | undefined, tasks: Task[]): Promise<void> {
        if (type == undefined) {
            return;
        }
        await Promise.all(tasks.map(async task => {
            const data: TaskEventData = { taskId: task.id, projectId: task.projectId, columnId: task.columnId };
            await FrameworkEventUtilities.emit(type, data, task.tenantId);
        }));
    }
}
