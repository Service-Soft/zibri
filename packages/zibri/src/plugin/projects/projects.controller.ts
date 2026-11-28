import { Auth } from '../../auth/decorators/auth.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { PaginationResult } from '../../data-source/models/pagination-result.model';
import { inject } from '../../di/inject.function';
import { Response } from '../../open-api/decorators/response.decorator';
import { type Route } from '../../routing/controller-route-configuration.model';
import { Body } from '../../routing/decorators/body.decorator';
import { Delete } from '../../routing/decorators/delete.decorator';
import { Get } from '../../routing/decorators/get.decorator';
import { Param } from '../../routing/decorators/param.decorator';
import { Patch } from '../../routing/decorators/patch.decorator';
import { Post } from '../../routing/decorators/post.decorator';
import { Put } from '../../routing/decorators/put.decorator';
import { NewProjectColumn } from './models/new-project-column.model';
import { NewProjectShare } from './models/new-project-share.model';
import { NewProject } from './models/new-project.model';
import { NewRecurringTask } from './models/new-recurring-task.model';
import { NewTaskComment } from './models/new-task-comment.model';
import { NewTaskLabel } from './models/new-task-label.model';
import { NewTask } from './models/new-task.model';
import { type ProjectAccess } from './models/project-access.model';
import { ProjectBoard } from './models/project-board.model';
import { ProjectCalendar } from './models/project-calendar.model';
import { ProjectChange } from './models/project-change.model';
import { ProjectColumnChange } from './models/project-column-change.model';
import { ProjectColumnMove } from './models/project-column-move.model';
import { ProjectColumn } from './models/project-column.model';
import { ProjectShareResult } from './models/project-share-result.model';
import { ProjectShareRole } from './models/project-share-role.model';
import { ProjectShare } from './models/project-share.model';
import { ProjectUser } from './models/project-user.model';
import { ProjectWithAccess } from './models/project-with-access.model';
import { Project } from './models/project.model';
import { ProjectsAccess } from './models/projects-access.model';
import { RecurringTaskChange } from './models/recurring-task-change.model';
import { RecurringTask } from './models/recurring-task.model';
import { TaskChange } from './models/task-change.model';
import { TaskCommentPage } from './models/task-comment-page.model';
import { TaskComment } from './models/task-comment.model';
import { TaskLabelChange } from './models/task-label-change.model';
import { TaskLabel } from './models/task-label.model';
import { TaskMove } from './models/task-move.model';
import { Task } from './models/task.model';
import { WorkingCalendarChange } from './models/working-calendar-change.model';
import { ZIBRI_PROJECTS_PLUGIN_DI_TOKENS } from './projects.tokens';
import { type ProjectAccessServiceInterface } from './services/project-access-service.interface';
import { type ProjectServiceInterface } from './services/project-service.interface';
import { type RecurringTaskServiceInterface } from './services/recurring-task-service.interface';
import { type TaskServiceInterface } from './services/task-service.interface';
import { type WorkingCalendarServiceInterface } from './services/working-calendar-service.interface';

/**
 * The most rows a page of the list routes holds.
 */
const MAX_LIMIT: number = 100;

/**
 * The route of one task.
 */
const TASK_ROUTE: Route = '/tasks/:taskId';

/**
 * The route of one project.
 */
const PROJECT_ROUTE: Route = '/:projectId';

/**
 * The route of one recurring task.
 */
const RECURRING_TASK_ROUTE: Route = '/recurring-tasks/:recurringTaskId';

/**
 * The routes of the projects of the tenant of the request, below the path of the controller that extends it: the
 * projects, their boards with their columns, labels and tasks, the comments on the tasks, archiving and sharing. A
 * route answers what the caller sees, which is every project of the tenant with `projects.read`, and the projects
 * shared with them and the projects below those otherwise. Writing a project takes `projects.write`, archiving,
 * deleting and sharing it `projects.manage`, each of the tenant or its platform variant. On a board, a viewer reads, a
 * commenter also comments and an editor also writes the tasks, columns and labels, where `projects.read` makes a
 * member a viewer and `projects.write` beside it an editor of every project.
 */
// no @Controller of its own, for the reason MailingListController has none: the application's class extending this
// one says where the routes are. Every decorator is on a route rather than the class, which the application's class
// would not inherit. The routes of the board are open to every caller who is logged in: what a caller sees and the
// role they hold on it are the projects' own, which the services check
export class ProjectsController {
    private get projectService(): ProjectServiceInterface {
        return inject(ZIBRI_PROJECTS_PLUGIN_DI_TOKENS.PROJECT_SERVICE);
    }

    private get taskService(): TaskServiceInterface {
        return inject(ZIBRI_PROJECTS_PLUGIN_DI_TOKENS.TASK_SERVICE);
    }

    private get accessService(): ProjectAccessServiceInterface {
        return inject(ZIBRI_PROJECTS_PLUGIN_DI_TOKENS.PROJECT_ACCESS_SERVICE);
    }

    private get recurringTaskService(): RecurringTaskServiceInterface {
        return inject(ZIBRI_PROJECTS_PLUGIN_DI_TOKENS.RECURRING_TASK_SERVICE);
    }

    private get calendarService(): WorkingCalendarServiceInterface {
        return inject(ZIBRI_PROJECTS_PLUGIN_DI_TOKENS.WORKING_CALENDAR_SERVICE);
    }

    @Auth.isLoggedIn()
    @Response.paginated(Project)
    @Get('/')
    async findProjects(
        @Param.query('page', { type: 'number', format: 'integer', min: 1 })
        page: number,
        @Param.query('limit', { type: 'number', format: 'integer', min: 1, max: MAX_LIMIT })
        limit: number,
        @Param.query('parentId', { type: 'string', format: 'uuid', required: false })
        parentId: string | undefined,
        @Param.query('search', { type: 'string', required: false })
        search: string | undefined,
        @Param.query('includeArchived', { type: 'boolean', required: false })
        includeArchived: boolean | undefined
    ): Promise<PaginationResult<Project>> {
        return await this.projectService.findProjects(page, limit, { parentId, search, includeArchived });
    }

    @Auth.hasAnyLevelPermission(ProjectsAccess.WRITE)
    @Response.object(Project)
    @Post('/')
    async createProject(
        @Body(NewProject)
        project: NewProject
    ): Promise<Project> {
        return await this.projectService.createProject(project);
    }

    @Auth.isLoggedIn()
    @Response.paginated(Task)
    @Get('/tasks')
    async findTasks(
        @Param.query('page', { type: 'number', format: 'integer', min: 1 })
        page: number,
        @Param.query('limit', { type: 'number', format: 'integer', min: 1, max: MAX_LIMIT })
        limit: number,
        @Param.query('projectId', { type: 'string', format: 'uuid', required: false })
        projectId: string | undefined,
        @Param.query('search', { type: 'string', required: false })
        search: string | undefined,
        @Param.query('assigneeId', { type: 'string', format: 'uuid', required: false })
        assigneeId: string | undefined,
        @Param.query('includeArchived', { type: 'boolean', required: false })
        includeArchived: boolean | undefined
    ): Promise<PaginationResult<Task>> {
        return await this.taskService.findTasks(page, limit, { projectId, search, assigneeId, includeArchived });
    }

    @Auth.isLoggedIn()
    @Response.object(Task)
    @Get(TASK_ROUTE)
    async findTask(
        @Param.path('taskId', { type: 'string', format: 'uuid' })
        taskId: string
    ): Promise<Task> {
        return await this.taskService.findTask(taskId);
    }

    @Auth.isLoggedIn()
    @Response.object(Task)
    @Patch(TASK_ROUTE)
    async updateTask(
        @Param.path('taskId', { type: 'string', format: 'uuid' })
        taskId: string,
        @Body(TaskChange)
        change: TaskChange
    ): Promise<Task> {
        return await this.taskService.updateTask(taskId, change);
    }

    @Auth.isLoggedIn()
    @Response.object(Task)
    @Post('/tasks/:taskId/move')
    async moveTask(
        @Param.path('taskId', { type: 'string', format: 'uuid' })
        taskId: string,
        @Body(TaskMove)
        move: TaskMove
    ): Promise<Task> {
        return await this.taskService.moveTask(taskId, move);
    }

    @Auth.isLoggedIn()
    @Response.empty()
    @Delete(TASK_ROUTE)
    async deleteTask(
        @Param.path('taskId', { type: 'string', format: 'uuid' })
        taskId: string
    ): Promise<void> {
        await this.taskService.deleteTask(taskId);
    }

    @Auth.isLoggedIn()
    @Response.object(TaskCommentPage)
    @Get('/tasks/:taskId/comments')
    async findComments(
        @Param.path('taskId', { type: 'string', format: 'uuid' })
        taskId: string,
        @Param.query('page', { type: 'number', format: 'integer', min: 1 })
        page: number,
        @Param.query('limit', { type: 'number', format: 'integer', min: 1, max: MAX_LIMIT })
        limit: number
    ): Promise<TaskCommentPage> {
        return await this.taskService.findComments(taskId, page, limit);
    }

    @Auth.isLoggedIn()
    @Response.object(TaskComment)
    @Post('/tasks/:taskId/comments')
    async createComment(
        @Param.path('taskId', { type: 'string', format: 'uuid' })
        taskId: string,
        @Body(NewTaskComment)
        comment: NewTaskComment
    ): Promise<TaskComment> {
        return await this.taskService.createComment(taskId, comment);
    }

    @Auth.isLoggedIn()
    @Response.object(TaskComment)
    @Patch('/comments/:commentId')
    async updateComment(
        @Param.path('commentId', { type: 'string', format: 'uuid' })
        commentId: string,
        @Body(NewTaskComment)
        comment: NewTaskComment
    ): Promise<TaskComment> {
        return await this.taskService.updateComment(commentId, comment);
    }

    @Auth.isLoggedIn()
    @Response.empty()
    @Delete('/comments/:commentId')
    async deleteComment(
        @Param.path('commentId', { type: 'string', format: 'uuid' })
        commentId: string
    ): Promise<void> {
        await this.taskService.deleteComment(commentId);
    }

    @Auth.isLoggedIn()
    @Response.object(ProjectColumn)
    @Patch('/columns/:columnId')
    async updateColumn(
        @Param.path('columnId', { type: 'string', format: 'uuid' })
        columnId: string,
        @Body(ProjectColumnChange)
        change: ProjectColumnChange
    ): Promise<ProjectColumn> {
        return await this.projectService.updateColumn(columnId, change);
    }

    @Auth.isLoggedIn()
    @Response.object(ProjectColumn)
    @Post('/columns/:columnId/move')
    async moveColumn(
        @Param.path('columnId', { type: 'string', format: 'uuid' })
        columnId: string,
        @Body(ProjectColumnMove)
        move: ProjectColumnMove
    ): Promise<ProjectColumn> {
        return await this.projectService.moveColumn(columnId, move);
    }

    @Auth.isLoggedIn()
    @Response.empty()
    @Delete('/columns/:columnId')
    async deleteColumn(
        @Param.path('columnId', { type: 'string', format: 'uuid' })
        columnId: string
    ): Promise<void> {
        await this.projectService.deleteColumn(columnId);
    }

    @Auth.isLoggedIn()
    @Response.object(TaskLabel)
    @Patch('/labels/:labelId')
    async updateLabel(
        @Param.path('labelId', { type: 'string', format: 'uuid' })
        labelId: string,
        @Body(TaskLabelChange)
        change: TaskLabelChange
    ): Promise<TaskLabel> {
        return await this.projectService.updateLabel(labelId, change);
    }

    @Auth.isLoggedIn()
    @Response.empty()
    @Delete('/labels/:labelId')
    async deleteLabel(
        @Param.path('labelId', { type: 'string', format: 'uuid' })
        labelId: string
    ): Promise<void> {
        await this.projectService.deleteLabel(labelId);
    }

    @Auth.isLoggedIn()
    @Response.object(ProjectWithAccess)
    @Get(PROJECT_ROUTE)
    async findProject(
        @Param.path('projectId', { type: 'string', format: 'uuid' })
        projectId: string
    ): Promise<ProjectWithAccess> {
        const access: ProjectAccess = await this.accessService.resolveAccess(projectId);
        return { ...access.project, access: { role: access.role, fullAccess: access.fullAccess } };
    }

    @Auth.hasAnyLevelPermission(ProjectsAccess.WRITE)
    @Response.object(Project)
    @Patch(PROJECT_ROUTE)
    async updateProject(
        @Param.path('projectId', { type: 'string', format: 'uuid' })
        projectId: string,
        @Body(ProjectChange)
        change: ProjectChange
    ): Promise<Project> {
        return await this.projectService.updateProject(projectId, change);
    }

    @Auth.hasAnyLevelPermission(ProjectsAccess.MANAGE)
    @Response.empty()
    @Delete(PROJECT_ROUTE)
    async deleteProject(
        @Param.path('projectId', { type: 'string', format: 'uuid' })
        projectId: string
    ): Promise<void> {
        await this.projectService.deleteProject(projectId);
    }

    @Auth.hasAnyLevelPermission(ProjectsAccess.MANAGE)
    @Response.object(Project)
    @Post('/:projectId/archive')
    async archiveProject(
        @Param.path('projectId', { type: 'string', format: 'uuid' })
        projectId: string
    ): Promise<Project> {
        return await this.projectService.archiveProject(projectId);
    }

    @Auth.hasAnyLevelPermission(ProjectsAccess.MANAGE)
    @Response.object(Project)
    @Delete('/:projectId/archive')
    async unarchiveProject(
        @Param.path('projectId', { type: 'string', format: 'uuid' })
        projectId: string
    ): Promise<Project> {
        return await this.projectService.unarchiveProject(projectId);
    }

    @Auth.isLoggedIn()
    @Response.object(ProjectBoard)
    @Get('/:projectId/board')
    async resolveBoard(
        @Param.path('projectId', { type: 'string', format: 'uuid' })
        projectId: string
    ): Promise<ProjectBoard> {
        return await this.projectService.resolveBoard(projectId);
    }

    @Auth.isLoggedIn()
    @Response.array(ProjectUser)
    @Get('/:projectId/users')
    async findProjectUsers(
        @Param.path('projectId', { type: 'string', format: 'uuid' })
        projectId: string
    ): Promise<ProjectUser[]> {
        return await this.accessService.findProjectUsers(projectId);
    }

    @Auth.isLoggedIn()
    @Response.object(Task)
    @Post('/:projectId/tasks')
    async createTask(
        @Param.path('projectId', { type: 'string', format: 'uuid' })
        projectId: string,
        @Body(NewTask)
        task: NewTask
    ): Promise<Task> {
        return await this.taskService.createTask(projectId, task);
    }

    @Auth.isLoggedIn()
    @Response.object(ProjectColumn)
    @Post('/:projectId/columns')
    async createColumn(
        @Param.path('projectId', { type: 'string', format: 'uuid' })
        projectId: string,
        @Body(NewProjectColumn)
        column: NewProjectColumn
    ): Promise<ProjectColumn> {
        return await this.projectService.createColumn(projectId, column);
    }

    @Auth.isLoggedIn()
    @Response.object(TaskLabel)
    @Post('/:projectId/labels')
    async createLabel(
        @Param.path('projectId', { type: 'string', format: 'uuid' })
        projectId: string,
        @Body(NewTaskLabel)
        label: NewTaskLabel
    ): Promise<TaskLabel> {
        return await this.projectService.createLabel(projectId, label);
    }

    @Auth.hasAnyLevelPermission(ProjectsAccess.MANAGE)
    @Response.array(ProjectShare)
    @Get('/:projectId/shares')
    async findShares(
        @Param.path('projectId', { type: 'string', format: 'uuid' })
        projectId: string
    ): Promise<ProjectShare[]> {
        return await this.projectService.findShares(projectId);
    }

    @Auth.hasAnyLevelPermission(ProjectsAccess.MANAGE)
    @Response.object(ProjectShareResult)
    @Post('/:projectId/shares')
    async shareByEmail(
        @Param.path('projectId', { type: 'string', format: 'uuid' })
        projectId: string,
        @Body(NewProjectShare)
        share: NewProjectShare,
        @CurrentUser()
        user: CurrentUser
    ): Promise<ProjectShareResult> {
        return await this.projectService.shareByEmail(user, projectId, share);
    }

    @Auth.hasAnyLevelPermission(ProjectsAccess.MANAGE)
    @Response.object(ProjectShare)
    @Put('/:projectId/shares/:userId')
    async share(
        @Param.path('projectId', { type: 'string', format: 'uuid' })
        projectId: string,
        @Param.path('userId', { type: 'string', format: 'uuid' })
        userId: string,
        @Body(ProjectShareRole)
        role: ProjectShareRole
    ): Promise<ProjectShare> {
        return await this.projectService.share(projectId, userId, role.role);
    }

    @Auth.hasAnyLevelPermission(ProjectsAccess.MANAGE)
    @Response.empty()
    @Delete('/:projectId/shares/:userId')
    async unshare(
        @Param.path('projectId', { type: 'string', format: 'uuid' })
        projectId: string,
        @Param.path('userId', { type: 'string', format: 'uuid' })
        userId: string
    ): Promise<void> {
        await this.projectService.unshare(projectId, userId);
    }

    @Auth.hasAnyLevelPermission(ProjectsAccess.READ)
    @Response.object(ProjectCalendar)
    @Get('/calendar')
    async findTenantCalendar(): Promise<ProjectCalendar> {
        return await this.calendarService.findTenantCalendar();
    }

    @Auth.hasAnyLevelPermission(ProjectsAccess.MANAGE)
    @Response.object(ProjectCalendar)
    @Patch('/calendar')
    async updateTenantCalendar(
        @Body(WorkingCalendarChange)
        change: WorkingCalendarChange
    ): Promise<ProjectCalendar> {
        return await this.calendarService.updateTenantCalendar(change);
    }

    @Auth.isLoggedIn()
    @Response.object(ProjectCalendar)
    @Get('/:projectId/calendar')
    async findProjectCalendar(
        @Param.path('projectId', { type: 'string', format: 'uuid' })
        projectId: string
    ): Promise<ProjectCalendar> {
        return await this.calendarService.findProjectCalendar(projectId);
    }

    @Auth.hasAnyLevelPermission(ProjectsAccess.MANAGE)
    @Response.object(ProjectCalendar)
    @Patch('/:projectId/calendar')
    async updateProjectCalendar(
        @Param.path('projectId', { type: 'string', format: 'uuid' })
        projectId: string,
        @Body(WorkingCalendarChange)
        change: WorkingCalendarChange
    ): Promise<ProjectCalendar> {
        return await this.calendarService.updateProjectCalendar(projectId, change);
    }

    @Auth.isLoggedIn()
    @Response.array(RecurringTask)
    @Get('/:projectId/recurring-tasks')
    async findRecurringTasks(
        @Param.path('projectId', { type: 'string', format: 'uuid' })
        projectId: string
    ): Promise<RecurringTask[]> {
        return await this.recurringTaskService.findRecurringTasks(projectId);
    }

    @Auth.isLoggedIn()
    @Response.object(RecurringTask)
    @Post('/:projectId/recurring-tasks')
    async createRecurringTask(
        @Param.path('projectId', { type: 'string', format: 'uuid' })
        projectId: string,
        @Body(NewRecurringTask)
        recurringTask: NewRecurringTask
    ): Promise<RecurringTask> {
        return await this.recurringTaskService.createRecurringTask(projectId, recurringTask);
    }

    @Auth.isLoggedIn()
    @Response.object(RecurringTask)
    @Get(RECURRING_TASK_ROUTE)
    async findRecurringTask(
        @Param.path('recurringTaskId', { type: 'string', format: 'uuid' })
        recurringTaskId: string
    ): Promise<RecurringTask> {
        return await this.recurringTaskService.findRecurringTask(recurringTaskId);
    }

    @Auth.isLoggedIn()
    @Response.object(RecurringTask)
    @Patch(RECURRING_TASK_ROUTE)
    async updateRecurringTask(
        @Param.path('recurringTaskId', { type: 'string', format: 'uuid' })
        recurringTaskId: string,
        @Body(RecurringTaskChange)
        change: RecurringTaskChange
    ): Promise<RecurringTask> {
        return await this.recurringTaskService.updateRecurringTask(recurringTaskId, change);
    }

    @Auth.isLoggedIn()
    @Response.empty()
    @Delete(RECURRING_TASK_ROUTE)
    async deleteRecurringTask(
        @Param.path('recurringTaskId', { type: 'string', format: 'uuid' })
        recurringTaskId: string
    ): Promise<void> {
        await this.recurringTaskService.deleteRecurringTask(recurringTaskId);
    }
}