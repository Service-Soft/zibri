import { InternalError } from '../../error-handling/internal-error.model';
import { GlobalRegistry } from '../../global/global-registry';
import { Newable } from '../../types/newable.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { DiProvider, DiScope } from '../models/di-provider.model';
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
     * How long an instance lives, and therefore when a new one is built. Defaults to 'application'.
     */
    scope?: DiScope,
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
    const { register = 'immediately', token, variant, scope } = options;

    return target => {
        MetadataUtilities.setDiToken(target, token);
        MetadataUtilities.setFilePath(target);

        const variants: DiVariant[] = variant ? [variant] : [];

        const existing: FoundProvider<T> | undefined = findExistingProvider(target as unknown as Newable<T>);
        if (existing) {
            if (existing.register !== register) {
                throw new InternalError(
                    `The class "${target.name}" has been marked with decorators for both immediate and onUse injection registration`
                );
            }
            const provider: DiProvider<T> = existing.provider;
            provider.variants = Array.from(new Set([...provider.variants ?? [], ...variants]));
            if (token && (provider.token as Function) !== target && provider.token !== token) {
                throw new InternalError(
                    `Conflicting DI tokens for "${target.name}": `
                    + `"${String(provider.token)}" vs "${String(token)}".`
                );
            }
            if (token) {
                provider.token = token;
            }
            return;
        }

        const provider: DiProvider<T> = {
            token: (token ?? target) as DiToken<T>,
            useClass: target as unknown as Newable<T>,
            variants,
            scope
        };
        if (register === 'immediately') {
            GlobalRegistry.injectables.push(provider);
            return;
        }
        GlobalRegistry.lazyInjectables.push(provider);
    };
}

/**
 * A provider a class was declared with before, and which record it is in.
 */
type FoundProvider<T> = {
    /**
     * The provider, as the record holds it.
     */
    provider: DiProvider<T>,
    /**
     * When it is registered, which is the record it was found in.
     */
    register: NonNullable<InjectableOptions<T>['register']>
};

// eslint-disable-next-line jsdoc/require-jsdoc
function findExistingProvider<T>(target: Newable<T>): FoundProvider<T> | undefined {
    // the records hold providers of every class; the one whose class is the target is a provider of it
    const found: DiProvider<unknown> | undefined = GlobalRegistry.injectables.find(p => p.useClass === target);
    if (found) {
        return { provider: found as DiProvider<T>, register: 'immediately' };
    }
    const foundLazy: DiProvider<unknown> | undefined = GlobalRegistry.lazyInjectables.find(p => p.useClass === target);
    if (foundLazy) {
        return { provider: foundLazy as DiProvider<T>, register: 'onUse' };
    }
    return undefined;
}