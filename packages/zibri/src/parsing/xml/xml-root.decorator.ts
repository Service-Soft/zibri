import { XmlRootMetadataInput } from './xml-root-metadata.model';
import { Newable } from '../../types/newable.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';

/**
 * Names the root element a model is written as, the namespace of the document, and the prefixes it declares.
 *
 * Without it, the root element is named after the class and the document has no namespace. The namespace is that
 * of the root element and of every model without an `@XmlNamespace` of its own. A namespace with a prefix is
 * written with it, one without is the document's default namespace.
 * @param input - The name of the root element, which defaults to the class name, the namespace of the document, and
 * the prefixes it declares, each with the namespace it stands for.
 * @returns The class decorator.
 */
export function XmlRoot(input: XmlRootMetadataInput): (target: Newable<unknown>) => void {
    return target => {
        MetadataUtilities.setXmlRoot(target, {
            name: input.name ?? target.name,
            namespace: input.namespace,
            prefixes: input.prefixes ?? {}
        });
    };
}