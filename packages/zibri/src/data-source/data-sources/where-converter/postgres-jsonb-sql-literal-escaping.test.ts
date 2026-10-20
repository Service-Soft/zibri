import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestDataSource, defaultTestServerEntities } from '../../../__testing__/test-server/create-test-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function.ts';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator.ts';
import { inject } from '../../../di/inject.function.ts';
import { BaseEntity } from '../../../entity/base-entity.model.ts';
import { Entity } from '../../../entity/decorators/entity.decorator.ts';
import { Property } from '../../../entity/decorators/property.decorator.ts';
import { Repository } from '../../repository/repository.ts';

class ContactDetails {
    @Property.string()
    lastName!: string;

    @Property.string()
    note!: string;
}

@Entity({ tenant: 'shared' })
class Contact extends BaseEntity {
    @Property.string()
    name!: string;

    @Property.object({ cls: () => ContactDetails, required: false })
    details: ContactDetails | undefined | null;
}

describe('PostgresTypeOrmWhereFilterConverter — JSONB SQL literal escaping', () => {
    let server: StartedTestServer;
    let contactRepo: Repository<Contact>;

    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [createTestDataSource({ entities: [...defaultTestServerEntities, Contact] })]
        });
        contactRepo = inject(repositoryTokenFor(Contact));
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    beforeEach(async () => {
        await contactRepo.deleteAll({});
    });

    it('matches a JSONB string value containing a single quote without a SQL syntax error', async () => {
        await contactRepo.create({ name: 'A', details: { lastName: 'O\'Brien', note: 'ordinary' } });
        await contactRepo.create({ name: 'B', details: { lastName: 'Smith', note: 'ordinary' } });

        const res: Contact[] = await contactRepo.findAll({
            where: { details: { where: { lastName: 'O\'Brien' } } }
        });

        expect(res.map(c => c.name)).toEqual(['A']);
    });

    it('does not allow a quoted value to break out of the string literal and inject SQL', async () => {
        await contactRepo.create({ name: 'A', details: { lastName: 'O\'Brien', note: 'ordinary' } });
        await contactRepo.create({ name: 'B', details: { lastName: 'Smith', note: 'ordinary' } });

        // an injection payload shaped to try to close the literal and always match everything
        const payload: string = 'x\' OR \'1\'=\'1';

        const res: Contact[] = await contactRepo.findAll({
            where: { details: { where: { lastName: payload } } }
        });

        // must match nothing, not silently return all rows nor throw a syntax error
        expect(res).toEqual([]);
    });

    it('rejects an unterminated quote payload safely (matches nothing, does not corrupt the query)', async () => {
        await contactRepo.create({ name: 'A', details: { lastName: 'O\'Brien', note: 'ordinary' } });

        const res: Contact[] = await contactRepo.findAll({
            where: { details: { where: { lastName: 'unterminated\'' } } }
        });

        expect(res).toEqual([]);
    });

    it('handles multiple consecutive quotes in a value correctly', async () => {
        await contactRepo.create({ name: 'A', details: { lastName: '\'\'\'\'', note: 'ordinary' } });

        const res: Contact[] = await contactRepo.findAll({
            where: { details: { where: { lastName: '\'\'\'\'' } } }
        });

        expect(res.map(c => c.name)).toEqual(['A']);
    });

    it('matches via the "like" operator on a JSONB string field containing a quote', async () => {
        await contactRepo.create({ name: 'A', details: { lastName: 'O\'Brien', note: 'ordinary' } });

        const res: Contact[] = await contactRepo.findAll({
            where: { details: { where: { lastName: { like: '%O\'Brien%' } } } }
        });

        expect(res.map(c => c.name)).toEqual(['A']);
    });
});