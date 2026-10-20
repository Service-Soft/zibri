import { ValueConversion } from './value-conversion.enum.ts';
import { PropertyMetadata } from '../../entity/decorators/property.decorator.ts';

/**
 * A value a property change lists, in the form it is stored as json.
 */
type ListedValue = {
    /**
     * The value as it is stored now.
     */
    from: unknown,
    /**
     * The value to store instead.
     */
    to: unknown
};

/**
 * A migration's property change, with both properties resolved the way their decorators would
 * resolve them.
 */
export type ResolvedPropertyConversion = {
    /**
     * The name of the entity, for what a failed change says.
     */
    entity: string,
    /**
     * The name the property is stored under now.
     */
    currentName: string,
    /**
     * The property as it is stored now.
     */
    current: PropertyMetadata,
    /**
     * The name the property is stored under from now on.
     */
    changedName: string,
    /**
     * The property as it is stored from now on.
     */
    changed: PropertyMetadata,
    /**
     * The values the change lists.
     */
    values: ListedValue[],
    /**
     * What happens to the values it does not list.
     */
    default: ValueConversion
};