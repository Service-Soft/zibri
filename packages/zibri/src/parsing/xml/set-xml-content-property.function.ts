import { XmlPropertyMetadata } from './xml-property-metadata.model.ts';
import { InternalError } from '../../error-handling/internal-error.model.ts';
import { Newable } from '../../types/newable.type.ts';
import { MetadataUtilities } from '../../utilities/metadata.utilities.ts';
import { ObjectUtilities } from '../../utilities/object.utilities.ts';

/**
 * Marks a property as what the element holds, refusing a second one.
 *
 * Shared by `@XmlText` and `@XmlMixed`: both are the element's text, and an element has one. Internal, and in a
 * file of its own so that it stays that way: the decorator files are re-exported whole.
 * @param ctor - The model.
 * @param key - The property.
 * @param metadata - What the property is.
 * @throws When another property of the model is already the element's text.
 */
export function setXmlContentProperty(ctor: Newable<unknown>, key: string, metadata: XmlPropertyMetadata): void {
    const xmlProperties: Record<string, XmlPropertyMetadata> = MetadataUtilities.getXmlProperties(ctor);
    const existing: [string, XmlPropertyMetadata] | undefined = ObjectUtilities.entries(xmlProperties)
        .find(([other, xml]) => other !== key && (xml.kind === 'text' || xml.kind === 'mixed'));
    if (existing != undefined) {
        throw new InternalError(
            `${ctor.name}: "${key}" and "${existing[0]}" are both the text of the element, but an element has only one text.`
        );
    }
    xmlProperties[key] = metadata;
    MetadataUtilities.setXmlProperties(ctor, xmlProperties);
}