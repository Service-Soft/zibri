import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { Chore, describeEntityChecks } from './entity-checks.cases';
import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { PartialClass } from '../../entity/partial-class.model';
import { PickClass } from '../../entity/pick-class.model';
import { ErrorResponseBody } from '../../error-handling/error-response-body.model';
import { KnownHeader } from '../../http/known-header.enum';
import { MimeType } from '../../http/mime-type.enum';
import { Body } from '../../routing/decorators/body.decorator';
import { Controller } from '../../routing/decorators/controller.decorator';
import { Param } from '../../routing/decorators/param.decorator';
import { Patch } from '../../routing/decorators/patch.decorator';
import { Newable } from '../../types/newable.type';
import { CheckConstraintViolationError } from '../check-constraint-violation.error';
import { whereFor } from '../models/where/where-for.function';
import { Repository } from '../repository/repository';

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({ entities: [...defaultTestServerEntities, Chore], repositories: defaultTestServerRepositories });

class ChoreUpdateData extends PartialClass(PickClass(Chore, ['status', 'completedAt'])) {}

@Controller('/chores')
class ChoreController {
    @Patch('/:id')
    async update(@Param.path('id') id: string, @Body(ChoreUpdateData) body: ChoreUpdateData): Promise<Chore> {
        return await inject(dataSourceClass).getRepository(Chore).updateById(id, body);
    }
}

let server: StartedTestServer | undefined;
let baseUrl: string;
let chores: Repository<Chore>;

beforeAll(async () => {
    server = await startTestServer({ controllers: [ChoreController], dataSources: [dataSourceClass] });
    baseUrl = await server.start();
    chores = inject(dataSourceClass).getRepository(Chore);
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.inMemory.shutdown);

describeEntityChecks('the in memory data source', () => chores);

// 01 §D20: a check the data source refused was answered without its code
describe('a check the data source refuses', () => {
    it('is answered over http with the code and message of the check', async () => {
        const chore: Chore = await chores.create({ code: 'chore-over-http', status: 'open', estimate: 2 });

        // the body leaves out the completion date, so only the data source can judge the check
        const res: Response = await fetch(`${baseUrl}/chores/${chore.id}`, {
            method: 'PATCH',
            headers: { [KnownHeader.CONTENT_TYPE]: MimeType.JSON },
            body: JSON.stringify({ status: 'done' })
        });

        expect(res.status).toBe(400);
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const body: ErrorResponseBody = await res.json();
        expect(body.name).toBe('CheckConstraintViolationError');
        expect(body.problems).toEqual([{ key: 'body', code: 'completedAtRequired', message: 'a done chore has a completion date' }]);
    });

    it('is named by the check the entity declares with the same filter, when the store hands back a copy of it', () => {
        const error: CheckConstraintViolationError = new CheckConstraintViolationError(
            Chore,
            whereFor<Chore>({ estimate: { greaterThanEquals: 1 } })
        );

        expect(error.code).toBe('estimateTooSmall');
        expect(error.problems).toEqual([{ key: 'body', code: 'estimateTooSmall', message: 'takes at least 1' }]);
    });

    it('is answered by its filter alone, for a check only the store knows', () => {
        const error: CheckConstraintViolationError = new CheckConstraintViolationError(Chore, whereFor<Chore>({ code: { not: 'retired' } }));

        expect(error.code).toBe('check');
        expect(error.problems).toEqual([{ key: 'body', code: 'check', message: 'breaks the check on "code"' }]);
        expect(error.properties).toEqual(['code']);
    });
});
