import { MetadataUtilities } from '../encapsulation';
import { DiToken } from './di-token.model';

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

function getDependencyStackTrace(errorName: string, message: string, resolvingStack: Function[]): string {
    const stackTrace: string[] = ['Dependency resolution stack:'];
    for (const func of resolvingStack.reverse()) {
        const funcName: string = func.name || '<anonymous>';
        const filePath: string = MetadataUtilities.getFilePath(func) ?? 'unknown';
        stackTrace.push(`  at ${funcName} (${filePath})`);
    }
    return `${errorName}: ${message}\n${stackTrace.join('\n')}`;
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