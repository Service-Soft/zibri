import { setXmlContentProperty } from './set-xml-content-property.function.ts';
import { Newable } from '../../types/newable.type.ts';

/**
 * Reads and writes the decorated property as everything inside the element: its text and its child elements, in
 * the order they appear, like `Hello <x id="name"/>!`.
 *
 * The property is declared as a list of `oneOf`. Each part names its shape: the one shape of text holds a piece of
 * text, and every other shape is a model, written as the element named like the shape. A model with such a property
 * declares no other child elements and no `@XmlText`, since the property already is all of them.
 * @throws When another property of the model is already the element's text.
 */
export function XmlMixed(): PropertyDecorator {
    return (target, key) => {
        const ctor: Newable<unknown> = target.constructor as Newable<unknown>;
        setXmlContentProperty(ctor, key.toString(), { kind: 'mixed' });
    };
}