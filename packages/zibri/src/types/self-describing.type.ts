/**
 * A value that says what it is, in a value rather than in its prototype.
 *
 * Anything that goes through json and is recognized on the other side needs this. A class does not
 * survive that trip - the values come back and the prototype does not - so `instanceof` answers no
 * for a value that is one, and every check built on it silently starts saying the wrong thing about
 * a value that merely went somewhere and came back. A property is a value, so it comes back.
 *
 * Declared as `readonly className: 'TheClassName'` on the class itself, so that the literal type is
 * what tells two of them apart, and marked `exclude` so it stays wiring rather than becoming part of
 * what a caller is answered with.
 */
export type SelfDescribing = {
    /**
     * The name of the class this value is of.
     */
    readonly className: string
};