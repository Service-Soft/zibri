import { XmlPropertyMetadata } from './xml-property-metadata.model.ts';
import { PropertyMetadata } from '../../entity/decorators/property.decorator.ts';
import { ObjectPropertyMetadata } from '../../entity/models/object-property-metadata.model.ts';
import { OneOfShapeMetadata } from '../../entity/models/one-of-property-metadata.model.ts';
import { InternalError } from '../../error-handling/internal-error.model.ts';
import { Newable } from '../../types/newable.type.ts';
import { JsonUtilities } from '../../utilities/json.utilities.ts';
import { MetadataUtilities } from '../../utilities/metadata.utilities.ts';
import { ObjectUtilities } from '../../utilities/object.utilities.ts';

/**
 * What the parts of a mixed property can be.
 */
export type XmlMixedShapes = {
    /**
     * The name of the shape that holds a piece of text, if the content can hold text.
     */
    textShape: string | undefined,
    /**
     * The shapes written as elements, by the name of the element.
     */
    elementShapes: Map<string, ObjectPropertyMetadata>
};

/**
 * The property of a model that is its element's mixed content.
 */
export type XmlMixedProperty = {
    /**
     * The key of the property.
     */
    key: string,
    /**
     * What its parts can be.
     */
    shapes: XmlMixedShapes
};

/**
 * Reads what the xml decorators say about a model, for reading it and writing it alike.
 *
 * Internal: the reader and the writer have to agree on every answer here, which is why they ask the same place.
 */
export abstract class XmlModelUtilities {

    /**
     * How a property of a model appears in xml.
     * @param cls - The model.
     * @param key - The property.
     * @returns What the xml decorators say, or a child element named like the property when there is none.
     */
    static getXmlProperty(cls: Newable<unknown>, key: string): XmlPropertyMetadata {
        return MetadataUtilities.getXmlProperties(cls)[key] ?? { kind: 'element', name: key };
    }

    /**
     * The namespace the child elements of a model are in.
     * @param cls - The model.
     * @param documentNamespace - The namespace of the document the model is part of.
     * @returns The model's own namespace, or the document's.
     */
    static resolveNamespace(cls: Newable<unknown>, documentNamespace: string | undefined): string | undefined {
        // not the namespace of its @XmlRoot, which is the document's when the model is the root, and says
        // nothing when it is part of another document, like its name
        return MetadataUtilities.findXmlNamespace(cls) ?? documentNamespace;
    }

    /**
     * The mixed property of a model, when it has one.
     *
     * Checks what the decorators cannot while they run, because the other properties of the model may be declared
     * after them: a model whose element holds mixed content declares no other child element.
     * @param cls - The model.
     * @returns The key of the mixed property and what its parts can be, or undefined when the model has none.
     * @throws When the model declares a child element next to its mixed content, or the property is not a list of
     * `oneOf` of text and models.
     */
    static findMixedProperty(cls: Newable<unknown>): XmlMixedProperty | undefined {
        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(cls);
        const mixedKey: string | undefined = ObjectUtilities.keys(properties)
            .find(key => XmlModelUtilities.getXmlProperty(cls, key).kind === 'mixed');
        if (mixedKey == undefined) {
            return undefined;
        }
        const elementKeys: string[] = ObjectUtilities.keys(properties)
            .filter(key => XmlModelUtilities.getXmlProperty(cls, key).kind === 'element');
        if (elementKeys.length) {
            const others: string = elementKeys.map(key => JsonUtilities.stringify(key)).join(', ');
            throw new InternalError(
                `${cls.name}.${mixedKey} is marked with @XmlMixed, so it is everything inside the element, `
                + `but ${others} would be a child element of it as well.`
            );
        }
        return { key: mixedKey, shapes: XmlModelUtilities.resolveMixedShapes(cls, mixedKey, properties[mixedKey]) };
    }

    private static resolveMixedShapes(cls: Newable<unknown>, key: string, property: PropertyMetadata | undefined): XmlMixedShapes {
        const name: string = `${cls.name}.${key}`;
        if (property?.type !== 'array' || property.items.type !== 'oneOf') {
            throw new InternalError(`${name} is marked with @XmlMixed, so it has to be declared as a list of oneOf.`);
        }
        const res: XmlMixedShapes = { textShape: undefined, elementShapes: new Map() };
        for (const [shapeName, shape] of ObjectUtilities.entries<Record<string, OneOfShapeMetadata>>(property.items.shapes)) {
            switch (shape.type) {
                case 'string': {
                    if (res.textShape != undefined) {
                        throw new InternalError(
                            `${name} has two shapes of text, "${res.textShape}" and "${shapeName}", so a piece of text could be either.`
                        );
                    }
                    res.textShape = shapeName;
                    break;
                }
                case 'object': {
                    res.elementShapes.set(shapeName, shape);
                    break;
                }
                case 'number':
                case 'boolean':
                case 'date':
                case 'array':
                case 'unknown': {
                    throw new InternalError(
                        `${name} is mixed content, so each of its shapes is text or a model, but "${shapeName}" is a ${shape.type}.`
                    );
                }
            }
        }
        return res;
    }
}