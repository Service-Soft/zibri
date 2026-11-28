import { Property } from '../../../entity/decorators/property.decorator';
import { OmitClass } from '../../../entity/omit-class.model';
import { ProjectCallerAccess } from './project-caller-access.model';
import { Project } from './project.model';

/**
 * A project with what the caller may do on it, as `GET /:projectId` of the `ProjectsController` answers it.
 */
export class ProjectWithAccess extends OmitClass(Project, ['parent', 'children', 'columns', 'tasks', 'labels', 'recurringTasks']) {
    /**
     * What the caller may do on the project.
     */
    @Property.object({ cls: () => ProjectCallerAccess })
    access!: ProjectCallerAccess;
}