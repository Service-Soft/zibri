import { Newable } from '../../types/newable.type.ts';
import { MetadataUtilities } from '../../utilities/metadata.utilities.ts';

/**
 * Puts the elements a model declares into a namespace.
 *
 * The child elements of a model are in the namespace of the model that declares them, the way an xml schema
 * qualifies its elements. So `@XmlNamespace` on a model moves its properties' elements, not the element the
 * model itself is written as - that one belongs to whoever declares it. A model without it takes the namespace of
 * the document. The namespace is written with the prefix the root declares for it in `@XmlRoot`.
 * @param namespace - The namespace.
 * @returns The class decorator.
 */
export function XmlNamespace(namespace: string): (target: Newable<unknown>) => void {
    return target => {
        MetadataUtilities.setXmlNamespace(target, namespace);
    };
}