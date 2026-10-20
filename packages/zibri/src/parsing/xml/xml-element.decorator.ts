import { XmlPropertyMetadata } from './xml-property-metadata.model.ts';
import { Newable } from '../../types/newable.type.ts';
import { MetadataUtilities } from '../../utilities/metadata.utilities.ts';

/**
 * Reads and writes the decorated property as the child element of the given name, instead of one named after the property.
 *
 * Goes together with `@Property`, which still declares what the value is.
 * @param name - The name of the element.
 */
export function XmlElement(name: string): PropertyDecorator {
    return (target, key) => {
        const ctor: Newable<unknown> = target.constructor as Newable<unknown>;
        const xmlProperties: Record<string, XmlPropertyMetadata> = MetadataUtilities.getXmlProperties(ctor);
        xmlProperties[key.toString()] = { kind: 'element', name };
        MetadataUtilities.setXmlProperties(ctor, xmlProperties);
    };
}