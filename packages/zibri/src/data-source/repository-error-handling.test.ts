import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { QueryFailedError } from './query-failed.error';
import { Repository } from './repository';
import { createTestDataSource, defaultTestServerEntities } from '../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { BaseEntity } from '../entity/base-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { NotFoundError } from '../error-handling/errors/not-found.error';
import { type LoggerInterface } from '../logging/logger.interface';

@Entity()
class Widget extends BaseEntity {
    @Property.string({ unique: true })
    name!: string;

    @Property.number()
    stock!: number;
}

describe('Repository error handling', () => {
    let server: StartedTestServer;
    let widgetRepo: Repository<Widget>;

    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [createTestDataSource({ entities: [...defaultTestServerEntities, Widget] })]
        });
        widgetRepo = inject(repositoryTokenFor(Widget));
    }, 15000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    beforeEach(async () => {
        await widgetRepo.deleteAll({});
    });

    describe('not-found paths', () => {
        it('findById throws NotFoundError for a missing id', async () => {
            await expect(widgetRepo.findById('00000000-0000-4000-8000-000000000000')).rejects.toThrow(NotFoundError);
        });

        it('updateById upserts a new row when given a full entity for a missing id (save-based, not a strict update)', async () => {
            const missingId: string = '00000000-0000-4000-8000-000000000000';
            const upserted: Widget = await widgetRepo.updateById(missingId, { name: 'upserted', stock: 1 });

            expect(upserted.id).toBe(missingId);
            await expect(widgetRepo.findById(missingId)).resolves.toMatchObject({ name: 'upserted', stock: 1 });
        });

        it('updateById throws QueryFailedError, not NotFoundError, when the missing id combined with partial data violates a not-null constraint', async () => {
            await expect(
                widgetRepo.updateById('00000000-0000-4000-8000-000000000001', { stock: 1 })
            ).rejects.toThrow(QueryFailedError);
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
            await expect(widgetRepo.findOne({ where: { name: 'does-not-exist' } }, false)).resolves.toBeUndefined();
        });
    });

    describe('duplicate key handling', () => {
        it('translates a unique constraint violation into a QueryFailedError', async () => {
            await widgetRepo.create({ name: 'unique-widget', stock: 1 });

            await expect(widgetRepo.create({ name: 'unique-widget', stock: 2 })).rejects.toThrow(QueryFailedError);
        });
    });

    describe('id stripping on create', () => {
        it('ignores a client-supplied id and logs a warning by default', async () => {
            const logger: LoggerInterface = inject(ZIBRI_DI_TOKENS.LOGGER);
            // eslint-disable-next-line typescript/typedef
            const warnSpy = jest.spyOn(logger, 'warn');

            try {
                const suppliedId: string = '11111111-1111-4111-8111-111111111111';
                const created: Widget = await widgetRepo.create({ id: suppliedId, name: 'stripped', stock: 1 } as Partial<Widget> as Widget);

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
                { id: suppliedId, name: 'allowed-id', stock: 1 } as Partial<Widget> as Widget,
                { allowId: true }
            );

            expect(created.id).toBe(suppliedId);
        });
    });

    describe('mass operations with an empty where filter', () => {
        it('updateAll({}) updates every entity', async () => {
            await widgetRepo.create({ name: 'a', stock: 1 });
            await widgetRepo.create({ name: 'b', stock: 1 });

            const updated: Widget[] = await widgetRepo.updateAll({}, { stock: 99 });

            expect(updated).toHaveLength(2);
            expect(updated.every(w => w.stock === 99)).toBe(true);
        });

        it('deleteAll({}) deletes every entity', async () => {
            await widgetRepo.create({ name: 'a', stock: 1 });
            await widgetRepo.create({ name: 'b', stock: 1 });

            const deleted: Widget[] = await widgetRepo.deleteAll({});

            expect(deleted).toHaveLength(2);
            await expect(widgetRepo.findOne({ where: {} }, false)).resolves.toBeUndefined();
        });
    });
});