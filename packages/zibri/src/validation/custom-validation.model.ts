import { type ValidationProblem } from './validation-problem.model';
import { HttpRequestContext } from '../context/request/http-request.context';
import { WebsocketRequestContext } from '../context/request/websocket-request.context';
import { OmitStrict } from '../types/omit-strict.type';

/**
 * A problem a custom rule finds with an object.
 */
export type CustomValidationProblem<T> = OmitStrict<ValidationProblem, 'key'> & {
    /**
     * The property of the object the problem is with, such as `endsAt`. Left out for the object as a
     * whole.
     */
    property?: keyof T & string
};

/**
 * A rule of a model that its properties cannot say on their own, such as one comparing two of them.
 *
 * Given an object whose properties are all valid, and the current request. It returns what is wrong
 * with the object, or nothing.
 */
export type CustomValidationRule<T> = (
    value: T,
    ctx: HttpRequestContext | WebsocketRequestContext | undefined
) => CustomValidationProblem<T>[];
