import { BaseScimProvisioner } from './base-scim-provisioner';
import { ScimBody } from './scim-body.model';
import { ScimControllerClass } from './scim-controller-class.type';
import { ScimControllerOptions } from './scim-controller-options.model';
import { ScimEndpoint } from './scim-endpoint.model';
import { ScimResourceResponse } from './scim-resource-response.model';
import { type ScimServiceInterface } from './scim-service.interface';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { FileSize, fileSizeToBytes } from '../../entity/models/file-property-metadata.model';
import { InternalError } from '../../error-handling/internal-error.model';
import { GlobalRegistry } from '../../global/global-registry';
import { HttpStatus } from '../../http/http-status.enum';
import { JsonMimeType } from '../../http/json-mime-type.type';
import { JsonResponse } from '../../http/json-response.model';
import { KnownHeader } from '../../http/known-header.enum';
import { MimeType } from '../../http/mime-type.enum';
import { Response } from '../../open-api/decorators/response.decorator';
import { Route } from '../../routing/controller-route-configuration.model';
import { Body } from '../../routing/decorators/body.decorator';
import { ControllerData } from '../../routing/decorators/controller.decorator';
import { Delete } from '../../routing/decorators/delete.decorator';
import { Get } from '../../routing/decorators/get.decorator';
import { Param, QueryParamMetadataInput } from '../../routing/decorators/param.decorator';
import { Patch } from '../../routing/decorators/patch.decorator';
import { Post } from '../../routing/decorators/post.decorator';
import { Put } from '../../routing/decorators/put.decorator';
import { Newable } from '../../types/newable.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { Auth } from '../decorators/auth.decorator';
import { BaseUser } from '../models/base-user.model';
import { ApiKeyAuthStrategy } from '../strategies/api-key/api-key.auth-strategy';

/**
 * What SCIM answers in: its own json type, and plain json for a client that asks for that.
 */
const SCIM_MIME_TYPES: JsonMimeType[] = [MimeType.JSON_SCIM, MimeType.JSON];

const USER_PATH: Route = '/Users/:id';

const GROUP_PATH: Route = '/Groups/:id';

/**
 * The most operations a bulk request may hold, unless the options say otherwise.
 */
const DEFAULT_MAX_BULK_OPERATIONS: number = 1000;

/**
 * The most a bulk request may weigh, unless the options say otherwise.
 */
const DEFAULT_MAX_BULK_PAYLOAD_SIZE: FileSize = '1mb';

/**
 * The parameters of a route listing resources.
 */
const LIST_QUERY_OPTIONS: QueryParamMetadataInput = { type: 'string', required: false };

// eslint-disable-next-line jsdoc/require-returns
/**
 * Defines the SCIM routes (RFC 7644) an identity provider provisions users and groups through:
 * `/Users`, `/Groups`, `/Bulk`, `/ServiceProviderConfig`, `/ResourceTypes` and `/Schemas`, below the
 * path of the controller that extends it.
 *
 * Each tenant's identity provider calls them with an api key bound to the tenant, of a user holding
 * one of the `roles` there, sent as a bearer token.
 * @param provisioner - What provisioning does to the users of the application.
 * @param options - Who may provision, and how much one bulk request may do.
 */
export function ScimController<RoleType extends string>(
    provisioner: Newable<BaseScimProvisioner<RoleType, BaseUser<RoleType>>>,
    options: ScimControllerOptions<RoleType>
): Newable<object> {
    const maxBulkPayloadSize: FileSize = options.bulk?.maxPayloadSize ?? DEFAULT_MAX_BULK_PAYLOAD_SIZE;

    // eslint-disable-next-line jsdoc/require-jsdoc
    @Auth.hasRole(options.roles, [ApiKeyAuthStrategy])
    class Temp {
        /**
         * The provisioner the routes provision with, which also marks the class as SCIM's.
         */
        static readonly scimProvisioner: Newable<BaseScimProvisioner<RoleType, BaseUser<RoleType>>> = provisioner;

        private get scimService(): ScimServiceInterface {
            return inject(ZIBRI_DI_TOKENS.SCIM_SERVICE);
        }

        /**
         * Where the routes answer: the application's `baseUrl`, followed by the path of the
         * controller extending this one.
         * @returns The routes.
         * @throws When the application has no `baseUrl` yet.
         */
        private get endpoint(): ScimEndpoint {
            const baseUrl: string | undefined = GlobalRegistry.getAppData('baseUrl');
            const controller: ControllerData | undefined = MetadataUtilities.getControllerData(this.constructor);
            if (baseUrl == undefined || controller == undefined) {
                throw new InternalError('The location of a SCIM resource starts with the baseUrl of the application, which is not set.');
            }
            const path: string = controller.baseRoute === '/' ? '' : controller.baseRoute;
            return {
                provisioner,
                url: `${baseUrl.replace(/\/+$/, '')}${path}`,
                maxBulkOperations: options.bulk?.maxOperations ?? DEFAULT_MAX_BULK_OPERATIONS,
                maxBulkPayloadSize: fileSizeToBytes(maxBulkPayloadSize).toNumber()
            };
        }

        // eslint-disable-next-line jsdoc/require-jsdoc
        @Response.object(ScimBody, { mimeTypes: SCIM_MIME_TYPES })
        @Get('/ServiceProviderConfig')
        serviceProviderConfig(): ScimBody {
            return this.scimService.getServiceProviderConfig(this.endpoint);
        }

        // eslint-disable-next-line jsdoc/require-jsdoc
        @Response.object(ScimBody, { mimeTypes: SCIM_MIME_TYPES })
        @Get('/ResourceTypes')
        resourceTypes(): ScimBody {
            return this.scimService.getResourceTypes(this.endpoint);
        }

        // eslint-disable-next-line jsdoc/require-jsdoc
        @Response.object(ScimBody, { mimeTypes: SCIM_MIME_TYPES })
        @Get('/ResourceTypes/:id')
        resourceType(
            @Param.path('id', { type: 'string' })
            id: string
        ): ScimBody {
            return this.scimService.findResourceType(this.endpoint, id);
        }

        // eslint-disable-next-line jsdoc/require-jsdoc
        @Response.object(ScimBody, { mimeTypes: SCIM_MIME_TYPES })
        @Get('/Schemas')
        schemas(): ScimBody {
            return this.scimService.getSchemas(this.endpoint);
        }

        // eslint-disable-next-line jsdoc/require-jsdoc
        @Response.object(ScimBody, { mimeTypes: SCIM_MIME_TYPES })
        @Get('/Schemas/:id')
        schema(
            @Param.path('id', { type: 'string' })
            id: string
        ): ScimBody {
            return this.scimService.findSchema(this.endpoint, id);
        }

        // eslint-disable-next-line jsdoc/require-jsdoc
        @Response.object(ScimBody, { status: HttpStatus.CREATED, mimeTypes: SCIM_MIME_TYPES })
        @Post('/Users')
        async createUser(
            @Body(ScimBody, { allowAdditionalProperties: true })
            body: ScimBody
        ): Promise<JsonResponse<ScimBody>> {
            return toJsonResponse(await this.scimService.createUser(this.endpoint, body));
        }

        // eslint-disable-next-line jsdoc/require-jsdoc
        @Response.object(ScimBody, { mimeTypes: SCIM_MIME_TYPES })
        @Get('/Users')
        async findUsers(
            @Param.query('filter', LIST_QUERY_OPTIONS)
            filter: string | undefined,
            @Param.query('sortBy', LIST_QUERY_OPTIONS)
            sortBy: string | undefined,
            @Param.query('sortOrder', LIST_QUERY_OPTIONS)
            sortOrder: string | undefined,
            @Param.query('startIndex', { type: 'number', required: false })
            startIndex: number | undefined,
            @Param.query('count', { type: 'number', required: false })
            count: number | undefined,
            @Param.query('attributes', LIST_QUERY_OPTIONS)
            attributes: string | undefined,
            @Param.query('excludedAttributes', LIST_QUERY_OPTIONS)
            excludedAttributes: string | undefined
        ): Promise<ScimBody> {
            return await this.scimService.findUsers(
                this.endpoint,
                { filter, sortBy, sortOrder, startIndex, count, attributes, excludedAttributes }
            );
        }

        // eslint-disable-next-line jsdoc/require-jsdoc
        @Response.object(ScimBody, { mimeTypes: SCIM_MIME_TYPES })
        @Get(USER_PATH)
        async findUser(
            @Param.path('id', { type: 'string' })
            id: string,
            @Param.query('attributes', LIST_QUERY_OPTIONS)
            attributes: string | undefined,
            @Param.query('excludedAttributes', LIST_QUERY_OPTIONS)
            excludedAttributes: string | undefined
        ): Promise<JsonResponse<ScimBody>> {
            return toJsonResponse(await this.scimService.findUser(this.endpoint, id, { attributes, excludedAttributes }));
        }

        // eslint-disable-next-line jsdoc/require-jsdoc
        @Response.object(ScimBody, { mimeTypes: SCIM_MIME_TYPES })
        @Put(USER_PATH)
        async replaceUser(
            @Param.path('id', { type: 'string' })
            id: string,
            @Body(ScimBody, { allowAdditionalProperties: true })
            body: ScimBody,
            @Param.header(KnownHeader.IF_MATCH, { type: 'string', required: false })
            ifMatch: string | undefined
        ): Promise<JsonResponse<ScimBody>> {
            return toJsonResponse(await this.scimService.replaceUser(this.endpoint, id, body, ifMatch));
        }

        // eslint-disable-next-line jsdoc/require-jsdoc
        @Response.object(ScimBody, { mimeTypes: SCIM_MIME_TYPES })
        @Patch(USER_PATH)
        async patchUser(
            @Param.path('id', { type: 'string' })
            id: string,
            @Body(ScimBody, { allowAdditionalProperties: true })
            body: ScimBody,
            @Param.header(KnownHeader.IF_MATCH, { type: 'string', required: false })
            ifMatch: string | undefined
        ): Promise<JsonResponse<ScimBody>> {
            return toJsonResponse(await this.scimService.patchUser(this.endpoint, id, body, ifMatch));
        }

        // eslint-disable-next-line jsdoc/require-jsdoc
        @Response.empty({ mimeTypes: SCIM_MIME_TYPES })
        @Delete(USER_PATH)
        async deleteUser(
            @Param.path('id', { type: 'string' })
            id: string,
            @Param.header(KnownHeader.IF_MATCH, { type: 'string', required: false })
            ifMatch: string | undefined
        ): Promise<void> {
            await this.scimService.deleteUser(this.endpoint, id, ifMatch);
        }

        // eslint-disable-next-line jsdoc/require-jsdoc
        @Response.object(ScimBody, { status: HttpStatus.CREATED, mimeTypes: SCIM_MIME_TYPES })
        @Post('/Groups')
        async createGroup(
            @Body(ScimBody, { allowAdditionalProperties: true })
            body: ScimBody
        ): Promise<JsonResponse<ScimBody>> {
            return toJsonResponse(await this.scimService.createGroup(this.endpoint, body));
        }

        // eslint-disable-next-line jsdoc/require-jsdoc
        @Response.object(ScimBody, { mimeTypes: SCIM_MIME_TYPES })
        @Get('/Groups')
        async findGroups(
            @Param.query('filter', LIST_QUERY_OPTIONS)
            filter: string | undefined,
            @Param.query('sortBy', LIST_QUERY_OPTIONS)
            sortBy: string | undefined,
            @Param.query('sortOrder', LIST_QUERY_OPTIONS)
            sortOrder: string | undefined,
            @Param.query('startIndex', { type: 'number', required: false })
            startIndex: number | undefined,
            @Param.query('count', { type: 'number', required: false })
            count: number | undefined,
            @Param.query('attributes', LIST_QUERY_OPTIONS)
            attributes: string | undefined,
            @Param.query('excludedAttributes', LIST_QUERY_OPTIONS)
            excludedAttributes: string | undefined
        ): Promise<ScimBody> {
            return await this.scimService.findGroups(
                this.endpoint,
                { filter, sortBy, sortOrder, startIndex, count, attributes, excludedAttributes }
            );
        }

        // eslint-disable-next-line jsdoc/require-jsdoc
        @Response.object(ScimBody, { mimeTypes: SCIM_MIME_TYPES })
        @Get(GROUP_PATH)
        async findGroup(
            @Param.path('id', { type: 'string' })
            id: string,
            @Param.query('attributes', LIST_QUERY_OPTIONS)
            attributes: string | undefined,
            @Param.query('excludedAttributes', LIST_QUERY_OPTIONS)
            excludedAttributes: string | undefined
        ): Promise<JsonResponse<ScimBody>> {
            return toJsonResponse(await this.scimService.findGroup(this.endpoint, id, { attributes, excludedAttributes }));
        }

        // eslint-disable-next-line jsdoc/require-jsdoc
        @Response.object(ScimBody, { mimeTypes: SCIM_MIME_TYPES })
        @Put(GROUP_PATH)
        async replaceGroup(
            @Param.path('id', { type: 'string' })
            id: string,
            @Body(ScimBody, { allowAdditionalProperties: true })
            body: ScimBody,
            @Param.header(KnownHeader.IF_MATCH, { type: 'string', required: false })
            ifMatch: string | undefined
        ): Promise<JsonResponse<ScimBody>> {
            return toJsonResponse(await this.scimService.replaceGroup(this.endpoint, id, body, ifMatch));
        }

        // eslint-disable-next-line jsdoc/require-jsdoc
        @Response.object(ScimBody, { mimeTypes: SCIM_MIME_TYPES })
        @Patch(GROUP_PATH)
        async patchGroup(
            @Param.path('id', { type: 'string' })
            id: string,
            @Body(ScimBody, { allowAdditionalProperties: true })
            body: ScimBody,
            @Param.header(KnownHeader.IF_MATCH, { type: 'string', required: false })
            ifMatch: string | undefined
        ): Promise<JsonResponse<ScimBody>> {
            return toJsonResponse(await this.scimService.patchGroup(this.endpoint, id, body, ifMatch));
        }

        // eslint-disable-next-line jsdoc/require-jsdoc
        @Response.empty({ mimeTypes: SCIM_MIME_TYPES })
        @Delete(GROUP_PATH)
        async deleteGroup(
            @Param.path('id', { type: 'string' })
            id: string,
            @Param.header(KnownHeader.IF_MATCH, { type: 'string', required: false })
            ifMatch: string | undefined
        ): Promise<void> {
            await this.scimService.deleteGroup(this.endpoint, id, ifMatch);
        }

        // eslint-disable-next-line jsdoc/require-jsdoc
        @Response.object(ScimBody, { mimeTypes: SCIM_MIME_TYPES })
        @Post('/Bulk')
        async bulk(
            @Body(ScimBody, { allowAdditionalProperties: true, maxSize: maxBulkPayloadSize })
            body: ScimBody
        ): Promise<ScimBody> {
            return await this.scimService.bulk(this.endpoint, body);
        }
    }
    return Temp;
}

/**
 * A resource as its route answers with it: its version as the etag, and its url as its location.
 * @param resource - The resource.
 * @returns The response.
 */
function toJsonResponse(resource: ScimResourceResponse): JsonResponse<ScimBody> {
    return JsonResponse.of(resource.body, { headers: { [KnownHeader.ETAG]: resource.version, [KnownHeader.LOCATION]: resource.location } });
}

/**
 * Checks whether a controller class was defined by `ScimController`.
 * @param value - The class.
 * @returns True when it was.
 */
export function isScimControllerClass(value: unknown): value is ScimControllerClass {
    return typeof value === 'function' && 'scimProvisioner' in value && typeof value.scimProvisioner === 'function';
}