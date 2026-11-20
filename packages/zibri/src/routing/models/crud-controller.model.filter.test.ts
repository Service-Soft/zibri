import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { FilterConfig, OrderConfig } from 'zibri-contract';
import { createInMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { PaginationResult } from '../../data-source/models/pagination-result.model';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { Controller } from '../decorators/controller.decorator';
import { CrudControllerOptions } from './crud-controller-options.model';
import { CrudController } from './crud-controller.model';

class CrudTaskAddress {
    @Property.string()
    street!: string;
}

class CrudTaskNote {
    @Property.string()
    text!: string;
}

@Entity({ tenant: 'shared', allowOrphan: true })
class CrudTaskOwner extends BaseEntity {
    @Property.string()
    name!: string;

    @Property.oneToMany({ target: () => CrudTask, inverseSide: 'owner' })
    tasks!: CrudTask[];
}

@Entity({ tenant: 'shared', allowOrphan: true })
class CrudTask extends BaseEntity {
    @Property.string()
    title!: string;

    @Property.string()
    status!: string;

    @Property.number({ format: 'integer' })
    priority!: number;

    @Property.date()
    dueAt!: Date;

    @Property.object({ cls: () => CrudTaskAddress })
    address!: CrudTaskAddress;

    @Property.array({ items: { type: 'string' } })
    tags!: string[];

    @Property.array({ items: { type: 'object', cls: () => CrudTaskNote } })
    notes!: CrudTaskNote[];

    @Property.manyToOne({ target: () => CrudTaskOwner, joinColumn: 'ownerId', inverseSide: 'tasks' })
    owner!: CrudTaskOwner;

    @Property.string({ format: 'uuid' })
    ownerId!: string;

    @Property.string({ exclude: true })
    internalNote!: string;
}

class CrudTaskData {
    @Property.string()
    title!: string;
}

class CrudFolderNode {
    @Property.string()
    label!: string;

    @Property.object({ cls: () => CrudFolderNode, required: false })
    parent?: CrudFolderNode;
}

@Entity({ tenant: 'shared', allowOrphan: true })
class CrudFolder extends BaseEntity {
    @Property.string()
    title!: string;

    @Property.object({ cls: () => CrudFolderNode })
    node!: CrudFolderNode;
}

// eslint-disable-next-line typescript/typedef
const taskFilter = {
    title: 'iLike',
    status: 'oneOf',
    priority: 'range',
    dueAt: 'range',
    address: { street: 'equals' },
    tags: 'includes',
    notes: { text: 'iLike' },
    owner: { name: 'equals' }
} as const satisfies FilterConfig<CrudTask>;

// eslint-disable-next-line typescript/typedef
const priorityOrder = { priority: true } as const satisfies OrderConfig<CrudTask>;

// eslint-disable-next-line typescript/typedef
const ownerOrder = { owner: { name: true }, priority: true } as const satisfies OrderConfig<CrudTask>;

@Controller('/tasks')
class TaskController extends CrudController(CrudTask, CrudTaskData, CrudTaskData, { filter: taskFilter }) {}

@Controller('/similar-tasks')
class SimilarTaskController extends CrudController(CrudTask, CrudTaskData, CrudTaskData, { filter: { title: 'fuzzy' } }) {}

@Controller('/priority-tasks')
class PriorityTaskController extends CrudController(CrudTask, CrudTaskData, CrudTaskData, { order: priorityOrder }) {}

@Controller('/owner-tasks')
class OwnerTaskController extends CrudController(CrudTask, CrudTaskData, CrudTaskData, { order: ownerOrder }) {}

@Controller('/unordered-tasks')
class UnorderedTaskController extends CrudController(CrudTask, CrudTaskData, CrudTaskData, { order: false }) {}

// typed as 3.0 typed them, without the entity, which is then the class handed over: what the type checks
const limitOptions: CrudControllerOptions = { maxLimit: 5 };

/**
 * A controller given options typed without the entity.
 */
class LimitedTaskController extends CrudController(CrudTask, CrudTaskData, CrudTaskData, limitOptions) {
    async findTitles(): Promise<string[]> {
        const page: PaginationResult<CrudTask> = await this.findAll(1, 5);
        return page.items.map(task => task.title);
    }
}

/**
 * Defines a controller ordered by a property its entity does not have.
 * @returns The controller.
 */
function defineOrderedByMissing(): unknown {
    // @ts-expect-error the order names a property of the entity
    return CrudController(CrudTask, CrudTaskData, CrudTaskData, { order: { missing: true } });
}

/**
 * Defines a controller filtered by a property its entity does not have.
 * @returns The controller.
 */
function defineFilteredByMissing(): unknown {
    // @ts-expect-error the filter names a property of the entity
    return CrudController(CrudTask, CrudTaskData, CrudTaskData, { filter: { missing: 'equals' } });
}

@Controller('/folders')
class FolderController extends CrudController(CrudFolder, CrudTaskData, CrudTaskData) {}

describe('CrudController filters and orders', () => {
    let server: StartedTestServer;
    let baseUrl: string;

    beforeAll(async () => {
        server = await startTestServer({
            controllers: [TaskController, SimilarTaskController, PriorityTaskController, OwnerTaskController, UnorderedTaskController, FolderController],
            dataSources: [
                createInMemoryDataSource({
                    entities: [...defaultTestServerEntities, CrudTaskOwner, CrudTask, CrudFolder],
                    repositories: defaultTestServerRepositories
                })
            ]
        });
        baseUrl = await server.start();
        const ada: CrudTaskOwner = await inject(repositoryTokenFor(CrudTaskOwner)).create({ name: 'Ada' });
        const bob: CrudTaskOwner = await inject(repositoryTokenFor(CrudTaskOwner)).create({ name: 'Bob' });
        await inject(repositoryTokenFor(CrudTask)).createAll([
            {
                title: 'Invoice 100%',
                status: 'open',
                priority: 1,
                dueAt: new Date('2026-01-10'),
                address: { street: 'Main Street' },
                tags: ['billing'],
                notes: [{ text: 'Sent by mail' }],
                ownerId: ada.id,
                internalNote: 'a'
            },
            {
                title: 'Invoice draft',
                status: 'done',
                priority: 5,
                dueAt: new Date('2026-02-10'),
                address: { street: 'Side Street' },
                tags: ['billing', 'urgent'],
                notes: [],
                ownerId: bob.id,
                internalNote: 'b'
            },
            {
                title: 'Call Miller',
                status: 'open',
                priority: 3,
                dueAt: new Date('2026-03-10'),
                address: { street: 'Main Street' },
                tags: ['phone'],
                notes: [{ text: 'No answer' }, { text: 'Call back by mail' }],
                ownerId: ada.id,
                internalNote: 'c'
            },
            {
                title: 'Overdue reminder',
                status: 'waiting',
                priority: 9,
                dueAt: new Date('2026-04-10'),
                address: { street: 'Elm' },
                tags: [],
                notes: [{ text: 'Second one' }],
                ownerId: bob.id,
                internalNote: 'd'
            }
        ]);
        await inject(repositoryTokenFor(CrudFolder)).createAll([
            { title: 'Reports', node: { label: 'reports', parent: { label: 'b', parent: { label: 'z' } } } },
            { title: 'Drafts', node: { label: 'drafts', parent: { label: 'a', parent: { label: 'y' } } } },
            { title: 'Archive', node: { label: 'archive', parent: { label: 'c', parent: { label: 'x' } } } }
        ]);
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    /**
     * Requests a page of tasks.
     * @param path - The route.
     * @param query - The filter and the order, as they are written into the query.
     * @returns The response.
     */
    async function list(path: string, query: Record<string, unknown>): Promise<Response> {
        const params: URLSearchParams = new URLSearchParams({ page: '1', limit: '10' });
        for (const [key, value] of Object.entries(query)) {
            params.set(key, JSON.stringify(value));
        }
        return await fetch(`${baseUrl}${path}?${params.toString()}`);
    }

    /**
     * Reads the titles of a page of tasks or folders, in the order they are answered.
     * @param path - The route.
     * @param query - The filter and the order, as they are written into the query.
     * @returns The titles.
     */
    async function findTitles(path: string, query: Record<string, unknown>): Promise<string[]> {
        const res: Response = await list(path, query);
        expect(res.status).toBe(200);
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const page: PaginationResult<CrudTask | CrudFolder> = await res.json();
        return page.items.map(task => task.title);
    }

    it('finds the rows that meet every filter that has a value', async () => {
        expect(await findTitles('/tasks', { filter: { title: 'invoice', status: ['open', 'waiting'] }, order: { priority: 'ASC' } }))
            .toEqual(['Invoice 100%']);
        // an empty value filters nothing, like the empty fields of a table
        expect(await findTitles('/tasks', { filter: { title: '', status: [] }, order: { priority: 'ASC' } }))
            .toEqual(['Invoice 100%', 'Call Miller', 'Invoice draft', 'Overdue reminder']);
    });

    it('matches text that appears anywhere, with % and _ taken as they are', async () => {
        expect(await findTitles('/tasks', { filter: { title: 'voice' }, order: { priority: 'ASC' } })).toEqual(['Invoice 100%', 'Invoice draft']);
        expect(await findTitles('/tasks', { filter: { title: '0%' } })).toEqual(['Invoice 100%']);
        expect(await findTitles('/tasks', { filter: { title: '_' } })).toEqual([]);
    });

    it('finds similar text, and numbers and dates in a range', async () => {
        expect(await findTitles('/similar-tasks', { filter: { title: 'Call Miler' } })).toContain('Call Miller');
        expect(await findTitles('/similar-tasks', { filter: { title: 'Call Miler' } })).not.toContain('Overdue reminder');
        expect(await findTitles('/tasks', { filter: { priority: { from: 3 } }, order: { priority: 'ASC' } }))
            .toEqual(['Call Miller', 'Invoice draft', 'Overdue reminder']);
        expect(await findTitles('/tasks', { filter: { dueAt: { from: '2026-02-01', to: '2026-03-31' } }, order: { priority: 'ASC' } }))
            .toEqual(['Call Miller', 'Invoice draft']);
    });

    it('filters by the properties of an object, of the items of an array and of a related row', async () => {
        expect(await findTitles('/tasks', { filter: { address: { street: 'Main Street' } }, order: { priority: 'ASC' } }))
            .toEqual(['Invoice 100%', 'Call Miller']);
        expect(await findTitles('/tasks', { filter: { tags: ['billing', 'urgent'] } })).toEqual(['Invoice draft']);
        expect(await findTitles('/tasks', { filter: { notes: { text: 'mail' } }, order: { priority: 'ASC' } }))
            .toEqual(['Invoice 100%', 'Call Miller']);
        expect(await findTitles('/tasks', { filter: { owner: { name: 'Bob' } }, order: { priority: 'ASC' } }))
            .toEqual(['Invoice draft', 'Overdue reminder']);
    });

    it('orders by the properties it may, in both directions and in the order they are given', async () => {
        expect(await findTitles('/tasks', { order: { priority: 'DESC' } })).toEqual(['Overdue reminder', 'Invoice draft', 'Call Miller', 'Invoice 100%']);
        expect(await findTitles('/tasks', { order: { status: 'ASC', priority: 'DESC' } }))
            .toEqual(['Invoice draft', 'Call Miller', 'Invoice 100%', 'Overdue reminder']);
        expect(await findTitles('/priority-tasks', { order: { priority: 'ASC' } })).toEqual(['Invoice 100%', 'Call Miller', 'Invoice draft', 'Overdue reminder']);
    });

    it('orders by the properties of an object, and of a relation it is given', async () => {
        expect(await findTitles('/tasks', { order: { address: { street: 'DESC' }, priority: 'ASC' } }))
            .toEqual(['Invoice draft', 'Invoice 100%', 'Call Miller', 'Overdue reminder']);
        expect(await findTitles('/owner-tasks', { order: { owner: { name: 'DESC' }, priority: 'DESC' } }))
            .toEqual(['Overdue reminder', 'Invoice draft', 'Call Miller', 'Invoice 100%']);
    });

    it('leaves out the order of a list that can not be ordered, like any query it does not name', async () => {
        expect(await findTitles('/unordered-tasks', { order: { priority: 'DESC' } })).toEqual(await findTitles('/unordered-tasks', {}));
    });

    it.each([
        ['a filter of a property it has none for', '/tasks', { filter: { internalNote: 'a' } }],
        ['a filter value of the wrong type', '/tasks', { filter: { priority: { from: 'high' } } }],
        ['a filter of a property of an object it has none for', '/tasks', { filter: { owner: { id: 'a' } } }],
        ['a list of values where it takes text', '/tasks', { filter: { title: ['a'] } }],
        ['an order by an excluded property', '/tasks', { order: { internalNote: 'ASC' } }],
        ['an order by an array', '/tasks', { order: { tags: 'ASC' } }],
        ['an order by a relation it was not given', '/tasks', { order: { owner: { name: 'ASC' } } }],
        ['an order by a property it was not given', '/priority-tasks', { order: { title: 'ASC' } }],
        ['an order that is no direction', '/tasks', { order: { title: 'UP' } }]
    ])('answers %s with a 400', async (_, path, query) => {
        expect((await list(path, query)).status).toBe(400);
    });

    it('takes the entity from the class alone, and refuses options naming what it does not have', () => {
        expect(LimitedTaskController.prototype.findTitles).toBeInstanceOf(Function);
        expect(defineOrderedByMissing).toThrow('A list of CrudTask can\'t be ordered by "missing", which CrudTask doesn\'t have.');
        expect(defineFilteredByMissing).toThrow('missing');
    });

    it('orders by an object that holds one of its own kind, as deep as the rows hold it', async () => {
        expect(await findTitles('/folders', { order: { node: { label: 'ASC' } } })).toEqual(['Archive', 'Drafts', 'Reports']);
        expect(await findTitles('/folders', { order: { node: { parent: { label: 'ASC' } } } })).toEqual(['Drafts', 'Reports', 'Archive']);
        expect(await findTitles('/folders', { order: { node: { parent: { parent: { label: 'ASC' } } } } }))
            .toEqual(['Archive', 'Drafts', 'Reports']);
        expect(await findTitles('/folders', { order: { node: { parent: { parent: { label: 'DESC' } } } } }))
            .toEqual(['Reports', 'Drafts', 'Archive']);
    });
});