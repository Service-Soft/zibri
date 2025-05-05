import { ReflectUtilities } from './reflect.utilities';
import { MetadataInjectionKeys, DiToken, InjectOptions } from '../di';

export abstract class MetadataUtilities {
    static setFilePath(target: Object, errorStack: string): void {
        const callerLine: string = errorStack.split('\n')[5]; // Adjust based on your stack trace
        const filePath: string = callerLine.match(/\((.*):\d+:\d+\)/)?.[1] ?? 'unknown';

        // Store the file path in metadata
        if (typeof target === 'function') {
            ReflectUtilities.setMetadata(MetadataInjectionKeys.FILE_LOCATION, filePath, target);
        }
        else {
            ReflectUtilities.setMetadata(MetadataInjectionKeys.FILE_LOCATION, filePath, target.constructor);
        }
    }

    static getFilePath(target: Object): string | undefined {
        return ReflectUtilities.getMetadata(MetadataInjectionKeys.FILE_LOCATION, target);
    }

    static getParamTypes(target: Object): unknown[] {
        return ReflectUtilities.getMetadata(MetadataInjectionKeys.PARAM_TYPES, target) ?? [];
    }

    static setDiToken<T>(target: Object, token?: DiToken<T>): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.DI_TOKEN, token ?? target, target);
    }

    static setInjectParamTokens(tokens: Record<number, DiToken<unknown>>, target: Object): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.DI_INJECT_PARAM_TOKENS, tokens, target);
    }

    static getInjectParamTokens(target: Object): Record<number, DiToken<unknown>> {
        return ReflectUtilities.getOwnMetadata(MetadataInjectionKeys.DI_INJECT_PARAM_TOKENS, target) ?? {};
    }

    static setInjectParamOptions(options: Record<number, InjectOptions>, target: Object): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.DI_INJECT_PARAM_OPTIONS, options, target);
    }

    static getInjectParamOptions(target: Object): Record<number, InjectOptions> {
        return ReflectUtilities.getOwnMetadata(MetadataInjectionKeys.DI_INJECT_PARAM_OPTIONS, target) ?? {};
    }
}