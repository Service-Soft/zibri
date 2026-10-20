/**
 * The xml helpers of `@node-saml/node-saml`, which parse, sign and verify the messages it builds. Not
 * part of its public api: the package exports no `SAML` method that signs a message for the SOAP or
 * the HTTP-POST binding, nor one that reads a document into a DOM.
 */
export type NodeSamlXml = typeof import('@node-saml/node-saml/lib/xml.js');