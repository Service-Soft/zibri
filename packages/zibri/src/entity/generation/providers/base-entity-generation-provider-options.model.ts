import { EntityGenerationProvider } from './entity-generation-provider.interface';
import { OmitStrict } from '../../../types/omit-strict.type';

/**
 * Options shared by every entity generation provider.
 */
export type BaseEntityGenerationProviderOptions = Partial<OmitStrict<EntityGenerationProvider, 'resolveSpec'>>
    & Pick<EntityGenerationProvider, 'prefix'>;