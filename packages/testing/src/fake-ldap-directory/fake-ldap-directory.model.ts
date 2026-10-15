import { randomUUID } from 'node:crypto';
import { AddressInfo, createServer, Server, Socket } from 'node:net';
import { createServer as createTlsServer, Server as TlsServer, TLSSocket } from 'node:tls';

import { AndFilter,
    Attribute,
    BerReader,
    BerWriter,
    BindRequest,
    EqualityFilter,
    ExtendedRequest,
    ExtensibleFilter,
    Filter,
    NotFilter,
    OrFilter,
    PresenceFilter,
    ProtocolOperation,
    SearchRequest,
    SubstringFilter } from 'ldapts';

import { FakeLdapBind } from './fake-ldap-bind.model';
import { FakeLdapDirectoryOptions } from './fake-ldap-directory-options.model';
import { FakeLdapEntry } from './fake-ldap-entry.model';
import { FakeLdapSearch } from './fake-ldap-search.model';
import { createFakeKeyPair } from '../create-fake-key-pair.function';
import { FakeKeyPair } from '../fake-key-pair.model';

/**
 * The result codes of RFC 4511 the directory answers with.
 */
enum ResultCode {
    SUCCESS = 0,
    OPERATIONS_ERROR = 1,
    PROTOCOL_ERROR = 2,
    SIZE_LIMIT_EXCEEDED = 4,
    CONFIDENTIALITY_REQUIRED = 13,
    CONSTRAINT_VIOLATION = 19,
    NO_SUCH_OBJECT = 32,
    INVALID_CREDENTIALS = 49,
    INSUFFICIENT_ACCESS_RIGHTS = 50,
    UNWILLING_TO_PERFORM = 53
}

/**
 * What a refused bind is answered with.
 */
type Refusal = {
    /**
     * The result code.
     */
    code: ResultCode,
    /**
     * The diagnostic message.
     */
    message: string
};

/**
 * Which port takes which kind of connection.
 */
type Ports = {
    /**
     * The port of connections that start in the clear.
     */
    plain: number,
    /**
     * The port of connections encrypted from the first byte.
     */
    tls: number
};

/**
 * How a locked account's bind is answered, by the name of the result code.
 */
const LOCKED_ANSWERS: Record<NonNullable<FakeLdapEntry['lockedWith']>, Refusal> = {
    invalidCredentials: { code: ResultCode.INVALID_CREDENTIALS, message: 'AcceptSecurityContext error, data 533' },
    unwillingToPerform: { code: ResultCode.UNWILLING_TO_PERFORM, message: 'Account inactivated. Contact system administrator.' },
    constraintViolation: { code: ResultCode.CONSTRAINT_VIOLATION, message: 'Exceed password retry limit. Please try later.' }
};

/**
 * The extended operation that upgrades a connection to TLS.
 */
const START_TLS_OID: string = '1.3.6.1.4.1.1466.20037';

/**
 * The matching rule of Active Directory that follows a group's members through the groups among them.
 */
const IN_CHAIN_RULE: string = '1.2.840.113556.1.4.1941';

/**
 * The attributes only sent when a search names them.
 */
const OPERATIONAL_ATTRIBUTES: Set<string> = new Set(['entryuuid']);

/**
 * The host the directory listens on.
 */
const HOST: string = '127.0.0.1';

/**
 * What a connection knows about itself.
 */
type Connection = {
    /**
     * Whether it is encrypted.
     */
    encrypted: boolean,
    /**
     * Who it is bound as with a password, if anybody.
     */
    boundAs: string | undefined,
    /**
     * What arrived and is not a whole message yet.
     */
    pending: Buffer
};

/**
 * A directory in the test's own process, speaking LDAP over TLS: on one port from the first byte, on
 * another after StartTLS. A bind in the clear is refused, a bind with a name and no password succeeds
 * without binding as anybody, and only a connection bound with a password may search, the way a
 * hardened directory behaves.
 */
export class FakeLdapDirectory {
    /**
     * Every bind it was asked for, in order.
     */
    readonly binds: FakeLdapBind[] = [];

    /**
     * Every search it was asked for, in order.
     */
    readonly searches: FakeLdapSearch[] = [];

    private readonly plainServer: Server;
    private readonly tlsServer: TlsServer;
    private readonly sockets: Set<Socket> = new Set();
    private ports: Ports | undefined;

    private constructor(
        /**
         * The entries of the directory, which a test may change while it runs.
         */
        readonly entries: FakeLdapEntry[],
        private readonly key: FakeKeyPair
    ) {
        this.plainServer = createServer(socket => this.serve(socket, false));
        this.tlsServer = createTlsServer({ key: key.privateKey, cert: key.certificate }, socket => this.serve(socket, true));
    }

    /**
     * The certificate the directory proves who it is with, PEM encoded, which a client has to trust.
     * @returns The certificate.
     */
    get certificate(): string {
        return this.key.certificate;
    }

    /**
     * Where the directory takes connections that start in the clear and are upgraded with StartTLS.
     * @returns The url.
     */
    get ldapUrl(): string {
        return `ldap://${HOST}:${this.getPorts().plain}`;
    }

    /**
     * Where the directory takes connections that are encrypted from the first byte.
     * @returns The url.
     */
    get ldapsUrl(): string {
        return `ldaps://${HOST}:${this.getPorts().tls}`;
    }

    /**
     * Builds a directory, with a certificate made for it.
     * @param options - The entries of the directory.
     * @returns The directory, not listening yet.
     */
    static async create(options: FakeLdapDirectoryOptions): Promise<FakeLdapDirectory> {
        const entries: FakeLdapEntry[] = options.entries.map(entry => {
            const hasId: boolean = Object.keys(entry.attributes).some(name => name.toLowerCase() === 'entryuuid');
            return hasId ? entry : { ...entry, attributes: { ...entry.attributes, entryUUID: [randomUUID()] } };
        });
        // a name of its own: a client that trusts two directories looks a certificate up by its name, and
        // refuses one checked against the other's
        const key: FakeKeyPair = await createFakeKeyPair(`CN=Fake directory ${randomUUID()}`, { hosts: [HOST, 'localhost'] });
        return new FakeLdapDirectory(entries, key);
    }

    /**
     * Starts listening on two free ports of the loopback interface.
     */
    async listen(): Promise<void> {
        const [plain, tls] = await Promise.all([this.plainServer, this.tlsServer].map(async server => {
            await new Promise<void>(resolve => server.listen(0, HOST, resolve));
            const address: AddressInfo | string | null = server.address();
            if (address == undefined || typeof address === 'string') {
                throw new Error('The fake directory is not listening on a port.');
            }
            return address.port;
        }));
        this.ports = { plain: plain ?? 0, tls: tls ?? 0 };
    }

    /**
     * Stops listening, and closes every connection.
     */
    async stop(): Promise<void> {
        for (const socket of this.sockets) {
            socket.destroy();
        }
        await Promise.all([this.plainServer, this.tlsServer].map(server => new Promise<void>(resolve => server.close(() => resolve()))));
    }

    private getPorts(): Ports {
        if (this.ports == undefined) {
            throw new Error('The fake directory is not listening yet.');
        }
        return this.ports;
    }

    private serve(socket: Socket, encrypted: boolean): void {
        const connection: Connection = { encrypted, boundAs: undefined, pending: Buffer.alloc(0) };
        this.sockets.add(socket);
        socket.once('close', () => this.sockets.delete(socket));
        socket.on('error', () => socket.destroy());
        const onData: (data: Buffer) => void = data => {
            connection.pending = Buffer.concat([connection.pending, data]);
            let message: Buffer | undefined = FakeLdapDirectory.takeMessage(connection);
            while (message != undefined) {
                if (this.answer(socket, connection, message, onData) === 'upgraded') {
                    return;
                }
                message = FakeLdapDirectory.takeMessage(connection);
            }
        };
        socket.on('data', onData);
    }

    /**
     * Answers one message.
     * @param socket - The connection it came in on.
     * @param connection - What the connection knows about itself.
     * @param message - The message, whole.
     * @param onData - What reads the connection, which an upgrade to TLS stops.
     * @returns Whether the connection was upgraded to TLS, after which nothing more is read from it here.
     */
    private answer(socket: Socket, connection: Connection, message: Buffer, onData: (data: Buffer) => void): 'answered' | 'upgraded' {
        const reader: BerReader = new BerReader(message);
        reader.readSequence();
        const messageId: number = reader.readInt() ?? 0;
        const operation: number | null = reader.readSequence();
        if (operation == undefined) {
            socket.destroy();
            return 'answered';
        }
        switch (operation) {
            case ProtocolOperation.LDAP_REQ_BIND: {
                const request: BindRequest = new BindRequest({ messageId });
                try {
                    request.parseMessage(reader);
                }
                catch {
                    socket.write(FakeLdapDirectory.result(messageId, ProtocolOperation.LDAP_RES_BIND, ResultCode.PROTOCOL_ERROR));
                    return 'answered';
                }
                socket.write(this.bind(connection, request));
                return 'answered';
            }
            case ProtocolOperation.LDAP_REQ_SEARCH: {
                const request: SearchRequest = new SearchRequest({ messageId, filter: new PresenceFilter({ attribute: 'objectclass' }) });
                request.parseMessage(reader);
                socket.write(this.search(connection, request));
                return 'answered';
            }
            case ProtocolOperation.LDAP_REQ_EXTENSION: {
                const request: ExtendedRequest = new ExtendedRequest({ messageId });
                request.parseMessage(reader);
                if (request.oid !== START_TLS_OID || connection.encrypted) {
                    socket.write(FakeLdapDirectory.result(messageId, ProtocolOperation.LDAP_RES_EXTENSION, ResultCode.OPERATIONS_ERROR));
                    return 'answered';
                }
                socket.removeListener('data', onData);
                socket.write(FakeLdapDirectory.result(messageId, ProtocolOperation.LDAP_RES_EXTENSION, ResultCode.SUCCESS));
                // what comes next is the client starting TLS on the same connection
                this.serve(new TLSSocket(socket, { isServer: true, key: this.key.privateKey, cert: this.key.certificate }), true);
                return 'upgraded';
            }
            case ProtocolOperation.LDAP_REQ_UNBIND: {
                socket.end();
                return 'answered';
            }
            default: {
                socket.destroy();
                return 'answered';
            }
        }
    }

    private bind(connection: Connection, request: BindRequest): Buffer {
        const succeed: (boundAs: string | undefined) => Buffer = boundAs => {
            this.binds.push({ dn: request.dn, withPassword: !!request.password, encrypted: connection.encrypted, succeeded: true });
            connection.boundAs = boundAs;
            return FakeLdapDirectory.result(request.messageId, ProtocolOperation.LDAP_RES_BIND, ResultCode.SUCCESS);
        };
        const refuse: (code: ResultCode, message: string) => Buffer = (code, message) => {
            this.binds.push({ dn: request.dn, withPassword: !!request.password, encrypted: connection.encrypted, succeeded: false });
            connection.boundAs = undefined;
            return FakeLdapDirectory.result(request.messageId, ProtocolOperation.LDAP_RES_BIND, code, message);
        };
        if (!connection.encrypted) {
            return refuse(ResultCode.CONFIDENTIALITY_REQUIRED, 'TLS confidentiality required');
        }
        // an anonymous bind, or an unauthenticated one: a name without a password binds as nobody, and
        // succeeds (RFC 4513, 5.1.2)
        if (!request.password) {
            return succeed(undefined);
        }
        const entry: FakeLdapEntry | undefined = this.findEntry(request.dn);
        if (entry?.lockedWith != undefined) {
            const locked: Refusal = LOCKED_ANSWERS[entry.lockedWith];
            return refuse(locked.code, locked.message);
        }
        if (entry?.password !== request.password) {
            return refuse(ResultCode.INVALID_CREDENTIALS, 'AcceptSecurityContext error, data 52e');
        }
        return succeed(entry.dn);
    }

    private search(connection: Connection, request: SearchRequest): Buffer {
        this.searches.push({ baseDn: request.baseDN, filter: request.filter.toString(), boundAs: connection.boundAs });
        if (connection.boundAs == undefined) {
            return FakeLdapDirectory.result(request.messageId, ProtocolOperation.LDAP_RES_SEARCH, ResultCode.INSUFFICIENT_ACCESS_RIGHTS);
        }
        const base: string = FakeLdapDirectory.normalize(request.baseDN);
        if (!this.entries.some(entry => FakeLdapDirectory.normalize(entry.dn).endsWith(base))) {
            return FakeLdapDirectory.result(request.messageId, ProtocolOperation.LDAP_RES_SEARCH, ResultCode.NO_SUCH_OBJECT);
        }
        const found: FakeLdapEntry[] = this.entries
            .filter(entry => FakeLdapDirectory.isInScope(FakeLdapDirectory.normalize(entry.dn), base, request.scope))
            .filter(entry => this.matches(request.filter, entry));
        const sent: FakeLdapEntry[] = request.sizeLimit > 0 ? found.slice(0, request.sizeLimit) : found;
        return Buffer.concat([
            ...sent.map(entry => FakeLdapDirectory.searchEntry(request, entry)),
            FakeLdapDirectory.result(
                request.messageId,
                ProtocolOperation.LDAP_RES_SEARCH,
                sent.length < found.length ? ResultCode.SIZE_LIMIT_EXCEEDED : ResultCode.SUCCESS
            )
        ]);
    }

    private findEntry(dn: string): FakeLdapEntry | undefined {
        return this.entries.find(entry => FakeLdapDirectory.normalize(entry.dn) === FakeLdapDirectory.normalize(dn));
    }

    /**
     * Whether an entry matches a filter, comparing names and values without regard to case.
     * @param filter - The filter.
     * @param entry - The entry.
     * @returns Whether it matches.
     */
    private matches(filter: Filter, entry: FakeLdapEntry): boolean {
        if (filter instanceof AndFilter) {
            return filter.filters.every(part => this.matches(part, entry));
        }
        if (filter instanceof OrFilter) {
            return filter.filters.some(part => this.matches(part, entry));
        }
        if (filter instanceof NotFilter) {
            return !this.matches(filter.filter, entry);
        }
        if (filter instanceof PresenceFilter) {
            return FakeLdapDirectory.valuesOf(entry, filter.attribute).length > 0;
        }
        if (filter instanceof EqualityFilter) {
            const expected: string = (Buffer.isBuffer(filter.value) ? filter.value.toString('utf8') : filter.value).toLowerCase();
            return FakeLdapDirectory.valuesOf(entry, filter.attribute).some(value => value.toLowerCase() === expected);
        }
        if (filter instanceof SubstringFilter) {
            const escape: (text: string) => string = text => text.replaceAll(/[$()*+.?[\\\]^{|}]/g, '\\$&');
            const parts: string[] = [filter.initial, ...filter.any, filter.final].map(part => escape(part));
            const pattern: RegExp = new RegExp(`^${parts.join('.*')}$`, 'i');
            return FakeLdapDirectory.valuesOf(entry, filter.attribute).some(value => pattern.test(value));
        }
        if (filter instanceof ExtensibleFilter && filter.rule === IN_CHAIN_RULE) {
            return this.isMemberInChain(entry, filter.matchType, FakeLdapDirectory.normalize(filter.value), new Set());
        }
        return false;
    }

    /**
     * Whether an entry is listed in an attribute of a group, or of a group listed there, as deep as
     * they go.
     * @param group - The group.
     * @param attribute - The attribute that lists its members.
     * @param dn - The entry, normalized.
     * @param visited - The groups looked at already, normalized, so a loop of groups ends.
     * @returns Whether it is listed.
     */
    private isMemberInChain(group: FakeLdapEntry, attribute: string, dn: string, visited: Set<string>): boolean {
        const members: string[] = FakeLdapDirectory.valuesOf(group, attribute).map(member => FakeLdapDirectory.normalize(member));
        if (members.includes(dn)) {
            return true;
        }
        visited.add(FakeLdapDirectory.normalize(group.dn));
        return members.filter(member => !visited.has(member)).some(member => {
            const inner: FakeLdapEntry | undefined = this.findEntry(member);
            return inner != undefined && this.isMemberInChain(inner, attribute, dn, visited);
        });
    }

    /**
     * Takes the first whole message off what a connection received.
     * @param connection - The connection.
     * @returns The message, or undefined while it has not arrived whole.
     */
    private static takeMessage(connection: Connection): Buffer | undefined {
        const reader: BerReader = new BerReader(connection.pending);
        if (reader.readSequence() == undefined || reader.offset + reader.length > connection.pending.length) {
            return undefined;
        }
        const message: Buffer = connection.pending.subarray(0, reader.offset + reader.length);
        connection.pending = connection.pending.subarray(reader.offset + reader.length);
        return message;
    }

    private static result(messageId: number, operation: number, code: number, message: string = ''): Buffer {
        const writer: BerWriter = new BerWriter();
        writer.startSequence();
        writer.writeInt(messageId);
        writer.startSequence(operation);
        writer.writeEnumeration(code);
        writer.writeString('');
        writer.writeString(message);
        writer.endSequence();
        writer.endSequence();
        return writer.buffer;
    }

    private static searchEntry(request: SearchRequest, entry: FakeLdapEntry): Buffer {
        // ldapts reads the names that were asked for in lowercase
        const asked: string[] = request.attributes.map(name => name.toLowerCase());
        const everything: boolean = !asked.length || asked.includes('*');
        const writer: BerWriter = new BerWriter();
        writer.startSequence();
        writer.writeInt(request.messageId);
        writer.startSequence(ProtocolOperation.LDAP_RES_SEARCH_ENTRY);
        writer.writeString(entry.dn);
        writer.startSequence();
        for (const [type, values] of Object.entries(entry.attributes)) {
            const name: string = type.toLowerCase();
            if (asked.includes(name) || (everything && !OPERATIONAL_ATTRIBUTES.has(name))) {
                const buffers: Buffer[] = values.map(value => Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8'));
                new Attribute({ type, values: buffers }).write(writer);
            }
        }
        writer.endSequence();
        writer.endSequence();
        writer.endSequence();
        return writer.buffer;
    }

    private static isInScope(dn: string, base: string, scope: SearchRequest['scope']): boolean {
        switch (scope) {
            case 'base': {
                return dn === base;
            }
            case 'one': {
                return dn.endsWith(`,${base}`) && !dn.slice(0, -base.length - 1).includes(',');
            }
            case 'sub': {
                return dn === base || dn.endsWith(`,${base}`);
            }
            case 'children':
            case 'subordinates': {
                return dn.endsWith(`,${base}`);
            }
        }
    }

    private static valuesOf(entry: FakeLdapEntry, attribute: string): string[] {
        return Object.entries(entry.attributes)
            .filter(([name]) => name.toLowerCase() === attribute.toLowerCase())
            .flatMap(([, values]) => values.map(value => Buffer.isBuffer(value) ? value.toString('utf8') : value));
    }

    private static normalize(dn: string): string {
        return dn.split(',').map(part => part.trim().toLowerCase())
            .join(',');
    }
}