import { randomBytes } from 'node:crypto';

import { beforeAll, describe, expect, it } from '@jest/globals';

import { JwtUser } from '../../../__testing__/mocks/entities/jwt-user.entity';
import { ChainedAuditEntry } from '../../../audit/chained-audit-entry.model';
import { ApiKey } from '../../../auth/strategies/api-key/api-key.model';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { initDiContainer } from '../../../di/init-di-container.function';
import { inject } from '../../../di/inject.function';
import { BaseEntity } from '../../../entity/base-entity.model';
import { Invoice } from '../../../plugin/invoicing/models/invoice.model';
import { NumberInvoices } from '../../../plugin/invoicing/models/number-invoices.model';
import { Newable } from '../../../types/newable.type';
import { ChainUtilities } from '../../chain/chain.utilities';
import { FrameworkColumnRegistry } from '../../migration/framework-column.registry';
import { MigratedEntityUtilities } from '../../migration/migrated-entity.utilities';
import { MissingFrameworkColumnError } from '../../migration/missing-framework-column.error';
import { MissingFrameworkColumn } from '../../migration/missing-framework-column.model';
import { SchemaManagement } from '../../models/schema-management.model';
import { RepositoryClass } from '../../repository/repository-class.type';
import { PostgresDataSource, PostgresOptions } from './postgres-data-source.model';
import { PostgresPooler } from './postgres-pooler.model';
import { PostgresSchemaManager } from './postgres-schema-manager.model';
import { PostgresSchema } from './postgres-schema.model';

/**
 * Which columns the framework added since 3.2 a schema the data source does not manage lacks, as the columns stored in
 * the database say, and the statements that add them, worked out without a database.
 */

const ENTITIES: Newable<BaseEntity>[] = [JwtUser, ApiKey, ChainedAuditEntry, Invoice, NumberInvoices];

/**
 * The columns 3.3 added to these entities, by entity.
 */
const ADDED: ReadonlyMap<Newable<BaseEntity>, readonly string[]> = new Map<Newable<BaseEntity>, readonly string[]>([
    [JwtUser, ['locale', 'kind']],
    [ApiKey, ['userKind']],
    [ChainedAuditEntry, ['userKind', 'approvalRequestId']],
    [Invoice, ['type', 'precedingInvoices', 'issuedAt']],
    [NumberInvoices, ['scope']]
]);

/**
 * A data source managing no schema, for what it decides about the columns.
 */
class ExternalDataSource extends PostgresDataSource {
    options: PostgresOptions = { ssl: false };
    entities: Newable<BaseEntity>[] = ENTITIES;
    repositories: RepositoryClass[] = [];
    schemaManagement: SchemaManagement = 'external';
    pooler: PostgresPooler = 'none';

    /**
     * Builds the schema of its entities, and the manager working out what the database lacks of it.
     * @returns Both.
     */
    resolveSchemaAndManager(): [PostgresSchema, PostgresSchemaManager] {
        const schema: PostgresSchema = new PostgresSchema(ENTITIES, this.columnSettings);
        const manager: PostgresSchemaManager = new PostgresSchemaManager(
            schema,
            this.columnSettings,
            ENTITIES,
            { threshold: undefined, thresholdIsInclusive: false },
            this.logger
        );
        return [schema, manager];
    }
}

let dataSource: ExternalDataSource;

/**
 * The columns a database holds of the tables of the entities, as postgres lists them: those of 3.2 alone, without
 * what 3.3 added.
 * @param schema - The schema of the entities.
 * @param tables - The entities whose tables the database holds, every one by default.
 * @returns The columns, as `table` and `name`.
 */
function storedOfThreeTwo(schema: PostgresSchema, tables: readonly Newable<BaseEntity>[] = ENTITIES): Record<string, unknown>[] {
    return tables.flatMap(entity => schema.getTable(entity).columns
        .filter(column => !(ADDED.get(entity) ?? []).includes(column.property ?? ''))
        .map(column => ({ table: schema.getTable(entity).name, name: column.name })));
}

beforeAll(() => {
    initDiContainer();
    dataSource = new ExternalDataSource(inject(ZIBRI_DI_TOKENS.LOGGER), inject(ZIBRI_DI_TOKENS.AUTH_SERVICE));
});

describe('the columns a schema of 3.2 lacks', () => {
    it('are exactly those 3.3 added, each with the statements that add it as the framework creates it', () => {
        const [schema, manager] = dataSource.resolveSchemaAndManager();

        const missing: MissingFrameworkColumn[] = manager.resolveMissingFrameworkColumnsIn(storedOfThreeTwo(schema));

        expect(missing.map(c => [c.entity, c.property]).sort()).toEqual([...ADDED].flatMap(([entity, properties]) => properties.map(p => [entity, p])).sort());
        const users: string = MigratedEntityUtilities.resolveTableName(JwtUser);
        const kind: MissingFrameworkColumn | undefined = missing.find(c => c.entity === JwtUser && c.property === 'kind');
        expect(kind?.statements[0]).toMatch(new RegExp(`^ALTER TABLE "${users}" ADD COLUMN "kind" \\S+`));
        expect(kind?.statements[0]).not.toContain('NOT NULL');
        expect(kind?.statements).toContain(`UPDATE "${users}" SET "kind" = 'person' WHERE "kind" IS NULL`);
        expect(missing.find(c => c.entity === Invoice && c.property === 'type')?.statements)
            .toContain(`UPDATE "${MigratedEntityUtilities.resolveTableName(Invoice)}" SET "type" = 'INVOICE' WHERE "type" IS NULL`);
        // the unique of the scope of a counter, in its tenant, which keeps two formats rendering one scope apart
        expect(missing.find(c => c.entity === NumberInvoices)?.statements.join('\n'))
            .toMatch(/CREATE UNIQUE INDEX CONCURRENTLY \S+ ON "[^"]+" \("tenantId", "scope"\)/);
    });

    it('are none for a table the database has every column of, and for one it does not hold at all', () => {
        const [schema, manager] = dataSource.resolveSchemaAndManager();
        const whole: Record<string, unknown>[] = ENTITIES.flatMap(entity => schema.getTable(entity).columns
            .map(column => ({ table: schema.getTable(entity).name, name: column.name })));

        expect(manager.resolveMissingFrameworkColumnsIn(whole)).toEqual([]);
        expect(manager.resolveMissingFrameworkColumnsIn(storedOfThreeTwo(schema, [JwtUser])).map(c => c.entity)).toEqual([JwtUser, JwtUser]);
    });

    it('are left out of their tables, and a statement naming one is refused with the statements that add it', () => {
        const [schema, manager] = dataSource.resolveSchemaAndManager();
        schema.removeMissingColumns(manager.resolveMissingFrameworkColumnsIn(storedOfThreeTwo(schema)));

        expect(schema.getTable(Invoice).columns.map(c => c.property)).not.toContain('issuedAt');
        expect(() => schema.getColumn(Invoice, 'issuedAt')).toThrow(MissingFrameworkColumnError);
        expect(() => schema.getColumn(Invoice, 'issuedAt')).toThrow(`ADD COLUMN "issuedAt"`);
        expect(schema.getColumn(Invoice, 'number').name).toBe('number');
    });
});

describe('a value written to a column the framework added', () => {
    it('says what a row without the column says when it is none, or what the column registers as such', () => {
        expect([
            FrameworkColumnRegistry.meansAbsent(JwtUser, 'kind', undefined),
            FrameworkColumnRegistry.meansAbsent(JwtUser, 'kind', 'person'),
            FrameworkColumnRegistry.meansAbsent(JwtUser, 'kind', 'service'),
            FrameworkColumnRegistry.meansAbsent(Invoice, 'precedingInvoices', []),
            FrameworkColumnRegistry.meansAbsent(Invoice, 'issuedAt', new Date())
        ]).toEqual([true, true, false, true, false]);
    });

    it('that says so is left out of the hash of a chained row, so a row stored without the column verifies', () => {
        const key: Buffer = randomBytes(32);
        const row: object = { action: 'auth.login', outcome: 'success', occurredAt: new Date(0) };

        const hashed: string = ChainUtilities.resolveRowHash(key, ChainedAuditEntry, '', '', row);

        expect(ChainUtilities.resolveRowHash(key, ChainedAuditEntry, '', '', { ...row, userKind: 'person' })).toBe(hashed);
        expect(ChainUtilities.resolveRowHash(key, ChainedAuditEntry, '', '', { ...row, userKind: 'service' })).not.toBe(hashed);
    });
});
