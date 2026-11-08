import { TranslatedString } from '../localization/models/translated-string.model';
import { OpenApiReferenceObject, OpenApiSchemaObject } from '../open-api/open-api.model';

/**
 * A `$ref` to another part of an AsyncAPI document, such as `#/channels/chat-message`.
 */
export type AsyncApiReference = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    $ref: string
};

/**
 * The AsyncAPI 3.0 document of one version: the websocket events of the application.
 */
export type AsyncApiDefinition = {
    /**
     * The version of AsyncAPI the document follows.
     */
    asyncapi: '3.0.0',
    /**
     * The name of the application, and the version.
     */
    info: AsyncApiInfo,
    /**
     * The media type of a message that names none.
     */
    defaultContentType?: string,
    /**
     * Where a client connects, by name.
     */
    servers?: Record<string, AsyncApiServer>,
    /**
     * The events, by key, each with the messages sent on it.
     */
    channels?: Record<string, AsyncApiChannel>,
    /**
     * What the application does on each channel, by key.
     */
    operations?: Record<string, AsyncApiOperation>,
    /**
     * The reusable parts of the document.
     */
    components?: AsyncApiComponents
};

/**
 * What an AsyncAPI document describes.
 */
export type AsyncApiInfo = {
    /**
     * The name of the application.
     */
    title: string,
    /**
     * The version of the application.
     */
    version: string,
    /**
     * What the application is.
     */
    description?: string
};

/**
 * A tag of an operation, such as the controller it is declared in.
 */
export type AsyncApiTag = {
    /**
     * The name of the tag.
     */
    name: string,
    /**
     * What the tag groups.
     */
    description?: string
};

/**
 * Where a client connects.
 */
export type AsyncApiServer = {
    /**
     * The host, with its port where it names one, such as `api.example.com`.
     */
    host: string,
    /**
     * The protocol, such as `wss`.
     */
    protocol: string,
    /**
     * The path a client connects to, such as `/socket.io`.
     */
    pathname?: string,
    /**
     * How a client connects.
     */
    description?: TranslatedString,
    /**
     * What a client may connect with, any one of which is enough.
     */
    security?: (AsyncApiSecurityScheme | AsyncApiReference)[]
};

/**
 * An event, with the messages sent on it.
 */
export type AsyncApiChannel = {
    /**
     * The name of the event, such as `chat:send`.
     */
    address: string,
    /**
     * What the event is for.
     */
    description?: string,
    /**
     * The messages sent on the event, by key.
     */
    messages?: Record<string, AsyncApiMessage | AsyncApiReference>
};

/**
 * What the application does on a channel: `receive` the messages a client sends, or `send` messages to a client.
 */
export type AsyncApiOperation = {
    /**
     * Whether the application receives the messages or sends them.
     */
    action: 'send' | 'receive',
    /**
     * The channel of the operation.
     */
    channel: AsyncApiReference,
    /**
     * A short summary of the operation.
     */
    summary?: string,
    /**
     * What the operation does.
     */
    description?: string,
    /**
     * The messages of the operation, of those its channel holds.
     */
    messages?: AsyncApiReference[],
    /**
     * What the application answers a received message with.
     */
    reply?: AsyncApiOperationReply,
    /**
     * What a client may send the message with, any one of which is enough. Absent for an operation open to anonymous
     * clients.
     */
    security?: (AsyncApiSecurityScheme | AsyncApiReference)[],
    /**
     * The tags of the operation.
     */
    tags?: AsyncApiTag[],
    /**
     * The permission the operation requires.
     */
    'x-permission'?: string,
    /**
     * The permission of the platform the operation requires.
     */
    'x-platform-permission'?: string
};

/**
 * What the application answers a received message with.
 */
export type AsyncApiOperationReply = {
    /**
     * The channel the answer is sent on.
     */
    channel?: AsyncApiReference,
    /**
     * The messages the answer is one of.
     */
    messages?: AsyncApiReference[]
};

/**
 * A message: what it holds, and the media type it is written in.
 */
export type AsyncApiMessage = {
    /**
     * The name of the message.
     */
    name?: string,
    /**
     * A short summary of the message.
     */
    summary?: string,
    /**
     * What the message is.
     */
    description?: string,
    /**
     * The media type of the message, such as `application/json`.
     */
    contentType?: string,
    /**
     * The schema of what the message holds.
     */
    payload?: OpenApiSchemaObject | OpenApiReferenceObject
};

/**
 * The kinds of security scheme of AsyncAPI.
 */
export type AsyncApiSecuritySchemeType = 'userPassword' | 'apiKey' | 'X509' | 'symmetricEncryption' | 'asymmetricEncryption'
    | 'httpApiKey' | 'http' | 'oauth2' | 'openIdConnect' | 'plain' | 'scramSha256' | 'scramSha512' | 'gssapi';

/**
 * One flow of an `oauth2` scheme.
 */
export type AsyncApiOAuthFlow = {
    /**
     * Where a client is sent to authorize.
     */
    authorizationUrl?: string,
    /**
     * Where a client gets a token.
     */
    tokenUrl?: string,
    /**
     * Where a client refreshes a token.
     */
    refreshUrl?: string,
    /**
     * The scopes, each with what it allows.
     */
    availableScopes: Record<string, string>
};

/**
 * How a client proves who it is.
 */
export type AsyncApiSecurityScheme = {
    /**
     * The kind of scheme.
     */
    type: AsyncApiSecuritySchemeType,
    /**
     * What the scheme is.
     */
    description?: string,
    /**
     * The name of the header, query parameter or cookie of an `httpApiKey`.
     */
    name?: string,
    /**
     * Where the key of an `httpApiKey` or an `apiKey` goes.
     */
    in?: 'user' | 'password' | 'query' | 'header' | 'cookie',
    /**
     * The scheme of `http`, such as `bearer`.
     */
    scheme?: string,
    /**
     * The format of a bearer token, such as `JWT`.
     */
    bearerFormat?: string,
    /**
     * The flows of an `oauth2` scheme, by name.
     */
    flows?: Record<string, AsyncApiOAuthFlow>,
    /**
     * Where an `openIdConnect` scheme is discovered.
     */
    openIdConnectUrl?: string
};

/**
 * The reusable parts of an AsyncAPI document.
 */
export type AsyncApiComponents = {
    /**
     * Schemas, by name.
     */
    schemas?: Record<string, OpenApiSchemaObject | OpenApiReferenceObject>,
    /**
     * Messages, by name.
     */
    messages?: Record<string, AsyncApiMessage>,
    /**
     * The security schemes, by the name of their auth strategy.
     */
    securitySchemes?: Record<string, AsyncApiSecurityScheme>
};