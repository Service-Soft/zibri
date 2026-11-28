import { type ProjectCallerAccessModel } from './project-caller-access.model';
import { type ProjectModel } from './project.model';

/**
 * A project with what the caller may do on it, as `GET /projects/:projectId` answers it.
 */
export type ProjectWithAccessModel = ProjectModel & {
    /**
     * What the caller may do on the project.
     */
    access: ProjectCallerAccessModel
};