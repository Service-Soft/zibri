import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

import { PostgresDataSource, PostgresOptions } from './postgres-data-source.model';
import { PostgresPooler } from './postgres-pooler.model';
import { queryPostgres } from '../../../__testing__/query-postgres.function';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { inject } from '../../../di/inject.function';
import { BaseEntity } from '../../../entity/base-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { Newable } from '../../../types/newable.type';
import { DataSource } from '../../decorators/data-source.decorator';
import { SchemaManagement } from '../../models/schema-management.model';
import { Repository } from '../../repository/repository';
import { RepositoryClass } from '../../repository/repository-class.type';
import { StoredValueTypeMismatchError } from '../../stored-value-type-mismatch.error';
import { Gauge, GaugeReading } from '../../tests/mistyped-values.cases';
import { UniqueConstraintViolationError } from '../../unique-constraint-violation.error';

// what a refused write collided on, and what a json
// column was found holding, were read out of the server's english messages

/**
 * A locale the server's messages are written in, other than english.
 */
const MESSAGE_LOCALE: string = 'de_DE.UTF-8';

@Entity({ tenant: 'shared', allowOrphan: true, uniques: [['email']] })
class LocalizedAccount extends BaseEntity {
    @Property.string()
    email!: string;
}

@DataSource()
class LocalizedDataSource extends PostgresDataSource {
    override options: PostgresOptions = {
        host: 'localhost',
        username: 'postgres',
        password: 'password',
        database: 'db',
        ssl: false
    };

    entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, LocalizedAccount, Gauge];

    readonly repositories: RepositoryClass[] = defaultTestServerRepositories;

    schemaManagement: SchemaManagement = 'synchronize';

    readonly pooler: PostgresPooler = 'none';
}

let server: StartedTestServer | undefined;
let accounts: Repository<LocalizedAccount>;
let gauges: Repository<Gauge>;

/**
 * Runs a statement as the data source's own role.
 * @param sql - The statement.
 * @param parameters - Its parameters.
 * @returns The rows it returned.
 */
async function runSql(sql: string, parameters: unknown[] = []): Promise<Record<string, unknown>[]> {
    return await queryPostgres(inject(LocalizedDataSource), sql, parameters);
}

beforeAll(async () => {
    server = await startTestServer({ dataSources: [LocalizedDataSource] });
    // the image ships its server's translations, and of the locales they need english alone. As
    // files of its own rather than into the locale archive: the running server mapped the archive
    // when it started and never reads it again, while a locale in files is found on every lookup.
    // The character map by the name of its file, which is not node's name for the encoding
    // eslint-disable-next-line unicorn/text-encoding-identifier-case, cspell/spellchecker
    await server.runInContainer(LocalizedDataSource, ['localedef', '--no-archive', '-i', 'de_DE', '-c', '-f', 'UTF-8', MESSAGE_LOCALE]);
    // which only a superuser may set, as an operator does for the whole server
    await server.runAsSuperuser(LocalizedDataSource, [`ALTER DATABASE db SET lc_messages = '${MESSAGE_LOCALE}'`]);
    // connections opened from here on write their messages in it
    await server.reInit();
    accounts = inject(LocalizedDataSource).getRepository(LocalizedAccount);
    gauges = inject(LocalizedDataSource).getRepository(Gauge);
}, 120000);

afterAll(async () => {
    // guarded so a failed beforeAll reports the real cause instead of a shutdown TypeError
    await server?.shutdown();
}, 30000);

describe('a postgres server whose messages are not in english', () => {
    it('writes its messages in that language', async () => {
        // the control: without it, every case below would pass on an english server as well
        const failed: unknown = await runSql('SELECT \'x\'::numeric').catch((error: unknown) => error);

        expect(failed).toBeInstanceOf(Error);
        expect(String(failed)).not.toMatch(/invalid input syntax/);
    }, 30000);

    it('names the properties a refused write collided on', async () => {
        await accounts.deleteAll({});
        await accounts.create({ email: 'someone@example.com' });

        const refused: unknown = await accounts.create({ email: 'someone@example.com' }).catch((error: unknown) => error);

        expect(refused).toBeInstanceOf(UniqueConstraintViolationError);
        expect(refused instanceof UniqueConstraintViolationError ? refused.properties : undefined).toEqual(['email']);
    }, 30000);

    describe('a json column holding another type than its property declares', () => {
        const reading: GaugeReading = { value: 5, takenAt: new Date('2024-03-01T10:00:00.000Z'), calibrated: true, note: 'ok' };
        let mistypedId: string;

        beforeEach(async () => {
            await gauges.deleteAll({});
            mistypedId = (await gauges.create({ name: 'mistyped', level: 1, reading })).id;
            await runSql(
                'UPDATE gauge SET reading = $1::jsonb WHERE id = $2',
                ['{"value":"not-a-number","takenAt":"2024-03-01T10:00:00.000Z","calibrated":true,"note":"ok"}', mistypedId]
            );
        }, 30000);

        it('names the property, the type it declares and the value that was found', async () => {
            await expect(gauges.findAll({ where: { reading: { where: { value: { greaterThan: 1 } } } } }))
                .rejects.toThrow('Gauge.reading.value is declared as a number, but a row holds "not-a-number"');
        }, 30000);

        it('names the property that could not be read, among others of other types read beside it', async () => {
            const found: Promise<Gauge[]> = gauges.findAll({
                where: { reading: { where: { takenAt: { after: new Date(0) }, value: { greaterThan: 1 } } } }
            });

            await expect(found).rejects.toThrow(StoredValueTypeMismatchError);
            await expect(found).rejects.toThrow('Gauge.reading.value is declared as a number');
        }, 30000);
    });
});