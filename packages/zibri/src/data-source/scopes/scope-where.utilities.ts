import { BaseEntity } from '../../entity/base-entity.model';
import { PropertyMetadata } from '../../entity/decorators/property.decorator';
import { Relation } from '../../entity/models/relation.enum';
import { InternalError } from '../../error-handling/internal-error.model';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { ObjectUtilities } from '../../utilities/object.utilities';
import { OneOfWhereFilterUtilities } from '../models/where/one-of-where-filter.utilities';
import { isWhereFilterKey, WhereFilterKeys } from '../models/where/where-filter-keys.model';
import { Where, WhereFilter } from '../models/where/where-filter.model';
import { WhereValueUtilities } from '../models/where/where-value.utilities';

/**
 * A caller's where filter with the entity's scopes applied to it.
 */
export type ScopedWhere<T extends BaseEntity> = {
    /**
     * Whether the caller's filter and the scope contradict each other, so that no row can satisfy
     * both.
     *
     * The query does not have to run at all in that case. It is not an error: asking for somebody
     * else's rows is answered with none of them, the same as asking for rows that do not exist.
     */
    matchesNothing: boolean,
    /**
     * The filter to query with. Only meaningful while `matchesNothing` is false.
     */
    where: Where<T> | undefined
};

/**
 * A single condition on a single property, once it is in object form.
 */
type ConditionObject = Record<string, unknown>;

/**
 * The marker a merge returns when the two conditions cannot both hold.
 */
const IMPOSSIBLE: unique symbol = Symbol('impossible');

/**
 * What a condition is being merged on, for the metadata a merge needs and for what an error says.
 */
type MergeContext = {
    /**
     * The path to the property, as a reader of an error can find it.
     */
    property: string,
    /**
     * What that property holds, where the entity declares it.
     */
    metadata: PropertyMetadata | undefined
};

/**
 * Combines the two values one key holds on both sides.
 *
 * Returns what the key holds afterwards, or the marker that the two cannot both hold. A merger that
 * needs a second key to say what it means writes that one into `into` itself.
 */
type KeyMerger = (
    left: unknown,
    right: unknown,
    into: ConditionObject,
    context: MergeContext
) => unknown | typeof IMPOSSIBLE;

/**
 * Narrows what a caller asked for by what the scopes of their entity allow them to see.
 */
export abstract class ScopeWhereUtilities {

    /**
     * How the two values of one key are combined, per key.
     *
     * Every key of a filter is here, so a key added to the filter language is a compile error until
     * somebody says what two of it mean together.
     */
    private static readonly keyMergers: Record<WhereFilterKeys, KeyMerger> = {
        // both sides say the value has to be one of their list, so only what is on both lists is left
        oneOf: (left, right, into, context) => {
            const allowed: unknown[] = this.intersection(left, right, 'oneOf', context);
            return allowed.length ? allowed : IMPOSSIBLE;
        },
        // both exclude what they list, so everything either of them lists is excluded
        notOneOf: (left, right, into, context) => this.union(left, right, 'notOneOf', context),
        // one value each, and a value is not two values - so the second one is excluded on top
        not: (left, right, into, context) => {
            if (WhereValueUtilities.equals(left, right, context.metadata)) {
                return left;
            }
            into['notOneOf'] = this.union(into['notOneOf'] ?? [], [right], 'notOneOf', context);
            return left;
        },
        is: (left, right, into, context) => this.mergeIs(left, right, context),
        // both require every listed value to be there, so both lists are required
        includes: (left, right, into, context) => this.union(left, right, 'includes', context),
        // both say every item has to be on their list, so an item has to be on both of them. Nothing
        // on both is impossible: an allow list never finds an array without items
        isIncludedIn: (left, right, into, context) => {
            const allowed: unknown[] = this.intersection(left, right, 'isIncludedIn', context);
            return allowed.length ? allowed : IMPOSSIBLE;
        },
        where: (left, right, into, context) => this.mergeNestedWhere(left, right, context),
        // two patterns are two patterns: "starts with rent" and "ends with 2026" is neither of them
        // and is not a third one, so both are asked for
        like: (left, right, into, context) => this.allOf(left, right, context),
        iLike: (left, right, into, context) => this.allOf(left, right, context),
        // unlike either pattern is unlike both of them, so both are asked for the same way
        notLike: (left, right, into, context) => this.allOf(left, right, context),
        notILike: (left, right, into, context) => this.allOf(left, right, context),
        fuzzyLike: (left, right, into, context) => this.allOf(left, right, context),
        length: (left, right, into, context) => this.sameOrImpossible(left, right, context),
        after: (left, right, into, context) => this.tighter(left, right, true, 'after', context),
        afterOrOn: (left, right, into, context) => this.tighter(left, right, true, 'afterOrOn', context),
        before: (left, right, into, context) => this.tighter(left, right, false, 'before', context),
        beforeOrOn: (left, right, into, context) => this.tighter(left, right, false, 'beforeOrOn', context),
        greaterThan: (left, right, into, context) => this.tighter(left, right, true, 'greaterThan', context),
        greaterThanEquals: (left, right, into, context) => this.tighter(left, right, true, 'greaterThanEquals', context),
        lesserThan: (left, right, into, context) => this.tighter(left, right, false, 'lesserThan', context),
        lesserThanEquals: (left, right, into, context) => this.tighter(left, right, false, 'lesserThanEquals', context),
        lengthGreaterThan: (left, right, into, context) => this.tighter(left, right, true, 'lengthGreaterThan', context),
        lengthGreaterThanEquals: (left, right, into, context) => this.tighter(left, right, true, 'lengthGreaterThanEquals', context),
        lengthLesserThan: (left, right, into, context) => this.tighter(left, right, false, 'lengthLesserThan', context),
        lengthLesserThanEquals: (left, right, into, context) => this.tighter(left, right, false, 'lengthLesserThanEquals', context)
    };

    /**
     * Narrows a caller's where filter by the one an entity's scope produced.
     *
     * Both sides are an OR of branches and both have to hold, so the result is every pairing of the
     * two: `(a or b) and (c or d)` is `ac or ad or bc or bd`. Anything less is wrong in one direction
     * or the other - folding the scope's branches together turns an "or" into an "and", and applying
     * it to only the caller's first branch leaves every other branch reading the whole table.
     *
     * A pairing that contradicts itself is dropped rather than queried, and when every pairing is
     * dropped the whole call matches nothing.
     * @param where - What the caller asked for.
     * @param scope - What the scope requires.
     * @param properties - The property metadata of the entity being queried.
     * @returns The filter to query with, or the note that nothing can match it.
     * @throws When both sides ask one property for something no single condition can express.
     */
    static applyToWhere<T extends BaseEntity>(
        where: Where<T> | undefined,
        scope: Where<T> | undefined,
        properties: Record<string, PropertyMetadata>
    ): ScopedWhere<T> {
        if (scope == undefined) {
            return { matchesNothing: false, where };
        }

        const scoped: WhereFilter<T>[] = [];
        for (const callerBranch of this.branchesOf(where)) {
            for (const scopeBranch of this.branchesOf(scope)) {
                const narrowed: WhereFilter<T> | typeof IMPOSSIBLE = this.narrowBranch(callerBranch, scopeBranch, properties);
                if (narrowed !== IMPOSSIBLE) {
                    scoped.push(narrowed);
                }
            }
        }

        if (!scoped.length) {
            return { matchesNothing: true, where: undefined };
        }
        return { matchesNothing: false, where: scoped.length === 1 ? scoped[0] : scoped };
    }

    /**
     * Splits a where filter into the branches it is an OR of.
     * @param where - The filter, if there is one.
     * @returns Its branches. A single unconditional branch when there is no filter.
     */
    static branchesOf<T extends BaseEntity>(where: Where<T> | undefined): WhereFilter<T>[] {
        if (where == undefined) {
            return [{}];
        }
        return Array.isArray(where) ? where : [where];
    }

    /**
     * Whether the given condition is already a filter object rather than a value.
     *
     * Told apart by the keys, because a value can be an object too - a Date, or a related entity.
     * @param condition - The condition to check.
     * @returns Whether it is a filter object.
     */
    static isConditionObject(condition: unknown): condition is ConditionObject {
        if (typeof condition !== 'object' || condition == undefined || Array.isArray(condition) || condition instanceof Date) {
            return false;
        }
        const keys: string[] = Object.keys(condition);
        return keys.length > 0 && keys.every(k => isWhereFilterKey(k));
    }

    /**
     * Combines one branch of the caller's filter with one branch of the scope's.
     * @param branch - The caller's branch.
     * @param required - The scope's branch, all of which has to hold on top of it.
     * @param properties - The property metadata of the entity being queried.
     * @returns The combined branch, or the marker that it cannot match anything.
     */
    private static narrowBranch<T extends BaseEntity>(
        branch: WhereFilter<T>,
        required: WhereFilter<T>,
        properties: Record<string, PropertyMetadata>
    ): WhereFilter<T> | typeof IMPOSSIBLE {
        const res: ConditionObject = { ...branch };
        for (const [property, condition] of Object.entries(required)) {
            const merged: unknown | typeof IMPOSSIBLE = this.mergeCondition(
                res[property],
                condition,
                { property, metadata: properties[property] }
            );
            if (merged === IMPOSSIBLE) {
                return IMPOSSIBLE;
            }
            res[property] = merged;
        }
        return res as WhereFilter<T>;
    }

    /**
     * Combines what the caller asked of one property with what the scope requires of it.
     *
     * Both have to hold, and several keys inside one condition object are already an AND, so this is
     * mostly a matter of getting the caller's condition into that shape and adding to it. What each
     * key means when both sides carry it is {@link ScopeWhereUtilities.keyMergers}.
     * @param existing - What the caller asked, if anything.
     * @param required - What the scope requires.
     * @param context - The property the two conditions are on.
     * @returns The combined condition, or the marker that the two cannot both hold.
     * @throws When the two ask for something no single condition can express.
     */
    private static mergeCondition(
        existing: unknown,
        required: unknown,
        context: MergeContext
    ): unknown | typeof IMPOSSIBLE {
        if (existing === undefined) {
            return required;
        }
        if (required === undefined) {
            return existing;
        }
        if (this.isOptionList(existing, context) || this.isOptionList(required, context)) {
            return this.mergeOptionLists(existing, required, context);
        }
        if (this.isOneOfFilter(existing) || this.isOneOfFilter(required)) {
            return this.mergeOneOf(existing, required, context);
        }

        const left: ConditionObject = this.toConditionObject(existing);
        const right: ConditionObject = this.toConditionObject(required);
        const res: ConditionObject = { ...left };

        for (const [key, value] of Object.entries(right)) {
            if (!(key in res) || res[key] === undefined) {
                res[key] = value;
                continue;
            }
            if (!isWhereFilterKey(key)) {
                throw new InternalError(`Unknown key "${key}" on the filter of "${context.property}".`);
            }
            const merged: unknown | typeof IMPOSSIBLE = this.keyMergers[key](res[key], value, res, context);
            if (merged === IMPOSSIBLE) {
                return IMPOSSIBLE;
            }
            res[key] = merged;
        }

        // "one of these" that also has to not be one of those, or not be that one, can be decided here
        // rather than by the database - and deciding it here is what lets the branch be dropped
        if (Array.isArray(res['oneOf'])) {
            const allowed: unknown[] = res['oneOf'].filter(v => !this.isExcluded(v, res, context));
            if (!allowed.length) {
                return IMPOSSIBLE;
            }
            res['oneOf'] = allowed;
        }

        return res;
    }

    /**
     * Combines two filters of a value of several named shapes.
     *
     * Each shape is answered on its own, because a value is of exactly one of them: a shape either
     * side refuses is refused, and a shape whose two filters contradict each other is refused as well
     * - which leaves the other shapes reachable rather than deciding the whole property.
     * @param existing - What the caller asked.
     * @param required - What the scope requires.
     * @param context - The property the two conditions are on.
     * @returns The combined filter, or the marker that no value of any shape satisfies both.
     * @throws When one side asks the property for something other than the shapes of its value.
     */
    private static mergeOneOf(
        existing: unknown,
        required: unknown,
        context: MergeContext
    ): unknown | typeof IMPOSSIBLE {
        if (!this.isOneOfFilter(existing) || !this.isOneOfFilter(required)) {
            // a filter naming the shapes matches a value that names one of them, and the only other
            // thing either side can ask for is the property holding no value at all
            if (existing === null || required === null) {
                return IMPOSSIBLE;
            }
            throw new InternalError(
                `The filter of "${context.property}" holds a value of several shapes, so it names every shape`
                + ' as `when` followed by the name of the shape.'
            );
        }

        const res: ConditionObject = {};
        const shapes: Set<string> = new Set([...Object.keys(existing), ...Object.keys(required)]);
        for (const shape of shapes) {
            res[shape] = this.mergeShape(existing[shape], required[shape], shape, context);
        }

        return ObjectUtilities.values(res).every(filter => filter === false) ? IMPOSSIBLE : res;
    }

    /**
     * Combines what both sides ask of one shape of a value of several shapes.
     * @param existing - What the caller asked of that shape, if it named it.
     * @param required - What the scope requires of it, if it named it.
     * @param shape - The key naming the shape, as `when` followed by its name.
     * @param context - The property the two conditions are on.
     * @returns The filter of that shape, or false when no value of it satisfies both.
     */
    private static mergeShape(
        existing: unknown,
        required: unknown,
        shape: string,
        context: MergeContext
    ): unknown {
        if (existing === false || required === false) {
            return false;
        }
        if (existing === undefined || OneOfWhereFilterUtilities.matchesEveryValue(existing)) {
            return required ?? existing;
        }
        if (required === undefined || OneOfWhereFilterUtilities.matchesEveryValue(required)) {
            return existing;
        }

        const merged: unknown | typeof IMPOSSIBLE = this.mergeCondition(existing, required, {
            property: `${context.property}.${shape}`,
            metadata: this.shapeMetadata(shape, context.metadata)
        });
        return merged === IMPOSSIBLE ? false : merged;
    }

    /**
     * Combines two conditions where at least one of them is an OR of several.
     *
     * Every option is paired with every option of the other side, the same way two filters are, and an
     * option that contradicts everything on the other side is simply one option fewer.
     * @param existing - What the caller asked.
     * @param required - What the scope requires.
     * @param context - The property the two conditions are on.
     * @returns The combined condition, or the marker that no option survives.
     */
    private static mergeOptionLists(
        existing: unknown,
        required: unknown,
        context: MergeContext
    ): unknown | typeof IMPOSSIBLE {
        const left: unknown[] = this.isOptionList(existing, context) ? existing : [existing];
        const right: unknown[] = this.isOptionList(required, context) ? required : [required];

        const res: unknown[] = [];
        for (const option of left) {
            for (const requirement of right) {
                const merged: unknown | typeof IMPOSSIBLE = this.mergeCondition(option, requirement, context);
                if (merged !== IMPOSSIBLE) {
                    res.push(merged);
                }
            }
        }

        if (!res.length) {
            return IMPOSSIBLE;
        }
        return res.length === 1 ? res[0] : res;
    }

    /**
     * Combines what both sides ask of what a property holds inside it.
     *
     * Where the property holds several values, both conditions are asked of the same one - "a payment
     * of mine over 100" rather than "a payment of mine and a payment over 100". That is the narrower
     * of the two readings, which is the direction a restriction is allowed to be read in.
     * @param left - What the caller asked of it.
     * @param right - What the scope requires of it.
     * @param context - The property the two conditions are on.
     * @returns The combined filter, or the marker that nothing satisfies both.
     * @throws When nothing says what the property holds, which is what a nested filter is read by.
     */
    private static mergeNestedWhere(left: unknown, right: unknown, context: MergeContext): unknown | typeof IMPOSSIBLE {
        const metadata: PropertyMetadata | undefined = context.metadata;
        if (metadata?.type === 'array' && metadata.items.type !== 'object') {
            // a list of values rather than of rows, so what is asked of an item is a condition on it
            return this.mergeCondition(left, right, {
                property: context.property,
                metadata: WhereValueUtilities.itemMetadata(metadata)
            });
        }

        const properties: Record<string, PropertyMetadata> | undefined = this.nestedProperties(metadata);
        if (properties == undefined) {
            throw new InternalError(
                `A scope and a filter both ask what "${context.property}" holds inside it,`
                + ' and nothing says what that is.'
            );
        }
        const scoped: ScopedWhere<BaseEntity> = this.applyToWhere(
            left as Where<BaseEntity>,
            right as Where<BaseEntity>,
            properties
        );
        return scoped.matchesNothing ? IMPOSSIBLE : scoped.where;
    }

    /**
     * The properties of the rows a property holds inside it.
     * @param metadata - The metadata of the property, where the entity declares it.
     * @returns The property metadata to read a nested filter by, or undefined when nothing says what
     * the property holds.
     */
    static nestedProperties(metadata: PropertyMetadata | undefined): Record<string, PropertyMetadata> | undefined {
        if (metadata?.type === 'object') {
            return MetadataUtilities.getModelProperties(metadata.cls());
        }
        if (metadata?.type === 'array' && metadata.items.type === 'object') {
            return MetadataUtilities.getModelProperties(metadata.items.cls());
        }
        if (
            metadata?.type === Relation.HAS_ONE
            || metadata?.type === Relation.BELONGS_TO_ONE
            || metadata?.type === Relation.MANY_TO_ONE
            || metadata?.type === Relation.ONE_TO_MANY
            || metadata?.type === Relation.MANY_TO_MANY
        ) {
            return MetadataUtilities.getModelProperties(metadata.target());
        }
        return undefined;
    }

    /**
     * The metadata of one shape of a value of several shapes.
     * @param shape - The key naming the shape, as `when` followed by its name.
     * @param metadata - The metadata of the property, where the entity declares it.
     * @returns What that shape holds, or undefined when the property is not described as one of
     * several shapes.
     */
    private static shapeMetadata(shape: string, metadata: PropertyMetadata | undefined): PropertyMetadata | undefined {
        if (metadata?.type !== 'oneOf') {
            return undefined;
        }
        const name: string | undefined = Object.keys(metadata.shapes)
            .find(n => OneOfWhereFilterUtilities.filterKey(n) === shape);
        if (name == undefined) {
            return undefined;
        }
        // the shapes hold what a property of that kind holds, minus what only a property has
        return { ...metadata.shapes[name] } as PropertyMetadata;
    }

    /**
     * Whether a condition names the shapes of a value that is one of several of them.
     * @param condition - The condition to check.
     * @returns True for an object naming every key as `when` followed by the name of a shape.
     */
    private static isOneOfFilter(condition: unknown): condition is ConditionObject {
        if (typeof condition !== 'object' || condition == undefined || Array.isArray(condition) || condition instanceof Date) {
            return false;
        }
        const keys: string[] = Object.keys(condition);
        return keys.length > 0 && keys.every(k => /^when[A-Z]/.test(k));
    }

    /**
     * Whether a condition is several conditions the property has to satisfy one of.
     *
     * A property that holds an array is filtered by an array as well, and that one is the value to
     * compare against rather than a list of conditions - which is the same rule the evaluator reads
     * a filter by.
     * @param condition - The condition to check.
     * @param context - The property the condition is on.
     * @returns True for a list of conditions.
     */
    private static isOptionList(condition: unknown, context: MergeContext): condition is unknown[] {
        return Array.isArray(condition)
            && context.metadata?.type !== 'array'
            && condition.length > 0
            && condition.every(option => this.isConditionObject(option) || this.isOneOfFilter(option));
    }

    /**
     * Puts a condition into the object form that several keys can be ANDed in.
     *
     * A bare value is an equality, which is `oneOf` with a single entry - the one shape a scalar
     * property has for equality, since `is` only exists on object properties.
     * @param condition - The condition to convert.
     * @returns The condition as an object.
     */
    private static toConditionObject(condition: unknown): ConditionObject {
        if (this.isConditionObject(condition)) {
            return condition;
        }
        return { oneOf: [condition] };
    }

    /**
     * Whether a value a condition allows is one the same condition excludes elsewhere.
     * @param value - The value to check.
     * @param condition - The condition it is allowed by.
     * @param context - The property the condition is on.
     * @returns True when the condition also says the value is not allowed.
     */
    private static isExcluded(value: unknown, condition: ConditionObject, context: MergeContext): boolean {
        if ('not' in condition && WhereValueUtilities.equals(value, condition['not'], context.metadata)) {
            return true;
        }
        return Array.isArray(condition['notOneOf'])
            && condition['notOneOf'].some(v => WhereValueUtilities.equals(value, v, context.metadata));
    }

    /**
     * The values on both lists.
     * @param left - What the caller listed.
     * @param right - What the scope listed.
     * @param key - The key both of them are under.
     * @param context - The property the condition is on.
     * @returns Every value of the caller's list that is also on the scope's.
     */
    private static intersection(left: unknown, right: unknown, key: WhereFilterKeys, context: MergeContext): unknown[] {
        const allowed: unknown[] = this.toValues(right, key, context);
        return this.toValues(left, key, context).filter(v => allowed.some(a => WhereValueUtilities.equals(v, a, context.metadata)));
    }

    /**
     * The values on either list.
     * @param left - What the caller listed.
     * @param right - What the scope listed.
     * @param key - The key both of them are under.
     * @param context - The property the condition is on.
     * @returns Every value of both lists, each of them once.
     */
    private static union(left: unknown, right: unknown, key: WhereFilterKeys, context: MergeContext): unknown[] {
        const res: unknown[] = [...this.toValues(left, key, context)];
        for (const value of this.toValues(right, key, context)) {
            if (!res.some(v => WhereValueUtilities.equals(v, value, context.metadata))) {
                res.push(value);
            }
        }
        return res;
    }

    /**
     * Asks for both values, where the key takes several and they cannot become one.
     * @param left - What the caller asked for.
     * @param right - What the scope requires.
     * @param context - The property the condition is on.
     * @returns Both values, or the one of them they both are.
     */
    private static allOf(left: unknown, right: unknown, context: MergeContext): unknown {
        const values: unknown[] = [...this.valuesOf(left)];
        for (const value of this.valuesOf(right)) {
            if (!values.some(v => WhereValueUtilities.equals(v, value, context.metadata))) {
                values.push(value);
            }
        }
        return values.length === 1 ? values[0] : values;
    }

    /**
     * The values one side of a key that takes several of them asks for.
     * @param value - What that side holds under the key.
     * @returns Its values.
     */
    private static valuesOf(value: unknown): unknown[] {
        return Array.isArray(value) ? Array.from<unknown>(value) : [value];
    }

    /**
     * Keeps the bound that allows the fewest values.
     * @param left - The bound the caller asked for.
     * @param right - The bound the scope requires.
     * @param keepLarger - Whether the larger of the two is the narrower one.
     * @param key - The key both bounds are under.
     * @param context - The property the condition is on.
     * @returns The narrower of the two bounds.
     * @throws When the two are values nothing can order, which no bound is written with.
     */
    private static tighter(
        left: unknown,
        right: unknown,
        keepLarger: boolean,
        key: WhereFilterKeys,
        context: MergeContext
    ): unknown {
        if (WhereValueUtilities.equals(left, right, context.metadata)) {
            return left;
        }
        // text included: the application orders text, and the data source is held to that order, so
        // the narrower of two bounds on it is decidable here as well
        const comparison: number = WhereValueUtilities.compare(left, right);
        if (Number.isNaN(comparison)) {
            throw this.cannotCombine(key, context);
        }
        return (comparison > 0) === keepLarger ? left : right;
    }

    /**
     * Combines the one value both sides say the property is.
     *
     * A relation is judged by the row it names rather than by the shape the filter names it with, so
     * the entity and its id are the same answer - and the caller's is the one that is kept, because
     * the two have to reach the data source as one of them.
     * @param left - What the caller asked for.
     * @param right - What the scope requires.
     * @param context - The property the condition is on.
     * @returns The value, or the marker that the two cannot both hold.
     */
    private static mergeIs(left: unknown, right: unknown, context: MergeContext): unknown | typeof IMPOSSIBLE {
        const same: boolean = WhereValueUtilities.equals(
            WhereValueUtilities.unwrapRelation(left, context.metadata),
            WhereValueUtilities.unwrapRelation(right, context.metadata),
            context.metadata
        );
        return same ? left : IMPOSSIBLE;
    }

    /**
     * Keeps a value both sides ask for, where two different ones cannot both hold.
     * @param left - What the caller asked for.
     * @param right - What the scope requires.
     * @param context - The property the condition is on.
     * @returns The value, or the marker that the two cannot both hold.
     */
    private static sameOrImpossible(left: unknown, right: unknown, context: MergeContext): unknown | typeof IMPOSSIBLE {
        return WhereValueUtilities.equals(left, right, context.metadata) ? left : IMPOSSIBLE;
    }

    /**
     * The values a key lists.
     * @param value - What the key holds.
     * @param key - The key, for the error.
     * @param context - The property the condition is on.
     * @returns The values.
     * @throws When the key holds anything but a list.
     */
    private static toValues(value: unknown, key: WhereFilterKeys, context: MergeContext): unknown[] {
        if (!Array.isArray(value)) {
            throw new InternalError(`The "${key}" of the filter of "${context.property}" needs to be an array.`);
        }
        return value;
    }

    /**
     * The error for a pair of conditions no single condition can express.
     *
     * Refusing is the answer rather than keeping one of them: the caller's alone drops what a scope
     * requires, and a scope's alone answers a question nobody asked. Both are silent, and one of them
     * is a restriction quietly going away.
     * @param key - The key both sides carry.
     * @param context - The property they are on.
     * @returns The error to throw.
     */
    private static cannotCombine(key: WhereFilterKeys, context: MergeContext): InternalError {
        return new InternalError([
            `A scope and a filter both ask "${context.property}" for a "${key}", and the two cannot be combined into one.`,
            'Ask for it in a way the scope leaves open, or exempt the call from the scope with `unscoped`.'
        ]);
    }
}