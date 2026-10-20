import assert from 'node:assert';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createInMemoryDataSource } from 'zibri-testing';

import { ChangeSetType } from './models/change-set-type.enum.ts';
import { ChangeSet, CreateChangeSetData } from './models/change-set.model.ts';
import { Change } from './models/change.model.ts';
import { SoftDeleteEntity } from './models/soft-delete-entity.model.ts';
import { SoftDeleteWhere } from './models/soft-delete-where.model.ts';
import { SoftDeleteRepository } from './soft-delete-repository.ts';
import { Roles } from '../__testing__/mocks/entities/roles.enum.ts';
import { defaultTestServerEntities } from '../__testing__/test-server/create-test-data-source.function.ts';
import { startTestServer, StartedTestServer } from '../__testing__/test-server/start-test-server.function.ts';
import { DefaultTestServerUserRepository } from '../__testing__/test-server/user-repository.ts';
import { AuthServiceInterface } from '../auth/auth-service.interface.ts';
import { PasswordCredentials, PasswordCredentialsCreateData } from '../auth/authenticators/password/password-credentials.model.ts';
import { PasswordAuthenticator } from '../auth/authenticators/password/password.authenticator.ts';
import { Auth } from '../auth/decorators/auth.decorator.ts';
import { BaseUserEntity } from '../auth/models/base-user.model.ts';
import { JwtAuthData } from '../auth/strategies/jwt/jwt-auth-data.model.ts';
import { JwtAuthStrategy } from '../auth/strategies/jwt/jwt.auth-strategy.ts';
import { Where } from '../data-source/models/where/where-filter.model.ts';
import { Repository } from '../data-source/repository/repository.ts';
import { InjectRepository, repositoryTokenFor } from '../di/decorators/inject-repository.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default.ts';
import { inject } from '../di/inject.function.ts';
import { Entity } from '../entity/decorators/entity.decorator.ts';
import { Property } from '../entity/decorators/property.decorator.ts';
import { OmitClass } from '../entity/omit-class.model.ts';
import { PartialClass } from '../entity/partial-class.model.ts';
import { ConflictError } from '../error-handling/errors/conflict.error.ts';
import { NotFoundError } from '../error-handling/errors/not-found.error.ts';
import { InternalError } from '../error-handling/internal-error.model.ts';
import { Body } from '../routing/decorators/body.decorator.ts';
import { Controller } from '../routing/decorators/controller.decorator.ts';
import { Delete } from '../routing/decorators/delete.decorator.ts';
import { Get } from '../routing/decorators/get.decorator.ts';
import { Param } from '../routing/decorators/param.decorator.ts';
import { Patch } from '../routing/decorators/patch.decorator.ts';
import { Post } from '../routing/decorators/post.decorator.ts';
import { JsonUtilities } from '../utilities/json.utilities.ts';

// ---------- Test entity ----------
@Entity({ tenant: 'shared' })
class Task extends SoftDeleteEntity {
    @Property.string()
    title!: string;
}

class CreateTaskDto extends OmitClass(Task, ['changeSets', 'id', 'deleted']) {}
class UpdateTaskDto extends PartialClass(OmitClass(Task, ['changeSets', 'id', 'deleted'])) {}

@Entity({ tenant: 'shared' })
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
        return this.repo.updateById(id, body, { deleted: withDeleted ? 'include' : 'exclude' });
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
        return this.repo.findAll({ deleted: 'include' });
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
        // in process: nothing here depends on which store is underneath, which the shared cases of
        // src/data-source/tests cover
        dataSources: [
            createInMemoryDataSource({
                entities: [...defaultTestServerEntities, Task, TestUser]
            })
        ],
        controllers: [TaskController]
    });
    baseUrl = await server.start();

    changeSetRepo = inject(repositoryTokenFor(ChangeSet));
    changeRepo = inject(repositoryTokenFor(Change));
    taskRepo = inject(repositoryTokenFor(Task));

    const userRepo: DefaultTestServerUserRepository = inject(DefaultTestServerUserRepository);
    const credentialsRepo: Repository<PasswordCredentials, PasswordCredentialsCreateData> = inject(repositoryTokenFor(PasswordCredentials));

    const testEmail: string = 'task-test@example.com';
    const testPassword: string = 'test123';
    await userRepo.create({ email: testEmail, roles: [Roles.USER] });
    await credentialsRepo.create({
        password: testPassword,
        userId: (await userRepo.findOne({ where: { email: testEmail } })).id
    });

    const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
    const authData: JwtAuthData<Roles> = await authService.login(
        PasswordAuthenticator<Roles>,
        JwtAuthStrategy<Roles>,
        { email: testEmail, password: testPassword },
        undefined
    );
    accessToken = authData.accessToken.value;
}, 15000);

afterAll(async () => {
    await server.shutdown();
}, 15000);

beforeEach(async () => {
    await changeSetRepo.deleteAll({});
    await changeRepo.deleteAll({});
    await taskRepo.deleteAll({}, { hardDelete: true });
});

async function authFetch(path: string, options: RequestInit = {}): Promise<Response> {
    // a Headers instance or a list of pairs loses its entries when spread into an object
    const headers: Headers = new Headers(options.headers);
    headers.set('Authorization', `Bearer ${accessToken}`);
    headers.set('Content-Type', 'application/json');
    const res: Response = await fetch(`${baseUrl}${path}`, { ...options, headers });
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
            body: JsonUtilities.stringify({ title: 'Buy milk' })
        });
        const task: Task = await res.json() as Task;
        expect(task.deleted).toBe(false);
    });

    describe('soft delete', () => {
        let taskId: string;

        beforeEach(async () => {
            const res: Response = await authFetch('/tasks', {
                method: 'POST',
                body: JsonUtilities.stringify({ title: 'Temporary' })
            });
            const task: Task = await res.json() as Task;
            taskId = task.id;
        });

        it('marks the entity as deleted and creates a DELETE change set', async () => {
            await authFetch(`/tasks/${taskId}`, { method: 'DELETE' });

            const tasks: Task[] = await taskRepo.findAll({ deleted: 'include' });
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

        it('findById including deleted rows returns the task', async () => {
            await authFetch(`/tasks/${taskId}`, { method: 'DELETE' });
            const task: Task = await taskRepo.findById(taskId, { deleted: 'include' });
            expect(task.deleted).toBe(true);
        });

        it('findById with required=false returns undefined for a soft-deleted task', async () => {
            await authFetch(`/tasks/${taskId}`, { method: 'DELETE' });
            // the row is still there, so this only comes out undefined if the soft delete guard runs
            // before the requirement is decided rather than after
            expect(await taskRepo.findById(taskId, { required: false })).toBeUndefined();
            expect(await taskRepo.findById(taskId, { required: false, deleted: 'include' })).toBeDefined();
        });

        it('soft-deleted task can be updated if deleted rows are included', async () => {
            await authFetch(`/tasks/${taskId}`, { method: 'DELETE' });
            const params: URLSearchParams = new URLSearchParams({ withDeleted: 'true' });
            // Update using the controller, which includes deleted rows when the query asks for them
            await authFetch(`/tasks/${taskId}?${params.toString()}`, {
                method: 'PATCH',
                body: JsonUtilities.stringify({ title: 'Still here' })
            });
        });
    });

    describe('conditional updateById', () => {
        let taskId: string;

        beforeEach(async () => {
            const res: Response = await authFetch('/tasks', {
                method: 'POST',
                body: JsonUtilities.stringify({ title: 'Conditional' })
            });
            taskId = ((await res.json()) as Task).id;
        });

        it('applies the update while the condition holds', async () => {
            await taskRepo.updateById(taskId, { title: 'Changed' }, { where: { title: 'Conditional' } });
            expect((await taskRepo.findById(taskId)).title).toBe('Changed');
        });

        it('still refuses to touch a soft deleted row', async () => {
            await taskRepo.deleteById(taskId);

            // the condition must not become a way around the soft delete guard. It is an extra thing
            // the row has to satisfy, never a replacement for the ones it already had - and because
            // the guard is what puts the row out of reach, absent is all this may be told, even
            // though the condition it carried would have held
            await expect(
                taskRepo.updateById(taskId, { title: 'Changed' }, { where: { title: 'Conditional' } })
            ).rejects.toThrow(NotFoundError);

            const deleted: Task = await taskRepo.findById(taskId, { deleted: 'include' });
            expect(deleted.title).toBe('Conditional');
        });

        it('reaches a soft deleted row when it is asked to, and still honors the condition', async () => {
            await taskRepo.deleteById(taskId);

            await taskRepo.updateById(
                taskId,
                { title: 'Revived' },
                { deleted: 'include', where: { title: 'Conditional' } }
            );
            expect((await taskRepo.findById(taskId, { deleted: 'include' })).title).toBe('Revived');

            // reached, so a failed condition on it is a conflict - unlike the test above, where the
            // guard is what hides the row and absent is the only thing it may be told
            await expect(
                taskRepo.updateById(taskId, { title: 'Nope' }, { deleted: 'include', where: { title: 'stale' } })
            ).rejects.toThrow(ConflictError);
        });
    });

    describe('hard delete', () => {
        let taskId: string;

        beforeEach(async () => {
            const res: Response = await authFetch('/tasks', {
                method: 'POST',
                body: JsonUtilities.stringify({ title: 'To be removed' })
            });
            const task: Task = await res.json() as Task;
            taskId = task.id;
        });

        it('removes the entity from the database', async () => {
            await authFetch(`/tasks/${taskId}/hard`, { method: 'DELETE' });
            await expect(taskRepo.findById(taskId)).rejects.toThrow('Could not find');
        });

        it('removes an entity that was soft deleted first', async () => {
            await taskRepo.deleteById(taskId);

            // how a row in the trash goes for good. A hard deleteAll always reached it; deleting the
            // same row by its id read it through the soft delete guard and answered that it was gone
            await taskRepo.deleteById(taskId, { hardDelete: true });

            expect(await taskRepo.findById(taskId, { deleted: 'include', required: false })).toBeUndefined();
        });
    });

    describe('findAll queries', () => {
        let activeId: string;
        let deletedId: string;

        beforeEach(async () => {
            const res1: Response = await authFetch('/tasks', {
                method: 'POST',
                body: JsonUtilities.stringify({ title: 'Active' })
            });
            activeId = (await res1.json() as Task).id;

            const res2: Response = await authFetch('/tasks', {
                method: 'POST',
                body: JsonUtilities.stringify({ title: 'Removed' })
            });
            deletedId = (await res2.json() as Task).id;
            await authFetch(`/tasks/${deletedId}`, { method: 'DELETE' });
        });

        it('default findAll returns only non-deleted entities', async () => {
            const res: Response = await authFetch('/tasks');
            const tasks: Task[] = await res.json() as Task[];
            expect(tasks.map(t => t.id)).toEqual([activeId]);
        });

        it('findAll including deleted rows returns all entities', async () => {
            const res: Response = await authFetch('/tasks/with-deleted');
            const tasks: Task[] = await res.json() as Task[];
            expect(tasks.map(t => t.id).sort()).toEqual([activeId, deletedId].sort());
        });
    });

    describe('count and exists', () => {
        beforeEach(async () => {
            await taskRepo.create({ title: 'Active' });
            const removed: Task = await taskRepo.create({ title: 'Removed' });
            await taskRepo.deleteById(removed.id);
        });

        it('counts only what has not been soft deleted', async () => {
            // a count that ignores the flag is worse than a findAll that does: nothing about the
            // number says which rows it stands for, so "2 tasks" reads as true right up until
            // somebody opens the list and finds one
            expect(await taskRepo.count()).toBe(1);
            expect(await taskRepo.count({ deleted: 'include' })).toBe(2);
            expect(await taskRepo.count({ deleted: 'only' })).toBe(1);
        });

        it('reports a soft deleted row as gone unless it is asked for', async () => {
            expect(await taskRepo.exists({ where: { title: 'Active' } })).toBe(true);
            expect(await taskRepo.exists({ where: { title: 'Removed' } })).toBe(false);
            expect(await taskRepo.exists({ where: { title: 'Removed' }, deleted: 'include' })).toBe(true);
            expect(await taskRepo.exists({ where: { title: 'Active' }, deleted: 'only' })).toBe(false);
        });
    });

    describe('deleteAll', () => {
        let id1: string, id2: string;

        beforeEach(async () => {
            const res1: Response = await authFetch('/tasks', {
                method: 'POST',
                body: JsonUtilities.stringify({ title: 'Task 1' })
            });
            id1 = (await res1.json() as Task).id;

            const res2: Response = await authFetch('/tasks', {
                method: 'POST',
                body: JsonUtilities.stringify({ title: 'Task 2' })
            });
            id2 = (await res2.json() as Task).id;
        });

        it('soft deletes all matching entities', async () => {
            const where: SoftDeleteWhere<Task> = { title: 'Task 1' };
            await taskRepo.deleteAll(where); // soft delete by default

            const allTasks: Task[] = await taskRepo.findAll({ deleted: 'include' });
            const task1: Task | undefined = allTasks.find(t => t.id === id1);
            const task2: Task | undefined = allTasks.find(t => t.id === id2);
            assert(task1 && task2);
            expect(task1.deleted).toBe(true);
            expect(task2.deleted).toBe(false);
        });

        it('returns what it deleted and creates a DELETE change set for it', async () => {
            // deleteById has recorded one all along, deleteAll silently did not: it read its result
            // back through the soft delete filter, which excludes the rows it had just marked
            // deleted, so it handed an empty array to the change set writer and there was nothing
            // to record. Deleting in bulk left no audit trail at all.
            const deleted: Task[] = await taskRepo.deleteAll({ title: 'Task 1' }, { returnDeleted: true });

            expect(deleted.map(t => t.id)).toEqual([id1]);
            expect(deleted[0]?.deleted).toBe(true);

            const changeSets: ChangeSet[] = await changeSetRepo.findAll({ where: { changeSetEntityId: id1 } });
            expect(changeSets.some(cs => cs.type === ChangeSetType.DELETE)).toBe(true);
        });

        it('hard deletes all matching entities', async () => {
            const where: SoftDeleteWhere<Task> = { title: 'Task 2' };
            await taskRepo.deleteAll(where, { hardDelete: true });

            const allTasks: Task[] = await taskRepo.findAll({ deleted: 'include' });
            expect(allTasks.find(t => t.id === id2)).toBeUndefined();
        });
    });

    describe('only the soft deleted rows', () => {
        let activeId: string;
        let deletedId: string;

        beforeEach(async () => {
            activeId = (await taskRepo.create({ title: 'Active' })).id;
            deletedId = (await taskRepo.create({ title: 'Removed' })).id;
            await taskRepo.deleteById(deletedId);
        });

        it('finds what was deleted and nothing else', async () => {
            // what a trash view lists. Including deleted rows answered every row, and a filter on
            // `deleted` was overwritten, so there was no way to ask for these alone
            expect((await taskRepo.findAll({ deleted: 'only' })).map(t => t.id)).toEqual([deletedId]);
            await expect(taskRepo.findById(activeId, { deleted: 'only' })).rejects.toThrow(NotFoundError);
            expect((await taskRepo.findAllPaginated(1, 10, { deleted: 'only' })).items.map(t => t.id)).toEqual([deletedId]);
        });

        it('restores a row it reached, and hands it back', async () => {
            const restored: Task = await taskRepo.updateById(deletedId, { deleted: false }, { deleted: 'only' });

            expect(restored.deleted).toBe(false);
            expect((await taskRepo.findById(deletedId)).id).toBe(deletedId);
        });
    });

    describe('a filter naming deleted', () => {
        beforeEach(async () => {
            await taskRepo.create({ title: 'Active' });
            await taskRepo.deleteById((await taskRepo.create({ title: 'Removed' })).id);
        });

        it('refuses a value the call would otherwise have overwritten', async () => {
            // the soft delete filter types leave `deleted` out, and the entity's own Where does not -
            // which is how one reaches the repository without a cast
            const onlyDeleted: Where<Task> = { deleted: true };
            const oneBranchDeleted: Where<Task> = [{ title: 'Active' }, { deleted: true }];

            await expect(taskRepo.findAll({ where: onlyDeleted })).rejects.toThrow(InternalError);
            await expect(taskRepo.count({ where: oneBranchDeleted })).rejects.toThrow(InternalError);
        });

        it('lets a value through that says what the call does anyway', async () => {
            const live: Where<Task> = { deleted: false };

            expect((await taskRepo.findAll({ where: live })).map(t => t.title)).toEqual(['Active']);
        });
    });
});