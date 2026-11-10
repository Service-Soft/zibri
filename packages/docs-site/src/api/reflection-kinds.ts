/**
 * The kinds of reflection the API reference reads, by their names in typedoc.
 */
type ReflectionKindName = 'Namespace' | 'Enum' | 'EnumMember' | 'Variable' | 'Function' | 'Class' | 'Interface' | 'Constructor'
    | 'Property' | 'Method' | 'Accessor' | 'TypeAlias';

// the kinds typedoc gives a reflection, which its json holds as numbers. typedoc ships them as an enum of an es module
// the bundle of the site does not load; the test of the reference checks these against it
export const REFLECTION_KINDS: Readonly<Record<ReflectionKindName, number>> = {
    Namespace: 4,
    Enum: 8,
    EnumMember: 16,
    Variable: 32,
    Function: 64,
    Class: 128,
    Interface: 256,
    Constructor: 512,
    Property: 1024,
    Method: 2048,
    Accessor: 262144,
    TypeAlias: 2097152
};