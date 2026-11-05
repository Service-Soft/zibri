/**
 * A value that is one of several named shapes, together with the name of the shape it is.
 *
 * Declared with the names and the type each one holds, `OneOf<{ Signup: Signup, Invite: Invite }>`,
 * and narrowed by its name: `if (contact.shape === 'Signup')` makes `contact.value` a `Signup`.
 */
export type OneOf<Shapes> = {
    [Name in keyof Shapes & string]: {
        /**
         * The name of the shape the value is.
         */
        shape: Name,
        /**
         * The value, as that shape.
         */
        value: Shapes[Name]
    }
}[keyof Shapes & string];