import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { Repository } from './repository';
import { TestTimeouts } from '../../__testing__/constants';
import { createTestDataSource, defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { NotFoundError } from '../../error-handling/errors/not-found.error';
import { type LoggerInterface } from '../../logging/logger.interface';
import { QueryFailedError } from '../query-failed.error';
import { UniqueConstraintViolationError } from '../unique-constraint-violation.error';

@Entity({ tenant: 'shared' })
class Widget extends BaseEntity {
    @Property.string({ unique: true })
    name!: string;

    @Property.number()
    stock!: number;
}

/**
 * Every column optional on purpose: an update that missed its row and fell back to an insert would
 * break no constraint, and leave no trace.
 */
@Entity({ tenant: 'shared' })
class Note extends BaseEntity {
    @Property.string({ required: false })
    body: string | undefined | null;
}

describe('Repository error handling', () => {
    let server: StartedTestServer;
    let widgetRepo: Repository<Widget>;
    let noteRepo: Repository<Note>;

    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [createTestDataSource({ entities: [...defaultTestServerEntities, Widget, Note], repositories: defaultTestServerRepositories })]
        });
        widgetRepo = inject(repositoryTokenFor(Widget));
        noteRepo = inject(repositoryTokenFor(Note));
    }, TestTimeouts.postgres.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.postgres.shutdown);

    beforeEach(async () => {
        await widgetRepo.deleteAll({});
    });

    describe('not-found paths', () => {
        it('findById throws NotFoundError for a missing id', async () => {
            await expect(widgetRepo.findById('00000000-0000-4000-8000-000000000000')).rejects.toThrow(NotFoundError);
        });

        it('updateById throws NotFoundError for a missing id', async () => {
            await expect(
                widgetRepo.updateById('00000000-0000-4000-8000-000000000001', { stock: 1 })
            ).rejects.toThrow(NotFoundError);
        });

        // with nothing to break, an update handed to an upserting save would insert the row and bring it
        // back carrying only what this call set - with nothing raised anywhere
        it('updateById does not bring back a deleted row whose columns are all optional', async () => {
            const created: Note = await noteRepo.create({ body: 'deleted under us' });
            await noteRepo.deleteById(created.id);

            await expect(noteRepo.updateById(created.id, { body: 'edited' })).rejects.toThrow(NotFoundError);
            expect(await noteRepo.findAll({ where: { id: created.id } })).toEqual([]);
        });

        it('deleteById throws NotFoundError for a missing id', async () => {
            await expect(
                widgetRepo.deleteById('00000000-0000-4000-8000-000000000000')
            ).rejects.toThrow(NotFoundError);
        });

        it('findOne with required=true (default) throws NotFoundError when nothing matches', async () => {
            await expect(widgetRepo.findOne({ where: { name: 'does-not-exist' } })).rejects.toThrow(NotFoundError);
        });

        it('findOne with required=false returns undefined instead of throwing', async () => {
            await expect(widgetRepo.findOne({ where: { name: 'does-not-exist' }, required: false })).resolves.toBeUndefined();
        });

        // an empty table is the case a caller asks this for: seeding a database on its first start,
        // refusing a migration that already ran
        it('exists answers false for a table holding nothing, and true once it holds a row', async () => {
            await expect(widgetRepo.exists()).resolves.toBe(false);

            await widgetRepo.create({ name: 'first', stock: 1 });

            await expect(widgetRepo.exists()).resolves.toBe(true);
        });
    });

    describe('duplicate key handling', () => {
        it('translates a unique constraint violation into a UniqueConstraintViolationError', async () => {
            await widgetRepo.create({ name: 'unique-widget', stock: 1 });

            await expect(widgetRepo.create({ name: 'unique-widget', stock: 2 })).rejects.toThrow(UniqueConstraintViolationError);
        });

        it('names the property that was already taken', async () => {
            await widgetRepo.create({ name: 'named-widget', stock: 1 });

            // the same information a valkey backed store reports for the same declaration, which is
            // what lets an application react to a duplicate without knowing which store refused it
            await expect(widgetRepo.create({ name: 'named-widget', stock: 2 }))
                .rejects.toMatchObject({ properties: ['name'] });
        });

        it('keeps the failed query as the cause', async () => {
            await widgetRepo.create({ name: 'caused-widget', stock: 1 });

            const error: unknown = await widgetRepo.create({ name: 'caused-widget', stock: 2 }).catch((error_: unknown) => error_);

            expect((error as UniqueConstraintViolationError).cause).toBeInstanceOf(QueryFailedError);
        });
    });

    describe('id stripping on create', () => {
        it('ignores a client-supplied id and logs a warning by default', async () => {
            const logger: LoggerInterface = inject(ZIBRI_DI_TOKENS.LOGGER);
            // eslint-disable-next-line typescript/typedef
            const warnSpy = jest.spyOn(logger, 'warn');

            try {
                const suppliedId: string = '11111111-1111-4111-8111-111111111111';
                const created: Widget = await widgetRepo.create({ id: suppliedId, name: 'stripped', stock: 1 });

                expect(created.id).not.toBe(suppliedId);
                expect(warnSpy).toHaveBeenCalledWith('Found an id on the create data, it will be ignored.');
            }
            finally {
                warnSpy.mockRestore();
            }
        });

        it('honors a client-supplied id when allowId is true', async () => {
            const suppliedId: string = '22222222-2222-4222-8222-222222222222';
            const created: Widget = await widgetRepo.create(
                { id: suppliedId, name: 'allowed-id', stock: 1 },
                { allowId: true }
            );

            expect(created.id).toBe(suppliedId);
        });
    });

    describe('mass operations with an empty where filter', () => {
        it('updateAll({}) updates every entity', async () => {
            await widgetRepo.create({ name: 'a', stock: 1 });
            await widgetRepo.create({ name: 'b', stock: 1 });

            const updated: Widget[] = await widgetRepo.updateAll({}, { stock: 99 }, { returnUpdated: true });

            expect(updated).toHaveLength(2);
            expect(updated.every(w => w.stock === 99)).toBe(true);
        });

        it('deleteAll({}) deletes every entity', async () => {
            await widgetRepo.create({ name: 'a', stock: 1 });
            await widgetRepo.create({ name: 'b', stock: 1 });

            const deleted: Widget[] = await widgetRepo.deleteAll({}, { returnDeleted: true });

            expect(deleted).toHaveLength(2);
            await expect(widgetRepo.findOne({ where: {}, required: false })).resolves.toBeUndefined();
        });
    });
});