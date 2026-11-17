import { CacheOperation } from '../caching/cache/cache-operation.enum';
import { HttpMethod } from '../http/http-method.enum';
import { HttpStatus } from '../http/http-status.enum';
import { TranslatedString } from '../localization/models/translated-string.model';

/**
 * The keys json has: strings, as a number key is written as one too. An index signature of a class has number keys
 * besides its string ones, a `Record<string, …>` has not.
 */
type JsonKeys<T> = Extract<keyof T, string>;

/**
 * The keys of an object that can hold undefined, which JSON.stringify leaves out.
 */
type OptionalKeys<T> = { [K in JsonKeys<T>]-?: undefined extends T[K] ? K : never }[JsonKeys<T>];

/**
 * A type as a response carries it as json, compared with the types of zibri-contract a frontend reads it with: a Date
 * becomes the ISO string JSON.stringify writes and a bigint the string it is sent as, a key that can hold undefined
 * may be left out, and arrays and objects carry the same of their items and properties.
 *
 * A translated string is a string, and the enums of zibri that the contract leaves to the server, the http methods
 * and statuses and the operations of a cache, are the strings and numbers they hold.
 */
export type Json<T> = T extends Date | bigint ? string
    : T extends TranslatedString | HttpMethod | CacheOperation ? string
        : T extends HttpStatus ? number
            : T extends (infer Item)[] ? Json<Item>[]
                : T extends object ? JsonObject<T>
                    : T;

/**
 * An object as json, flattened into one object so that an intersection compares like the object it stands for.
 */
type JsonObject<T> = Flattened<
    { [K in Exclude<JsonKeys<T>, OptionalKeys<T>>]: Json<T[K]> } & { [K in OptionalKeys<T>]?: Json<Exclude<T[K], undefined>> }
>;

/**
 * The properties of an intersection as one object.
 */
type Flattened<T> = { [K in keyof T]: T[K] };