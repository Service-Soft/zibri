import { OpenApiDefinition, OpenApiExplorerSecurityScheme, OpenApiExplorerTag, OpenApiExplorerUtilities, onClient, provideContext, State, TsxComponent, useEffect, useState, useWritableInput } from 'zibri';

import { ExplorerAuthorize, ExplorerAuthorizeScheme } from './explorer-authorize';
import { ExplorerBar } from './explorer-bar';
import { ExplorerCredentials, ExplorerDefinition, ExplorerServer } from './explorer-context';
import { ExplorerOperation } from './explorer-operation';
import { Heading } from '../components/heading';
import { Link } from '../components/link';

/**
 * A server the document names, as a request is sent to it.
 */
type ExplorerServerOption = {
    url: string,
    description: string
};

type ServerSelectProps = {
    servers: ExplorerServerOption[],
    server: State<string>
};

type ServerProps = {
    server: ExplorerServerOption
};

type Props = {
    definition: OpenApiDefinition,
    version: string,
    documentUrl: string,
    versionHeader: string
};

/**
 * The servers of the document, their variables filled in with their defaults.
 * @param definition - The document.
 * @returns The servers, in the order of the document.
 */
function resolveServers(definition: OpenApiDefinition): ExplorerServerOption[] {
    return (definition.servers ?? []).map(server => {
        const url: string = server.url.replaceAll(/\{([^}]+)\}/g, (_, name: string) => String(server.variables?.[name]?.default ?? ''));
        return { url, description: server.description ?? '' };
    });
}

// the description of the server chosen below the choice, which is why the servers are a prop the browser reads
const ExplorerServerSelect: TsxComponent<ServerSelectProps> = ({ servers, server }) => {
    const selected: State<string> = useWritableInput(server);

    return (
        <div className="flex flex-col gap-1">
            <label className="inline-flex gap-2 items-center">
                Server
                <select id="explorer-server" value={selected} className="px-2 py-1.5 rounded border border-disabled-dark bg-gray text-white">
                    {servers.map(option => <option value={option.url}>{option.url}</option>)}
                </select>
            </label>
            {servers.map((option, index) => <p
                id={`explorer-server-description-${index}`}
                className="text-sm text-disabled"
                hidden={selected.value !== option.url || option.description === ''}
            >
                {option.description}
            </p>)}
        </div>
    );
};

// a single server leaves nothing to choose, so it is named like the servers of the AsyncAPI document
const ExplorerServerName: TsxComponent<ServerProps> = ({ server }) => {
    return (
        <div className="flex flex-col gap-1">
            <p className="inline-flex gap-2 items-center">
                Server
                <code id="explorer-server-url" className="px-2 py-1.5 rounded bg-gray font-mono">{server.url}</code>
            </p>
            {server.description !== '' && <p id="explorer-server-description-0" className="text-sm text-disabled">{server.description}</p>}
        </div>
    );
};

/**
 * The schemes of the document, as the user enters what a request is sent with.
 * @param schemes - The schemes.
 * @returns The schemes.
 */
function toAuthorizeSchemes(schemes: OpenApiExplorerSecurityScheme[]): ExplorerAuthorizeScheme[] {
    return schemes.map(({ name, scheme }) => ({
        name,
        type: scheme.type,
        description: scheme.description ?? '',
        scheme: scheme.scheme ?? '',
        location: scheme.in ?? '',
        parameterName: scheme.name ?? ''
    }));
}

export const ExplorerOpenApi: TsxComponent<Props> = ({ definition, version, documentUrl, versionHeader }) => {
    const servers: ExplorerServerOption[] = resolveServers(definition);
    const schemes: OpenApiExplorerSecurityScheme[] = OpenApiExplorerUtilities.resolveSecuritySchemes(definition);
    const tags: OpenApiExplorerTag[] = OpenApiExplorerUtilities.resolveTags(definition);
    const server: State<string> = useState(servers[0]?.url ?? '');
    // what a request logs in with, which only a request of this document sends
    const credentials: State<Record<string, string>> = useState<Record<string, string>>({});

    provideContext(ExplorerDefinition, definition);
    provideContext(ExplorerServer, server.value);
    provideContext(ExplorerCredentials, credentials.value);

    // what the user entered is kept in this browser, so a reload keeps them logged in
    onClient(() => {
        try {
            credentials.value = JSON.parse(localStorage.getItem('zibri-explorer-credentials') ?? '{}');
        }
        catch {
            localStorage.removeItem('zibri-explorer-credentials');
        }
    });

    useEffect(() => {
        localStorage.setItem('zibri-explorer-credentials', JSON.stringify(credentials.value));
    }, [credentials]);

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2 items-center">
                <Link id="explorer-document" href={documentUrl} className="underline">OpenAPI document</Link>
                <span id="explorer-document-version" className="px-2 py-0.5 rounded-full bg-primary text-sm">OpenAPI {definition.openapi}</span>
            </div>
            {definition.info.description != undefined && <p>{definition.info.description}</p>}
            {(servers.length > 0 || schemes.length > 0) && <ExplorerBar id="explorer-bar">
                {servers.length === 1 && <ExplorerServerName server={servers[0]}/>}
                {servers.length > 1 && <ExplorerServerSelect servers={servers} server={server}/>}
                {schemes.length > 0 && <div className="ml-auto">
                    <ExplorerAuthorize schemes={toAuthorizeSchemes(schemes)} credentials={credentials}/>
                </div>}
            </ExplorerBar>}
            {tags.length
                ? tags.map(tag => <details id={`tag-${tag.name}`} open>
                    <summary className="py-3 border-b border-white cursor-pointer">
                        <Heading tag="h2" className="inline text-2xl!">{tag.name}</Heading>
                        {tag.description != undefined && <span className="ml-4 text-disabled">{tag.description}</span>}
                    </summary>
                    {tag.operations.map(operation => <ExplorerOperation
                        operation={operation}
                        schemes={schemes}
                        version={version}
                        versionHeader={versionHeader}
                    />)}
                </details>)
                : <p className="text-disabled">This version has no operations.</p>}
        </div>
    );
};
