import { AsyncApiExplorerOperation, AsyncApiExplorerServer, AsyncApiExplorerTag } from './async-api-explorer-operation.model';
import { InternalError } from '../../error-handling/internal-error.model';
import { ObjectUtilities } from '../../utilities/object.utilities';
import { AsyncApiChannel, AsyncApiDefinition, AsyncApiMessage, AsyncApiOperation, AsyncApiReference, AsyncApiSecurityScheme } from '../async-api.model';

/**
 * The tag of the operations that name none.
 */
const DEFAULT_TAG: string = 'default';

/**
 * What the explorer page reads from an AsyncAPI document while it renders: the operations by tag, with their channel
 * and their messages, and the servers a client connects to. The schemas of the messages are read with
 * `OpenApiExplorerUtilities`, which takes the document as well.
 *
 * Only references into the document itself are followed. Any other reference, and one naming a part the document
 * does not have, throws, naming the reference.
 */
export abstract class AsyncApiExplorerUtilities {
    /**
     * Resolves the operations of a document, by tag, in the order their tags first appear.
     * @param definition - The document.
     * @returns The tags with their operations.
     */
    static resolveTags(definition: AsyncApiDefinition): AsyncApiExplorerTag[] {
        const tags: Map<string, AsyncApiExplorerTag> = new Map();
        for (const [key, operation] of ObjectUtilities.entries(definition.operations ?? {})) {
            for (const name of operation.tags?.length ? operation.tags.map(tag => tag.name) : [DEFAULT_TAG]) {
                const tag: AsyncApiExplorerTag = tags.get(name) ?? { name, operations: [] };
                tags.set(name, tag);
                tag.operations.push(this.resolveOperation(definition, name, key, operation));
            }
        }
        return [...tags.values()];
    }

    /**
     * Resolves the servers a client connects to.
     * @param definition - The document.
     * @returns The servers, in the order of the document.
     */
    static resolveServers(definition: AsyncApiDefinition): AsyncApiExplorerServer[] {
        return ObjectUtilities.entries(definition.servers ?? {}).map(([name, server]) => ({
            name,
            url: `${server.protocol}://${server.host}${server.pathname ?? ''}`,
            description: server.description
        }));
    }

    private static resolveOperation(definition: AsyncApiDefinition, tag: string, key: string, operation: AsyncApiOperation): AsyncApiExplorerOperation {
        const channel: AsyncApiChannel = this.resolveChannel(definition, operation.channel);
        return {
            id: `asyncapi-${tag}-${key}`.replaceAll(/[^\w-]+/g, '-'),
            action: operation.action,
            address: channel.address,
            summary: operation.summary,
            description: operation.description ?? channel.description,
            messages: (operation.messages ?? ObjectUtilities.values(channel.messages ?? {}))
                .map(message => this.resolveMessage(definition, message)),
            replies: (operation.reply?.messages ?? []).map(message => this.resolveMessage(definition, message)),
            securitySchemes: (operation.security ?? []).map(scheme => this.resolveSecuritySchemeName(scheme)),
            permissions: [operation['x-permission'], operation['x-platform-permission']].filter(permission => permission != undefined)
        };
    }

    private static resolveChannel(definition: AsyncApiDefinition, reference: AsyncApiReference): AsyncApiChannel {
        const [kind, name, ...rest] = this.parseReference(reference);
        const channel: AsyncApiChannel | undefined = kind === 'channels' && rest.length === 0 && name != undefined
            ? definition.channels?.[name]
            : undefined;
        if (channel == undefined) {
            throw new InternalError(`The AsyncAPI document refers to "${reference.$ref}", which is none of its channels.`);
        }
        return channel;
    }

    /**
     * Resolves a message: one of a channel, such as `#/channels/chat/messages/request`, or one of the components.
     * @param definition - The document.
     * @param message - The message, or a reference to one.
     * @returns The message.
     * @throws An InternalError for a reference the document cannot resolve, or one that refers to itself.
     */
    private static resolveMessage(definition: AsyncApiDefinition, message: AsyncApiMessage | AsyncApiReference): AsyncApiMessage {
        let current: AsyncApiMessage | AsyncApiReference = message;
        const seen: string[] = [];
        while ('$ref' in current) {
            const reference: string = current.$ref;
            if (seen.includes(reference)) {
                throw new InternalError(`The AsyncAPI document refers from "${reference}" to itself: ${[...seen, reference].join(' -> ')}.`);
            }
            seen.push(reference);
            const [kind, name, part, messageName] = this.parseReference(current);
            const found: AsyncApiMessage | AsyncApiReference | undefined = kind === 'channels' && part === 'messages' && name != undefined && messageName != undefined
                ? definition.channels?.[name]?.messages?.[messageName]
                : kind === 'messages' && name != undefined
                    ? definition.components?.messages?.[name]
                    : undefined;
            if (found == undefined) {
                throw new InternalError(`The AsyncAPI document refers to "${reference}", which is none of its messages.`);
            }
            current = found;
        }
        return current;
    }

    private static resolveSecuritySchemeName(scheme: AsyncApiSecurityScheme | AsyncApiReference): string {
        if (!('$ref' in scheme)) {
            return scheme.type;
        }
        const [kind, name] = this.parseReference(scheme);
        if (kind !== 'securitySchemes' || name == undefined) {
            throw new InternalError(`The AsyncAPI document refers to "${scheme.$ref}", which is none of its components.securitySchemes.`);
        }
        return name;
    }

    /**
     * The segments of a reference into the document, without the `components` of one into the components.
     * @param reference - The reference, such as `#/components/messages/chat`.
     * @returns The segments, such as `['messages', 'chat']`. Empty for a reference out of the document.
     */
    private static parseReference(reference: AsyncApiReference): string[] {
        if (!reference.$ref.startsWith('#/')) {
            return [];
        }
        const segments: string[] = reference.$ref.slice(2).split('/')
            .map(segment => segment.replaceAll('~1', '/').replaceAll('~0', '~'));
        return segments[0] === 'components' ? segments.slice(1) : segments;
    }
}
