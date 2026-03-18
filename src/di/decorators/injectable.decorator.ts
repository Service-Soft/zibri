import { GlobalRegistry } from '../../global/global-registry';
import { Newable } from '../../types/newable.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { DiProvider } from '../models/di-provider.model';
import { DiToken } from '../models/di-token.model';

/**
 * Options for the \@injectable decorator.
 */
export type InjectableOptions<T> = {
    /**
     * An optional token where the marked class should be registered under instead of the class.
     */
    token?: DiToken<T>,
    /**
     * When the injectable should be registered. Defaults to 'immediately'.
     */
    register?: 'immediately' | 'onUse'
};

/**
 * Marks a class to be injectable.
 * @param options - Options for the injectable.
 */
export function Injectable<T>(options: InjectableOptions<T> = {}): ClassDecorator {
    const { register = 'immediately', token } = options;

    return target => {
        MetadataUtilities.setDiToken(target, token);
        // eslint-disable-next-line unicorn/error-message
        const stack: string = new Error().stack ?? '';
        MetadataUtilities.setFilePath(target, stack);

        const provider: DiProvider<T> = {
            token: (token ?? target) as DiToken<T>,
            useClass: target as unknown as Newable<T>
        };
        if (register === 'immediately') {
            GlobalRegistry.injectables.push(provider);
            return;
        }
        GlobalRegistry.lazyInjectables.push(provider);
    };
}