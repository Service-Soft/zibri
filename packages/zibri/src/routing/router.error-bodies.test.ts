import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { Body } from './decorators/body.decorator';
import { Controller } from './decorators/controller.decorator';
import { Post } from './decorators/post.decorator';
import { TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { BaseEntity } from '../entity/base-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { MimeType } from '../http/mime-type.enum';

@Entity({ tenant: 'shared', allowOrphan: true })
class ErrorBodyProject extends BaseEntity {
    @Property.string()
    name!: string;

    @Property.oneToMany({ target: () => ErrorBodyTask, inverseSide: 'project' })
    tasks!: ErrorBodyTask[];
}

@Entity({ tenant: 'shared', allowOrphan: true })
class ErrorBodyTask extends BaseEntity {
    @Property.string()
    title!: string;

    @Property.manyToOne({ target: () => ErrorBodyProject, joinColumn: 'projectId', inverseSide: 'tasks', required: false })
    project?: ErrorBodyProject;

    @Property.string({ format: 'uuid', required: false })
    projectId?: string;
}

@Controller('/error-bodies')
class ErrorBodiesController {
    @Post('/tasks')
    create(@Body(ErrorBodyTask) task: ErrorBodyTask): string {
        return task.title;
    }
}

let server: StartedTestServer | undefined;
let baseUrl: string;

beforeAll(async () => {
    server = await startTestServer({
        controllers: [ErrorBodiesController],
        dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories })]
    });
    baseUrl = await server.start();
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.inMemory.shutdown);

// error bodies told every caller about the application's classes
// and its explorer, which belongs to whoever writes the application
describe('the body of an error a caller is answered with', () => {
    it('says that a relation cannot be written, and names no class', async () => {
        const res: Response = await fetch(`${baseUrl}/error-bodies/tasks`, {
            method: 'POST',
            headers: { 'Content-Type': MimeType.JSON },
            body: JSON.stringify({ title: 'Write the report', project: { name: 'Reports' } })
        });

        expect(res.status).toBe(400);
        const body: string = await res.text();
        expect(body).toContain('relations are not allowed');
        expect(body).not.toMatch(/class |ErrorBodyProject|@Property/);
    });

    it('says that a route does not exist, and nothing about the explorer', async () => {
        const res: Response = await fetch(`${baseUrl}/nope`, { headers: { Accept: MimeType.JSON } });

        expect(res.status).toBe(404);
        const body: string = await res.text();
        expect(body).toContain('does not exist');
        expect(body).not.toContain('Explorer');
    });
});