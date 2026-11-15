/**
 * How the rows of a tenant's export are written: a JSON object per line, or CSV with a header row.
 */
export type TenantExportFormat = 'json-lines' | 'csv';