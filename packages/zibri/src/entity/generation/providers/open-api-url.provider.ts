
import { EntityGenerationProvider } from './entity-generation-provider.interface';
import { openApiToV3 } from './open-api-to-v3.function';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { HttpClientInterface } from '../../../http-client/http-client.interface';
import { OpenApiDefinition } from '../../../open-api/open-api.model';

/**
 * An entity generation provider using an open api url.
 */
export class OpenApiUrlProvider implements EntityGenerationProvider {

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected get http(): HttpClientInterface {
        return inject(ZIBRI_DI_TOKENS.HTTP_CLIENT);
    }

    constructor(
        readonly prefix: string,
        protected readonly baseUrl: string,
        readonly generateSchemasFromPaths: boolean = false,
        readonly markAsEntities: boolean = false
    ) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveSpec(): Promise<OpenApiDefinition> {
        const spec: unknown = (await this.http.get(this.baseUrl)).rawBody;
        return await openApiToV3(spec);
    }
}