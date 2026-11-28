import { type ProjectAccess } from '../models/project-access.model';
import { type ProjectRole } from '../models/project-role.model';
import { type ProjectUser } from '../models/project-user.model';
import { type Project } from '../models/project.model';

/**
 * Interface for the service that answers what the caller of a request may do on a project, who else sees it, and how
 * other users are shown to the caller. Every method acts in the active tenant.
 */
export interface ProjectAccessServiceInterface {
    /**
     * Resolves the project and the role of the caller on it.
     * @param projectId - The id of the project.
     * @returns The project, the role and whether the caller sees every project.
     * @throws A NotFoundError for a project the caller does not see.
     */
    resolveAccess: (projectId: string) => Promise<ProjectAccess>,
    /**
     * Validates that the caller holds at least a role on a project.
     * @param access - What the caller may do on it, as `resolveAccess` answers it.
     * @param role - The least role needed.
     * @throws A ForbiddenError for a lower role.
     */
    validateRole: (access: ProjectAccess, role: ProjectRole) => void,
    /**
     * Validates that a project and its board can be written: that it is not archived.
     * @param project - The project.
     * @throws A ConflictError for an archived project, or one below an archived project.
     */
    validateNotArchived: (project: Project) => void,
    /**
     * Resolves whether the caller of the request sees every project of the tenant.
     * @returns Whether they do.
     */
    resolveHasFullAccess: () => Promise<boolean>,
    /**
     * Resolves whether a user sees a project: an active member of the tenant whose roles carry `projects.read`, a
     * member it or a project above it is shared with, or a user whose own roles carry `projects.read_all`.
     * @param userId - The id of the user.
     * @param projectId - The id of the project.
     * @returns Whether they see it.
     */
    resolveSeesProject: (userId: string, projectId: string) => Promise<boolean>,
    /**
     * Validates the users a task of a project is assigned to: each one who sees the project.
     * @param projectId - The id of the project.
     * @param userIds - The ids of the users newly assigned.
     * @throws A BadRequestError naming a user who does not see the project.
     */
    validateAssignees: (projectId: string, userIds: string[]) => Promise<void>,
    /**
     * Resolves users as the caller is shown them: by their name, and with their email address for a caller who sees
     * every project.
     * @param userIds - The ids of the users.
     * @returns The users, each once.
     */
    resolveUsers: (userIds: string[]) => Promise<ProjectUser[]>,
    /**
     * Finds the users who see a project, such as to assign a task of it to: the members of the tenant who see every
     * project, and those it or a project above it is shared with.
     * @param projectId - The id of the project.
     * @returns The users, as the caller is shown them.
     */
    findProjectUsers: (projectId: string) => Promise<ProjectUser[]>
}
