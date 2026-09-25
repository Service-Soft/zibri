import { getDependencyStackTrace } from './get-dependency-stack-trace.function';
import { InternalError } from '../../error-handling/internal-error.model';
import { MetadataUtilities } from '../../utilities/metadata.utilities';

/**
 * Get the message for a constructor parameter that cannot be resolved to a token.
 * @param target - The class or factory whose parameter cannot be injected.
 * @param index - The position of the parameter in the parameter list.
 * @param declaredAs - What TypeScript recorded as the parameter's type, if it recorded anything.
 * @returns The message as a string.
 */
function getUninjectableParameterMessage(target: Function, index: number, declaredAs: Function | undefined): string {
    const where: string = `Parameter ${index} of "${target.name || '<anonymous>'}"`;
    const declaredIn: string | undefined = MetadataUtilities.getFilePath(target);
    const lines: string[] = declaredAs == undefined
        ? [
            `${where} cannot be injected, because nothing was recorded about its type.`,
            'Decorate the parameter with @Inject(token) to say what to resolve. That needs nothing',
            'written down about the type, and it is the only way open to a build made with esbuild,',
            'Vite or Bun, none of which emit decorator metadata at all.',
            'The other way is to let the declared type name it, which needs "emitDecoratorMetadata": true',
            'in tsconfig.json - tsc and swc both support that - and a type that still names a class at runtime.'
        ]
        : [
            `${where} cannot be injected, because its type was recorded as "${declaredAs.name}".`,
            'TypeScript writes down a built-in like that for anything that is not a class - an interface,',
            'a union, a generic parameter, a primitive - and also for a class that is not defined yet',
            'because two modules import each other.',
            'Decorate the parameter with @Inject(token) to say what to resolve,',
            'or break the import cycle if it is a class you expected to be injected.'
        ];
    if (declaredIn != undefined) {
        lines.push(`It was declared in ${declaredIn}.`);
    }
    return lines.join('\n');
}

/**
 * An error to throw when a constructor parameter cannot be turned into a token to resolve.
 *
 * The container learns what to pass a constructor from an `@Inject` token where there is one, and
 * otherwise from the type metadata a build writes down. That metadata is lossy where it exists at
 * all: everything that is not a class arrives as a built-in, so an interface and a generic and a
 * half-loaded class all look alike by the time the container reads them, and a toolchain that emits
 * none leaves the parameter carrying nothing. What is missing is therefore never in the parameter
 * itself but in what can be known about it, which is why this names the class, the position and what
 * was recorded rather than a token that does not exist.
 */
export class UninjectableParameterError extends InternalError {
    constructor(
        target: Function,
        index: number,
        declaredAs: Function | undefined,
        resolvingStack: Function[],
        options?: ErrorOptions
    ) {
        super(getUninjectableParameterMessage(target, index, declaredAs), options);
        this.name = 'UninjectableParameterError';
        if (resolvingStack.length) {
            this.stack = getDependencyStackTrace(this.name, this.message, resolvingStack);
        }
    }
}