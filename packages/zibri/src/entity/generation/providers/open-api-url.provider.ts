
import { BaseEntityGenerationProviderOptions } from './base-entity-generation-provider-options.model.ts';
import { EntityGenerationProvider } from './entity-generation-provider.interface.ts';
import { OpenApiConvertUtilities } from './open-api-convert.utilities.ts';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../../di/inject.function.ts';
import { HttpClientInterface } from '../../../http-client/http-client.interface.ts';
import { OpenApiDefinition } from '../../../open-api/open-api.model.ts';
import { optionalPeer } from '../../../utilities/optional-peer.function.ts';
import { EntityTenant } from '../../models/entity-tenant.model.ts';

/**
 * Options for an open api url provider.
 */
type OpenApiUrlProviderOptions = BaseEntityGenerationProviderOptions & {
    /**
     * The base url where the open api file lives.
     */
    readonly baseUrl: string
};

/**
 * An entity generation provider using an open api url.
 */
export class OpenApiUrlProvider implements EntityGenerationProvider {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    readonly prefix: string;
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    readonly markAsEntities: false | EntityTenant;
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    readonly generateSchemasFromPaths: boolean;
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    readonly onError: 'throw' | 'warn';

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    protected readonly baseUrl: string;

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    protected get http(): HttpClientInterface {
        return inject(ZIBRI_DI_TOKENS.HTTP_CLIENT);
    }

    constructor({
        prefix,
        baseUrl,
        onError = 'throw',
        generateSchemasFromPaths = false,
        markAsEntities = false
    }: OpenApiUrlProviderOptions) {
        this.baseUrl = baseUrl;
        this.prefix = prefix;
        this.generateSchemasFromPaths = generateSchemasFromPaths;
        this.markAsEntities = markAsEntities;
        this.onError = onError;

        optionalPeer('swagger2openapi', 'OpenApiFileProvider');
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async resolveSpec(): Promise<OpenApiDefinition> {
        const spec: unknown = (await this.http.get(this.baseUrl)).rawBody;
        return await OpenApiConvertUtilities.toV3(spec);
    }
}