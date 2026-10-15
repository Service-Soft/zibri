import { describe, expect, it } from '@jest/globals';

import { Entity, EntityMetadata } from './entity.decorator';
import { Property } from './property.decorator';
import { KeyGroups, keyGroupsOf } from '../../global/model-registry/key-descriptor';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { BaseEntity } from '../base-entity.model';

/**
 * The property names written on the decorator are checked against the class while compiling: every
 * name has to be a property of it, whether that property is required or optional.
 */

/**
 * The far side of the relation an item reads.
 */
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
class Shelf extends BaseEntity {
    /**
     * The items on the shelf.
     */
    @Property.oneToMany({ target: () => Item, inverseSide: 'shelf' })
    items!: Item[];
}

/**
 * An entity naming only optional properties, in every list that names properties.
 */
@Entity({
    tenant: 'shared',
    allowOrphan: true,
    allowDuplicate: true,
    defaultOrder: { label: 'ASC' },
    defaultRelations: { shelf: true },
    uniques: [['label', 'variant']],
    indexes: [['variant', 'label']]
})
class Item extends BaseEntity {
    /**
     * A label, unique together with the variant.
     */
    @Property.string({ required: false })
    label?: string | null;

    /**
     * A variant, which an item may have none of.
     */
    @Property.string({ required: false })
    variant?: string | null;

    /**
     * The shelf the item is on, when it is on one.
     */
    @Property.manyToOne({ target: () => Shelf, joinColumn: 'shelfId', inverseSide: 'items', required: false })
    shelf?: Shelf;

    /**
     * The id of the shelf the item is on.
     */
    @Property.string({ required: false })
    shelfId?: string;
}

describe('naming properties on the entity decorator', () => {
    it('takes optional properties in every list that names them, while compiling', () => {
        const metadata: EntityMetadata<Item> | undefined = MetadataUtilities.getEntityMetadata(Item);

        expect(metadata?.uniques).toEqual([{ properties: ['label', 'variant'] }]);
        expect(metadata?.indexes).toEqual([['variant', 'label']]);
        expect(metadata?.defaultRelations).toEqual({ shelf: true });
    });

    it('refuses a name that is no property of the class, while compiling', () => {
        // @ts-expect-error - "variety" is no property of the class, beside a name that is
        @Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true, uniques: [['label', 'variety']] })
        class Unique extends BaseEntity {
            @Property.string({ required: false })
            label?: string | null;

            @Property.string({ required: false })
            variant?: string | null;
        }

        // @ts-expect-error - "lable" is misspelled
        @Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true, indexes: [['lable']] })
        class Indexed extends BaseEntity {
            @Property.string({ required: false })
            label?: string | null;
        }

        // @ts-expect-error - "createAt" is misspelled
        @Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true, defaultOrder: { createAt: 'ASC' } })
        class Ordered extends BaseEntity {}

        // @ts-expect-error - "shelves" is no property of the class
        @Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true, defaultRelations: { shelves: true } })
        class Related extends BaseEntity {}

        expect([Unique, Indexed, Ordered, Related].every(cls => MetadataUtilities.getEntityMetadata(cls) != undefined)).toBe(true);
    });
});

describe('declaring the tenant of an entity', () => {
    it('asks every entity which tenant its rows belong to, while compiling and while starting', () => {
        expect(() => {
            // @ts-expect-error - "tenantID" is no property of the class
            @Entity({ tenant: { property: 'tenantID' }, allowOrphan: true, allowDuplicate: true })
            class Misspelled extends BaseEntity {
                @Property.string({ format: 'uuid' })
                tenantId!: string;
            }
            return Misspelled;
        }).toThrow(/Misspelled: The tenant property "tenantID" is not a declared property/);
    });

    it('holds the tenant in "tenantId" when the entity names no other, while compiling and while starting', () => {
        expect(() => {
            // @ts-expect-error - "tenantId" is no property of the class
            @Entity({ allowOrphan: true, allowDuplicate: true })
            class Unaware extends BaseEntity {
                @Property.string()
                name!: string;
            }
            return Unaware;
        }).toThrow(/Unaware: The tenant property "tenantId" is not a declared property[\S\s]*tenant: 'shared'/);

        @Entity({ allowOrphan: true, allowDuplicate: true })
        class Defaulted extends BaseEntity {
            @Property.string({ format: 'uuid' })
            tenantId!: string;
        }
        expect(MetadataUtilities.getEntityMetadata(Defaulted)?.tenant).toEqual({ property: 'tenantId' });

        // shared, or another property, names no "tenantId" to look for
        @Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
        class Shared extends BaseEntity {}
        @Entity({ tenant: { property: 'workspaceId' }, allowOrphan: true, allowDuplicate: true })
        class Renamed extends BaseEntity {
            @Property.string({ format: 'uuid' })
            workspaceId!: string;
        }
        expect([Shared, Renamed].map(cls => MetadataUtilities.getEntityMetadata(cls)?.tenant))
            .toEqual(['shared', { property: 'workspaceId' }]);
    });

    it('refuses a tenant property that cannot hold a tenant the same way on every row', () => {
        expect(() => {
            @Entity({ allowOrphan: true, allowDuplicate: true })
            class Counted extends BaseEntity {
                @Property.number({ format: 'integer' })
                tenantId!: number;
            }
            return Counted;
        }).toThrow(/Counted: The tenant property "tenantId" is a number property/);

        expect(() => {
            @Entity({ allowOrphan: true, allowDuplicate: true })
            class Encrypted extends BaseEntity {
                @Property.string({ format: 'uuid', encryption: true })
                tenantId!: string;
            }
            return Encrypted;
        }).toThrow(/Encrypted: The tenant property "tenantId" is encrypted/);

        expect(() => {
            @Entity({ allowOrphan: true, allowDuplicate: true })
            class Decided extends BaseEntity {
                @Property.string({ format: 'uuid', required: () => true })
                tenantId!: string;
            }
            return Decided;
        }).toThrow(/Decided: The tenant property "tenantId" decides per row whether it is required/);
    });

    it('refuses a tenant property that is not a uuid', () => {
        expect(() => {
            @Entity({ allowOrphan: true, allowDuplicate: true })
            class Untyped extends BaseEntity {
                @Property.string()
                tenantId!: string;
            }
            return Untyped;
        }).toThrow(/Untyped: The tenant property "tenantId" is not a uuid/);

        expect(() => {
            @Entity({ tenant: { property: 'workspaceId' }, allowOrphan: true, allowDuplicate: true })
            class Emailed extends BaseEntity {
                @Property.string({ format: 'email' })
                workspaceId!: string;
            }
            return Emailed;
        }).toThrow(/Emailed: The tenant property "workspaceId" is not a uuid/);
    });

    it('holds every unique and every index within a tenant', () => {
        @Entity({
            allowOrphan: true,
            allowDuplicate: true,
            uniques: [['label', 'variant'], ['tenantId', 'code']],
            indexes: [['variant']]
        })
        class Owned extends BaseEntity {
            @Property.string({ format: 'uuid' })
            tenantId!: string;

            @Property.string({ unique: true })
            email!: string;

            @Property.string()
            label!: string;

            @Property.string()
            variant!: string;

            @Property.string()
            code!: string;
        }

        const groups: KeyGroups = keyGroupsOf(Owned);
        expect(groups.uniques.map(group => group.properties)).toEqual([
            ['tenantId', 'email'],
            ['tenantId', 'label', 'variant'],
            // already per tenant as it was written, so it is left as it is
            ['tenantId', 'code']
        ]);
        expect(groups.indexes).toEqual([['tenantId', 'variant'], ['tenantId']]);
    });
});