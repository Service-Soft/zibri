import { GlobalRegistry } from '../../global/global-registry';
import { Newable } from '../../types/newable.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { DiToken } from '../models/di-token.model';

/**
 * Marks a class to be injectable.
 * @param token - An optional token where the marked class should be registered under instead of the class.
 */
export function Injectable<T>(token?: DiToken<T>): ClassDecorator {
    return target => {
        MetadataUtilities.setDiToken(target, token);
        // eslint-disable-next-line unicorn/error-message
        const stack: string = new Error().stack ?? '';
        MetadataUtilities.setFilePath(target, stack);
        GlobalRegistry.injectables.push({
            token: (token ?? target) as DiToken<T>,
            useClass: target as unknown as Newable<unknown>
        });
    };
}