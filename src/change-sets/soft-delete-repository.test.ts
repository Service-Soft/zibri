import assert from 'node:assert';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

import { ChangeSetType } from './models/change-set-type.enum';
import { ChangeSet, CreateChangeSetData } from './models/change-set.model';
import { Change } from './models/change.model';
import { SoftDeleteEntity } from './models/soft-delete-entity.model';
import { SoftDeleteWhere } from './models/soft-delete-where.model';
import { SoftDeleteRepository } from './soft-delete-repository';
import { Roles } from '../__testing__/mocks/entities/roles.enum';
import { createTestDataSource, defaultTestServerEntities } from '../__testing__/test-server/create-test-data-source.function';
import { startTestServer, StartedTestServer } from '../__testing__/test-server/start-test-server.function';
import { DefaultTestServerUserRepository } from '../__testing__/test-server/user-repository';
import { AuthServiceInterface } from '../auth/auth-service.interface';
import { Auth } from '../auth/decorators/auth.decorator';
import { BaseUserEntity } from '../auth/models/base-user.model';
import { JwtAuthData } from '../auth/strategies/jwt/jwt-auth-data.model';
import { JwtCredentials } from '../auth/strategies/jwt/jwt-credentials.model';
import { JwtAuthStrategy } from '../auth/strategies/jwt/jwt.auth-strategy';
import { Repository } from '../data-source/repository';
import { InjectRepository, repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { OmitClass } from '../entity/omit-class.model';
import { PartialClass } from '../entity/partial-class.model';
import { Body } from '../routing/decorators/body.decorator';
import { Controller } from '../routing/decorators/controller.decorator';
import { Delete } from '../routing/decorators/delete.decorator';
import { Get } from '../routing/decorators/get.decorator';
import { Param } from '../routing/decorators/param.decorator';
import { Patch } from '../routing/decorators/patch.decorator';
import { Post } from '../routing/decorators/post.decorator';
import { JsonUtilities } from '../utilities/json.utilities';

// ---------- Test entity ----------
@Entity()
class Task extends SoftDeleteEntity {
    @Property.string()
    title!: string;
}

class CreateTaskDto extends OmitClass(Task, ['changeSets', 'id', 'deleted']) {}
class UpdateTaskDto extends PartialClass(OmitClass(Task, ['changeSets', 'id', 'deleted'])) {}

@Entity()
class TestUser extends BaseUserEntity(Roles) {
    @Property.string({ hash: true })
    password!: string;
}

// ---------- Controller ----------
@Controller('/tasks')
class TaskController {
    constructor(
        @InjectRepository(Task)
        private readonly repo: SoftDeleteRepository<Task>
    ) {}

    @Post('/')
    @Auth.isLoggedIn([JwtAuthStrategy])
    async create(@Body(CreateTaskDto) body: CreateTaskDto): Promise<Task> {
        return this.repo.create(body);
    }

    @Patch('/:id')
    @Auth.isLoggedIn([JwtAuthStrategy])
    async update(
        @Param.path('id')
        id: string,
        @Body(UpdateTaskDto)
        body: UpdateTaskDto,
        @Param.query('withDeleted', { type: 'boolean', required: false })
        withDeleted: boolean = false
    ): Promise<Task> {
        return this.repo.updateById(id, body, { withDeleted });
    }

    @Delete('/:id')
    @Auth.isLoggedIn([JwtAuthStrategy])
    async softDelete(@Param.path('id') id: string): Promise<Task> {
        return this.repo.deleteById(id);
    }

    @Delete('/:id/hard')
    @Auth.isLoggedIn([JwtAuthStrategy])
    async hardDelete(@Param.path('id') id: string): Promise<Task> {
        return this.repo.deleteById(id, { hardDelete: true });
    }

    @Get('/')
    @Auth.isLoggedIn([JwtAuthStrategy])
    async getAll(): Promise<Task[]> {
        return this.repo.findAll();
    }

    @Get('/with-deleted')
    @Auth.isLoggedIn([JwtAuthStrategy])
    async getAllWithDeleted(): Promise<Task[]> {
        return this.repo.findAll({ withDeleted: true });
    }

    @Get('/:id')
    @Auth.isLoggedIn([JwtAuthStrategy])
    async getById(@Param.path('id') id: string): Promise<Task> {
        return this.repo.findById(id);
    }
}

// ---------- Test setup ----------
let server: StartedTestServer;
let baseUrl: string;
let accessToken: string;

let changeSetRepo: Repository<ChangeSet, CreateChangeSetData>;
let changeRepo: Repository<Change>;
let taskRepo: SoftDeleteRepository<Task>;

beforeAll(async () => {
    server = await startTestServer({
        dataSources: [
            createTestDataSource({
                entities: [...defaultTestServerEntities, Task, TestUser]
            })
        ],
        controllers: [TaskController]
    });
    baseUrl = await server.start();

    changeSetRepo = inject(repositoryTokenFor(ChangeSet));
    changeRepo = inject(repositoryTokenFor(Change));
    taskRepo = inject(repositoryTokenFor(Task)) as SoftDeleteRepository<Task>;

    const userRepo: DefaultTestServerUserRepository = inject(DefaultTestServerUserRepository);
    const credentialsRepo: Repository<JwtCredentials> = inject(repositoryTokenFor(JwtCredentials));

    const testEmail: string = 'task-test@example.com';
    const testPassword: string = 'test123';
    await userRepo.create({ email: testEmail, roles: [Roles.USER] });
    await credentialsRepo.create({
        email: testEmail,
        password: testPassword,
        userId: (await userRepo.findOne({ where: { email: testEmail } }, true)).id
    });

    const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
    const authData: JwtAuthData<Roles> = await authService.login(JwtAuthStrategy<Roles>, {
        email: testEmail,
        password: testPassword
    });
    accessToken = authData.accessToken.value;
}, 15000);

afterAll(async () => {
    await server.shutdown();
});

beforeEach(async () => {
    await changeSetRepo.deleteAll({});
    await changeRepo.deleteAll({});
    await taskRepo.deleteAll({}, { hardDelete: true });
});

async function authFetch(path: string, options: RequestInit = {}): Promise<Response> {
    const res: Response = await fetch(`${baseUrl}${path}`, {
        ...options,
        headers: {
            ...options.headers,
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        }
    });
    if (!res.ok) {
        const body: unknown = await res.json();
        throw new Error(`Request "${options.method ?? 'GET'} ${path}" failed:\n${JsonUtilities.stringify(body, undefined, 4)}`);
    }
    return res;
}

// ---------- Tests ----------
describe('SoftDeleteRepository behavior', () => {
    it('created task is not deleted', async () => {
        const res: Response = await authFetch('/tasks', {
            method: 'POST',
            body: JSON.stringify({ title: 'Buy milk' })
        });
        const task: Task = await res.json() as Task;
        expect(task.deleted).toBe(false);
    });

    describe('soft delete', () => {
        let taskId: string;

        beforeEach(async () => {
            const res: Response = await authFetch('/tasks', {
                method: 'POST',
                body: JSON.stringify({ title: 'Temporary' })
            });
            const task: Task = await res.json() as Task;
            taskId = task.id;
        });

        it('marks the entity as deleted and creates a DELETE change set', async () => {
            await authFetch(`/tasks/${taskId}`, { method: 'DELETE' });

            const tasks: Task[] = await taskRepo.findAll({ withDeleted: true });
            const task: Task | undefined = tasks.find(t => t.id === taskId);
            assert(task);
            expect(task.deleted).toBe(true);

            const changeSets: ChangeSet[] = await changeSetRepo.findAll({ where: { changeSetEntityId: taskId } });
            expect(changeSets.some(cs => cs.type === ChangeSetType.DELETE)).toBe(true);
        });

        it('findById throws NotFoundError for soft-deleted task', async () => {
            await authFetch(`/tasks/${taskId}`, { method: 'DELETE' });
            await expect(taskRepo.findById(taskId)).rejects.toThrow('Could not find');
        });

        it('findById with withDeleted=true returns the task', async () => {
            await authFetch(`/tasks/${taskId}`, { method: 'DELETE' });
            const task: Task = await taskRepo.findById(taskId, { withDeleted: true });
            expect(task.deleted).toBe(true);
        });

        it('soft-deleted task can be updated if withDeleted is passed', async () => {
            await authFetch(`/tasks/${taskId}`, { method: 'DELETE' });
            const params: URLSearchParams = new URLSearchParams({ withDeleted: 'true' });
            // Update using the controller, which uses updateById with options that allow withDeleted
            await authFetch(`/tasks/${taskId}?${params.toString()}`, {
                method: 'PATCH',
                body: JSON.stringify({ title: 'Still here' })
            });
        });
    });

    describe('hard delete', () => {
        let taskId: string;

        beforeEach(async () => {
            const res: Response = await authFetch('/tasks', {
                method: 'POST',
                body: JSON.stringify({ title: 'To be removed' })
            });
            const task: Task = await res.json() as Task;
            taskId = task.id;
        });

        it('removes the entity from the database', async () => {
            await authFetch(`/tasks/${taskId}/hard`, { method: 'DELETE' });
            await expect(taskRepo.findById(taskId)).rejects.toThrow('Could not find');
        });
    });

    describe('findAll queries', () => {
        let activeId: string;
        let deletedId: string;

        beforeEach(async () => {
            const res1: Response = await authFetch('/tasks', {
                method: 'POST',
                body: JSON.stringify({ title: 'Active' })
            });
            activeId = (await res1.json() as Task).id;

            const res2: Response = await authFetch('/tasks', {
                method: 'POST',
                body: JSON.stringify({ title: 'Removed' })
            });
            deletedId = (await res2.json() as Task).id;
            await authFetch(`/tasks/${deletedId}`, { method: 'DELETE' });
        });

        it('default findAll returns only non-deleted entities', async () => {
            const res: Response = await authFetch('/tasks');
            const tasks: Task[] = await res.json() as Task[];
            expect(tasks.map(t => t.id)).toEqual([activeId]);
        });

        it('findAll with withDeleted returns all entities', async () => {
            const res: Response = await authFetch('/tasks/with-deleted');
            const tasks: Task[] = await res.json() as Task[];
            expect(tasks.map(t => t.id).sort()).toEqual([activeId, deletedId].sort());
        });
    });

    describe('deleteAll', () => {
        let id1: string, id2: string;

        beforeEach(async () => {
            const res1: Response = await authFetch('/tasks', {
                method: 'POST',
                body: JSON.stringify({ title: 'Task 1' })
            });
            id1 = (await res1.json() as Task).id;

            const res2: Response = await authFetch('/tasks', {
                method: 'POST',
                body: JSON.stringify({ title: 'Task 2' })
            });
            id2 = (await res2.json() as Task).id;
        });

        it('soft deletes all matching entities', async () => {
            const where: SoftDeleteWhere<Task> = { title: 'Task 1' };
            await taskRepo.deleteAll(where); // soft delete by default

            const allTasks: Task[] = await taskRepo.findAll({ withDeleted: true });
            const task1: Task | undefined = allTasks.find(t => t.id === id1);
            const task2: Task | undefined = allTasks.find(t => t.id === id2);
            assert(task1 && task2);
            expect(task1.deleted).toBe(true);
            expect(task2.deleted).toBe(false);
        });

        it('hard deletes all matching entities', async () => {
            const where: SoftDeleteWhere<Task> = { title: 'Task 2' };
            await taskRepo.deleteAll(where, { hardDelete: true });

            const allTasks: Task[] = await taskRepo.findAll({ withDeleted: true });
            expect(allTasks.find(t => t.id === id2)).toBeUndefined();
        });
    });
});