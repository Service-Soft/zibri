import { AsyncApiDefinition, AsyncApiExplorerOperation, AsyncApiExplorerServer, AsyncApiExplorerTag, AsyncApiExplorerUtilities, AsyncApiMessage, OpenApiExampleDirection, provideContext, TsxComponent } from 'zibri';

import { ExplorerBar } from './explorer-bar';
import { ExplorerContent } from './explorer-content';
import { ExplorerDefinition } from './explorer-context';
import { ExplorerMethodClasses, resolveMethodClasses } from './explorer-methods';
import { Heading } from '../components/heading';
import { Link } from '../components/link';

type Props = {
    definition: AsyncApiDefinition,
    documentUrl: string
};

type MessageProps = {
    id: string,
    message: AsyncApiMessage,
    contentType: string,
    direction: OpenApiExampleDirection
};

type OperationProps = {
    operation: AsyncApiExplorerOperation,
    contentType: string
};

const ExplorerMessage: TsxComponent<MessageProps> = ({ id, message, contentType, direction }) => (
    <div>
        {message.description != undefined && <p>{message.description}</p>}
        <ExplorerContent id={id} mimeType={message.contentType ?? contentType} content={{ schema: message.payload }} direction={direction}/>
    </div>
);

const ExplorerAsyncOperation: TsxComponent<OperationProps> = ({ operation, contentType }) => {
    // in the words of a socket.io client: it emits what the application receives, and listens to what it sends
    const clientAction: string = operation.action === 'receive' ? 'emit' : 'on';
    const classes: ExplorerMethodClasses = resolveMethodClasses(clientAction);
    // the lock is only a mark: the explorer sends no event, so what is entered under authorize is not used here

    return (
        <details id={operation.id} className={`my-2 rounded border ${classes.frame}`}>
            <summary className="flex flex-wrap gap-3 items-center p-1.5 cursor-pointer">
                <span className={`min-w-20 py-1.5 rounded-sm text-center font-bold text-[#111] ${classes.badge}`}>{clientAction.toUpperCase()}</span>
                <span id={`${operation.id}-address`} className="font-mono font-semibold break-all">{operation.address}</span>
                <span className="flex-1 text-disabled">{operation.summary}</span>
                <span id={`${operation.id}-permissions`} className="flex gap-2 items-center">
                    {operation.permissions.map(permission => <span className="px-2 pb-0.5 rounded-full border border-white bg-dark-gray text-sm">{permission}</span>)}
                </span>
                {operation.securitySchemes.length > 0 && <img
                    id={`${operation.id}-lock`}
                    className="h-5 w-5 m-1"
                    src="/assets/lock.svg"
                    alt={`Requires a login with ${operation.securitySchemes.join(' or ')}`}
                    title={`Requires a login with ${operation.securitySchemes.join(' or ')}`}
                />}
            </summary>
            <div className={`flex flex-col gap-3 px-4 pt-3 pb-4 border-t ${classes.frame}`}>
                {operation.description != undefined && <p>{operation.description}</p>}
                <Heading tag="h4" className="text-lg! font-semibold">{operation.action === 'receive' ? 'Message a client sends' : 'Message a client receives'}</Heading>
                {operation.messages.map((message, index) => <ExplorerMessage
                    id={`${operation.id}-message-${index}`}
                    message={message}
                    contentType={contentType}
                    direction={operation.action === 'receive' ? 'request' : 'response'}
                />)}
                {operation.replies.length > 0 && <Heading tag="h4" className="text-lg! font-semibold">Answer</Heading>}
                {operation.replies.map((message, index) => <ExplorerMessage
                    id={`${operation.id}-reply-${index}`}
                    message={message}
                    contentType={contentType}
                    direction="response"
                />)}
            </div>
        </details>
    );
};

export const ExplorerAsyncApi: TsxComponent<Props> = ({ definition, documentUrl }) => {
    const servers: AsyncApiExplorerServer[] = AsyncApiExplorerUtilities.resolveServers(definition);
    const tags: AsyncApiExplorerTag[] = AsyncApiExplorerUtilities.resolveTags(definition);
    const contentType: string = definition.defaultContentType ?? 'application/json';

    // the schemas of the messages refer into this document
    provideContext(ExplorerDefinition, definition);

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2 items-center">
                <Link id="explorer-asyncapi-document" href={documentUrl} className="underline">AsyncAPI document</Link>
                <span id="explorer-asyncapi-document-version" className="px-2 py-0.5 rounded-full bg-primary text-sm">AsyncAPI {definition.asyncapi}</span>
            </div>
            {servers.length > 0 && <ExplorerBar id="asyncapi-bar">
                {servers.map(server => <div id={`asyncapi-server-${server.name}`} className="flex flex-col gap-1">
                    <p className="inline-flex gap-2 items-center">
                        Server
                        <code id={`asyncapi-server-${server.name}-url`} className="px-2 py-1.5 rounded bg-gray font-mono">{server.url}</code>
                    </p>
                    {server.description != undefined && <p className="text-sm text-disabled">{server.description}</p>}
                </div>)}
            </ExplorerBar>}
            {tags.map(tag => <details id={`asyncapi-tag-${tag.name}`} open>
                <summary className="py-3 border-b border-white cursor-pointer">
                    <Heading tag="h2" className="inline text-2xl!">{tag.name}</Heading>
                </summary>
                {tag.operations.map(operation => <ExplorerAsyncOperation operation={operation} contentType={contentType}/>)}
            </details>)}
        </div>
    );
};
