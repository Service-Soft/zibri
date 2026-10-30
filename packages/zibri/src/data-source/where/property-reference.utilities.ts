import { PropertyMetadata } from '../../entity/decorators/property.decorator';
import { InternalError } from '../../error-handling/internal-error.model';
import { PropertyReference } from '../models/where/property-reference.model';
import { WhereFilterKeys } from '../models/where/where-filter-keys.model';

/**
 * The keys whose value can be a reference to another property: the comparisons of a date and of a
 * number. Only these are read as one, so a json value that happens to hold a `property` key is still
 * the value it is under every other key.
 */
const REFERENCING_KEYS: ReadonlySet<WhereFilterKeys> = new Set<WhereFilterKeys>([
    'after',
    'afterOrOn',
    'before',
    'beforeOrOn',
    'greaterThan',
    'greaterThanEquals',
    'lesserThan',
    'lesserThanEquals'
]);

/**
 * Reads the references to other properties of a row that the comparisons of a filter make, which
 * every reader of a filter answers alike: a store comparing two columns, the evaluator comparing two
 * values of an object, and a schema predicate comparing two columns of a row.
 */
export class PropertyReferenceUtilities {

    /**
     * Whether what a key of a filter compares with is a reference to another property of the row.
     * @param key - The key.
     * @param value - What it compares with.
     * @returns True for a reference under a key that compares.
     */
    static isReferenceUnder(key: string, value: unknown): value is PropertyReference<string> {
        return REFERENCING_KEYS.has(key as WhereFilterKeys) && this.isReference(value);
    }

    /**
     * Whether a value is a reference to another property, as `propertyOf` makes it - and as it reads
     * back out of json, where a data source keeps the checks it holds rows to.
     * @param value - The value.
     * @returns True for a reference.
     */
    static isReference(value: unknown): value is PropertyReference<string> {
        return typeof value === 'object'
            && value != undefined
            && !Array.isArray(value)
            && Object.keys(value).length === 1
            && typeof Reflect.get(value, 'property') === 'string';
    }

    /**
     * Resolves the properties a condition on one property compares with, besides that property.
     * @param condition - The condition, or several of which one has to hold.
     * @returns The properties, in the order the condition names them.
     */
    static resolveReferenced(condition: unknown): string[] {
        if (Array.isArray(condition)) {
            return condition.flatMap(option => this.resolveReferenced(option));
        }
        if (!this.isConditionObject(condition)) {
            return [];
        }
        return Object.entries(condition).flatMap(([key, value]) => this.isReferenceUnder(key, value) ? [value.property] : []);
    }

    /**
     * Resolves a condition on one property against the object it is judged on, each reference
     * replaced with the value the object holds there - null where it holds none, which no comparison
     * is satisfied by.
     * @param condition - The condition, or several of which one has to hold.
     * @param holder - The object the property is on.
     * @returns The condition comparing with values only, the same one when it names no property.
     */
    static resolveAgainst(condition: unknown, holder: object): unknown {
        if (Array.isArray(condition)) {
            const resolved: unknown[] = condition.map(option => this.resolveAgainst(option, holder));
            return resolved.some((option, i) => option !== condition[i]) ? resolved : condition;
        }
        if (!this.isConditionObject(condition)) {
            return condition;
        }
        const entries: [string, unknown][] = Object.entries(condition);
        if (!entries.some(([key, value]) => this.isReferenceUnder(key, value))) {
            return condition;
        }
        return Object.fromEntries(entries.map(([key, value]) => [
            key,
            // eslint-disable-next-line unicorn/no-null
            this.isReferenceUnder(key, value) ? Reflect.get(holder, value.property) ?? null : value
        ]));
    }

    /**
     * Refuses a condition comparing a property with one the entity does not declare, or with one
     * holding another kind of value - which the type of a filter refuses already, and a filter built
     * at run time can still name.
     * @param name - The property compared, as a refusal names it.
     * @param metadata - Its metadata.
     * @param condition - The condition on it, or several of which one has to hold.
     * @param properties - The properties of the entity, or their names alone where nothing more is
     * known of them.
     * @throws An InternalError naming the reference refused.
     */
    static validateReferences(
        name: string,
        metadata: PropertyMetadata | undefined,
        condition: unknown,
        properties: Record<string, PropertyMetadata> | ReadonlySet<string>
    ): void {
        if (Array.isArray(condition)) {
            for (const option of condition) {
                this.validateReferences(name, metadata, option, properties);
            }
            return;
        }
        if (!this.isConditionObject(condition)) {
            return;
        }
        for (const [key, value] of Object.entries(condition)) {
            if (!this.isReferenceUnder(key, value)) {
                continue;
            }
            const declared: boolean = properties instanceof Set ? properties.has(value.property) : value.property in properties;
            if (!declared) {
                throw new InternalError(`${name}: The filter compares with "${value.property}", which the entity does not declare.`);
            }
            if (this.isNamesOnly(properties)) {
                continue;
            }
            const referenced: PropertyMetadata | undefined = properties[value.property];
            const kind: string | undefined = this.resolveComparableKind(metadata);
            if (kind == undefined || kind !== this.resolveComparableKind(referenced)) {
                throw new InternalError(
                    `${name}: "${key}" compares a ${kind ?? metadata?.type ?? 'value'} with "${value.property}",`
                    + ` which holds a ${referenced?.type ?? 'value'}.`
                );
            }
        }
    }

    /**
     * Whether the properties of an entity are given by their names alone, where nothing more is known
     * of them.
     * @param properties - The properties of the entity, or their names alone.
     * @returns True for the names alone.
     */
    static isNamesOnly(properties: Record<string, PropertyMetadata> | ReadonlySet<string>): properties is ReadonlySet<string> {
        return properties instanceof Set;
    }

    /**
     * Resolves which kind of value a property holds, for the properties a comparison can name.
     * @param metadata - The property.
     * @returns 'date' or 'number', undefined for any other.
     */
    private static resolveComparableKind(metadata: PropertyMetadata | undefined): 'date' | 'number' | undefined {
        if (metadata?.type === 'date' || metadata?.type === 'number') {
            return metadata.type;
        }
        return undefined;
    }

    /**
     * Whether a condition is the object form of one, holding keys such as `after`, rather than a value.
     * @param condition - The condition.
     * @returns True for the object form.
     */
    private static isConditionObject(condition: unknown): condition is Record<string, unknown> {
        return typeof condition === 'object'
            && condition != undefined
            && !Array.isArray(condition)
            && !(condition instanceof Date)
            && Object.getPrototypeOf(condition) === Object.prototype;
    }
}