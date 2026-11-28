/**
 * The company whose books they are, as its statements name it.
 */
export type BookkeepingCompanyModel = {
    /**
     * The name of the company, its firm, such as `Acme Software UG (haftungsbeschränkt)`.
     */
    name: string,
    /**
     * Where the company has its seat, such as `Berlin`, or null for none.
     */
    seat?: string | null,
    /**
     * The court of the register the company is entered in, such as `Amtsgericht Charlottenburg`, or null for none.
     */
    registerCourt?: string | null,
    /**
     * The number the company is entered in the register under, such as `HRB 123456 B`, or null for none.
     */
    registerNumber?: string | null
};
