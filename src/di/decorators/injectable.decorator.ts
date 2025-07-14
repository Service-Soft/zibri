import { GlobalRegistry } from '../../global';
import { Newable } from '../../types';
import { MetadataUtilities } from '../../utilities';
import { DiToken } from '../models';

// eslint-disable-next-line jsdoc/require-returns
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