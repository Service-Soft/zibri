import { beforeAll, describe, expect, it } from '@jest/globals';

import { PostgresDataSource, PostgresOptions } from './postgres-data-source.model';
import { PostgresPooler } from './postgres-pooler.model';
import { PostgresColumnSettings, PostgresSchema } from './postgres-schema.model';
import { PostgresColumn, PostgresTable } from './postgres-table.model';
import { Company } from '../../../__testing__/mocks/entities/company.entity';
import { Profile } from '../../../__testing__/mocks/entities/profile.entity';
import { User } from '../../../__testing__/mocks/entities/user.entity';
import { defaultTestServerEntities } from '../../../__testing__/test-server/create-test-data-source.function';
import { BackupEntity } from '../../../backup/backup-entity.model';
import { BackupResourceEntity } from '../../../backup/backup-resource-entity.model';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { initDiContainer } from '../../../di/init-di-container.function';
import { inject } from '../../../di/inject.function';
import { BaseEntity } from '../../../entity/base-entity.model';
import { isRelationMetadata } from '../../../entity/models/is-relation-metadata.function';
import { MailingListSubscriber } from '../../../plugin/mailing-list/models/mailing-list-subscriber.model';
import { MailingList } from '../../../plugin/mailing-list/models/mailing-list.model';
import { Newable } from '../../../types/newable.type';
import { OmitStrict } from '../../../types/omit-strict.type';
import { FsUtilities } from '../../../utilities/fs.utilities';
import { JsonUtilities } from '../../../utilities/json.utilities';
import { MetadataUtilities } from '../../../utilities/metadata.utilities';
import { Gizmo, GizmoPart, GizmoTag, OldGizmo, OldGizmoPart, OldGizmoTag, SpareGizmo } from '../../migration/moved-entities.cases';
import { SchemaManagement } from '../../models/schema-management.model';
import { RepositoryClass } from '../../repository/repository-class.type';
import { Book, Plaque, Shelf } from '../../tests/created-relations.cases';
import { Album, Artist, Track } from '../../tests/nested-relations.cases';
import { Measurement } from '../../tests/number-formats.cases';
import { Lead } from '../../tests/one-of-entities.cases';
import { Chore, Doorplate, Folder, Guest, Household, Lodger, Pet, Resident, Stop, Ticket, Trip } from '../../tests/owned-relations.cases';
import { Label, Organizer, Venue } from '../../tests/partial-nested-update.cases';
import { Genre, Playlist } from '../../tests/relation-allow-list.cases';
import { CostGroup, CostItem } from '../../tests/repository-costs.cases';
import { Account, Invoice, Project, Tag, Task } from '../../tests/scoped-relations.cases';

/**
 * A column, as the tables typeorm built are described.
 */
type DescribedColumn = Pick<PostgresColumn, 'name' | 'type' | 'length' | 'isArray' | 'nullable' | 'default' | 'generated' | 'collation'>;

/**
 * A table, as the tables typeorm built are described: without the keys an entity declares, which the
 * data source keeps apart from its tables.
 */
type DescribedTable = OmitStrict<PostgresTable, 'entityClass' | 'columns'> & {
    /**
     * Its columns, by name.
     */
    columns: DescribedColumn[]
};

/**
 * The data source the schema belongs to, for what it decides about columns.
 */
class ComparedDataSource extends PostgresDataSource {
    options: PostgresOptions = { ssl: false };
    entities: Newable<BaseEntity>[] = [];
    repositories: RepositoryClass[] = [];
    schemaManagement: SchemaManagement = 'external';
    pooler: PostgresPooler = 'none';

    /**
     * What the data source decides about the columns, as the schema is handed it.
     * @returns The settings.
     */
    resolveSettings(): PostgresColumnSettings {
        return this.columnSettings;
    }
}

function byName(a: { name: string }, b: { name: string }): number {
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/**
 * Describes the tables the schema builds, the way the tables typeorm built were recorded.
 * @param schema - The schema.
 * @returns Its tables, described.
 */
function describeTables(schema: PostgresSchema): DescribedTable[] {
    return schema.tables.map(table => ({
        name: table.name,
        columns: table.columns.map((c): DescribedColumn => ({
            name: c.name,
            type: c.type,
            length: c.length,
            isArray: c.isArray,
            nullable: c.nullable,
            default: c.default,
            generated: c.generated,
            collation: c.collation
        })).sort(byName),
        primaryKey: { ...table.primaryKey, columns: [...table.primaryKey.columns].sort() },
        foreignKeys: [...table.foreignKeys].sort(byName),
        uniques: [...table.uniques].sort(byName),
        indexes: [...table.indexes].sort(byName)
    })).sort(byName);
}

/**
 * Collects some entities and every entity their relations reach.
 * @param entities - The entities to start from.
 * @returns Them and the entities they relate to, each once.
 */
function withRelated(entities: Newable<BaseEntity>[]): Newable<BaseEntity>[] {
    const res: Set<Newable<BaseEntity>> = new Set();
    const visit: (entity: Newable<BaseEntity>) => void = entity => {
        if (res.has(entity)) {
            return;
        }
        res.add(entity);
        for (const property of Object.values(MetadataUtilities.getModelProperties(entity))) {
            if (isRelationMetadata(property)) {
                visit(property.target());
            }
        }
    };
    for (const entity of entities) {
        visit(entity);
    }
    return [...res];
}

/**
 * The columns declared since typeorm's tables were recorded, by table: what a database of 2.x lacks and
 * the upgrade guide tells an application to add. The recording stays what typeorm built.
 */
const COLUMNS_ADDED_SINCE_RECORDING: Record<string, string[]> = {
    audit_entry: ['mac', 'recordedAt'],
    jwt_refresh_token: ['authenticatedAt', 'ipAddress', 'issuedAt', 'userAgent'],
    jwt_user: ['emailVerifiedAt'],
    login_ticket: ['passwordChangeRequired', 'purpose'],
    password_credentials: ['changeRequired'],
    thread_job_entity: ['checkpoint', 'instanceId']
};

/**
 * The tables of the entities declared since typeorm's tables were recorded, which the upgrade guide's
 * migration creates.
 */
const TABLES_ADDED_SINCE_RECORDING: string[] = ['audit_checkpoint', 'chain_anchor', 'signing_key'];

let compared: ComparedDataSource;
/**
 * The tables typeorm built for each group of entities, as the 2.x data source declared them to it.
 */
let typeOrmTables: Record<string, DescribedTable[]>;

beforeAll(async () => {
    initDiContainer();
    compared = new ComparedDataSource(inject(ZIBRI_DI_TOKENS.LOGGER), inject(ZIBRI_DI_TOKENS.AUTH_SERVICE));
    typeOrmTables = JsonUtilities.parse(await FsUtilities.readFile(FsUtilities.getPath(__dirname, 'postgres-schema.typeorm-tables.json')));
});

describe('PostgresSchema', () => {
    // the tables were built by typeorm from a second description of every entity. Named the
    // way typeorm named them, a database it created keeps its keys when the schema takes over. What
    // typeorm built was recorded while it still built them, and is what a database of 2.x holds
    it.each([
        ['the framework\'s own entities', defaultTestServerEntities],
        ['entities relating to each other every way', [User, Company, Profile]],
        ['rows a relation owns', [Household, Resident, Chore, Pet, Doorplate, Guest, Trip, Stop, Ticket, Lodger, Folder]],
        ['rows created through a relation', [Shelf, Book, Plaque]],
        ['relations of relations', [Artist, Album, Track]],
        ['objects inside rows', [Venue, Organizer, Label]],
        ['relations allowed to some callers', [Playlist, Genre]],
        ['relations under a scope', [Account, Invoice, Tag, Project, Task]],
        ['values of several shapes', [Lead]],
        ['every kind of number', [Measurement]],
        ['entities a migration moves', [OldGizmo, OldGizmoPart, SpareGizmo, OldGizmoTag, Gizmo, GizmoPart, GizmoTag]],
        ['a plugin\'s many to many relation', [MailingList, MailingListSubscriber]],
        ['backups', [BackupEntity, BackupResourceEntity]],
        ['the measured costs', [CostGroup, CostItem]]
    ])('builds the tables typeorm built, for %s', (group, seeds) => {
        const built: DescribedTable[] = describeTables(new PostgresSchema(withRelated(seeds), compared.resolveSettings()));
        for (const table of built) {
            expect(table.columns.map(c => c.name)).toEqual(expect.arrayContaining(COLUMNS_ADDED_SINCE_RECORDING[table.name] ?? []));
        }
        const recorded: DescribedTable[] = built.filter(table => !TABLES_ADDED_SINCE_RECORDING.includes(table.name)).map(table => ({
            ...table,
            columns: table.columns.filter(c => !(COLUMNS_ADDED_SINCE_RECORDING[table.name] ?? []).includes(c.name))
        }));

        expect(recorded).toEqual(typeOrmTables[group]);
    });
});