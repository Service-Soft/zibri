import { create as createXml } from 'xmlbuilder2';
import { XMLBuilder, XMLBuilderCreateOptions } from 'xmlbuilder2/lib/interfaces';

/**
 * Represents a wrapper around XML nodes to implement easy to use and chainable document builder methods.
 */
export type XML = XMLBuilder;

/**
 * Utility class for handling xml files.
 */
export abstract class XmlUtilities {
    /**
     * Creates an XML document without any child nodes with the given options.
     * @param options - Builder options.
     * @returns Document node.
     */
    static create(options: XMLBuilderCreateOptions = { version: '1.0', encoding: 'utf8' }): XML {
        return createXml(options);
    }

    /**
     * Parses the given xml.
     * @param xml - The xml content to parse.
     * @returns The parsed result.
     */
    static parse<T>(xml: string): T {
        return createXml(xml).end({ format: 'object' }) as T;
    }
}