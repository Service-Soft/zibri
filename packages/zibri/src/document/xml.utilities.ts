import { XmlElementNode } from './xml-element-node.model.ts';
import { XmlGenerateOptions } from './xml-generate-options.model.ts';
import { XmlParseOptions } from './xml-parse-options.model.ts';
import { XmlReaderUtilities } from './xml-reader.utilities.ts';
import { XmlString } from './xml-string.type.ts';
import { XmlWriterUtilities } from './xml-writer.utilities.ts';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default.ts';
import { inject } from '../di/inject.function.ts';
import { InternalError } from '../error-handling/internal-error.model.ts';
import { MimeType } from '../http/mime-type.enum.ts';
import { parseShape } from '../parsing/functions/parse-one-of.function.ts';
import { JsonBodyMetadata, XmlBodyMetadata } from '../routing/decorators/body-metadata.model.ts';
import { resolveStructuredBodyMetadata } from '../routing/resolve-body-metadata.function.ts';
import { Newable } from '../types/newable.type.ts';

/**
 * Utility class for handling xml documents.
 */
export abstract class XmlUtilities {

    /**
     * Writes data as the xml document the given model describes.
     *
     * The data is validated against the model first. Each property is written as a child element named after it, a
     * property declared as an array as one such element per item, and a property marked with `@XmlElement`,
     * `@XmlAttribute`, `@XmlText` or `@XmlMixed` as that element, that attribute, the element's own text or
     * everything inside it. A property without a value is left out. The root element, the namespaces and their
     * prefixes are the ones `@XmlRoot` and `@XmlNamespace` give the models.
     * @param cls - The model the document is written as.
     * @param data - The values to write.
     * @param options - How the document is laid out.
     * @returns The xml document.
     * @throws {InternalError} When the data does not fit the model, or holds something xml cannot.
     */
    static async generateFrom<T>(cls: Newable<T>, data: T, options: XmlGenerateOptions = {}): Promise<XmlString> {
        return XmlUtilities.resolveXmlString(await XmlWriterUtilities.write(cls, data, options));
    }

    /**
     * Reads an xml document as the data of the given model.
     *
     * The document is read the way an xml request body is, and the data is validated against the model.
     * @param cls - The model the document is read as.
     * @param xml - The xml document.
     * @param options - How strictly the document is read.
     * @returns The data of the model.
     * @throws {InternalError} When the document is not well formed, or does not have the structure of the model.
     * @throws A ValidationError when the values in it break the rules of the model.
     */
    static async parseFrom<T>(cls: Newable<T>, xml: string, options: XmlParseOptions = {}): Promise<T> {
        const metadata: JsonBodyMetadata | XmlBodyMetadata = resolveStructuredBodyMetadata(
            { type: MimeType.XML, modelClass: cls, allowAdditionalProperties: options.allowAdditionalProperties },
            0
        );
        let value: unknown;
        try {
            const root: XmlElementNode = XmlReaderUtilities.resolveRootElement(xml);
            value = parseShape(XmlReaderUtilities.readShape(root, metadata.shape), metadata.shape);
        }
        catch (error) {
            throw new InternalError(`The xml could not be read as ${cls.name}.`, { cause: error });
        }
        await inject(ZIBRI_DI_TOKENS.VALIDATION_SERVICE).validateBody(value, metadata);
        // validated as the model just now, which is what makes it one
        return value as T;
    }

    /**
     * Checks that text is a well formed xml document.
     *
     * For a document written some other way than with `generateFrom`, for example by hand or taken from elsewhere.
     * @param xml - The text.
     * @returns The same text, as an `XmlString`.
     * @throws {InternalError} When the text is not a well formed xml document.
     */
    static resolveXmlString(xml: string): XmlString {
        if (XmlUtilities.isXmlString(xml)) {
            return xml;
        }
        // read a second time for what it refuses, which only text that is refused pays for
        throw new InternalError('The text is not a well formed xml document.', { cause: XmlUtilities.findParseError(xml) });
    }

    private static isXmlString(xml: string): xml is XmlString {
        return XmlUtilities.findParseError(xml) == undefined;
    }

    private static findParseError(xml: string): unknown {
        try {
            XmlReaderUtilities.resolveRootElement(xml);
            return undefined;
        }
        catch (error) {
            return error;
        }
    }
}