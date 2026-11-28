import { type BaseUser } from '../../../auth/models/base-user.model';
import { type Permission } from '../../../auth/roles/permission.type';
import { type PlatformPermission } from '../../../auth/roles/platform-permission.type';
import { Repository } from '../../../data-source/repository/repository';
import { resolveEntityScopeContext } from '../../../data-source/scopes/resolve-entity-scope-context.function';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { Inject } from '../../../di/decorators/inject.decorator';
import { Injectable } from '../../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { type EntityScopeContext } from '../../../entity/models/entity-scope.model';
import { BadRequestError } from '../../../error-handling/errors/bad-request.error';
import { ConflictError } from '../../../error-handling/errors/conflict.error';
import { ForbiddenError } from '../../../error-handling/errors/forbidden.error';
import { InternalError } from '../../../error-handling/internal-error.model';
import { $ts } from '../../../localization/translate.function';
import { type RowShare } from '../../../sharing/row-share.model';
import { type ShareServiceInterface } from '../../../sharing/share-service.interface';
import { type ProjectAccess } from '../models/project-access.model';
import { PROJECT_ROLES, type ProjectRole } from '../models/project-role.model';
import { type ProjectUser } from '../models/project-user.model';
import { Project } from '../models/project.model';
import { ProjectsAccess } from '../models/projects-access.model';
import { type ProjectsPluginOptions } from '../models/projects-plugin-options.model';
import { ZIBRI_PROJECTS_PLUGIN_DI_TOKENS } from '../projects.tokens';
import { type ProjectAccessServiceInterface } from './project-access-service.interface';

/**
 * Default implementation of the project access service: the roles of shares, through the share service, beside the
 * permissions of the caller's membership.
 */
@Injectable({ register: 'onUse' })
export class ProjectAccessService implements ProjectAccessServiceInterface {
    // read when used rather than injected, for the reason the bank plugin reads its repositories so: the plugin's
    // validate names a missing entity rather than a failed build of this
    private get projectRepository(): Repository<Project> {
        return inject(repositoryTokenFor(Project));
    }

    private get shareService(): ShareServiceInterface {
        return inject(ZIBRI_DI_TOKENS.SHARE_SERVICE);
    }

    constructor(
        @Inject(ZIBRI_PROJECTS_PLUGIN_DI_TOKENS.OPTIONS)
        protected readonly options: ProjectsPluginOptions
    ) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveAccess(projectId: string): Promise<ProjectAccess> {
        // through the scope sharing narrows it by, so a project the caller does not see is answered 404 like one that
        // is not there
        const project: Project = await this.projectRepository.findById(projectId);
        const context: EntityScopeContext = await resolveEntityScopeContext(Project);
        const fullAccess: boolean = await context.hasAnyLevelPermission(ProjectsAccess.READ);
        const byPermissions: ProjectRole | undefined = fullAccess
            ? await context.hasAnyLevelPermission(ProjectsAccess.WRITE) ? 'editor' : 'viewer'
            : undefined;
        const userId: string | undefined = context.currentUser?.id;
        const shared: string | undefined = userId == undefined
            ? undefined
            : await this.shareService.resolveRole(Project, project.id, userId);
        // a share can give a member more than their permissions do, never less
        const role: ProjectRole | undefined = PROJECT_ROLES[Math.max(
            byPermissions == undefined ? -1 : PROJECT_ROLES.indexOf(byPermissions),
            PROJECT_ROLES.findIndex(r => r === shared)
        )];
        if (role == undefined) {
            // the project was found, so the caller sees it: through full access, or through a share
            throw new InternalError(`The caller sees the Project ${project.id} without a role on it.`);
        }
        return { project, role, fullAccess };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    validateRole(access: ProjectAccess, role: ProjectRole): void {
        if (PROJECT_ROLES.indexOf(access.role) < PROJECT_ROLES.indexOf(role)) {
            throw new ForbiddenError($ts`This needs a role of at least ${role} on the project.`);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    validateNotArchived(project: Project): void {
        if (project.archivedAt != undefined) {
            throw new ConflictError($ts`The project is archived. Bring it back to change it.`);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveHasFullAccess(): Promise<boolean> {
        return await this.shareService.resolveHasFullAccess(Project);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveSeesProject(userId: string, projectId: string): Promise<boolean> {
        const tenantId: string | undefined = inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).getActiveTenantId();
        if (tenantId == undefined) {
            throw new InternalError('Whether a user sees a project is answered in a tenant, and none is active.');
        }
        const user: BaseUser<string> | undefined = await inject(ZIBRI_DI_TOKENS.USER_SERVICE)
            .findById<string, BaseUser<string>, false>(userId, { required: false });
        if (user == undefined || user.deactivatedAt != undefined) {
            return false;
        }
        // what their roles carry outside a request, as no credential of theirs narrows it here
        const permissions: (Permission | PlatformPermission)[] = await inject(ZIBRI_DI_TOKENS.AUTH_SERVICE)
            .resolveUserPermissions(user, tenantId);
        if (permissions.includes(ProjectsAccess.READ.platformPermission)) {
            return true;
        }
        const membership: unknown = await inject(ZIBRI_DI_TOKENS.MEMBERSHIP_SERVICE).findActiveMembership(userId, tenantId);
        return membership == undefined
            ? false
            : permissions.includes(ProjectsAccess.READ.permission)
                || await this.shareService.resolveRole(Project, projectId, userId) != undefined;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async validateAssignees(projectId: string, userIds: string[]): Promise<void> {
        const unique: string[] = [...new Set(userIds)];
        const sees: boolean[] = await Promise.all(unique.map(async userId => await this.resolveSeesProject(userId, projectId)));
        const refused: string | undefined = unique.find((_, index) => sees[index] !== true);
        if (refused != undefined) {
            throw new BadRequestError(
                $ts`The user "${refused}" does not see the project, and needs to before a task of it is assigned to them.`
            );
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveUsers(userIds: string[]): Promise<ProjectUser[]> {
        const unique: string[] = [...new Set(userIds)];
        if (!unique.length) {
            return [];
        }
        const [found, fullAccess] = await Promise.all([this.options.findUsers(unique), this.resolveHasFullAccess()]);
        const byId: Map<string, Required<ProjectUser>> = new Map(found.map(user => [user.id, user]));
        return unique.map(id => {
            const user: Required<ProjectUser> | undefined = byId.get(id);
            // a user the application does not name, such as one deleted since, is shown by their id
            if (user == undefined) {
                return { id, name: id };
            }
            // the email address of somebody else is for those who see every project alone: a guest sees names
            return fullAccess ? { id, name: user.name, email: user.email } : { id, name: user.name };
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findProjectUsers(projectId: string): Promise<ProjectUser[]> {
        const access: ProjectAccess = await this.resolveAccess(projectId);
        const ancestorIds: string[] = await this.resolveAncestorIds(access.project);
        const shares: RowShare[][] = await Promise.all(ancestorIds.map(async id => await this.shareService.findShares(Project, id)));
        const tenantId: string = access.project.tenantId;
        const memberIds: string[] = await inject(ZIBRI_DI_TOKENS.MEMBERSHIP_SERVICE).findActiveMemberIds?.(tenantId) ?? [];
        const candidates: string[] = [...new Set([...shares.flat().map(share => share.userId), ...memberIds])];
        const sees: boolean[] = await Promise.all(candidates.map(async userId => await this.resolveSeesProject(userId, projectId)));
        return await this.resolveUsers(candidates.filter((_, index) => sees[index] === true));
    }

    /**
     * Resolves the ids of a project and of the projects above it, past what the caller sees, one read per project.
     * @param project - The project.
     * @returns The ids, the project first.
     */
    private async resolveAncestorIds(project: Project): Promise<string[]> {
        const res: string[] = [project.id];
        // a project is refused as the parent of one below it, so the walk ends; stopping at a project seen already
        // ends it for rows stored in a circle before that was refused
        for (let parentId: string | null | undefined = project.parentId; parentId != undefined && !res.includes(parentId);) {
            const parent: Pick<Project, 'id' | 'parentId'> | undefined = await this.projectRepository.findById(parentId, {
                select: { id: true, parentId: true },
                unscoped: true,
                required: false
            });
            if (parent == undefined) {
                break;
            }
            res.push(parent.id);
            parentId = parent.parentId;
        }
        return res;
    }
}