/**
 * A row ordered by its position, such as a task in its column.
 */
export type PositionedRow = {
    /**
     * The id of the row.
     */
    id: string,
    /**
     * Its position.
     */
    position: number
};

/**
 * Where a row is placed among others: its position, and the rows whose positions change with it, which is none
 * unless the positions ran out of precision and are spread out again.
 */
export type PositionPlacement = {
    /**
     * The position of the row placed.
     */
    position: number,
    /**
     * The other rows with the positions they get, when they are spread out again.
     */
    respread: PositionedRow[]
};