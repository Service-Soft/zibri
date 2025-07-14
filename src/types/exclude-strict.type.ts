// eslint-disable-next-line jsdoc/require-jsdoc
export type ExcludeStrict<UnionType, ExcludedMembers extends UnionType> = Exclude<UnionType, ExcludedMembers>;