import { BaseEntityGenerationProviderOptions } from './base-entity-generation-provider-options.model.ts';
import { EntityGenerationProvider } from './entity-generation-provider.interface.ts';
import { OpenApiConvertUtilities } from './open-api-convert.utilities.ts';
import { OpenApiDefinition } from '../../../open-api/open-api.model.ts';
import { FsUtilities, FsPath } from '../../../utilities/fs.utilities.ts';
import { JsonUtilities } from '../../../utilities/json.utilities.ts';
import { optionalPeer } from '../../../utilities/optional-peer.function.ts';
import { EntityTenant } from '../../models/entity-tenant.model.ts';

/**
 * Options for an open api file provider.
 */
type OpenApiFileProviderOptions = BaseEntityGenerationProviderOptions & {
    /**
     * The path to the open api file.
     */
    readonly filePath: FsPath
};

/**
 * An entity generation provider using a local open api file.
 */
export class OpenApiFileProvider implements EntityGenerationProvider {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    readonly prefix: string;
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    readonly markAsEntities: false | EntityTenant;
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    readonly generateSchemasFromPaths: boolean;
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    readonly onError: 'throw' | 'warn';

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    protected readonly filePath: FsPath;

    constructor({
        prefix,
        filePath,
        onError = 'throw',
        generateSchemasFromPaths = false,
        markAsEntities = false
    }: OpenApiFileProviderOptions) {
        this.filePath = filePath;
        this.prefix = prefix;
        this.generateSchemasFromPaths = generateSchemasFromPaths;
        this.markAsEntities = markAsEntities;
        this.onError = onError;

        optionalPeer('swagger2openapi', 'OpenApiFileProvider');
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async resolveSpec(): Promise<OpenApiDefinition> {
        const spec: unknown = JsonUtilities.parse(await FsUtilities.readFile(this.filePath));
        return await OpenApiConvertUtilities.toV3(spec);
    }
}