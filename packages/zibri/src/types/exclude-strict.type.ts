// eslint-disable-next-line jsdoc-js/require-jsdoc
export type ExcludeStrict<UnionType, ExcludedMembers extends UnionType> = Exclude<UnionType, ExcludedMembers>;