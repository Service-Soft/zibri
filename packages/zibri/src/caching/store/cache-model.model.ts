import { SelfDescribing } from '../../types/self-describing.type';

/**
 * A class named for the declarations on it rather than for building one.
 *
 * Not `Newable`, deliberately: nothing here calls the constructor, it reads the `@Property`
 * declarations off the class and applies them to a value json already produced. Requiring a public
 * constructor would refuse a class that keeps its own - `HtmlResponse` and `FileResponse` both do,
 * so that they are only ever built through their factories - for a capability that is never used.
 */
export type DeclaringClass<T> = {
    /**
     * What the declarations are read off.
     */
    readonly prototype: T,
    /**
     * The name of the class, which is what a message about it says.
     */
    readonly name: string
};

/**
 * What a store that serializes its values holds.
 *
 * A store outside the process writes json and reads json back, and json carries neither a `Date`
 * nor a `bigint` nor an exact decimal - each of them goes out as text and comes back as text, with
 * nothing saying what the text stood for. Reading that back needs either the shape of the value or
 * a guess, and a guess is what turns every all-numeric id into a number.
 *
 * So a store that serializes is told the shape, and the shape has to be one that survives being
 * stored: a class whose instances are {@link SelfDescribing}, so that what comes back can still be
 * told apart from anything else. `'plain'` is the answer for a value with no shape to read - a
 * number, a string, an object of them - and says so rather than leaving it unanswered.
 */
export type CacheModel = DeclaringClass<SelfDescribing> | 'plain';