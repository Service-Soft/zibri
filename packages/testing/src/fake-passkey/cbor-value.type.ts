/**
 * A value CBOR can encode, as far as WebAuthn uses it: integers, text, bytes, arrays and maps.
 */
export type CborValue = number | string | Uint8Array | CborValue[] | Map<number | string, CborValue>;