import { XmlElementNode } from './xml-element-node.model.ts';
import { XmlGenerateOptions } from './xml-generate-options.model.ts';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default.ts';
import { inject } from '../di/inject.function.ts';
import { PropertyMetadata } from '../entity/decorators/property.decorator.ts';
import { RelationType } from '../entity/models/relation-type.enum.ts';
import { ValidationError } from '../error-handling/errors/validation.error.ts';
import { InternalError } from '../error-handling/internal-error.model.ts';
import { MimeType } from '../http/mime-type.enum.ts';
import { isNamedValue } from '../parsing/functions/parse-one-of.function.ts';
import { XmlMixedProperty, XmlMixedShapes, XmlModelUtilities } from '../parsing/xml/xml-model.utilities.ts';
import { XmlPropertyMetadata } from '../parsing/xml/xml-property-metadata.model.ts';
import { XmlRootMetadata } from '../parsing/xml/xml-root-metadata.model.ts';
import { BodyMetadata } from '../routing/decorators/body-metadata.model.ts';
import { resolveBodyMetadata } from '../routing/resolve-body-metadata.function.ts';
import { Newable } from '../types/newable.type.ts';
import { MetadataUtilities } from '../utilities/metadata.utilities.ts';
import { BigNumber } from '../utilities/number.utilities.ts';
import { ObjectUtilities } from '../utilities/object.utilities.ts';

// what text cannot hold as it is: the markup characters, and a carriage return, which a reader
// would turn into a line feed
const TEXT_SPECIAL_CHARACTERS: RegExp = /[\r&<>]/g;
// an attribute value additionally ends at its quote, and a reader turns tabs and line breaks in it
// into spaces
const ATTRIBUTE_SPECIAL_CHARACTERS: RegExp = /[\t\n\r"&<]/g;
// the characters xml 1.0 has no form for at all, not even as a reference: the control characters but
// tab and the line breaks, the surrogates, and the two noncharacters at the end of the basic plane.
// Listed rather than written as the complement of what xml allows, which ends a range at � -
// TypeScript 7 takes that character for a malformed escape and refuses the expression
// oxlint-disable-next-line no-control-regex
const INVALID_CHARACTER: RegExp = /[\0-\x08\x0B\x0C\x0E-\x1F\uD800-\uDFFF￾￿]/u;
// a letter or underscore, then letters, digits, marks, underscores, dots and hyphens. Narrower than
// what xml allows, and without the colon: a prefix is written from the namespace, never named
const NAME: RegExp = /^[\p{L}_][\p{L}\p{N}\p{M}_.-]*$/u;
// the one prefix an attribute may name itself, since it is bound in every document without a declaration
const XML_ATTRIBUTE: RegExp = /^xml:[\p{L}_][\p{L}\p{N}\p{M}_.-]*$/u;
// two spaces per level
const INDENTATION: string = '  ';

/**
 * The namespaces of a document and how each is written.
 */
type DocumentNamespaces = {
    /**
     * The namespace written without a prefix, if any.
     */
    defaultNamespace: string | undefined,
    /**
     * The prefix of each other namespace.
     */
    prefixes: Map<string, string>,
    /**
     * The model the document is written as, to name in an error.
     */
    cls: Newable<unknown>
};

/**
 * Writes the data of a model as the xml document the model describes.
 *
 * Internal: `XmlUtilities.generateFrom` is the public way in. The router and the error handler write through here
 * directly, since what they answer with is sent rather than handed to anyone as an `XmlString`.
 */
export abstract class XmlWriterUtilities {

    /**
     * Writes data as the xml document the given model describes, validating it against the model first.
     * @param cls - The model the document is written as.
     * @param data - The values to write.
     * @param options - How the document is laid out.
     * @returns The xml document.
     * @throws {InternalError} When the data does not fit the model, or holds something xml cannot.
     */
    static async write<T>(cls: Newable<T>, data: T, options: XmlGenerateOptions = {}): Promise<string> {
        const metadata: BodyMetadata = resolveBodyMetadata({ type: MimeType.XML, modelClass: cls }, 0);
        try {
            await inject(ZIBRI_DI_TOKENS.VALIDATION_SERVICE).validateBody(data, metadata);
        }
        catch (error) {
            // not the validation error itself, which answers 400: a request's body was checked when it
            // arrived, so data that does not fit by the time it is written is the application's mistake
            if (error instanceof ValidationError) {
                throw new InternalError(`The data does not fit the model ${cls.name}.`, { cause: error });
            }
            throw error;
        }
        return XmlWriterUtilities.stringify(cls, data, options);
    }

    /**
     * Writes data as the xml document the given model describes, without validating it.
     *
     * For data the framework builds itself, where there is nothing to validate it with: the source translations are
     * extracted during a build, where no application exists and so no validation service does either.
     * @param cls - The model the document is written as.
     * @param data - The values to write.
     * @param options - How the document is laid out.
     * @returns The xml document.
     * @throws {InternalError} When the data holds something xml cannot.
     */
    static stringify<T>(cls: Newable<T>, data: T, options: XmlGenerateOptions = {}): string {
        const root: XmlRootMetadata | undefined = MetadataUtilities.findXmlRoot(cls);
        const documentNamespace: string | undefined = root?.namespace;
        const element: XmlElementNode = XmlWriterUtilities.resolveObjectElement(
            root?.name ?? cls.name,
            documentNamespace,
            data,
            cls,
            documentNamespace
        );
        const namespaces: DocumentNamespaces = XmlWriterUtilities.resolveDocumentNamespaces(root, cls);
        // the declarations first, then the root's own attributes
        const declarations: Record<string, string> = {};
        if (namespaces.defaultNamespace != undefined) {
            declarations['xmlns'] = namespaces.defaultNamespace;
        }
        for (const [namespace, prefix] of namespaces.prefixes) {
            declarations[`xmlns:${prefix}`] = namespace;
        }
        element.attributes = { ...declarations, ...element.attributes };

        const separator: string = options.indent === true ? '\n' : '';
        const document: string = XmlWriterUtilities.stringifyElement(element, namespaces, options.indent === true ? 0 : undefined);
        return `<?xml version="1.0" encoding="UTF-8"?>${separator}${document}`;
    }

    private static resolveDocumentNamespaces(root: XmlRootMetadata | undefined, cls: Newable<unknown>): DocumentNamespaces {
        const prefixes: Map<string, string> = new Map();
        for (const [prefix, namespace] of ObjectUtilities.entries(root?.prefixes ?? {})) {
            if (!NAME.test(prefix) || prefix.toLowerCase().startsWith('xml')) {
                throw new InternalError(`"${prefix}" in the prefixes of ${cls.name} is not a prefix a namespace can have.`);
            }
            if (prefixes.has(namespace)) {
                throw new InternalError(
                    `${cls.name} declares two prefixes for the namespace "${namespace}", so neither would be the one it is written with.`
                );
            }
            prefixes.set(namespace, prefix);
        }
        // the root's namespace is the default one unless it has a prefix, which is what the document had
        // before prefixes could be declared
        const defaultNamespace: string | undefined = root?.namespace != undefined && !prefixes.has(root.namespace)
            ? root.namespace
            : undefined;
        return { defaultNamespace, prefixes, cls };
    }

    private static resolveObjectElement(
        name: string,
        namespace: string | undefined,
        value: unknown,
        cls: Newable<unknown>,
        documentNamespace: string | undefined
    ): XmlElementNode {
        if (typeof value !== 'object' || value == undefined) {
            throw new InternalError(`"${name}" has to be an object to be written as ${cls.name}.`);
        }
        const values: Map<string, unknown> = new Map(Object.entries(value));
        // the child elements of a model are in its namespace, the way a schema qualifies what it declares
        const childNamespace: string | undefined = XmlModelUtilities.resolveNamespace(cls, documentNamespace);
        const element: XmlElementNode = { name, namespace, attributes: {}, content: [] };
        let text: string = '';

        const mixed: XmlMixedProperty | undefined = XmlModelUtilities.findMixedProperty(cls);
        // in the order the properties are declared in, which is the order their decorators ran in
        for (const [key, property] of ObjectUtilities.entries(MetadataUtilities.getModelProperties(cls))) {
            const propertyValue: unknown = values.get(key);
            if (propertyValue == undefined) {
                continue;
            }
            const xml: XmlPropertyMetadata = XmlModelUtilities.getXmlProperty(cls, key);
            switch (xml.kind) {
                case 'element': {
                    element.content.push(
                        ...XmlWriterUtilities.resolveElements(xml.name, childNamespace, propertyValue, property, documentNamespace)
                    );
                    break;
                }
                case 'attribute': {
                    element.attributes[xml.name] = XmlWriterUtilities.formatValue(propertyValue);
                    break;
                }
                case 'text': {
                    text = XmlWriterUtilities.formatValue(propertyValue);
                    break;
                }
                case 'mixed': {
                    if (mixed != undefined) {
                        element.content.push(
                            ...XmlWriterUtilities.resolveMixedContent(propertyValue, mixed.shapes, childNamespace, documentNamespace)
                        );
                    }
                    break;
                }
            }
        }
        // the text before the child elements, as a model with both has always been written
        if (text.length) {
            element.content.unshift(text);
        }
        return element;
    }

    private static resolveMixedContent(
        value: unknown,
        shapes: XmlMixedShapes,
        namespace: string | undefined,
        documentNamespace: string | undefined
    ): (string | XmlElementNode)[] {
        if (!Array.isArray(value)) {
            throw new InternalError('Mixed content has to be a list of its parts.');
        }
        return value.map(part => {
            if (!isNamedValue(part)) {
                throw new InternalError('A part of mixed content has to name its shape.');
            }
            if (part.shape === shapes.textShape) {
                return XmlWriterUtilities.formatValue(part.value);
            }
            const shape: PropertyMetadata | undefined = shapes.elementShapes.get(part.shape);
            if (shape?.type !== 'object') {
                throw new InternalError(`"${part.shape}" is not a shape of the mixed content.`);
            }
            return XmlWriterUtilities.resolveObjectElement(part.shape, namespace, part.value, shape.cls(), documentNamespace);
        });
    }

    private static resolveElements(
        name: string,
        namespace: string | undefined,
        value: unknown,
        metadata: PropertyMetadata,
        documentNamespace: string | undefined
    ): XmlElementNode[] {
        if (value == undefined) {
            return [];
        }
        switch (metadata.type) {
            case 'object': {
                return [XmlWriterUtilities.resolveObjectElement(name, namespace, value, metadata.cls(), documentNamespace)];
            }
            case 'array': {
                if (!Array.isArray(value)) {
                    throw new InternalError(`"${name}" has to be an array to be written as one.`);
                }
                // one element per item, which is how a list property is read back. A list of lists
                // would repeat the same element for both, and read back as one flat list
                if (metadata.items.type === 'array') {
                    throw new InternalError(`"${name}" is a list of lists, which has no xml form.`);
                }
                const items: PropertyMetadata = metadata.items;
                return value.flatMap(item => XmlWriterUtilities.resolveElements(name, namespace, item, items, documentNamespace));
            }
            case 'string':
            case 'number':
            case 'boolean':
            case 'date': {
                return [{ name, namespace, attributes: {}, content: [XmlWriterUtilities.formatValue(value)] }];
            }
            case 'oneOf':
            case 'unknown': {
                return XmlWriterUtilities.resolveUntypedElements(name, namespace, value);
            }
            case 'file':
            case RelationType.HAS_ONE:
            case RelationType.BELONGS_TO_ONE:
            case RelationType.ONE_TO_MANY:
            case RelationType.MANY_TO_ONE:
            case RelationType.MANY_TO_MANY: {
                throw new InternalError(`"${name}" is a ${metadata.type} property, which has no xml form.`);
            }
        }
    }

    /**
     * Writes a value that has no model to say what it is, the way the body parser reads one back: an object as its
     * keys, a list as its items repeated, anything else as text.
     * @param name - The name of the element.
     * @param namespace - The namespace of the element.
     * @param value - The value.
     * @returns The elements for the value, none when it is empty.
     */
    private static resolveUntypedElements(name: string, namespace: string | undefined, value: unknown): XmlElementNode[] {
        if (value == undefined) {
            return [];
        }
        if (Array.isArray(value)) {
            return value.flatMap(item => {
                if (Array.isArray(item)) {
                    throw new InternalError(`"${name}" is a list of lists, which has no xml form.`);
                }
                return XmlWriterUtilities.resolveUntypedElements(name, namespace, item);
            });
        }
        if (typeof value === 'object' && !(value instanceof Date) && !(value instanceof BigNumber)) {
            const content: XmlElementNode[] = Object.entries(value)
                .flatMap(([key, child]) => XmlWriterUtilities.resolveUntypedElements(key, namespace, child));
            return [{ name, namespace, attributes: {}, content }];
        }
        return [{ name, namespace, attributes: {}, content: [XmlWriterUtilities.formatValue(value)] }];
    }

    private static formatValue(value: unknown): string {
        if (typeof value === 'string') {
            return value;
        }
        if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
            return String(value);
        }
        if (value instanceof Date) {
            return value.toISOString();
        }
        if (value instanceof BigNumber) {
            // fixed rather than exponential notation, which xml schema's decimal has no form for
            return value.toFixed();
        }
        throw new InternalError(`A ${typeof value} cannot be written as xml text.`);
    }

    /**
     * Writes an element and everything in it.
     * @param element - The element.
     * @param namespaces - How the namespaces of the document are written.
     * @param depth - How deep the element is, when the document is indented and the element is where indenting
     * cannot change anything.
     * @returns The element as xml.
     */
    private static stringifyElement(element: XmlElementNode, namespaces: DocumentNamespaces, depth: number | undefined): string {
        const name: string = XmlWriterUtilities.resolveQualifiedName(element, namespaces);
        let res: string = `<${name}`;
        for (const [attribute, value] of ObjectUtilities.entries(element.attributes)) {
            XmlWriterUtilities.validateAttributeName(attribute);
            res += ` ${attribute}="${XmlWriterUtilities.escape(value, ATTRIBUTE_SPECIAL_CHARACTERS)}"`;
        }
        if (!element.content.length) {
            return `${res}/>`;
        }
        // only between elements: whitespace next to text becomes part of the text, and a reader cannot
        // tell it from whitespace the text had. Nothing inside text is indented either, however deep
        const elementsOnly: boolean = element.content.every(item => typeof item !== 'string');
        if (depth != undefined && elementsOnly) {
            const indentation: string = INDENTATION.repeat(depth + 1);
            const children: string = element.content
                .map(child => `\n${indentation}${XmlWriterUtilities.stringifyContent(child, namespaces, depth + 1)}`)
                .join('');
            return `${res}>${children}\n${INDENTATION.repeat(depth)}</${name}>`;
        }
        const content: string = element.content.map(item => XmlWriterUtilities.stringifyContent(item, namespaces, undefined)).join('');
        return `${res}>${content}</${name}>`;
    }

    private static stringifyContent(item: string | XmlElementNode, namespaces: DocumentNamespaces, depth: number | undefined): string {
        return typeof item === 'string'
            ? XmlWriterUtilities.escape(item, TEXT_SPECIAL_CHARACTERS)
            : XmlWriterUtilities.stringifyElement(item, namespaces, depth);
    }

    private static resolveQualifiedName(element: XmlElementNode, namespaces: DocumentNamespaces): string {
        if (!NAME.test(element.name)) {
            throw new InternalError(`"${element.name}" is not a name an xml element can have.`);
        }
        if (element.namespace === namespaces.defaultNamespace) {
            return element.name;
        }
        const prefix: string | undefined = element.namespace == undefined ? undefined : namespaces.prefixes.get(element.namespace);
        if (prefix == undefined) {
            throw new InternalError(
                `<${element.name}> is in the namespace "${element.namespace ?? 'none'}", `
                + `which ${namespaces.cls.name} declares no prefix for. Name one in the prefixes of its @XmlRoot.`
            );
        }
        return `${prefix}:${element.name}`;
    }

    private static escape(value: string, special: RegExp): string {
        if (INVALID_CHARACTER.test(value)) {
            throw new InternalError(`"${value}" contains a character xml cannot hold.`);
        }
        // a character reference for each: correct wherever it appears, with no table to keep
        return value.replaceAll(special, character => `&#x${character.charCodeAt(0).toString(16)};`);
    }

    private static validateAttributeName(name: string): void {
        if (!NAME.test(name) && !XML_ATTRIBUTE.test(name) && name !== 'xmlns' && !name.startsWith('xmlns:')) {
            throw new InternalError(`"${name}" is not a name an xml attribute can have.`);
        }
    }
}