import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { Repository } from './repository.ts';
import { createTestDataSource, defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../di/inject.function.ts';
import { BaseEntity } from '../../entity/base-entity.model.ts';
import { Entity } from '../../entity/decorators/entity.decorator.ts';
import { Property } from '../../entity/decorators/property.decorator.ts';
import { NotFoundError } from '../../error-handling/errors/not-found.error.ts';
import { type LoggerInterface } from '../../logging/logger.interface.ts';
import { QueryFailedError } from '../query-failed.error.ts';
import { UniqueConstraintViolationError } from '../unique-constraint-violation.error.ts';

@Entity({ tenant: 'shared' })
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
    }, 30000);

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

        it('updateById throws NotFoundError for a missing id', async () => {
            await expect(
                widgetRepo.updateById('00000000-0000-4000-8000-000000000001', { stock: 1 })
            ).rejects.toThrow(NotFoundError);
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
            // eslint-disable-next-line typescript-js/typedef
            const warnSpy = vi.spyOn(logger, 'warn');

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