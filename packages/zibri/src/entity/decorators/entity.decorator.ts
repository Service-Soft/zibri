import { type PropertyMetadata } from './property.decorator';
// a leaf module on purpose: it reads metadata and imports the class it recognizes as a type only, so
// asking whether an entity can be soft deleted does not pull the change set entities in - they are
// decorated with @Entity themselves, which would evaluate this module from inside its own loading
import { isSoftDeleteEntityNewable } from '../../change-sets/models/is-soft-delete-entity.function';
import { InternalError } from '../../error-handling/internal-error.model';
import { GlobalRegistry } from '../../global/global-registry';
import { Newable } from '../../types/newable.type';
import { OmitStrict } from '../../types/omit-strict.type';
import { JsonUtilities } from '../../utilities/json.utilities';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { ObjectUtilities } from '../../utilities/object.utilities';
import { toSnakeCase } from '../../utilities/to-snake-case.function';
import { type BaseEntity } from '../base-entity.model';
import { type EntityOrder, type OrderDirection } from '../models/entity-order.model';
import { type EntityRelations } from '../models/entity-relations.model';
import { type EntityScope } from '../models/entity-scope.model';
import { declaresUnique, UniqueGroup, UniqueGroupInput } from '../models/unique-declaration.model';

/**
 * Metadata for an Entity.
 */
export type EntityMetadata<T extends BaseEntity = BaseEntity> = {
    /**
     * The name of the table in the db.
     */
    tableName: string,
    /**
     * Whether or not this entity is allowed to exist without belonging to a data source.
     */
    allowOrphan: boolean,
    /**
     * Whether or not this entity is allowed to exist in multiple a data sources.
     */
    allowDuplicate: boolean,
    /**
     * Default ordering to apply to results when nothing has been specified.
     */
    defaultOrder?: EntityOrder<T>,
    /**
     * Default relations to include in results when nothing has been specified.
     */
    defaultRelations?: EntityRelations<T>,
    /**
     * Groups of properties that have to be unique together.
     *
     * Use `unique` on the property itself for a single property. This is for the case where no
     * column is unique on its own, eg. One counter per year *and* per recipient.
     *
     * Rejecting duplicates is only half of what it buys. It is also the declaration that those
     * columns name at most one row, which is what `Repository.upsert` needs in order to have
     * exactly one row to insert or change.
     *
     * A group that contains a column which is already unique on its own is refused, since it rejects
     * nothing that column rejects by itself. So are two groups over the same columns, whatever order
     * each is written in: the constraint holds for the combination, so both spell one group.
     */
    uniques?: UniqueGroup[],
    /**
     * Groups of properties that are indexed together.
     *
     * Use `index` on the property itself for a single property. This is for the case where the
     * lookup uses more than one column, eg. Rows of one tenant in one status.
     *
     * The order of a group is the order of the index, which is what decides the lookups it answers:
     * an index on `(tenantId, status)` also answers a lookup by `tenantId` alone, and one by
     * `status` alone goes back to reading the table.
     *
     * A group that reaches a column which is unique on its own is refused: from that column on it
     * matches at most one row, so the rest of the group is never read. So is a group of one column
     * that already declares `index`, which is one index written twice.
     */
    indexes?: string[][],
    /**
     * The scopes every row of this entity is restricted by.
     *
     * A scope is enforced by the repository rather than by whoever asks it something, so it holds for
     * lists, single rows, updates, deletes and creates alike - including the ones nobody thought to
     * guard. A caller that cannot satisfy it is refused; code running outside a request has to say
     * `unscoped` to read the entity at all.
     */
    scope?: EntityScope
};

/**
 * A default order below the first relation it reaches through.
 *
 * The first level is checked against the class being decorated, which is what `TOrderKey` does.
 * Below that there is nothing to check it against: the relation names a target the decorator is
 * being given before the class it belongs to exists, so what a read refuses is where an order
 * through a relation that holds no such property is caught.
 */
type NestedOrderInput = {
    [key: string]: OrderDirection | NestedOrderInput
};

/**
 * Default relations below the first level, checked the same way and for the same reason as
 * {@link NestedOrderInput}.
 */
type NestedRelationsInput = {
    [key: string]: true | NestedRelationsInput
};

// eslint-disable-next-line jsdoc/require-jsdoc
type EntityMetadataInput<
    TOrderKey extends string = never,
    TRelationKey extends string = never,
    TUniqueKey extends string = never,
    TIndexKey extends string = never
> = OmitStrict<Partial<EntityMetadata>, 'defaultOrder' | 'defaultRelations' | 'uniques' | 'indexes'> & {
    /**
     * Default ordering to apply to results when nothing has been specified.
     */
    defaultOrder?: { [K in TOrderKey]?: OrderDirection | NestedOrderInput },
    /**
     * Default relations to include in results when nothing has been specified.
     */
    defaultRelations?: { [K in TRelationKey]?: true | NestedRelationsInput },
    /**
     * Groups of properties that have to be unique together.
     *
     * Write the group as an array of property names, or as an object when it is unique among only
     * some rows - `{ properties: ['email'], where: whereFor<Account>({ deleted: false }) }`.
     */
    uniques?: (TUniqueKey[] | UniqueGroupInput<TUniqueKey>)[],
    /**
     * Groups of properties that are indexed together.
     */
    indexes?: TIndexKey[][]
};

// eslint-disable-next-line jsdoc/require-jsdoc, typescript/no-explicit-any
type ConstrainKeys<TKey extends string> = [TKey] extends [never] ? object : Record<TKey, any>;

// eslint-disable-next-line jsdoc/require-returns
/**
 * Marks an entity.
 * @param options - Configuration options for the entity.
 */
export function Entity<
    TOrderKey extends string,
    TRelationKey extends string,
    TUniqueKey extends string,
    TIndexKey extends string
>(
    options: EntityMetadataInput<TOrderKey, TRelationKey, TUniqueKey, TIndexKey> = {}
) {
    const {
        tableName, defaultOrder, defaultRelations, uniques, indexes, scope, allowOrphan = false, allowDuplicate = false
    } = options;
    // normalized here, so that the two ways of writing a group are one shape everywhere below and in
    // every store that reads them back
    const uniqueGroups: UniqueGroup[] | undefined = uniques
        ?.map(group => Array.isArray(group) ? { properties: group } : { properties: group.properties, where: group.where });
    return <T extends ConstrainKeys<TOrderKey>
        & ConstrainKeys<TRelationKey>
        & ConstrainKeys<TUniqueKey>
        & ConstrainKeys<TIndexKey>>(
        target: Newable<T>
    ): void => {
        validateGroupsAddSomething(target, uniqueGroups ?? [], indexes ?? []);
        validateSoftDeleteKeysSayWhichRows(target, uniqueGroups ?? []);
        const metadata: EntityMetadata = {
            tableName: tableName ?? toSnakeCase(target.name),
            allowOrphan,
            allowDuplicate,
            // the one place the two halves of these meet. What is written on the decorator is checked
            // against the class by its keys, because the class is not known until the line below;
            // what is stored is stated in terms of the entity, because everything reading it back has
            // one. They describe the same thing and neither is expressible as the other here
            defaultOrder: defaultOrder as EntityMetadata['defaultOrder'],
            defaultRelations: defaultRelations as EntityMetadata['defaultRelations'],
            uniques: uniqueGroups,
            indexes,
            scope
        };
        MetadataUtilities.setEntityMetadata(target as unknown as Newable<BaseEntity>, metadata);
        GlobalRegistry.entityClasses.push(target as unknown as Newable<BaseEntity>);
    };
}

/**
 * Refuses a group that says what is already said elsewhere.
 *
 * The two places a key can be declared mean different things - the property for the single column
 * case, the entity for the case that spans several - and a group built around a column that is
 * already unique says what that column says. Refused rather than merged away, because the two
 * readings differ: whoever wrote the group may have meant the combination to be the constraint,
 * which is only true once the property stops declaring one of its own.
 * @param target - The class being decorated.
 * @param uniques - The groups of columns it declares unique together.
 * @param indexes - The groups of columns it declares indexed together.
 * @throws When a group repeats another group, or what one of its columns already declares.
 */
function validateGroupsAddSomething(target: Newable<unknown>, uniques: UniqueGroup[], indexes: string[][]): void {
    const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(target);
    validateUniqueGroupsAddSomething(target, uniques, properties);
    validateIndexGroupsAddSomething(target, indexes, properties);
}

/**
 * Refuses a unique declaration on a soft delete entity that does not say whether deleted rows count.
 *
 * Both answers are ordinary. An address a deleted account no longer occupies is what lets somebody
 * register again; an address that stays taken is how a deletion stops being a way to shed a history.
 * Nothing in the declaration distinguishes them, and picking one silently makes the other into a bug
 * that only surfaces the first time a real user tries to sign up again - so the entity has to say.
 *
 * Only soft delete entities are asked, because only they have rows that are present and gone at once.
 * @param target - The class being decorated.
 * @param uniques - The groups of columns it declares unique together.
 * @throws When a unique declaration on a soft delete entity names no rows.
 */
function validateSoftDeleteKeysSayWhichRows(target: Newable<unknown>, uniques: UniqueGroup[]): void {
    if (!isSoftDeleteEntityNewable(target)) {
        return;
    }
    const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(target);
    const remedy: string[] = [
        `Add "where: whereFor<${target.name}>({ deleted: false })" to it so a deleted row stops occupying the value,`,
        'or "where: {}" to keep the value taken for good.'
    ];

    for (const [key, metadata] of ObjectUtilities.entries(properties)) {
        if (!('unique' in metadata) || !declaresUnique(metadata.unique) || typeof metadata.unique === 'object') {
            continue;
        }
        throw new InternalError([
            `${target.name}.${key}: "unique" on a soft delete entity has to say whether soft deleted rows still hold the value.`,
            ...remedy
        ]);
    }

    for (const group of uniques) {
        if (group.where != undefined) {
            continue;
        }
        throw new InternalError([
            `${target.name}: The unique group (${group.properties.join(', ')}) is declared on a soft delete entity`,
            'without saying whether soft deleted rows still hold the value.',
            ...remedy
        ]);
    }
}

/**
 * Refuses a unique group that rejects nothing another declaration rejects already.
 * @param target - The class being decorated.
 * @param uniques - The groups of columns it declares unique together.
 * @param properties - What its properties declare.
 * @throws When a group repeats another group, or a column that is unique on its own.
 */
function validateUniqueGroupsAddSomething(
    target: Newable<unknown>,
    uniques: UniqueGroup[],
    properties: Record<string, PropertyMetadata>
): void {
    for (const [position, group] of uniques.entries()) {
        // as a set, because a unique group is one: the constraint holds for the combination, and
        // which order it was written in changes nothing about what it rejects. The rows it covers do
        // change that, so two groups over the same columns are one declaration only while they also
        // cover the same rows
        const twin: UniqueGroup | undefined = uniques.slice(0, position).find(
            other => namesTheSameColumns(other.properties, group.properties) && coversTheSameRows(other, group)
        );
        if (twin != undefined) {
            throw new InternalError([
                `${target.name}: The unique groups (${twin.properties.join(', ')}) and (${group.properties.join(', ')})`,
                'name the same columns over the same rows.',
                'A unique group holds for the combination, so the order it is written in carries nothing.',
                'That is one constraint declared twice - keep one of them.'
            ]);
        }

        // any column of the group, not only the first: a column that is unique on its own already
        // names at most one row, so nothing put beside it can narrow that further. Only counted when
        // it is unique over every row - one that is unique among some of them leaves the rest to the
        // group, which is then the only thing constraining them
        const key: string | undefined = group.properties.find(k => isUniqueEverywhere(properties[k]));
        if (key != undefined) {
            const remedy: string = isPrimary(properties[key])
                ? 'Drop the group: whatever it names beside the primary key cannot narrow it.'
                : `Drop the group, or remove "unique" from "${key}" when the combination is what has to be unique.`;
            throw new InternalError([
                `${target.name}: The unique group (${group.properties.join(', ')}) contains "${key}",`,
                `which is ${uniqueBecause(properties[key])}.`,
                'That column already names at most one row, so the group rejects nothing the column does not reject on its own.',
                remedy
            ]);
        }
    }
}

/**
 * Whether two groups are declared over the same rows.
 * @param group - One group.
 * @param other - The other group.
 * @returns True when both name the same filter, or neither names one.
 */
function coversTheSameRows(group: UniqueGroup, other: UniqueGroup): boolean {
    // compared as it was written rather than by meaning: two filters that mean the same thing and
    // read differently are left alone, because refusing a declaration is worse than missing a
    // duplicate that the store will name itself
    const one: string = group.where == undefined ? '' : JsonUtilities.stringify(group.where);
    const two: string = other.where == undefined ? '' : JsonUtilities.stringify(other.where);
    return one === two;
}

/**
 * Refuses an index group whose columns are never read, or that another declaration already keeps.
 * @param target - The class being decorated.
 * @param indexes - The groups of columns it declares indexed together.
 * @param properties - What its properties declare.
 * @throws When a group repeats another group, or reaches a column that is unique on its own.
 */
function validateIndexGroupsAddSomething(
    target: Newable<unknown>,
    indexes: string[][],
    properties: Record<string, PropertyMetadata>
): void {
    for (const [position, group] of indexes.entries()) {
        // in order, because an index group is a sequence rather than a set: the lookups it answers
        // are the ones that begin at its first column, so the same columns ordered otherwise are a
        // different index, and only the same columns in the same order are the same one
        const twin: string[] | undefined = indexes.slice(0, position).find(other => isTheSameGroup(other, group));
        if (twin != undefined) {
            throw new InternalError([
                `${target.name}: The index group (${group.join(', ')}) is declared twice.`,
                'Keep one of them.'
            ]);
        }

        const onlyColumn: string | undefined = group.length === 1 ? group[0] : undefined;
        if (onlyColumn != undefined && isIndexed(properties[onlyColumn])) {
            throw new InternalError([
                `${target.name}: The index group (${onlyColumn}) names the one column that already declares "index" of its own.`,
                'A single column is what the property flag says, and a group is what more than one column needs,',
                `so this is one index declared twice. Keep either the group or "index" on "${onlyColumn}".`
            ]);
        }

        // wherever it sits, since a group that reaches a unique column reaches at most one row from
        // there on. Where it sits decides how much of the group that kills rather than whether
        const uniqueAt: number = group.findIndex(k => isUnique(properties[k]));
        const column: string | undefined = group[uniqueAt];
        if (column != undefined) {
            const remedy: string = describeShorterGroup(group.slice(0, uniqueAt));
            throw new InternalError([
                `${target.name}: The index group (${group.join(', ')}) reaches "${column}", which is ${uniqueBecause(properties[column])}.`,
                'A lookup that gets that far matches at most one row through the index that constraint already keeps,',
                `so every column from "${column}" on is never read. ${remedy}`
            ]);
        }
    }
}

/**
 * Whether two groups name the same columns, in whatever order each names them.
 * @param group - One group.
 * @param other - The other group.
 * @returns True when both name the same set of columns.
 */
function namesTheSameColumns(group: string[], other: string[]): boolean {
    return group.length === other.length && group.every(column => other.includes(column));
}

/**
 * Whether two groups name the same columns in the same order.
 * @param group - One group.
 * @param other - The other group.
 * @returns True when both name the same columns, each in the same place.
 */
function isTheSameGroup(group: string[], other: string[]): boolean {
    return group.length === other.length && group.every((column, position) => column === other[position]);
}

/**
 * Says what is left of an index group once the part that is never read is taken off it.
 * @param kept - The columns of the group that still answer a lookup, in their declared order.
 * @returns The way to declare them, or the way out when nothing is left.
 */
function describeShorterGroup(kept: string[]): string {
    if (kept.length === 0) {
        return 'Drop the group.';
    }
    if (kept.length === 1) {
        return `Declare "index" on "${kept[0]}" instead of the group.`;
    }
    return `Declare the group as (${kept.join(', ')}) instead.`;
}

/**
 * Whether a property names at most one row on its own.
 * @param metadata - The declared metadata of the property, or undefined when it declares none.
 * @returns True when the property is the primary key or declares itself unique.
 */
function isUnique(metadata: PropertyMetadata | undefined): boolean {
    if (metadata == undefined) {
        return false;
    }
    return isPrimary(metadata) || ('unique' in metadata && declaresUnique(metadata.unique));
}

/**
 * Whether a property names at most one row across the entire table.
 *
 * The distinction a `where` introduces: a column that is unique among some rows leaves the rest
 * unconstrained, so it is not the thing that makes another declaration redundant.
 * @param metadata - The declared metadata of the property, or undefined when it declares none.
 * @returns True when the property is the primary key, or unique with no filter narrowing it.
 */
function isUniqueEverywhere(metadata: PropertyMetadata | undefined): boolean {
    if (metadata == undefined) {
        return false;
    }
    return isPrimary(metadata) || ('unique' in metadata && metadata.unique === true);
}

/**
 * Whether a property is the primary key.
 * @param metadata - The declared metadata of the property, or undefined when it declares none.
 * @returns True when the property is the primary key.
 */
function isPrimary(metadata: PropertyMetadata | undefined): boolean {
    return metadata != undefined && 'primary' in metadata && metadata.primary;
}

/**
 * Whether a property declares an index of its own.
 * @param metadata - The declared metadata of the property, or undefined when it declares none.
 * @returns True when the property declares `index`.
 */
function isIndexed(metadata: PropertyMetadata | undefined): boolean {
    return metadata != undefined && 'index' in metadata && metadata.index;
}

/**
 * Names the declaration that makes a column unique, for the error message.
 * @param metadata - The declared metadata of the property.
 * @returns What the column is, in the words the declaration used.
 */
function uniqueBecause(metadata: PropertyMetadata | undefined): string {
    return isPrimary(metadata) ? 'the primary key' : 'already declared unique on its own';
}