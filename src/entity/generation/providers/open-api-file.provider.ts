import { EntityGenerationProvider } from './entity-generation-provider.interface';
import { openApiToV3 } from './open-api-to-v3.function';
import { OpenApiDefinition } from '../../../open-api/open-api.model';
import { FsUtilities, FsPath } from '../../../utilities/fs.utilities';

/**
 * An entity generation provider using a local open api file.
 */
export class OpenApiFileProvider implements EntityGenerationProvider {
    constructor(
        readonly prefix: string,
        protected readonly filePath: FsPath,
        readonly generateSchemasFromPaths: boolean = false,
        readonly markAsEntities: boolean = false
    ) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveSpec(): Promise<OpenApiDefinition> {
        const spec: unknown = JSON.parse(await FsUtilities.readFile(this.filePath));
        return await openApiToV3(spec);
    }
}