import { ScimBody } from './scim-body.model';
import { ScimEndpoint } from './scim-endpoint.model';
import { ScimErrorType } from './scim-error-type.enum';
import { ScimFilterUtilities } from './scim-filter.utilities';
import { ScimResourceResponse } from './scim-resource-response.model';
import { ScimSchema } from './scim-schema.enum';
import { ScimServiceInterface } from './scim-service.interface';
import { ScimError } from './scim.error';
import { HttpError } from '../../error-handling/errors/http.error';
import { HttpStatus } from '../../http/http-status.enum';
import { $ts } from '../../localization/translate.function';
import { type LoggerInterface } from '../../logging/logger.interface';

/**
 * The methods an operation of a bulk request may have.
 */
const BULK_METHODS: string[] = ['POST', 'PUT', 'PATCH', 'DELETE'];

/**
 * What a reference to a resource another operation of the same bulk request creates starts with.
 */
const BULK_ID_PREFIX: string = 'bulkId:';

/**
 * An operation of a bulk request (RFC 7644, 3.7), read.
 */
type ScimBulkOperation = {
    /**
     * Its position in the request.
     */
    index: number,
    // eslint-disable-next-line jsdoc/require-jsdoc
    method: string,
    // eslint-disable-next-line jsdoc/require-jsdoc
    bulkId: string | undefined,
    /**
     * The etag the resource has to have, if the operation names one.
     */
    version: string | undefined,
    // eslint-disable-next-line jsdoc/require-jsdoc
    path: string,
    // eslint-disable-next-line jsdoc/require-jsdoc
    data: unknown
};

/**
 * A bulk request as it is applied.
 */
type ScimBulkRun = {
    /**
     * What applies each operation, as a request of its own would.
     */
    service: ScimServiceInterface,
    /**
     * Where an operation that failed unexpectedly is reported.
     */
    logger: LoggerInterface,
    /**
     * The routes the request came through.
     */
    endpoint: ScimEndpoint,
    /**
     * After how many failed operations it stops, if it stops at all.
     */
    failOnErrors: number | undefined,
    /**
     * The id of every resource an operation created, by the bulkId it named.
     */
    created: Map<string, string>,
    /**
     * The result of every operation applied, by its position in the request.
     */
    results: Map<number, ScimBody>,
    /**
     * How many operations failed so far.
     */
    errors: number
};

/**
 * Applies the bulk requests of SCIM (RFC 7644, 3.7): operations that refer to the resources others
 * of the same request create, in an order that resolves those references.
 */
export abstract class ScimBulkUtilities {
    /**
     * Applies a bulk request, each operation as a request of its own would be.
     * @param service - What applies the operations.
     * @param logger - Where an operation that failed unexpectedly is reported.
     * @param endpoint - The routes the request came through.
     * @param body - The request.
     * @returns The bulk response, with the result of every operation in the order of the request.
     * @throws A ScimError when the request is no bulk request, or holds more operations than allowed.
     */
    static async apply(service: ScimServiceInterface, logger: LoggerInterface, endpoint: ScimEndpoint, body: unknown): Promise<ScimBody> {
        const run: ScimBulkRun = {
            service,
            logger,
            endpoint,
            failOnErrors: this.resolveFailOnErrors(body),
            created: new Map(),
            results: new Map(),
            errors: 0
        };
        let pending: ScimBulkOperation[] = this.resolveOperations(endpoint, body);
        // operations creating a resource without what refers to the others of a circle, and its id
        const unfinished: [ScimBulkOperation, string][] = [];
        while (pending.length && !this.isStopped(run)) {
            const deferred: ScimBulkOperation[] = await this.resolvePass(run, pending);
            if (deferred.length < pending.length) {
                pending = deferred;
                continue;
            }
            // operations that only wait for each other refer to each other in a circle, which creating
            // one of them without its references first breaks
            const breaker: ScimBulkOperation | undefined = this.findCircleBreaker(deferred);
            if (breaker == undefined) {
                for (const operation of deferred) {
                    run.results.set(operation.index, this.toError(run, operation, new ScimError(
                        HttpStatus.CONFLICT,
                        $ts`The operation refers in a circle to resources the request creates.`
                    )));
                }
                break;
            }
            const id: string | undefined = await this.resolveCircleBreak(run, breaker);
            if (id != undefined) {
                unfinished.push([breaker, id]);
            }
            pending = deferred.filter(operation => operation !== breaker);
        }
        // in order, each the rest of an operation already applied, and so even after a stop
        for (const [operation, id] of unfinished) {
            run.results.set(operation.index, await this.resolveCompletion(run, operation, id));
        }
        return {
            schemas: [ScimSchema.BULK_RESPONSE],
            Operations: [...run.results.entries()].sort(([a], [b]) => a - b).map(([, result]) => result)
        };
    }

    /**
     * Applies the operations of a bulk request whose references can be resolved, in order.
     * @param run - The bulk request being applied.
     * @param pending - The operations not applied yet.
     * @returns The operations that wait for a resource one of the others creates.
     */
    private static async resolvePass(run: ScimBulkRun, pending: ScimBulkOperation[]): Promise<ScimBulkOperation[]> {
        const waiting: Set<string> = new Set(pending.map(operation => operation.bulkId).filter(bulkId => bulkId != undefined));
        const deferred: ScimBulkOperation[] = [];
        for (const operation of pending) {
            if (this.isStopped(run)) {
                break;
            }
            const unresolved: string[] = this.findReferences(operation).filter(bulkId => !run.created.has(bulkId));
            // one created by an operation further on: this one waits for it
            if (unresolved.some(bulkId => waiting.has(bulkId) && bulkId !== operation.bulkId)) {
                deferred.push(operation);
                continue;
            }
            const result: ScimBody = unresolved.length
                ? this.toError(run, operation, new ScimError(
                    HttpStatus.CONFLICT,
                    $ts`The operation refers to bulkId ${unresolved.join(', ')}, which no operation of the request created.`
                ))
                : await this.resolveResult(run, operation);
            run.errors += this.isError(result) ? 1 : 0;
            run.results.set(operation.index, result);
        }
        return deferred;
    }

    /**
     * The operation of a circle to break: one creating a resource another of the circle refers to.
     * @param deferred - The operations of the circle, and those waiting for them.
     * @returns The operation, or undefined when none creates what the others wait for.
     */
    private static findCircleBreaker(deferred: ScimBulkOperation[]): ScimBulkOperation | undefined {
        const referenced: Set<string> = new Set(deferred.flatMap(operation => this.findReferences(operation)));
        return deferred.find(operation => operation.method === 'POST' && operation.bulkId != undefined && referenced.has(operation.bulkId));
    }

    /**
     * Creates the resource of an operation of a circle without what refers to the resources the
     * others create, so that they can be applied.
     * @param run - The bulk request being applied.
     * @param operation - The operation.
     * @returns The id of the resource, or undefined when it could not be created.
     */
    private static async resolveCircleBreak(run: ScimBulkRun, operation: ScimBulkOperation): Promise<string | undefined> {
        const unresolved: Set<string> = new Set(this.findReferences(operation).filter(bulkId => !run.created.has(bulkId)));
        const result: ScimBody = await this.resolveResult(run, { ...operation, data: this.withoutReferences(operation.data, unresolved) });
        run.errors += this.isError(result) ? 1 : 0;
        run.results.set(operation.index, result);
        return operation.bulkId == undefined ? undefined : run.created.get(operation.bulkId);
    }

    /**
     * Replaces the resource an operation of a circle created with the whole of its data, now that the
     * resources it refers to exist.
     * @param run - The bulk request being applied.
     * @param operation - The operation.
     * @param id - The id of the resource it created.
     * @returns The result of the operation.
     */
    private static async resolveCompletion(run: ScimBulkRun, operation: ScimBulkOperation, id: string): Promise<ScimBody> {
        const users: boolean = operation.path === '/Users';
        const unresolved: string[] = this.findReferences(operation).filter(bulkId => !run.created.has(bulkId));
        try {
            if (unresolved.length) {
                throw new ScimError(
                    HttpStatus.CONFLICT,
                    $ts`The operation refers to bulkId ${unresolved.join(', ')}, which no operation of the request created.`
                );
            }
            const data: unknown = this.replaceBulkIds(operation.data, run.created);
            const response: ScimResourceResponse = await this.resolveChange(run, 'PUT', users, id, data, undefined);
            return this.toResult(operation, response.location, response.version, HttpStatus.CREATED);
        }
        catch (error) {
            // the resource exists, without what referred to the others
            return { ...this.toError(run, operation, error), location: `${run.endpoint.url}${operation.path}/${id}` };
        }
    }

    /**
     * Reads the operations of a bulk request.
     * @param endpoint - The routes the request came through.
     * @param body - The request.
     * @returns The operations, in order.
     * @throws A ScimError when the request is no bulk request, or holds more operations than allowed.
     */
    private static resolveOperations(endpoint: ScimEndpoint, body: unknown): ScimBulkOperation[] {
        const invalid: (detail: string) => ScimError = detail => new ScimError(
            HttpStatus.BAD_REQUEST,
            $ts`${detail}`,
            ScimErrorType.INVALID_SYNTAX
        );
        const operations: unknown = ScimFilterUtilities.isRecord(body) ? this.findAttribute(body, 'Operations') : undefined;
        if (!Array.isArray(operations)) {
            throw invalid('A bulk request lists its Operations.');
        }
        if (operations.length > endpoint.maxBulkOperations) {
            throw new ScimError(
                HttpStatus.CONTENT_TOO_LARGE,
                $ts`A bulk request holds at most ${endpoint.maxBulkOperations} operations, this one ${operations.length}.`
            );
        }
        const bulkIds: Set<string> = new Set();
        return operations.map((operation: unknown, index): ScimBulkOperation => {
            if (!ScimFilterUtilities.isRecord(operation)) {
                throw invalid('An operation of a bulk request is a json object.');
            }
            const method: unknown = this.findAttribute(operation, 'method');
            const path: unknown = this.findAttribute(operation, 'path');
            const bulkId: unknown = this.findAttribute(operation, 'bulkId');
            const version: unknown = this.findAttribute(operation, 'version');
            if (typeof method !== 'string' || !BULK_METHODS.includes(method.toUpperCase()) || typeof path !== 'string') {
                throw invalid('An operation of a bulk request has a method, POST, PUT, PATCH or DELETE, and a path.');
            }
            if ((bulkId != undefined && typeof bulkId !== 'string') || (version != undefined && typeof version !== 'string')) {
                throw invalid('The bulkId and the version of an operation are strings.');
            }
            if (typeof bulkId === 'string') {
                if (bulkIds.has(bulkId)) {
                    throw invalid('Every bulkId of a bulk request is its own.');
                }
                bulkIds.add(bulkId);
            }
            return {
                index,
                method: method.toUpperCase(),
                bulkId: bulkId ?? undefined,
                version: version ?? undefined,
                path,
                data: this.findAttribute(operation, 'data')
            };
        });
    }

    /**
     * Reads after how many failed operations a bulk request stops.
     * @param body - The request.
     * @returns The number, or undefined to apply every operation whatever fails.
     * @throws A ScimError (invalidValue) when it is no whole number above 0.
     */
    private static resolveFailOnErrors(body: unknown): number | undefined {
        const failOnErrors: unknown = ScimFilterUtilities.isRecord(body) ? this.findAttribute(body, 'failOnErrors') : undefined;
        if (failOnErrors == undefined) {
            return undefined;
        }
        if (typeof failOnErrors !== 'number' || !Number.isInteger(failOnErrors) || failOnErrors < 1) {
            throw new ScimError(HttpStatus.BAD_REQUEST, $ts`failOnErrors is a whole number above 0.`, ScimErrorType.INVALID_VALUE);
        }
        return failOnErrors;
    }

    private static isStopped(run: ScimBulkRun): boolean {
        return run.failOnErrors != undefined && run.errors >= run.failOnErrors;
    }

    private static isError(result: ScimBody): boolean {
        return typeof result['status'] === 'string' && Number(result['status']) >= 400;
    }

    /**
     * Applies one operation of a bulk request, answering what it did or why it failed.
     * @param run - The bulk request being applied. An operation creating a resource adds its id to the
     * created ones.
     * @param operation - The operation.
     * @returns The result of the operation.
     */
    private static async resolveResult(run: ScimBulkRun, operation: ScimBulkOperation): Promise<ScimBody> {
        const { service, endpoint, created } = run;
        try {
            const path: unknown = this.replaceBulkIds(operation.path, created);
            const data: unknown = this.replaceBulkIds(operation.data, created);
            const match: RegExpExecArray | undefined = typeof path === 'string'
                ? /^\/(Users|Groups)(?:\/([^/]+))?$/.exec(path) ?? undefined
                : undefined;
            const resource: string | undefined = match?.[1];
            const id: string | undefined = match?.[2];
            if (resource == undefined || (operation.method === 'POST') !== (id == undefined)) {
                throw new ScimError(
                    HttpStatus.BAD_REQUEST,
                    $ts`A POST names /Users or /Groups, every other operation a resource, eg. /Users/{id}.`,
                    ScimErrorType.INVALID_PATH
                );
            }
            const users: boolean = resource === 'Users';
            if (id == undefined) {
                const response: ScimResourceResponse = users
                    ? await service.createUser(endpoint, data)
                    : await service.createGroup(endpoint, data);
                if (operation.bulkId != undefined) {
                    created.set(operation.bulkId, response.id);
                }
                return this.toResult(operation, response.location, response.version, HttpStatus.CREATED);
            }
            if (operation.method === 'DELETE') {
                await (users ? service.deleteUser(endpoint, id, operation.version) : service.deleteGroup(endpoint, id, operation.version));
                return this.toResult(operation, `${endpoint.url}/${resource}/${id}`, undefined, HttpStatus.NO_CONTENT);
            }
            const response: ScimResourceResponse = await this.resolveChange(run, operation.method, users, id, data, operation.version);
            return this.toResult(operation, response.location, response.version, HttpStatus.OK);
        }
        catch (error) {
            return this.toError(run, operation, error);
        }
    }

    private static async resolveChange(
        run: ScimBulkRun,
        method: string,
        users: boolean,
        id: string,
        data: unknown,
        version: string | undefined
    ): Promise<ScimResourceResponse> {
        const { service, endpoint } = run;
        if (method === 'PUT') {
            return users ? await service.replaceUser(endpoint, id, data, version) : await service.replaceGroup(endpoint, id, data, version);
        }
        return users ? await service.patchUser(endpoint, id, data, version) : await service.patchGroup(endpoint, id, data, version);
    }

    private static toResult(operation: ScimBulkOperation, location: string, version: string | undefined, status: HttpStatus): ScimBody {
        return {
            method: operation.method,
            ...operation.bulkId == undefined ? {} : { bulkId: operation.bulkId },
            location,
            ...version == undefined ? {} : { version },
            status: `${status}`
        };
    }

    /**
     * The result of an operation of a bulk request that failed: its status, and the error a request
     * of its own would have answered with.
     * @param run - The bulk request being applied.
     * @param operation - The operation.
     * @param error - Why it failed.
     * @returns The result.
     */
    private static toError(run: ScimBulkRun, operation: ScimBulkOperation, error: unknown): ScimBody {
        let status: HttpStatus = HttpStatus.INTERNAL_SERVER_ERROR;
        let response: unknown;
        if (error instanceof ScimError) {
            status = error.status;
            response = error.body;
        }
        else if (error instanceof HttpError) {
            status = error.status;
            response = { schemas: [ScimSchema.ERROR], status: `${error.status}`, detail: error.message };
        }
        else {
            run.logger.error(new Error(`The operation ${operation.index} of a SCIM bulk request failed.`, { cause: error }));
            response = { schemas: [ScimSchema.ERROR], status: `${status}`, detail: 'Internal Server Error' };
        }
        return {
            method: operation.method,
            ...operation.bulkId == undefined ? {} : { bulkId: operation.bulkId },
            // a failed POST created nothing to point at
            ...operation.method === 'POST' ? {} : { location: operation.path },
            status: `${status}`,
            response
        };
    }

    /**
     * The bulkIds an operation refers to, as `bulkId:…` anywhere in its path or data.
     * @param operation - The operation.
     * @returns The bulkIds.
     */
    private static findReferences(operation: ScimBulkOperation): string[] {
        const inPath: string[] = operation.path.split('/').flatMap(segment => this.findReferencesIn(segment));
        return [...this.findReferencesIn(operation.data), ...inPath];
    }

    private static findReferencesIn(value: unknown): string[] {
        if (typeof value === 'string') {
            return value.startsWith(BULK_ID_PREFIX) ? [value.slice(BULK_ID_PREFIX.length)] : [];
        }
        const items: unknown[] = Array.isArray(value) ? value : ScimFilterUtilities.isRecord(value) ? Object.values(value) : [];
        return items.flatMap(item => this.findReferencesIn(item));
    }

    /**
     * Leaves out of the data of an operation what refers to the given bulkIds: every item of a list
     * that does, say a member, and every attribute that is such a reference.
     * @param value - The data.
     * @param bulkIds - The bulkIds.
     * @returns The data, without them.
     */
    private static withoutReferences(value: unknown, bulkIds: Set<string>): unknown {
        const refers: (item: unknown) => boolean = item => this.findReferencesIn(item).some(bulkId => bulkIds.has(bulkId));
        if (Array.isArray(value)) {
            return value.filter(item => !refers(item)).map(item => this.withoutReferences(item, bulkIds));
        }
        return ScimFilterUtilities.isRecord(value)
            ? Object.fromEntries(Object.entries(value)
                .filter(([, item]) => !(typeof item === 'string' && refers(item)))
                .map(([key, item]) => [key, this.withoutReferences(item, bulkIds)]))
            : value;
    }

    /**
     * Replaces every `bulkId:…` the given value holds with the id of the resource created under it.
     * @param value - A path, or the data of an operation.
     * @param created - The ids of the created resources, by their bulkId.
     * @returns The value, with the ids in.
     */
    private static replaceBulkIds(value: unknown, created: Map<string, string>): unknown {
        if (typeof value === 'string') {
            return value.split('/')
                .map(segment => segment.startsWith(BULK_ID_PREFIX) ? created.get(segment.slice(BULK_ID_PREFIX.length)) ?? segment : segment)
                .join('/');
        }
        if (Array.isArray(value)) {
            return value.map(item => this.replaceBulkIds(item, created));
        }
        return ScimFilterUtilities.isRecord(value)
            ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.replaceBulkIds(item, created)]))
            : value;
    }

    private static findAttribute(record: Record<string, unknown>, name: string): unknown {
        const key: string | undefined = ScimFilterUtilities.findKey(record, name);
        return key == undefined ? undefined : record[key];
    }
}