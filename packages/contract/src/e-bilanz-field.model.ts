/**
 * A field of the GCD module of an E-Bilanz.
 */
export type EBilanzFieldModel = {
    /**
     * The element name of the field, such as `genInfo.company.id.name`.
     */
    name: string,
    /**
     * The German label of the field.
     */
    label: string,
    /**
     * The value, or null for NIL.
     */
    value: string | null,
    /**
     * Which occurrence of a field stated more than once it is, such as the second shareholder, from 0.
     */
    occurrence: number
};