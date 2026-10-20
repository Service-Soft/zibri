import { NodeSamlXml } from './node-saml-xml.type.ts';
import { BadRequestError } from '../../../error-handling/errors/bad-request.error.ts';
import { $ts } from '../../../localization/translate.function.ts';
import { optionalPeer } from '../../../utilities/optional-peer.function.ts';

/**
 * The namespace of SOAP 1.1 envelopes, which the SAML SOAP binding carries messages in.
 */
const SOAP_NAMESPACE: string = 'http://schemas.xmlsoap.org/soap/envelope/';

/**
 * The namespace of SAML protocol messages.
 */
const PROTOCOL_NAMESPACE: string = 'urn:oasis:names:tc:SAML:2.0:protocol';

/**
 * The node type of an element.
 */
const ELEMENT_NODE: number = 1;

/**
 * Reads and writes the SOAP envelopes the SAML SOAP binding carries messages in (SAML bindings, 3.2).
 */
export abstract class SamlSoapUtilities {
    /**
     * Finds the logout request a SOAP envelope carries in its body, as a document of its own.
     *
     * The request is written with the namespaces it uses declared on it, wherever the envelope declared
     * them, so its signature checks as it did inside the envelope: a signature covers the request in
     * exclusive canonical form, which renders the same namespaces wherever they were declared.
     * @param envelope - The envelope, exactly as it arrived.
     * @returns The logout request.
     * @throws BadRequestError when it is not a SOAP envelope whose body is one logout request.
     */
    static async findLogoutRequest(envelope: string): Promise<string> {
        let document: Document;
        try {
            document = await this.resolveNodeSamlXml().parseDomFromString(envelope);
        }
        catch {
            throw new BadRequestError($ts`The body is not a SOAP envelope carrying a logout request.`);
        }
        const root: Element = document.documentElement;
        const [body, ...others] = this.findChildren(root).filter(child => this.isElement(child, SOAP_NAMESPACE, 'Body'));
        const [message, ...more] = body == undefined ? [] : this.findChildren(body);
        if (!this.isElement(root, SOAP_NAMESPACE, 'Envelope') || others.length || more.length || message == undefined
            || !this.isElement(message, PROTOCOL_NAMESPACE, 'LogoutRequest')) {
            throw new BadRequestError($ts`The body is not a SOAP envelope carrying a logout request.`);
        }
        // the element is node-saml's xmldom one, typed as a browser Element: its toString writes the
        // xml, which a browser Element has no counterpart for
        // eslint-disable-next-line typescript/no-base-to-string
        return message.toString();
    }

    /**
     * Puts a message into a SOAP envelope.
     * @param message - The message, a document of its own.
     * @returns The envelope.
     */
    static toEnvelope(message: string): string {
        // the declaration of a document of its own cannot stand inside another one
        const element: string = message.replace(/^<\?xml[^>]*\?>\s*/, '');
        return `<soap:Envelope xmlns:soap="${SOAP_NAMESPACE}"><soap:Body>${element}</soap:Body></soap:Envelope>`;
    }

    private static findChildren(element: Element): Element[] {
        // by index, since the node lists of the DOM node-saml parses into are not iterable
        const nodes: ChildNode[] = Array.from({ length: element.childNodes.length }, (_, i) => element.childNodes.item(i));
        return nodes.filter((node): node is Element => node.nodeType === ELEMENT_NODE);
    }

    private static isElement(element: Element, namespace: string, name: string): boolean {
        return element.namespaceURI === namespace && element.localName === name;
    }

    private static resolveNodeSamlXml(): NodeSamlXml {
        return optionalPeer<NodeSamlXml>('@node-saml/node-saml/lib/xml', 'Sign-in through a SAML identity provider');
    }
}