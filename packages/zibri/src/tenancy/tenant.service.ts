import { TenantServiceInterface } from './tenant-service.interface';
import { AlsUtilities } from '../context/als.utilities';
import { Injectable } from '../di/decorators/injectable.decorator';
import { BadRequestError } from '../error-handling/errors/bad-request.error';
import { InternalError } from '../error-handling/internal-error.model';
import { HttpRequest } from '../http/http-request.model';
import { $ts } from '../localization/translate.function';
import { UUIDUtilities } from '../utilities/uuid.utilities';
import { WebsocketRequest } from '../websocket/models/websocket-request.model';

// named like the header in the query too, so that it cannot be taken for a `tenantId` parameter a
// route of the application reads for a purpose of its own
const TENANT_PARAMETER: string = 'x-tenant-id';

/**
 * The default {@link TenantServiceInterface}, keeping the active tenant in async local storage and
 * reading the tenant of a request from its `x-tenant-id` header, or from its `x-tenant-id` query
 * parameter, which is where links name it.
 */
@Injectable({ register: 'onUse' })
export class TenantService implements TenantServiceInterface {

    // eslint-disable-next-line jsdoc/require-jsdoc
    async runAs<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
        if (!UUIDUtilities.isUuid(tenantId)) {
            throw new InternalError(`The tenant "${tenantId}" is not a uuid. Every tenant id is one.`);
        }
        // in the case every uuid is stored in. A filter finds a uuid in either case, while everything
        // comparing the active tenant as a string - a key bound to a tenant, a room, the tenant of a row
        // sent back unchanged - would take the same tenant written in capitals for another one
        return await AlsUtilities.runInTenant(tenantId.toLowerCase(), fn);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    getActiveTenantId(): string | undefined {
        return AlsUtilities.getCurrentTenant();
    }

    // as wide as the interface, so that an application overriding it may look the tenant up
    // eslint-disable-next-line jsdoc/require-jsdoc
    resolveTenant(request: HttpRequest | WebsocketRequest): string | undefined | Promise<string | undefined> {
        const header: string | undefined = this.findSingleValue(request.headers?.[TENANT_PARAMETER]);
        const query: string | undefined = this.findSingleValue(request.query?.[TENANT_PARAMETER]);
        if (header != undefined && query != undefined && header !== query) {
            throw new BadRequestError($ts`The request names the tenant "${header}" in its header and "${query}" in its query.`);
        }
        return header ?? query;
    }

    // as wide as the interface, for the reason resolveTenant is
    // eslint-disable-next-line jsdoc/require-jsdoc
    resolveTenantUrl(url: string, tenantId: string): string | Promise<string> {
        const link: URL = new URL(url);
        link.searchParams.set(TENANT_PARAMETER, tenantId);
        return link.toString();
    }

    /**
     * Finds the one value a header or query parameter holds.
     * @param value - What the request holds under its name.
     * @returns The value, or undefined when it is missing, empty or sent several times: a value sent
     * twice names two tenants, and picking one of them would be a guess.
     */
    private findSingleValue(value: unknown): string | undefined {
        return typeof value === 'string' && value.length ? value : undefined;
    }
}