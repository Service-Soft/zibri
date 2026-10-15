import { describe, expect, it } from '@jest/globals';

import { Migration } from './migration.model';
import { Injectable } from '../../di/decorators/injectable.decorator';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { Newable } from '../../types/newable.type';
import { SemVerVersion } from '../../versioning/sem-ver.utilities';
import { DataSourceInterface } from '../data-sources/data-source.interface';
import { Repository } from '../repository/repository';
import { Transaction } from '../transaction/transaction.model';

/**
 * A gizmo as the first version of the application stores it, under a table name the second version
 * renames.
 */
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true, tableName: 'old_gizmo' })
export class OldGizmo extends BaseEntity {
    /**
     * Its name, which no two gizmos share.
     */
    @Property.string({ unique: true })
    name!: string;

    /**
     * The parts it is built from, a relation the gizmo owns.
     */
    @Property.manyToMany({ target: () => OldGizmoPart, inverseSide: 'gizmos', joinTable: true })
    parts!: OldGizmoPart[];

    /**
     * The tags it carries, a relation the tags own.
     */
    @Property.manyToMany({ target: () => OldGizmoTag, inverseSide: 'gizmos', joinTable: false })
    tags!: OldGizmoTag[];
}

/**
 * A part of the gizmos of the first version.
 */
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true, tableName: 'gizmo_part' })
export class OldGizmoPart extends BaseEntity {
    /**
     * Its name.
     */
    @Property.string()
    name!: string;

    /**
     * The gizmos it is part of.
     */
    @Property.manyToMany({ target: () => OldGizmo, inverseSide: 'parts', joinTable: false })
    gizmos!: OldGizmo[];

    /**
     * The spare gizmos it is part of.
     */
    @Property.manyToMany({ target: () => SpareGizmo, inverseSide: 'parts', joinTable: false })
    spareGizmos!: SpareGizmo[];
}

/**
 * A gizmo the first version stores apart from the others, which the second version merges into them.
 */
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class SpareGizmo extends BaseEntity {
    /**
     * Its name.
     */
    @Property.string()
    name!: string;

    /**
     * The parts it is built from, a relation the gizmo owns.
     */
    @Property.manyToMany({ target: () => OldGizmoPart, inverseSide: 'spareGizmos', joinTable: true })
    parts!: OldGizmoPart[];
}

/**
 * A tag of the gizmos of the first version.
 */
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true, tableName: 'gizmo_tag' })
export class OldGizmoTag extends BaseEntity {
    /**
     * Its name.
     */
    @Property.string()
    name!: string;

    /**
     * The gizmos it is on.
     */
    @Property.manyToMany({ target: () => OldGizmo, inverseSide: 'tags', joinTable: true })
    gizmos!: OldGizmo[];
}

/**
 * The gizmo as the second version of the application declares it, under its own table name.
 */
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class Gizmo extends BaseEntity {
    /**
     * Its name, which no two gizmos share.
     */
    @Property.string({ unique: true })
    name!: string;

    /**
     * The parts it is built from, a relation the gizmo owns.
     */
    @Property.manyToMany({ target: () => GizmoPart, inverseSide: 'gizmos', joinTable: true })
    parts!: GizmoPart[];

    /**
     * The tags it carries, a relation the tags own.
     */
    @Property.manyToMany({ target: () => GizmoTag, inverseSide: 'gizmos', joinTable: false })
    tags!: GizmoTag[];
}

/**
 * A part of the gizmos of the second version.
 */
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true, tableName: 'gizmo_part' })
export class GizmoPart extends BaseEntity {
    /**
     * Its name.
     */
    @Property.string()
    name!: string;

    /**
     * The gizmos it is part of.
     */
    @Property.manyToMany({ target: () => Gizmo, inverseSide: 'parts', joinTable: false })
    gizmos!: Gizmo[];
}

/**
 * A tag of the gizmos of the second version.
 */
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true, tableName: 'gizmo_tag' })
export class GizmoTag extends BaseEntity {
    /**
     * Its name.
     */
    @Property.string()
    name!: string;

    /**
     * The gizmos it is on.
     */
    @Property.manyToMany({ target: () => Gizmo, inverseSide: 'tags', joinTable: true })
    gizmos!: Gizmo[];
}

/**
 * The entities of the first version.
 */
export const firstVersionEntities: Newable<BaseEntity>[] = [OldGizmo, OldGizmoPart, OldGizmoTag, SpareGizmo];

/**
 * The entities of the second version.
 */
export const secondVersionEntities: Newable<BaseEntity>[] = [Gizmo, GizmoPart, GizmoTag];

/**
 * Builds the migration of the second version, which renames the gizmos and merges the spare ones
 * into them.
 * @param dataSourceClass - The data source it belongs to.
 * @returns The migration.
 */
export function createUpgradeGizmoMigration(dataSourceClass: Newable<DataSourceInterface>): Newable<Migration> {
    /**
     * Moves the gizmos to the table name the second version declares, and the spare ones with them.
     */
    @Injectable()
    class UpgradeGizmoMigration extends Migration {
        /**
         * The version of the application that ships it.
         */
        version: SemVerVersion = '0.1.0';

        constructor() {
            super(dataSourceClass);
        }

        override async up(transaction: Transaction): Promise<void> {
            await this.dataSource.renameEntity({ entity: Gizmo, currentTableName: 'old_gizmo', transaction });
            await this.dataSource.mergeEntity({ entity: Gizmo, currentTableName: 'spare_gizmo', transaction });
        }

        // eslint-disable-next-line typescript/require-await
        override async down(): Promise<void> {
            throw new Error('Not needed for these cases.');
        }
    }
    return UpgradeGizmoMigration;
}

/**
 * Stores gizmos the way the first version does: two of them, with parts and tags, and two spare ones
 * with parts - one of them named like a gizmo already is.
 * @param dataSource - The data source, started as the first version.
 */
export async function seedFirstVersion(dataSource: DataSourceInterface): Promise<void> {
    const parts: OldGizmoPart[] = await dataSource.getRepository(OldGizmoPart).createAll([{ name: 'wheel' }, { name: 'axle' }]);
    const wheel: OldGizmoPart[] = parts.filter(p => p.name === 'wheel');
    const gizmos: Repository<OldGizmo> = dataSource.getRepository(OldGizmo);
    const first: OldGizmo = await gizmos.create({ name: 'first', parts });
    await gizmos.create({ name: 'second', parts: parts.filter(p => p.name === 'axle') });
    await dataSource.getRepository(OldGizmoTag).create({ name: 'new', gizmos: [first] });
    await dataSource.getRepository(SpareGizmo).createAll([{ name: 'second', parts: wheel }, { name: 'third', parts: wheel }]);
}

/**
 * Runs every case against the gizmos one data source holds once the second version renamed them and
 * merged the spare ones into them.
 * @param dataSourceName - The data source, for the name of the cases.
 * @param dataSourceOf - Reads the data source, started as the second version over what
 * {@link seedFirstVersion} stored.
 */
export function describeMovedEntities(dataSourceName: string, dataSourceOf: () => DataSourceInterface): void {
    describe(`entities a migration renamed and merged, on ${dataSourceName}`, () => {
        it('holds every entity stored under the previous table names, but the one a unique leaves out', async () => {
            const gizmos: Gizmo[] = await dataSourceOf().getRepository(Gizmo)
                .findAll({ take: 'all' });

            expect(gizmos.map(g => g.name).sort()).toStrictEqual(['first', 'second', 'third']);
        });

        it('keeps the many to many relations it owns, of every entity moved', async () => {
            const gizmos: Gizmo[] = await dataSourceOf().getRepository(Gizmo)
                .findAll({ take: 'all', relations: ['parts'] });
            const partsByGizmo: [string, string[]][] = gizmos
                .map((g): [string, string[]] => [g.name, g.parts.map(p => p.name).sort()])
                .sort((a, b) => a[0].localeCompare(b[0]));

            // the spare "second" was left out, and with it the wheel it was built from
            expect(partsByGizmo).toStrictEqual([['first', ['axle', 'wheel']], ['second', ['axle']], ['third', ['wheel']]]);
        });

        it('keeps those relations from the other side, too', async () => {
            const parts: GizmoPart[] = await dataSourceOf().getRepository(GizmoPart)
                .findAll({ take: 'all', relations: ['gizmos'] });
            const gizmosByPart: [string, string[]][] = parts
                .map((p): [string, string[]] => [p.name, p.gizmos.map(g => g.name).sort()])
                .sort((a, b) => a[0].localeCompare(b[0]));

            expect(gizmosByPart).toStrictEqual([['axle', ['first', 'second']], ['wheel', ['first', 'third']]]);
        });

        it('keeps the many to many relations another entity owns to it, from both sides', async () => {
            const tags: GizmoTag[] = await dataSourceOf().getRepository(GizmoTag)
                .findAll({ take: 'all', relations: ['gizmos'] });
            const first: Gizmo = await dataSourceOf().getRepository(Gizmo)
                .findOne({ where: { name: 'first' }, relations: ['tags'] });

            expect(tags.map(t => [t.name, t.gizmos.map(g => g.name)])).toStrictEqual([['new', ['first']]]);
            expect(first.tags.map(t => t.name)).toStrictEqual(['new']);
        });

        it('keeps its uniques enforced', async () => {
            await expect(dataSourceOf().getRepository(Gizmo)
                .create({ name: 'first' })).rejects.toThrow();
        });
    });
}