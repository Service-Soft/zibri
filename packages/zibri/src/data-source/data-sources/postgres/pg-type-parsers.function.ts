import { optionalPeer } from '../../../utilities/optional-peer.function.ts';

/**
 * The oid postgres gives `numeric[]`.
 */
const NUMERIC_ARRAY_OID: number = 1231;

/**
 * The oid postgres gives `text[]`.
 */
const TEXT_ARRAY_OID: number = 1009;

/**
 * What turns one value of a postgres result into a javascript value.
 */
type PgTypeParser = (value: string) => unknown;

/**
 * The part of pg's type registry a connection reads its results through.
 */
type PgTypes = {
    /**
     * Hands back what reads a value of the given oid.
     */
    getTypeParser: (oid: number, format?: string) => PgTypeParser
};

/**
 * The parts of the postgres client that are used as values rather than as types.
 */
type Pg = {
    /**
     * Which parser each of postgres' types is read with.
     */
    types: PgTypes
};

/**
 * The type parsers a postgres connection reads its results with.
 *
 * A single `numeric` arrives as text, because the column holds more digits than a javascript number
 * does, and the property that names the format is what reads it into the type it declares. An array
 * of them arrives through a parser of its own, built out of `parseFloat` - so a `numeric[]` is read
 * as doubles, and the digits past what one of those holds are gone before any transformer sees the
 * value. Reading the array as text hands each element over in the shape a single one already has.
 *
 * The parsers themselves come from the installed client, so everything other than that one array
 * type is read exactly as it is without this.
 * @returns The registry to hand the connection.
 * @throws If `pg` is not installed.
 */
export function pgTypeParsers(): PgTypes {
    const pg: Pg = optionalPeer<Pg>('pg', 'Talking to postgres');
    return {
        getTypeParser: (oid: number, format?: string) => oid === NUMERIC_ARRAY_OID
            ? pg.types.getTypeParser(TEXT_ARRAY_OID, format)
            : pg.types.getTypeParser(oid, format)
    };
}