import { type JsonResponse } from '../../http/json-response.model';

/**
 * A `Response` decorator, which compiles only on a method that can return what it declares: the
 * declared value, or a `JsonResponse` of it, has to be one of the values the method's return type
 * allows, once awaited.
 */
export type ResponseDecorator<Declared> = <Method extends (...args: never[]) => unknown>(
    target: Object,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<Method> & (
        // a declaration that names no type, such as a model only known once the application has
        // started, says nothing the return type could contradict
        { body: unknown } extends { body: Declared }
            ? unknown
            // inside an object, so that a declared union is checked as a whole rather than member by
            // member, and so that a type parameter is compared rather than left unresolved: a bare one
            // defers the check, which would refuse every method of a generic controller. The promise is
            // taken apart with infer rather than Awaited for the same reason
            : Method extends (...args: never[]) => infer Returned
                ? { body: Declared } extends { body: Returned extends PromiseLike<infer Inner> ? Inner : Returned }
                    ? unknown
                    : { body: JsonResponse<Declared> } extends { body: Returned extends PromiseLike<infer Inner> ? Inner : Returned }
                        ? unknown
                        : { readonly 'the method does not return what the decorator declares': Declared }
                : never
    )
) => void;
