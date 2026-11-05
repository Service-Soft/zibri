import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { SaveOperation } from './before-save';
import { RepositoryHooks } from './repository-hooks.model';
import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { type EncryptionServiceInterface } from '../../auth/encryption/encryption-service.interface';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider } from '../../di/models/di-provider.model';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { DeepPartial } from '../../types/deep-partial.type';
import { Newable } from '../../types/newable.type';
import { Repository } from '../repository/repository';
import { RepositoryFor } from '../repository/repository-for.decorator';

/**
 * The hooks every row passes through before it is written, removed and handed back, declared by the
 * application: for every repository through `ZIBRI_DI_TOKENS.REPOSITORY_HOOKS`, and on one by
 * overriding the methods of its `@RepositoryFor` class. Each wraps what is below it, so encryption,
 * hashing and defaults still happen unless a hook leaves them out.
 *
 * Container free: what is checked is which hook sees which row, which no store changes.
 */

@Entity({ tenant: 'shared', allowOrphan: true })
class Task extends BaseEntity {
    @Property.string()
    title!: string;

    @Property.string({ encryption: true })
    note!: string;

    @Property.string({ required: false })
    stamp?: string;

    @Property.oneToMany({ target: () => Comment, inverseSide: 'task', cascade: ['insert', 'update'] })
    comments!: Comment[];
}

@Entity({ tenant: 'shared', allowOrphan: true })
class Comment extends BaseEntity {
    @Property.string()
    text!: string;

    @Property.string({ required: false })
    stamp?: string;

    @Property.manyToOne({ target: () => Task, joinColumn: 'taskId', inverseSide: 'comments', required: false })
    task?: Task;

    @Property.string({ format: 'uuid', required: false })
    taskId?: string;
}

/**
 * The texts of the comments a delete handed to the repository's own hook.
 */
const deletedComments: string[] = [];

@RepositoryFor(Task)
class TaskRepository extends Repository<Task> {
    protected override async beforeSave(data: Task | DeepPartial<Task>, operation: SaveOperation): Promise<void> {
        if (typeof data.title === 'string') {
            data.title = data.title.toUpperCase();
        }
        await super.beforeSave(data, operation);
    }
}

@RepositoryFor(Comment)
class CommentRepository extends Repository<Comment> {
    protected override async beforeSave(data: Comment | DeepPartial<Comment>, operation: SaveOperation): Promise<void> {
        if (typeof data.text === 'string') {
            data.text = data.text.toUpperCase();
        }
        await super.beforeSave(data, operation);
    }

    protected override async beforeDelete(row: Comment): Promise<void> {
        deletedComments.push(row.text);
        await super.beforeDelete(row);
    }
}

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
    entities: [...defaultTestServerEntities, Task, Comment],
    repositories: [...defaultTestServerRepositories, TaskRepository, CommentRepository]
});

/**
 * Whether an entity is one of the two this file stamps, the rest being the framework's own.
 * @param entity - The entity a hook runs for.
 * @returns True for tasks and comments.
 */
function isStamped(entity: Newable<BaseEntity>): boolean {
    return entity === Task || entity === Comment;
}

/**
 * Creates tasks sharing one title, so a filter on it names exactly them.
 * @param title - The title, as stored.
 * @param notes - One note per task.
 * @returns The tasks, as created.
 */
async function createTasks(title: string, notes: string[]): Promise<Task[]> {
    return await inject(repositoryTokenFor(Task)).createAll(notes.map(note => ({ title, note })));
}

afterEach(() => {
    jest.restoreAllMocks();
});

describe('hooks declared for every repository and on one', () => {
    let server: StartedTestServer | undefined;
    let tasks: Repository<Task>;
    let comments: Repository<Comment>;
    const returnedNotes: string[] = [];

    const hooks: RepositoryHooks = {
        beforeSave: async (data, operation, entity, wrapped) => {
            if (isStamped(entity)) {
                Object.assign(data, { stamp: operation });
            }
            await wrapped(data, operation, entity);
        },
        beforeReturn: async (row, entity, autoDecrypt, wrapped) => {
            await wrapped(row, entity, autoDecrypt);
            if ('note' in row && typeof row.note === 'string') {
                returnedNotes.push(row.note);
            }
        }
    };

    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [dataSourceClass],
            providers: [...defaultTestServerProviders, defineProvider({ token: ZIBRI_DI_TOKENS.REPOSITORY_HOOKS, useValue: hooks })]
        });
        tasks = inject(repositoryTokenFor(Task));
        comments = inject(repositoryTokenFor(Comment));
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('runs the global hook and the repository\'s own on a created row, and the default inside them', async () => {
        const [task] = await createTasks('plan the sprint', ['ask Ada first']);

        expect(task?.title).toBe('PLAN THE SPRINT');
        expect(task?.stamp).toBe(SaveOperation.CREATE);
        expect(task?.note).toBe('ask Ada first');
        const stored: Task = await tasks.findById(task?.id ?? '', { autoDecrypt: false });
        expect(stored.title).toBe('PLAN THE SPRINT');
        expect(stored.stamp).toBe(SaveOperation.CREATE);
        expect(stored.note).not.toBe('ask Ada first');
    });

    it('runs both on an update', async () => {
        const [task] = await createTasks('review', ['before friday']);

        const updated: Task = await tasks.updateById(task?.id ?? '', { title: 'review again' });

        expect(updated.title).toBe('REVIEW AGAIN');
        expect(updated.stamp).toBe(SaveOperation.UPDATE);
    });

    it('runs the hooks of the repository of a related entity on the rows written through the relation', async () => {
        const task: Task = await tasks.create({ title: 'ship', note: 'tuesday', comments: [{ text: 'looks good' }] });

        const written: Comment[] = await comments.findAll({ where: { taskId: task.id } });

        expect(written.map(c => [c.text, c.stamp])).toEqual([['LOOKS GOOD', SaveOperation.CREATE]]);
    });

    it('hands the global before return hook the row the default decrypted', async () => {
        const [task] = await createTasks('read', ['the plan']);
        returnedNotes.length = 0;

        await tasks.findById(task?.id ?? '');

        expect(returnedNotes).toEqual(['the plan']);
    });

    it('reads only the ids for a deleteAll that hands nothing back while no beforeDelete is declared', async () => {
        await createTasks('counted', ['one', 'two']);
        const decrypt: jest.SpiedFunction<EncryptionServiceInterface['decrypt']> = jest.spyOn(inject(ZIBRI_DI_TOKENS.ENCRYPTION_SERVICE), 'decrypt');

        expect(await tasks.deleteAll({ title: 'COUNTED' })).toBe(2);

        expect(decrypt).not.toHaveBeenCalled();
    });

    it('hands every row a deleteAll removes to a beforeDelete of the repository\'s own', async () => {
        await comments.createAll([{ text: 'first' }, { text: 'second' }]);
        deletedComments.length = 0;

        expect(await comments.deleteAll({ text: { oneOf: ['FIRST', 'SECOND'] } })).toBe(2);

        expect(deletedComments.sort()).toEqual(['FIRST', 'SECOND']);
    });
});

describe('a beforeDelete declared for every repository', () => {
    let server: StartedTestServer | undefined;
    const deletedNotes: string[] = [];

    const hooks: RepositoryHooks = {
        beforeDelete: async (row, entity, wrapped) => {
            if ('note' in row && typeof row.note === 'string') {
                deletedNotes.push(row.note);
            }
            await wrapped(row, entity);
        }
    };

    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [dataSourceClass],
            providers: [...defaultTestServerProviders, defineProvider({ token: ZIBRI_DI_TOKENS.REPOSITORY_HOOKS, useValue: hooks })]
        });
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('hands it every row a deleteAll removes, readable', async () => {
        await createTasks('audited', ['first', 'second']);

        expect(await inject(repositoryTokenFor(Task)).deleteAll({ title: 'AUDITED' })).toBe(2);

        expect(deletedNotes.sort()).toEqual(['first', 'second']);
    });
});