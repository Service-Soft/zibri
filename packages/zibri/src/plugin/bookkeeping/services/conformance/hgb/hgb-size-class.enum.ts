/**
 * The size class of a corporation by § 267 and § 267a HGB, which decides the forms of its statements.
 */
export enum HgbSizeClass {
    /**
     * A micro corporation (Kleinstkapitalgesellschaft), § 267a HGB: the shortened balance sheet of § 266 (1) sentence
     * 4 and the income statement of § 275 (5) HGB.
     */
    MICRO = 'MICRO',
    /**
     * A small corporation, § 267 (1) HGB: the shortened balance sheet of § 266 (1) sentence 3 and the full income
     * statement.
     */
    SMALL = 'SMALL',
    /**
     * A medium-sized corporation, § 267 (2) HGB: the full statements.
     */
    MEDIUM = 'MEDIUM',
    /**
     * A large corporation, § 267 (3) HGB: the full statements.
     */
    LARGE = 'LARGE'
}
