import { XmlPropertyMetadata } from './xml-property-metadata.model.ts';
import { Newable } from '../../types/newable.type.ts';
import { MetadataUtilities } from '../../utilities/metadata.utilities.ts';

/**
 * Reads and writes the decorated property as an attribute of the element, instead of as a child element.
 *
 * Goes together with `@Property`, which still declares what the value is.
 * @param name - The name of the attribute, which defaults to the name of the property.
 */
export function XmlAttribute(name?: string): PropertyDecorator {
    return (target, key) => {
        const ctor: Newable<unknown> = target.constructor as Newable<unknown>;
        const xmlProperties: Record<string, XmlPropertyMetadata> = MetadataUtilities.getXmlProperties(ctor);
        xmlProperties[key.toString()] = { kind: 'attribute', name: name ?? key.toString() };
        MetadataUtilities.setXmlProperties(ctor, xmlProperties);
    };
}