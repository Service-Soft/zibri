import { AsyncApiMessage } from '../async-api.model';

/**
 * One operation of an AsyncAPI document, its references resolved, as the explorer shows it.
 */
export type AsyncApiExplorerOperation = {
    /**
     * An id of the operation, unique in its tag, that an element can carry.
     */
    id: string,
    /**
     * Whether the application receives the messages, which a client sends, or sends them to a client.
     */
    action: 'send' | 'receive',
    /**
     * The event of the operation, such as `chat:send`.
     */
    address: string,
    /**
     * A short summary of the operation.
     */
    summary: string | undefined,
    /**
     * What the operation does.
     */
    description: string | undefined,
    /**
     * The messages of the operation.
     */
    messages: AsyncApiMessage[],
    /**
     * What the application answers a message of the operation with.
     */
    replies: AsyncApiMessage[],
    /**
     * The names of the security schemes the operation accepts, any one of which is enough. Empty for an operation
     * open to anonymous clients.
     */
    securitySchemes: string[],
    /**
     * The permissions the operation requires, from `x-permission` and `x-platform-permission`.
     */
    permissions: string[]
};

/**
 * The operations of one tag of an AsyncAPI document.
 */
export type AsyncApiExplorerTag = {
    /**
     * The name of the tag, or `default` for the operations that have none.
     */
    name: string,
    /**
     * The operations of the tag, in the order of the document.
     */
    operations: AsyncApiExplorerOperation[]
};

/**
 * A server of an AsyncAPI document, as a client connects to it.
 */
export type AsyncApiExplorerServer = {
    /**
     * The name of the server in the document.
     */
    name: string,
    /**
     * Where a client connects, such as `wss://api.example.com/socket.io`.
     */
    url: string,
    /**
     * How a client connects.
     */
    description: string | undefined
};
