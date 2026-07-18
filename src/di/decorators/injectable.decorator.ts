import { InternalError } from '../../error-handling/internal-error.model';
import { GlobalRegistry } from '../../global/global-registry';
import { Newable } from '../../types/newable.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { DiProvider } from '../models/di-provider.model';
import { DiToken } from '../models/di-token.model';
import { DiVariant } from '../models/di-variant.model';

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
    register?: 'immediately' | 'onUse',
    /**
     * The variant of the injectable.
     */
    variant?: DiVariant
};

/**
 * Marks a class to be injectable.
 * @param options - Options for the injectable.
 */
export function Injectable<T>(options: InjectableOptions<T> = {}): ClassDecorator {
    const { register = 'immediately', token, variant } = options;

    return target => {
        MetadataUtilities.setDiToken(target, token);
        // eslint-disable-next-line unicorn/error-message
        const stack: string = new Error().stack ?? '';
        MetadataUtilities.setFilePath(target, stack);

        const variants: DiVariant[] = variant ? [variant] : [];

        const existing: FoundProvider<T> | undefined = findExistingProvider(target as unknown as Newable<T>);
        if (existing) {
            if (existing.register !== register) {
                throw new InternalError(
                    `The class "${target.name}" has been marked with decorators for both immediate and onUse injection registration`
                );
            }
            existing.variants = Array.from(new Set([...existing.variants ?? [], ...variants]));
            if (token && (existing.token as Function) !== target && existing.token !== token) {
                throw new InternalError(
                    `Conflicting DI tokens for "${target.name}": `
                    + `"${String(existing.token)}" vs "${String(token)}".`
                );
            }
            if (token) {
                existing.token = token;
            }
            return;
        }

        const provider: DiProvider<T> = {
            token: (token ?? target) as DiToken<T>,
            useClass: target as unknown as Newable<T>,
            variants
        };
        if (register === 'immediately') {
            GlobalRegistry.injectables.push(provider);
            return;
        }
        GlobalRegistry.lazyInjectables.push(provider);
    };
}

// eslint-disable-next-line jsdoc/require-jsdoc
type FoundProvider<T> = DiProvider<T> & Required<Pick<InjectableOptions<T>, 'register'>>;

// eslint-disable-next-line jsdoc/require-jsdoc
function findExistingProvider<T>(target: Newable<T>): FoundProvider<T> | undefined {
    const found: DiProvider<unknown> | undefined = GlobalRegistry.injectables.find(p => p.useClass === target);
    if (found) {
        (found as FoundProvider<T>).register = 'immediately';
        return found as FoundProvider<T>;
    }
    const foundLazy: DiProvider<unknown> | undefined = GlobalRegistry.lazyInjectables.find(p => p.useClass === target);
    if (foundLazy) {
        (foundLazy as FoundProvider<T>).register = 'onUse';
        return foundLazy as FoundProvider<T>;
    }
    return undefined;
}