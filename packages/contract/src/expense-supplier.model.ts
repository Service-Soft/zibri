/**
 * Who issued the document of an expense.
 */
export type ExpenseSupplierModel = {
    /**
     * The name, such as `Office Supplies GmbH`.
     */
    name: string,
    /**
     * The address, its lines separated by line breaks, or null for none.
     */
    address?: string | null,
    /**
     * The VAT identification number, such as `DE123456789`, or null for none.
     */
    vatId?: string | null
};
