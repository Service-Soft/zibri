import type { SaxesParser, SaxesTagNS } from 'saxes';

import { XmlContent, XmlElementNode } from './xml-element-node.model';
import { PropertyMetadata } from '../entity/decorators/property.decorator';
import { Relation } from '../entity/models/relation.enum';
import { XmlMixedProperty, XmlMixedShapes, XmlModelUtilities } from '../parsing/xml/xml-model.utilities';
import { XmlPropertyMetadata } from '../parsing/xml/xml-property-metadata.model';
import { BodyShapeMetadata } from '../routing/decorators/body-metadata.model';
import { Newable } from '../types/newable.type';
import { MetadataUtilities } from '../utilities/metadata.utilities';
import { ObjectUtilities } from '../utilities/object.utilities';
import { optionalPeer } from '../utilities/optional-peer.function';

// namespaces tracked, so an element and an attribute are read by their local name whatever prefix
// the document gave them
// eslint-disable-next-line jsdoc/require-jsdoc
type ParserOptions = { xmlns: true };

/**
 * Reads xml documents into the values a model describes.
 *
 * Internal: shared by the xml body parser and `XmlUtilities.parseFrom`, which is what keeps a body and a document
 * read the same way. What it hands back is still to be parsed and validated as the model.
 */
export abstract class XmlReaderUtilities {

    /**
     * Parses the given xml document into its root element.
     * @param xml - The xml document to parse.
     * @returns The root element, with its text and attributes decoded.
     * @throws When the document is not well formed.
     */
    static resolveRootElement(xml: string): XmlElementNode {
        // saxes rather than a parser that repairs what it cannot read, closing a tag that was left open
        // and taking the last of two equal attributes, so a broken body would reach the handler as
        // something the sender never wrote. saxes refuses anything not well formed, and it expands no
        // entity a document declares itself, which keeps entity expansion attacks out. Without an
        // error handler it throws on the first thing it refuses
        const { SaxesParser: Parser } = optionalPeer<typeof import('saxes')>('saxes', 'Reading xml');
        const parser: SaxesParser<ParserOptions> = new Parser<ParserOptions>({ xmlns: true });
        const open: XmlElementNode[] = [];
        let root: XmlElementNode | undefined;

        parser.on('opentag', tag => {
            const element: XmlElementNode = {
                name: tag.local,
                namespace: tag.uri.length ? tag.uri : undefined,
                attributes: XmlReaderUtilities.resolveAttributes(tag),
                content: []
            };
            const parent: XmlElementNode | undefined = open.at(-1);
            if (parent == undefined) {
                root = element;
            }
            else {
                parent.content.push(element);
            }
            open.push(element);
        });
        parser.on('closetag', () => open.pop());
        const appendText: (text: string) => void = text => {
            // the whitespace around the root element has no element to belong to
            const current: XmlElementNode | undefined = open.at(-1);
            if (current == undefined) {
                return;
            }
            // one piece of text however the document split it, eg. around a cdata section
            const last: XmlContent | undefined = current.content.at(-1);
            if (typeof last === 'string') {
                current.content[current.content.length - 1] = last + text;
                return;
            }
            current.content.push(text);
        };
        parser.on('text', appendText);
        parser.on('cdata', appendText);

        parser.write(xml).close();

        if (root == undefined) {
            throw new Error('The xml document has no root element');
        }
        return root;
    }

    /**
     * Reads the root element of a document as the value of a body shape.
     * @param root - The root element.
     * @param shape - What the document is declared as.
     * @returns The value, still to be parsed and validated as the shape.
     */
    static readShape(root: XmlElementNode, shape: BodyShapeMetadata): unknown {
        // several shapes have no model to say which children are lists, so the body is read as it stands
        return shape.type === 'anyOf' ? XmlReaderUtilities.readUntyped(root) : XmlReaderUtilities.readValue(root, shape);
    }

    private static readValue(element: XmlElementNode, metadata: PropertyMetadata): unknown {
        switch (metadata.type) {
            case 'object': {
                return XmlReaderUtilities.readObject(element, metadata.cls());
            }
            case 'array': {
                // a list read from one element is that element's children. A list property of a model
                // is read from repeated elements instead, see readObject
                return XmlReaderUtilities.getChildren(element).map(child => XmlReaderUtilities.readValue(child, metadata.items));
            }
            case 'string':
            case 'number':
            case 'boolean':
            case 'date': {
                // text either way: parseShape turns it into what the property declares, as it does
                // for a query parameter
                return XmlReaderUtilities.getText(element);
            }
            case 'oneOf':
            case 'unknown':
            case 'file':
            case Relation.HAS_ONE:
            case Relation.BELONGS_TO_ONE:
            case Relation.ONE_TO_MANY:
            case Relation.MANY_TO_ONE:
            case Relation.MANY_TO_MANY: {
                return XmlReaderUtilities.readUntyped(element);
            }
        }
    }

    private static readObject(element: XmlElementNode, cls: Newable<unknown>): Record<string, unknown> {
        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(cls);
        // a map rather than an object that is written to: a document names its own elements, and one named
        // __proto__ would otherwise replace the prototype of the object, which then answers for every
        // property the document left out. fromEntries creates each entry as an own property instead
        const res: Map<string, unknown> = new Map();
        const keysByElementName: Map<string, string> = new Map();

        for (const key of ObjectUtilities.keys(properties)) {
            const xml: XmlPropertyMetadata = XmlModelUtilities.getXmlProperty(cls, key);
            switch (xml.kind) {
                case 'element': {
                    keysByElementName.set(xml.name, key);
                    break;
                }
                case 'attribute': {
                    res.set(key, element.attributes[xml.name]);
                    break;
                }
                case 'text': {
                    const text: string = XmlReaderUtilities.getText(element);
                    // an empty element has no text rather than an empty one, so a required text is
                    // reported missing instead of being handed to the handler as ''
                    res.set(key, text.length ? text : undefined);
                    break;
                }
                case 'mixed': {
                    // read below, from the whole content rather than from the elements of one name
                    break;
                }
            }
        }

        const mixed: XmlMixedProperty | undefined = XmlModelUtilities.findMixedProperty(cls);
        if (mixed != undefined) {
            // every child element is a part of the content, so none of them is left to be a property
            res.set(mixed.key, XmlReaderUtilities.readMixed(element, mixed.shapes, cls));
            return Object.fromEntries(res);
        }

        for (const [name, elements] of XmlReaderUtilities.groupByName(XmlReaderUtilities.getChildren(element))) {
            const key: string | undefined = keysByElementName.get(name);
            if (key != undefined) {
                res.set(key, XmlReaderUtilities.readElements(elements, properties[key]));
                continue;
            }
            // an element the model does not declare is kept under its own name, so validation reports it
            // as an unknown key. Unless that name is a property read from somewhere else - an attribute,
            // the text, an element of another name - where keeping it would hand the element in as that
            // property's value
            if (Object.hasOwn(properties, name)) {
                throw new Error(`<${name}> is not an element of ${cls.name}`);
            }
            res.set(name, XmlReaderUtilities.readElements(elements, undefined));
        }

        return Object.fromEntries(res);
    }

    private static readMixed(element: XmlElementNode, shapes: XmlMixedShapes, cls: Newable<unknown>): unknown[] {
        const parts: unknown[] = [];
        for (const item of element.content) {
            if (typeof item === 'string') {
                if (shapes.textShape != undefined) {
                    parts.push({ shape: shapes.textShape, value: item });
                    continue;
                }
                // content that holds no text can still be laid out over several lines
                if (item.trim().length) {
                    throw new Error(`The content of ${cls.name} holds no text`);
                }
                continue;
            }
            const shape: PropertyMetadata | undefined = shapes.elementShapes.get(item.name);
            if (shape?.type !== 'object') {
                throw new Error(`<${item.name}> is not part of the content of ${cls.name}`);
            }
            parts.push({ shape: item.name, value: XmlReaderUtilities.readObject(item, shape.cls()) });
        }
        return parts;
    }

    private static readElements(elements: XmlElementNode[], property: PropertyMetadata | undefined): unknown {
        if (property?.type === 'array') {
            return elements.map(child => XmlReaderUtilities.readValue(child, property.items));
        }
        const values: unknown[] = elements.map(child => property
            ? XmlReaderUtilities.readValue(child, property)
            : XmlReaderUtilities.readUntyped(child));
        // kept as a list when a property that is not one repeats, so validation says so instead
        // of one of them being dropped
        return values.length === 1 ? values[0] : values;
    }

    private static readUntyped(element: XmlElementNode): unknown {
        const children: XmlElementNode[] = XmlReaderUtilities.getChildren(element);
        if (!children.length) {
            return XmlReaderUtilities.getText(element);
        }
        // a map for the same reason as in readObject
        const res: Map<string, unknown> = new Map();
        for (const [name, elements] of XmlReaderUtilities.groupByName(children)) {
            res.set(name, XmlReaderUtilities.readElements(elements, undefined));
        }
        return Object.fromEntries(res);
    }

    private static groupByName(elements: XmlElementNode[]): Map<string, XmlElementNode[]> {
        const res: Map<string, XmlElementNode[]> = new Map();
        for (const element of elements) {
            // pushed onto the group rather than a copy of it with the element added, which made a
            // document of many same-named elements quadratic to read - seconds for one 100kb body
            const group: XmlElementNode[] | undefined = res.get(element.name);
            if (group == undefined) {
                res.set(element.name, [element]);
                continue;
            }
            group.push(element);
        }
        return res;
    }

    private static getText(element: XmlElementNode): string {
        return element.content.filter(item => typeof item === 'string').join('');
    }

    private static getChildren(element: XmlElementNode): XmlElementNode[] {
        return element.content.filter(item => typeof item !== 'string');
    }

    private static resolveAttributes(tag: SaxesTagNS): Record<string, string> {
        const attributes: Record<string, string> = {};
        for (const attribute of Object.values(tag.attributes)) {
            // a namespace declaration binds a prefix, it carries no data of the element
            if (attribute.name === 'xmlns' || attribute.prefix === 'xmlns') {
                continue;
            }
            // the xml prefix is bound in every document to the same namespace, so it is kept: xml:space
            // and xml:lang are attributes a model names as they are
            attributes[attribute.prefix === 'xml' ? attribute.name : attribute.local] = attribute.value;
        }
        return attributes;
    }
}