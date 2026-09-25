import assert from 'node:assert';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

import { ChangeSetRepository, ResetChangeSetResult } from './change-set-repository';
import { ChangeSetEntity } from './models/change-set-entity.model';
import { ChangeSetType } from './models/change-set-type.enum';
import { ChangeSet, CreateChangeSetData } from './models/change-set.model';
import { Change } from './models/change.model';
import { Roles } from '../__testing__/mocks/entities/roles.enum';
import { createTestDataSource, defaultTestServerEntities } from '../__testing__/test-server/create-test-data-source.function';
import { startTestServer, StartedTestServer } from '../__testing__/test-server/start-test-server.function';
import { DefaultTestServerUserRepository } from '../__testing__/test-server/user-repository'; // adjust if needed
import { AuthServiceInterface } from '../auth/auth-service.interface';
import { Auth } from '../auth/decorators/auth.decorator';
import { BaseUserEntity } from '../auth/models/base-user.model';
import { JwtAuthData } from '../auth/strategies/jwt/jwt-auth-data.model';
import { JwtCredentials } from '../auth/strategies/jwt/jwt-credentials.model';
import { JwtAuthStrategy } from '../auth/strategies/jwt/jwt.auth-strategy';
import { Repository } from '../data-source/repository/repository';
import { InjectRepository, repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { BaseEntity } from '../entity/base-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { OmitClass } from '../entity/omit-class.model';
import { PartialClass } from '../entity/partial-class.model';
import { ConflictError } from '../error-handling/errors/conflict.error';
import { InternalError } from '../error-handling/internal-error.model';
import { Body } from '../routing/decorators/body.decorator';
import { Controller } from '../routing/decorators/controller.decorator';
import { Delete } from '../routing/decorators/delete.decorator';
import { Param } from '../routing/decorators/param.decorator';
import { Patch } from '../routing/decorators/patch.decorator';
import { Post } from '../routing/decorators/post.decorator';
import { JsonUtilities } from '../utilities/json.utilities';

// ---- Test entity that extends ChangeSetEntity ----
@Entity()
class Widget extends BaseEntity implements ChangeSetEntity {
    @Property.string()
    name!: string;

    @Property.number()
    value!: number;

    @Property.string({ excludeFromChangeSets: true })
    internalNote!: string;

    // required by ChangeSetEntity
    @Property.oneToMany({ target: () => ChangeSet, inverseSide: 'changeSetEntityId' }) // dummy, real implementation may differ
    changeSets!: ChangeSet[];
}

class CreateWidgetDto extends OmitClass(Widget, ['changeSets', 'id']) {}

class UpdateWidgetDto extends PartialClass(OmitClass(Widget, ['changeSets', 'id'])) {}

@Entity()
class TestUser extends BaseUserEntity(Roles) {
    @Property.string({ hash: true })
    password!: string;
}

// ---- Controller that uses the repository ----
@Controller('/widgets')
class WidgetController {
    constructor(
        @InjectRepository(Widget)
        private readonly repo: ChangeSetRepository<Widget>
    ) {}

    @Post('/')
    @Auth.isLoggedIn([JwtAuthStrategy])
    async create(@Body(CreateWidgetDto) body: CreateWidgetDto): Promise<Widget> {
        return await this.repo.create(body);
    }

    @Patch('/:id')
    @Auth.isLoggedIn([JwtAuthStrategy])
    async update(@Param.path('id') id: string, @Body(UpdateWidgetDto) body: UpdateWidgetDto): Promise<Widget> {
        return this.repo.updateById(id, body);
    }

    @Delete('/:id')
    @Auth.isLoggedIn([JwtAuthStrategy])
    async delete(@Param.path('id') id: string): Promise<Widget> {
        return this.repo.deleteById(id);
    }

    // the bulk routes exist so that the acting user can be observed on them. Reading who made a
    // change means asking the request, so a bulk write driven from a test body has no user to record
    // and would pass whatever the repository did with it.
    @Post('/all')
    @Auth.isLoggedIn([JwtAuthStrategy])
    async createAll(@Body(CreateWidgetDto, { isArray: true }) body: CreateWidgetDto[]): Promise<Widget[]> {
        return await this.repo.createAll(body);
    }

    @Patch('/all/:name')
    @Auth.isLoggedIn([JwtAuthStrategy])
    async updateAll(@Param.path('name') name: string, @Body(UpdateWidgetDto) body: UpdateWidgetDto): Promise<Widget[]> {
        return await this.repo.updateAll({ name }, body, { returnUpdated: true });
    }

    @Delete('/all/:name')
    @Auth.isLoggedIn([JwtAuthStrategy])
    async deleteAll(@Param.path('name') name: string): Promise<void> {
        await this.repo.deleteAll({ name });
    }

    @Post('/:id/reset/:changeSetId')
    @Auth.isLoggedIn([JwtAuthStrategy])
    async resetSingle(
        @Param.path('id') id: string,
        @Param.path('changeSetId') changeSetId: string
    ): Promise<ResetChangeSetResult<Widget>> {
        const entity: Widget = await this.repo.findById(id);
        return this.repo.resetSingleChangeSet(entity, changeSetId);
    }

    @Post('/:id/rollback/:changeSetId')
    @Auth.isLoggedIn([JwtAuthStrategy])
    async rollbackTo(
        @Param.path('id') id: string,
        @Param.path('changeSetId') changeSetId: string
    ): Promise<Widget> {
        const entity: Widget = await this.repo.findById(id);
        return this.repo.rollbackToChangeSet(entity, changeSetId);
    }
}

let server: StartedTestServer;
let baseUrl: string;
let accessToken: string;
let userId: string;

let changeSetRepo: Repository<ChangeSet, CreateChangeSetData>;
let changeRepo: Repository<Change>;
let widgetRepo: ChangeSetRepository<Widget>;

beforeAll(async () => {
    server = await startTestServer({
        dataSources: [
            createTestDataSource({
                entities: [...defaultTestServerEntities, Widget, TestUser]
            })
        ],
        controllers: [WidgetController]
    });
    baseUrl = await server.start();

    // Inject repository instances
    changeSetRepo = inject(repositoryTokenFor(ChangeSet));
    changeRepo = inject(repositoryTokenFor(Change));
    widgetRepo = inject(repositoryTokenFor(Widget)) as ChangeSetRepository<Widget>;

    // Create a user and login to get a token
    const userRepo: DefaultTestServerUserRepository = inject(DefaultTestServerUserRepository);
    const credentialsRepo: Repository<JwtCredentials> = inject(repositoryTokenFor(JwtCredentials));

    const testEmail: string = 'widget-test@example.com';
    const testPassword: string = 'test123';
    await userRepo.create({ email: testEmail, roles: [Roles.USER] });
    await credentialsRepo.create({ email: testEmail, password: testPassword, userId: (await userRepo.findOne({ where: { email: testEmail } })).id });

    userId = (await userRepo.findOne({ where: { email: testEmail } })).id;

    const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
    const authData: JwtAuthData<Roles> = await authService.login(JwtAuthStrategy<Roles>, { email: testEmail, password: testPassword });
    accessToken = authData.accessToken.value;
}, 15000);

afterAll(async () => {
    await server.shutdown();
}, 15000);

beforeEach(async () => {
    await changeSetRepo.deleteAll({});
    await changeRepo.deleteAll({});
    await widgetRepo.deleteAll({});
});

// Helper for authorized requests
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

describe('ChangeSetRepository behavior', () => {
    describe('on create', () => {
        it('creates a CREATE change set with correct changes (excluding internalNote)', async () => {
            const res: Response = await authFetch('/widgets', {
                method: 'POST',
                body: JSON.stringify({ name: 'TestWidget', value: 42, internalNote: 'secret' })
            });
            expect(res.status).toBe(200);
            const widget: Widget = await res.json() as Widget;

            const changeSets: ChangeSet[] = await changeSetRepo.findAll({ where: { changeSetEntityId: widget.id } });
            expect(changeSets).toHaveLength(1);
            const [cs]: ChangeSet[] = changeSets;
            assert(cs, 'no change set was recorded');
            expect(cs.type).toBe(ChangeSetType.CREATE);
            expect(cs.createdBy).toBe(userId);

            const changes: Change[] = await changeRepo.findAll({ where: { changeSetId: cs.id } });
            expect(changes).toHaveLength(3); // id, name and value. not internalNote
            expect(changes.map(c => c.key).sort()).toEqual(['id', 'name', 'value']);
            expect(changes.find(c => c.key === 'name')?.previousValue).toBeNull();
            expect(changes.find(c => c.key === 'name')?.newValue).toBe('TestWidget');
        });
    });

    describe('on update', () => {
        let widgetId: string;

        beforeEach(async () => {
            const res: Response = await authFetch('/widgets', {
                method: 'POST',
                body: JSON.stringify({ name: 'Original', value: 100, internalNote: 'old-secret' })
            });
            const widget: Widget = await res.json() as Widget;
            widgetId = widget.id;
            // clear change sets from creation to isolate update test
            await changeSetRepo.deleteAll({});
        });

        it('still records the change when the update carried a condition', async () => {
            // the conditional path is a different write - it goes through the driver's atomic
            // updateAll rather than a plain save - so it has to be checked that tracking survives it.
            // An update nobody can see afterwards is worse than one that was refused.
            await widgetRepo.updateById(widgetId, { name: 'Conditional' }, { where: { name: 'Original' } });

            const changeSets: ChangeSet[] = await changeSetRepo.findAll({ where: { changeSetEntityId: widgetId } });
            expect(changeSets).toHaveLength(1);
            expect(changeSets[0]?.type).toBe(ChangeSetType.UPDATE);
            expect((await widgetRepo.findById(widgetId)).name).toBe('Conditional');
        });

        it('writes nothing at all when the condition does not hold', async () => {
            // a conflict rather than a missing row: this caller can read it, so what they need to be
            // told is that it moved. Only a row they may not see is answered as absent
            await expect(
                widgetRepo.updateById(widgetId, { name: 'Rejected' }, { where: { name: 'something else' } })
            ).rejects.toThrow(ConflictError);

            // neither the row nor a change set claiming it moved. A refused update that still left a
            // record of having happened would be the worse half of the same bug
            expect((await widgetRepo.findById(widgetId)).name).toBe('Original');
            expect(await changeSetRepo.findAll({ where: { changeSetEntityId: widgetId } })).toHaveLength(0);
        });

        it('creates an UPDATE change set only with changed fields', async () => {
            await authFetch(`/widgets/${widgetId}`, {
                method: 'PATCH',
                body: JSON.stringify({ name: 'Updated', value: 100 }) // value unchanged
            });

            const changeSets: ChangeSet[] = await changeSetRepo.findAll({ where: { changeSetEntityId: widgetId } });
            expect(changeSets).toHaveLength(1);
            const [updateSet]: ChangeSet[] = changeSets;
            assert(updateSet, 'no change set was recorded');
            expect(updateSet.type).toBe(ChangeSetType.UPDATE);

            const changes: Change[] = await changeRepo.findAll({ where: { changeSetId: updateSet.id } });
            expect(changes).toHaveLength(1); // only name changed
            expect(changes[0]?.key).toBe('name');
            expect(changes[0]?.previousValue).toBe('Original');
            expect(changes[0]?.newValue).toBe('Updated');
        });

        it('does not create a change set when no values actually change', async () => {
            await authFetch(`/widgets/${widgetId}`, {
                method: 'PATCH',
                body: JSON.stringify({ name: 'Original', value: 100 })
            });

            const changeSets: ChangeSet[] = await changeSetRepo.findAll({ where: { changeSetEntityId: widgetId } });
            expect(changeSets).toHaveLength(0);
        });
    });

    describe('resetSingleChangeSet', () => {
        let widgetId: string;
        let nameUpdateChangeSetId: string;

        beforeEach(async () => {
            // Create widget, this causes
            const res1: Response = await authFetch('/widgets', {
                method: 'POST',
                body: JSON.stringify({ name: 'Initial', value: 10, internalNote: 'test' })
            });
            const w: Widget = await res1.json() as Widget;
            widgetId = w.id;

            // First update: change name
            await authFetch(`/widgets/${widgetId}`, { method: 'PATCH', body: JSON.stringify({ name: 'FirstEdit' }) });

            // Second update: change value
            await authFetch(`/widgets/${widgetId}`, { method: 'PATCH', body: JSON.stringify({ value: 20 }) });

            const sets: ChangeSet[] = await changeSetRepo.findAll({
                where: { changeSetEntityId: widgetId },
                order: { createdAt: 'ASC' },
                relations: ['changes']
            });
            // sets[0] = CREATE, sets[1] = UPDATE name, sets[2] = UPDATE value
            const nameUpdate: ChangeSet | undefined = sets[1];
            assert(nameUpdate, 'the name update was not recorded');
            nameUpdateChangeSetId = nameUpdate.id;
        });

        it('reverts only the targeted change, preserving later changes', async () => {
            await authFetch(`/widgets/${widgetId}/reset/${nameUpdateChangeSetId}`, { method: 'POST' });

            const widget: Widget = await widgetRepo.findById(widgetId);
            expect(widget.name).toBe('Initial'); // reverted
            expect(widget.value).toBe(20); // preserved (later change untouched)

            // A new RESET change set was created
            const allSets: ChangeSet[] = await changeSetRepo.findAll({ where: { changeSetEntityId: widgetId } });
            expect(allSets.some(s => s.type === ChangeSetType.RESET)).toBe(true);
        });
    });

    describe('rollbackToChangeSet', () => {
        let widgetId: string;
        let createSetId: string;

        beforeEach(async () => {
            const res: Response = await authFetch('/widgets', {
                method: 'POST',
                body: JSON.stringify({ name: 'Base', value: 1, internalNote: 'base' })
            });
            const w: Widget = await res.json() as Widget;
            widgetId = w.id;
            createSetId = (await changeSetRepo.findOne({ where: { changeSetEntityId: widgetId, type: ChangeSetType.CREATE } })).id;

            // Two subsequent updates
            await authFetch(`/widgets/${widgetId}`, { method: 'PATCH', body: JSON.stringify({ name: 'Version2' }) });
            await authFetch(`/widgets/${widgetId}`, { method: 'PATCH', body: JSON.stringify({ value: 99 }) });
        });

        it('rolls back all changes after the given change set', async () => {
            await authFetch(`/widgets/${widgetId}/rollback/${createSetId}`, { method: 'POST' });

            const widget: Widget = await widgetRepo.findById(widgetId);
            expect(widget.name).toBe('Base');
            expect(widget.value).toBe(1);

            // Only the CREATE and the new RESET change set remain (intermediate ones deleted)
            const remaining: ChangeSet[] = await changeSetRepo.findAll({ where: { changeSetEntityId: widgetId } });
            expect(remaining).toHaveLength(2);
            expect(remaining.map(s => s.type)).toEqual(expect.arrayContaining([ChangeSetType.CREATE, ChangeSetType.RESET]));
        });
    });

    // 01-data-layer M10. The singular paths were covered from the start - `on create` above asserts
    // the actor - and the bulk ones never were, which is how they came to write a different field
    // name than the entity declares and record every audit row with nobody on it.
    describe('who made the change, on a bulk write', () => {
        it('records the acting user on every change set a bulk create writes', async () => {
            const res: Response = await authFetch('/widgets/all', {
                method: 'POST',
                body: JSON.stringify([
                    { name: 'BulkOne', value: 1, internalNote: 'a' },
                    { name: 'BulkTwo', value: 2, internalNote: 'b' }
                ])
            });
            const widgets: Widget[] = await res.json() as Widget[];
            expect(widgets).toHaveLength(2);

            const changeSets: ChangeSet[] = await changeSetRepo.findAll({ where: { type: ChangeSetType.CREATE } });
            expect(changeSets).toHaveLength(2);
            // every one of them, not "at least one": a null actor on any row is the auditor's
            // question going unanswered for that row
            expect(changeSets.map(c => c.createdBy)).toEqual([userId, userId]);
        });

        it('records the acting user on every change set a bulk update writes', async () => {
            await authFetch('/widgets/all', {
                method: 'POST',
                body: JSON.stringify([
                    { name: 'Same', value: 1, internalNote: 'a' },
                    { name: 'Same', value: 2, internalNote: 'b' }
                ])
            });
            await changeSetRepo.deleteAll({});

            await authFetch('/widgets/all/Same', { method: 'PATCH', body: JSON.stringify({ value: 42 }) });

            const changeSets: ChangeSet[] = await changeSetRepo.findAll({ where: { type: ChangeSetType.UPDATE } });
            expect(changeSets).toHaveLength(2);
            expect(changeSets.map(c => c.createdBy)).toEqual([userId, userId]);
        });
    });

    // 01-data-layer M11. `updateAll` took a transaction over the write and its change sets from the
    // start; every other path wrote the two as independent statements, so a failure in between left
    // the mutation with no record of it, or a record of a mutation that was rolled back.
    describe('the change set and the change it describes are one write', () => {
        /**
         * Makes the change set write fail the way a crash between the two statements would.
         *
         * The change set repository is a collaborator the repository is constructed with, so this
         * replaces a dependency rather than any part of what is being tested. There is no way to
         * produce the failure with data: a change set is built out of the entity that was just
         * written successfully, so anything the change set cannot store the entity could not either.
         * @returns A function restoring the repository.
         */
        function failTheChangeSetWrite(): () => void {
            const original: typeof changeSetRepo.create = changeSetRepo.create.bind(changeSetRepo);
            const originalAll: typeof changeSetRepo.createAll = changeSetRepo.createAll.bind(changeSetRepo);
            changeSetRepo.create = () => Promise.reject(new InternalError('the change set could not be written'));
            changeSetRepo.createAll = () => Promise.reject(new InternalError('the change sets could not be written'));
            return () => {
                changeSetRepo.create = original;
                changeSetRepo.createAll = originalAll;
            };
        }

        it('leaves no entity behind when the change set of a create cannot be written', async () => {
            const restore: () => void = failTheChangeSetWrite();
            try {
                await expect(
                    authFetch('/widgets', {
                        method: 'POST',
                        body: JSON.stringify({ name: 'Unaudited', value: 1, internalNote: 'x' })
                    })
                ).rejects.toThrow();
            }
            finally {
                restore();
            }

            // the row would otherwise be there with nothing recording who created it, which is the
            // one state a change set exists to make impossible
            expect(await widgetRepo.findAll({ where: { name: 'Unaudited' } })).toHaveLength(0);
        });

        it('leaves no entity behind when the change sets of a bulk create cannot be written', async () => {
            const restore: () => void = failTheChangeSetWrite();
            try {
                await expect(
                    authFetch('/widgets/all', {
                        method: 'POST',
                        body: JSON.stringify([
                            { name: 'UnauditedBulk', value: 1, internalNote: 'a' },
                            { name: 'UnauditedBulk', value: 2, internalNote: 'b' }
                        ])
                    })
                ).rejects.toThrow();
            }
            finally {
                restore();
            }

            expect(await widgetRepo.findAll({ where: { name: 'UnauditedBulk' } })).toHaveLength(0);
        });

        it('leaves the previous value in place when the change set of an update cannot be written', async () => {
            const created: Response = await authFetch('/widgets', {
                method: 'POST',
                body: JSON.stringify({ name: 'Before', value: 1, internalNote: 'x' })
            });
            const widget: Widget = await created.json() as Widget;

            const restore: () => void = failTheChangeSetWrite();
            try {
                await expect(
                    authFetch(`/widgets/${widget.id}`, { method: 'PATCH', body: JSON.stringify({ name: 'After' }) })
                ).rejects.toThrow();
            }
            finally {
                restore();
            }

            // an update that landed with no change set is worse than one that was refused: the row
            // moved and the history says it never did
            expect((await widgetRepo.findById(widget.id)).name).toBe('Before');
        });
    });
});