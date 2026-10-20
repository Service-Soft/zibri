import { setXmlContentProperty } from './set-xml-content-property.function.ts';
import { Newable } from '../../types/newable.type.ts';

/**
 * Reads and writes the decorated property as the element's own text, instead of as a child element.
 *
 * Goes together with `@Property`, which still declares what the value is. A model has at most one such property,
 * and none next to an `@XmlMixed` one.
 * @throws When another property of the model is already the element's text.
 */
export function XmlText(): PropertyDecorator {
    return (target, key) => {
        const ctor: Newable<unknown> = target.constructor as Newable<unknown>;
        setXmlContentProperty(ctor, key.toString(), { kind: 'text' });
    };
}