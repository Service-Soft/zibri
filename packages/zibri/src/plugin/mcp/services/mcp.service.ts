import { type CurrentUser } from '../../../auth/decorators/current-user.decorator';
import { UserKindUtilities } from '../../../auth/user/user-kind.utilities';
import { type HttpRequestContext } from '../../../context/request/http-request.context';
import { Inject } from '../../../di/decorators/inject.decorator';
import { Injectable } from '../../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { ErrorUtilities } from '../../../error-handling/error.utilities';
import { InternalError } from '../../../error-handling/internal-error.model';
import { FileReferenceUtilities, type PendingFileReference } from '../../../file/file-reference.utilities';
import { GlobalRegistry } from '../../../global/global-registry';
import { HttpStatus } from '../../../http/http-status.enum';
import { MimeType } from '../../../http/mime-type.enum';
import { $ts } from '../../../localization/translate.function';
import { AuditAction, AuditOutcome, AuditReason } from '../../../logging/audit-event.model';
import { AuditUtilities } from '../../../logging/audit.utilities';
import { type LoggerInterface } from '../../../logging/logger.interface';
import { OpenApiSchemaUtilities } from '../../../open-api/open-api-schema.utilities';
import { parseObject } from '../../../parsing/functions/parse-object.function';
import { DeclaredResponseUtilities } from '../../../routing/declared-response.utilities';
import { type JsonBodyMetadata, type XmlBodyMetadata } from '../../../routing/decorators/body-metadata.model';
import { resolveStructuredBodyMetadata } from '../../../routing/resolve-body-metadata.function';
import { JsonUtilities } from '../../../utilities/json.utilities';
import { ZIBRI_APPROVAL_PLUGIN_DI_TOKENS } from '../../approval/approval.tokens';
import { type ApprovalRequestDetails } from '../../approval/models/approval-request-details.model';
import { McpToolUtilities } from '../mcp-tool.utilities';
import { ZIBRI_MCP_PLUGIN_DI_TOKENS } from '../mcp.tokens';
import { type McpAnswer } from '../models/mcp-answer.model';
import { McpJsonRpcMessage } from '../models/mcp-json-rpc-message.model';
import { type McpPluginOptions } from '../models/mcp-plugin-options.model';
import { type McpProposal } from '../models/mcp-proposal.model';
import { MCP_PROTOCOL_REVISIONS } from '../models/mcp-protocol-revisions.model';
import { type McpTool } from '../models/mcp-tool.model';
import { type McpServiceInterface } from './mcp-service.interface';

/**
 * The error codes of JSON-RPC and of the Model Context Protocol the server answers with.
 */
enum McpErrorCode {
    INVALID_REQUEST = -32_600,
    METHOD_NOT_FOUND = -32_601,
    INVALID_PARAMS = -32_602,
    INTERNAL_ERROR = -32_603,
    HEADER_MISMATCH = -32_020,
    UNSUPPORTED_PROTOCOL_VERSION = -32_022
}

/**
 * The keys of `_meta` a request of a stateless revision names its revision and its client by, and a result the server
 * by.
 */
const META: Readonly<Record<'PROTOCOL_VERSION' | 'CLIENT_CAPABILITIES' | 'SERVER_INFO', string>> = {
    PROTOCOL_VERSION: 'io.modelcontextprotocol/protocolVersion',
    CLIENT_CAPABILITIES: 'io.modelcontextprotocol/clientCapabilities',
    SERVER_INFO: 'io.modelcontextprotocol/serverInfo'
};

/**
 * The revision a request without a header of its revision is of, when it starts with no handshake (2025-11-25,
 * transports): one the server does not speak.
 */
const UNNAMED_REVISION: string = '2025-03-26';

/**
 * How a header value is written when it is not plain ASCII, around the value in base64.
 */
const BASE64_HEADER: RegExp = /^=\?base64\?(.*)\?=$/;

/**
 * What a message is, once it is known to be a request of a method.
 */
type McpRequest = {
    /**
     * The id, or undefined for a notification.
     */
    id: string | number | undefined,
    /**
     * The method.
     */
    method: string,
    /**
     * The parameters, an empty object when there are none.
     */
    params: Record<string, unknown>
};

/**
 * Who the server is, as a client is told.
 */
type McpServerInfo = {
    /**
     * The name of the application.
     */
    name: string,
    /**
     * The version of the application.
     */
    version: string
};

/**
 * Default implementation of the MCP service: the Streamable HTTP transport answering every request with JSON, and the
 * tools of the server, for every revision of `MCP_PROTOCOL_REVISIONS`.
 */
@Injectable({ register: 'onUse' })
export class McpService implements McpServiceInterface {
    private tools: Map<string, McpTool> | undefined;

    constructor(
        @Inject(ZIBRI_MCP_PLUGIN_DI_TOKENS.OPTIONS)
        protected readonly options: McpPluginOptions,
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        protected readonly logger: LoggerInterface
    ) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    findTools(user: CurrentUser): McpTool[] {
        this.tools ??= McpToolUtilities.resolveRegisteredTools();
        // the permissions of the credential, narrowed to what the roles of the caller carry in the tenant of the
        // request, which is what a route checking the permission checks
        return [...this.tools.values()].filter(tool => user.permissions.includes(McpToolUtilities.getPermission(tool)));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async handle(message: McpJsonRpcMessage, user: CurrentUser, context: HttpRequestContext): Promise<McpAnswer> {
        const request: McpRequest | McpAnswer = this.resolveRequest(message);
        if (!('method' in request)) {
            return request;
        }
        const meta: Record<string, unknown> | undefined = this.isRecord(request.params['_meta']) ? request.params['_meta'] : undefined;
        const header: string | undefined = context.request.get('mcp-protocol-version');
        // a request naming its revision in _meta is of a stateless revision, and so is one whose header names one: a
        // request of such a revision without it is refused as one, rather than read as one of a handshake
        return meta?.[META.PROTOCOL_VERSION] != undefined || (header != undefined && MCP_PROTOCOL_REVISIONS.stateless.includes(header))
            ? await this.handleStateless(request, meta, header, user, context)
            : await this.handleWithHandshake(request, header, user);
    }

    /**
     * Answers a request of a revision that names itself on every request.
     * @param request - The request.
     * @param meta - The `_meta` of its parameters.
     * @param header - The revision its header names.
     * @param user - The caller.
     * @param context - The request, for its headers.
     * @returns The answer.
     */
    protected async handleStateless(
        request: McpRequest,
        meta: Record<string, unknown> | undefined,
        header: string | undefined,
        user: CurrentUser,
        context: HttpRequestContext
    ): Promise<McpAnswer> {
        const revision: unknown = meta?.[META.PROTOCOL_VERSION];
        if (typeof revision !== 'string') {
            return this.error(
                HttpStatus.BAD_REQUEST,
                request.id,
                McpErrorCode.INVALID_PARAMS,
                $ts`The request needs the protocol version in its _meta.`
            );
        }
        if (header !== revision) {
            return this.error(
                HttpStatus.BAD_REQUEST,
                request.id,
                McpErrorCode.HEADER_MISMATCH,
                $ts`The MCP-Protocol-Version header needs to name the protocol version of the _meta of the request.`
            );
        }
        if (!MCP_PROTOCOL_REVISIONS.stateless.includes(revision)) {
            return this.unsupportedRevision(request.id, revision);
        }
        if (!this.isRecord(meta?.[META.CLIENT_CAPABILITIES])) {
            return this.error(
                HttpStatus.BAD_REQUEST,
                request.id,
                McpErrorCode.INVALID_PARAMS,
                $ts`The request needs the capabilities of its client in its _meta.`
            );
        }
        if (request.id == undefined) {
            return { status: HttpStatus.ACCEPTED, body: undefined };
        }
        if (context.request.get('mcp-method') !== request.method) {
            return this.error(
                HttpStatus.BAD_REQUEST,
                request.id,
                McpErrorCode.HEADER_MISMATCH,
                $ts`The Mcp-Method header needs to name the method of the request.`
            );
        }
        switch (request.method) {
            case 'server/discover': {
                return this.result(request.id, true, {
                    supportedVersions: [...MCP_PROTOCOL_REVISIONS.stateless, ...MCP_PROTOCOL_REVISIONS.handshake],
                    capabilities: { tools: {} },
                    ...this.options.instructions == undefined ? {} : { instructions: this.options.instructions },
                    // the same for every caller, and read whenever a client asks
                    ttlMs: 0,
                    cacheScope: 'public'
                });
            }
            case 'tools/list': {
                return this.listTools(request, user, true);
            }
            case 'tools/call': {
                return this.decodeHeader(context.request.get('mcp-name')) !== request.params['name']
                    ? this.error(
                        HttpStatus.BAD_REQUEST,
                        request.id,
                        McpErrorCode.HEADER_MISMATCH,
                        $ts`The Mcp-Name header needs to name the tool of the request.`
                    )
                    : await this.callTool(request, user, true);
            }
            default: {
                return this.error(
                    HttpStatus.NOT_FOUND,
                    request.id,
                    McpErrorCode.METHOD_NOT_FOUND,
                    $ts`The method "${request.method}" does not exist.`
                );
            }
        }
    }

    /**
     * Answers a request of a revision whose client starts with `initialize`. Nothing is kept of the handshake: the
     * server mints no session, and every later request names its revision in its header.
     * @param request - The request.
     * @param header - The revision its header names.
     * @param user - The caller.
     * @returns The answer.
     */
    protected async handleWithHandshake(request: McpRequest, header: string | undefined, user: CurrentUser): Promise<McpAnswer> {
        if (request.method === 'initialize') {
            const asked: unknown = request.params['protocolVersion'];
            // the one asked for when the server speaks it, its latest otherwise, for the client to accept or leave
            const revision: string = typeof asked === 'string' && MCP_PROTOCOL_REVISIONS.handshake.includes(asked)
                ? asked
                : MCP_PROTOCOL_REVISIONS.handshake[0] ?? '';
            return this.result(request.id, false, {
                protocolVersion: revision,
                capabilities: { tools: {} },
                serverInfo: this.getServerInfo(),
                ...this.options.instructions == undefined ? {} : { instructions: this.options.instructions }
            });
        }
        const revision: string = header ?? UNNAMED_REVISION;
        if (!MCP_PROTOCOL_REVISIONS.handshake.includes(revision)) {
            return this.unsupportedRevision(request.id, revision);
        }
        // the notification that the handshake is done, and any other, which asks nothing of a server of tools
        if (request.id == undefined) {
            return { status: HttpStatus.ACCEPTED, body: undefined };
        }
        switch (request.method) {
            case 'ping': {
                return this.result(request.id, false, {});
            }
            case 'tools/list': {
                return this.listTools(request, user, false);
            }
            case 'tools/call': {
                return await this.callTool(request, user, false);
            }
            default: {
                return this.error(
                    HttpStatus.OK,
                    request.id,
                    McpErrorCode.METHOD_NOT_FOUND,
                    $ts`The method "${request.method}" does not exist.`
                );
            }
        }
    }

    /**
     * Answers `tools/list` with every tool the caller sees, on one page.
     * @param request - The request.
     * @param user - The caller.
     * @param stateless - Whether the request is of a stateless revision, whose results say what they are.
     * @returns The answer.
     */
    protected listTools(request: McpRequest, user: CurrentUser, stateless: boolean): McpAnswer {
        // every tool on the first page, so a cursor is none the server handed out
        if (request.params['cursor'] != undefined) {
            return this.error(HttpStatus.OK, request.id, McpErrorCode.INVALID_PARAMS, $ts`The cursor is unknown.`);
        }
        const tools: object[] = this.findTools(user).map(tool => ({
            name: tool.name,
            ...tool.title == undefined ? {} : { title: tool.title },
            description: tool.description,
            inputSchema: OpenApiSchemaUtilities.resolveModelSchema(McpToolUtilities.getInput(tool), 'request'),
            outputSchema: OpenApiSchemaUtilities.resolveModelSchema(McpToolUtilities.getOutput(tool), 'response'),
            annotations: { readOnlyHint: tool.kind === 'read' }
        }));
        // the tools of this caller's permissions, read again whenever the client asks
        return this.result(request.id, stateless, { tools, ...stateless ? { ttlMs: 0, cacheScope: 'private' } : {} });
    }

    /**
     * Answers `tools/call`: refuses a tool the caller does not see like one that does not exist, validates the
     * arguments, and reads, or proposes the action of a write tool. Every call is recorded as `mcp.tool.called`.
     * @param request - The request.
     * @param user - The caller.
     * @param stateless - Whether the request is of a stateless revision, whose results say what they are.
     * @returns The answer.
     */
    protected async callTool(request: McpRequest, user: CurrentUser, stateless: boolean): Promise<McpAnswer> {
        const name: unknown = request.params['name'];
        // a tool the caller lacks the permission of is not one of theirs, and is refused without saying it exists
        const tool: McpTool | undefined = this.findTools(user).find(t => t.name === name);
        if (tool == undefined) {
            const exists: boolean = typeof name === 'string' && this.tools?.has(name) === true;
            this.recordCall(
                typeof name === 'string' ? name : undefined,
                user,
                AuditOutcome.FAILURE,
                exists ? AuditReason.MISSING_PERMISSION : AuditReason.REFUSED,
                undefined
            );
            return this.error(HttpStatus.OK, request.id, McpErrorCode.INVALID_PARAMS, $ts`The tool "${String(name)}" does not exist.`);
        }
        try {
            const input: object = await this.resolveInput(tool, request.params['arguments'] ?? {});
            const output: object = tool.kind === 'read'
                ? await this.resolveOutput(tool.output, await tool.read(input, user))
                : await this.propose(tool.action.name, input);
            const approvalRequestId: string | undefined = tool.kind === 'write' && 'approvalRequestId' in output
                ? String(output.approvalRequestId)
                : undefined;
            this.recordCall(tool.name, user, AuditOutcome.SUCCESS, undefined, approvalRequestId);
            return this.result(request.id, stateless, {
                content: [{ type: 'text', text: JsonUtilities.stringify(output) }],
                structuredContent: output,
                isError: false
            });
        }
        catch (error) {
            this.recordCall(tool.name, user, AuditOutcome.FAILURE, AuditUtilities.resolveReason(error), undefined);
            // a refusal, such as arguments that are not of the model, is something the model can act on
            if (ErrorUtilities.isRefusal(error)) {
                return this.result(request.id, stateless, { content: [{ type: 'text', text: error.message }], isError: true });
            }
            this.logger.error(new InternalError(`The MCP tool "${tool.name}" failed.`, { cause: error }));
            return this.error(HttpStatus.OK, request.id, McpErrorCode.INTERNAL_ERROR, $ts`The tool failed.`);
        }
    }

    /**
     * Proposes the action of a write tool as the caller, in the tenant of the request.
     * @param action - The name of the action.
     * @param input - The arguments, validated.
     * @returns The approval request it created.
     */
    protected async propose(action: string, input: object): Promise<McpProposal> {
        // proposed by the service account, which the request names as its proposer, and which never approves it: it
        // has no login, and a route taking a second factor is closed to it
        const proposed: ApprovalRequestDetails = await inject(ZIBRI_APPROVAL_PLUGIN_DI_TOKENS.APPROVAL_REQUEST_SERVICE)
            .propose({ action, input, reason: null });
        return { approvalRequestId: proposed.request.id, status: proposed.request.status };
    }

    /**
     * Reads the arguments of a call into the model of a tool, the way a json body of it is read, and validates them.
     * @param tool - The tool.
     * @param raw - The arguments as they were sent.
     * @returns The arguments.
     * @throws A `ValidationError` when they are not of the model.
     */
    protected async resolveInput(tool: McpTool, raw: unknown): Promise<object> {
        const model: ReturnType<typeof McpToolUtilities.getInput> = McpToolUtilities.getInput(tool);
        const input: unknown = parseObject(raw, model);
        const metadata: JsonBodyMetadata | XmlBodyMetadata = resolveStructuredBodyMetadata({ type: MimeType.JSON, modelClass: model }, 0);
        await inject(ZIBRI_DI_TOKENS.VALIDATION_SERVICE).validateBody(input, metadata);
        if (typeof input !== 'object' || input == undefined) {
            throw new InternalError(`The arguments of the MCP tool "${tool.name}" were read as no object.`);
        }
        return input;
    }

    /**
     * What a read tool answered, with only the properties its output model declares, as a route answers a model.
     * @param model - The output model.
     * @param output - What the tool answered.
     * @returns The output.
     */
    protected async resolveOutput(model: ReturnType<typeof McpToolUtilities.getOutput>, output: object): Promise<object> {
        const files: PendingFileReference[] = [];
        const declared: unknown = DeclaredResponseUtilities.resolveDeclaredValue(output, [model], files);
        await FileReferenceUtilities.resolveReferences(files);
        return this.isRecord(declared) ? declared : output;
    }

    /**
     * Records a call of a tool.
     * @param tool - The name of the tool, as it was called.
     * @param user - The caller.
     * @param outcome - Whether it was answered.
     * @param reason - Why not, when it was not.
     * @param approvalRequestId - The approval request a write tool proposed.
     */
    protected recordCall(
        tool: string | undefined,
        user: CurrentUser,
        outcome: AuditOutcome,
        reason: AuditReason | undefined,
        approvalRequestId: string | undefined
    ): void {
        inject(ZIBRI_DI_TOKENS.AUDIT_SERVICE).record({
            action: AuditAction.MCP_TOOL_CALLED,
            outcome,
            reason,
            subject: tool,
            userId: user.id,
            userKind: UserKindUtilities.getKind(user),
            approvalRequestId
        });
    }

    /**
     * Reads a message as a request of a method, or answers what it is instead.
     * @param message - The message.
     * @returns The request, or the answer to a message that is none.
     */
    private resolveRequest(message: McpJsonRpcMessage): McpRequest | McpAnswer {
        const id: unknown = message.id;
        const answerId: string | number | undefined = typeof id === 'string' || typeof id === 'number' ? id : undefined;
        if (message.jsonrpc !== '2.0') {
            return this.error(
                HttpStatus.BAD_REQUEST,
                answerId,
                McpErrorCode.INVALID_REQUEST,
                $ts`The message needs to be of JSON-RPC 2.0.`
            );
        }
        if (typeof message.method !== 'string') {
            // a response of the client, which a server sending no requests has nothing to match with
            return message.result !== undefined || message.error !== undefined
                ? { status: HttpStatus.ACCEPTED, body: undefined }
                : this.error(HttpStatus.BAD_REQUEST, answerId, McpErrorCode.INVALID_REQUEST, $ts`The message needs a method.`);
        }
        if (id !== undefined && answerId == undefined) {
            return this.error(
                HttpStatus.BAD_REQUEST,
                undefined,
                McpErrorCode.INVALID_REQUEST,
                $ts`The id of a request needs to be a string or a number.`
            );
        }
        return message.params !== undefined && !this.isRecord(message.params)
            ? this.error(
                HttpStatus.BAD_REQUEST,
                answerId,
                McpErrorCode.INVALID_PARAMS,
                $ts`The params of a request need to be an object.`
            )
            : { id: answerId, method: message.method, params: message.params ?? {} };
    }

    /**
     * Answers a request of a revision the server does not speak, with the ones it does.
     * @param id - The id of the request.
     * @param revision - The revision it named.
     * @returns The answer.
     */
    private unsupportedRevision(id: string | number | undefined, revision: string): McpAnswer {
        return this.error(
            HttpStatus.BAD_REQUEST,
            id,
            McpErrorCode.UNSUPPORTED_PROTOCOL_VERSION,
            $ts`The protocol version is not supported.`,
            { supported: [...MCP_PROTOCOL_REVISIONS.stateless, ...MCP_PROTOCOL_REVISIONS.handshake], requested: revision }
        );
    }

    /**
     * A result.
     * @param id - The id of the request.
     * @param stateless - Whether the request is of a stateless revision, whose results say what they are and who
     * the server is.
     * @param result - What the method answers.
     * @returns The answer.
     */
    private result(id: string | number | undefined, stateless: boolean, result: object): McpAnswer {
        return {
            status: HttpStatus.OK,
            body: {
                jsonrpc: '2.0',
                id,
                result: stateless
                    ? { resultType: 'complete', ...result, _meta: { [META.SERVER_INFO]: this.getServerInfo() } }
                    : result
            }
        };
    }

    /**
     * An error.
     * @param status - The status of the HTTP response.
     * @param id - The id of the request, undefined when it could not be read.
     * @param code - The code of the error.
     * @param message - What went wrong.
     * @param data - What the error carries besides.
     * @returns The answer.
     */
    private error(status: HttpStatus, id: string | number | undefined, code: McpErrorCode, message: string, data?: object): McpAnswer {
        return { status, body: { jsonrpc: '2.0', id: id ?? null, error: { code, message, ...data == undefined ? {} : { data } } } };
    }

    /**
     * Who the server is: the name and the version of the application.
     * @returns The name and the version.
     */
    private getServerInfo(): McpServerInfo {
        return { name: GlobalRegistry.getAppData('name') ?? 'zibri', version: GlobalRegistry.getAppData('version') ?? '0.0.0' };
    }

    /**
     * A header value as it was meant, the base64 of one that is not plain ASCII decoded.
     * @param value - The header value.
     * @returns The value.
     */
    private decodeHeader(value: string | undefined): string | undefined {
        const encoded: string | undefined = value == undefined ? undefined : BASE64_HEADER.exec(value)?.[1];
        return encoded == undefined ? value : Buffer.from(encoded, 'base64').toString('utf8');
    }

    private isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === 'object' && value != undefined && !Array.isArray(value);
    }
}