import { MetadataUtilities } from '../../encapsulation';

export function getDependencyStackTrace(errorName: string, message: string, resolvingStack: Function[]): string {
    const stackTrace: string[] = ['Dependency resolution stack:'];
    for (const func of resolvingStack.reverse()) {
        const funcName: string = func.name || '<anonymous>';
        const filePath: string = MetadataUtilities.getFilePath(func) ?? 'unknown';
        stackTrace.push(`  at ${funcName} (${filePath})`);
    }
    return `${errorName}: ${message}\n${stackTrace.join('\n')}`;
}