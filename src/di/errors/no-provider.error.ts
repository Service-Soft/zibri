import { getDependencyStackTrace } from './get-dependency-stack-trace.function';
import { MetadataUtilities } from '../../encapsulation';
import { DiToken } from '../models';

function tokenIsPrimitiveValue(token: DiToken<unknown>): boolean {
    return [String, Number, Boolean, Date].includes(
        token as unknown as StringConstructor | NumberConstructor | BooleanConstructor | DateConstructor
    );
}

function getNoProviderMessage(token: DiToken<unknown>, resolvingStack: Function[]): string {
    if (typeof token === 'string') {
        return `No provider for custom token "${token}"`;
    }
    if (tokenIsPrimitiveValue(token)) {
        if (!resolvingStack.length) {
            return `No provider for token "${token.name}". Did you forget to decorate it with @Inject()?`;
        }
        const currentClass: Function = resolvingStack[resolvingStack.length - 1];
        const paramTypes: unknown[] = MetadataUtilities.getParamTypes(currentClass);
        const index: number = paramTypes.findIndex(param => param === token);
        return `No provider for the token at index ${index} of class "${currentClass.name}". Did you forget to decorate it with @Inject()?`;
    }
    return `No provider for class "${token.name}". Did you forget to decorate it with @Injectable()?`;
}

export class NoProviderError extends Error {
    constructor(token: DiToken<unknown>, resolvingStack: Function[]) {
        const message: string = getNoProviderMessage(token, resolvingStack);
        super(message);
        this.name = 'NoProviderError';
        if (resolvingStack.length) {
            this.stack = getDependencyStackTrace(this.name, this.message, resolvingStack);
        }
    }
}