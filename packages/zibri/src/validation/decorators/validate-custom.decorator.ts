import { Newable } from '../../types/newable.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { type CustomValidationRule } from '../custom-validation.model';

// the class decorated has to be the one the rule was written for: assignable to it, and with no
// property it lacks. Assignable alone would let a rule of `Booking` onto any class that has its
// properties and more, which the rule then reads as a booking. Each property too many becomes a
// required one here, so the compiler's message names it. Used as the constraint of the class rather
// than intersected with the argument, for the reason `ConstrainKeys` in the entity decorator is
// eslint-disable-next-line jsdoc/require-jsdoc
type RuleTarget<C, T> = [Exclude<keyof C, keyof T>] extends [never]
    ? T
    : { [K in Exclude<keyof C, keyof T>]: 'is not a property of the class the rule was written for' };

// eslint-disable-next-line jsdoc/require-returns
/**
 * Adds a rule to a model that its properties cannot say on their own, such as one comparing two of
 * them.
 *
 * The rule runs wherever the model is validated, once its properties are valid: a request body, an
 * object inside one, a websocket request, a response read through the http client. It applies to a
 * class extending the model as well, and not to a model derived with `PartialClass`, `OmitClass`,
 * `PickClass` or `IntersectionClass`, whose values may lack what the rule reads.
 * @param rule - Given the object and the current request, returns what is wrong with the object.
 */
export function ValidateCustom<T>(rule: CustomValidationRule<T>) {
    return <C extends RuleTarget<C, T>>(target: Newable<C>): void => {
        MetadataUtilities.addCustomValidation(target, rule);
    };
}