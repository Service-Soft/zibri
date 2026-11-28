import { type Transaction } from '../../../../data-source/transaction/transaction.model';
import { type MimeType } from '../../../../http/mime-type.enum';
import { type EBilanzAccountMapping, type EBilanzAccountMappingCreateData } from '../models/e-bilanz-account-mapping.model';
import { type EBilanzFiling } from '../models/e-bilanz-filing.model';
import { type EBilanzPreparationInput } from '../models/e-bilanz-preparation-input.model';
import { type EBilanzPreparation } from '../models/e-bilanz-preparation.model';
import { type EBilanzSettings } from '../models/e-bilanz-settings.model';
import { type EBilanzState } from '../models/e-bilanz-state.model';

/**
 * A file uploaded or written, with its name and mime type.
 */
export type EBilanzFile = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly name: string,
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly mimeType: MimeType | string,
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly data: Buffer
};

/**
 * The E-Bilanz written by an exporter, a file named after its fiscal year with the extension of the exporter.
 */
export type EBilanzExport = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly name: `${string}.${string}`,
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly mimeType: MimeType,
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly data: Buffer
};

/**
 * Prepares, exports and sends the E-Bilanz of the closed fiscal years of the current tenant, with the company of its
 * bookkeeping settings, and keeps the records of their filing and the ELSTER certificate the E-Bilanz takes.
 */
export interface EBilanzServiceInterface {
    /**
     * Resolves the E-Bilanz of a closed fiscal year as the books state it now, and what it needs before it can be
     * prepared, without keeping anything.
     * @throws A ConflictError for an open fiscal year, or one no version of the taxonomy applies to.
     */
    resolvePreparation: (fiscalYearId: string, input: EBilanzPreparationInput) => Promise<EBilanzPreparation>,
    /**
     * Prepares the E-Bilanz of a closed fiscal year: archives its content as a record, which an export and a
     * transmission send.
     * @throws A ConflictError naming what it needs, while it needs something.
     */
    prepare: (fiscalYearId: string, input: EBilanzPreparationInput, createdBy: string) => Promise<EBilanzFiling>,
    /**
     * Resolves the E-Bilanz of a fiscal year: its latest preparation, what it needs now, the records of its filing,
     * its deadline, and whether a transmitter and exporters are registered.
     */
    resolveState: (fiscalYearId: string) => Promise<EBilanzState>,
    /**
     * Writes the latest preparation of a fiscal year with an exporter.
     * @throws A ConflictError for a fiscal year without a current preparation, or an exporter not registered.
     */
    resolveExport: (fiscalYearId: string, exporter: string) => Promise<EBilanzExport>,
    /**
     * Starts sending the latest preparation of a fiscal year with the transmitter and the certificate of the tenant:
     * records the transmission as `transmitting`, calls the transmitter once in the background, and records its result
     * as a record naming the first as its `transmissionId`. Sent for real only after a test transmission of the same
     * content was accepted. Called by the route a person sends it with, never by itself, and never again for a
     * transmission whose result is not known.
     * @returns The record of the transmission started, before it has a result.
     * @throws A ConflictError without a transmitter, a certificate or a current preparation, for a transmission for
     * real without an accepted test, while a transmission of the fiscal year is running, or while one of the same kind
     * has a result that is not known.
     */
    transmit: (fiscalYearId: string, options: { readonly test: boolean }, actingUserId: string) => Promise<EBilanzFiling>,
    /**
     * Records the latest preparation of a fiscal year as filed by hand, with the transmission protocol.
     * @throws A ConflictError without a current preparation, or while a transmission of the fiscal year is running.
     */
    recordManualFiling: (fiscalYearId: string, protocol: EBilanzFile, actingUserId: string) => Promise<EBilanzFiling>,
    /**
     * Records that each transmission of a fiscal year whose result is not known did not reach the tax administration,
     * as a person checked in ELSTER, so that it can be sent again.
     * @returns The records written, one for each such transmission.
     * @throws A ConflictError while a transmission of the fiscal year is running, or when none has a result that is
     * not known.
     */
    recordNotReceived: (fiscalYearId: string, actingUserId: string) => Promise<EBilanzFiling[]>,
    /**
     * Validates that a closed fiscal year can be reopened to correct its books, which `EBilanzConformanceService`
     * asks before it is: a fiscal year whose E-Bilanz is filed only to correct it, and one that is not filed not so.
     * Holds the transmissions of the fiscal year until the transaction of the reopening ends.
     * @throws A ConflictError while a transmission of it is running or has a result that is not known, for a filed
     * one without `forCorrection`, and for one not filed with it.
     */
    validateReopening: (fiscalYearId: string, forCorrection: boolean, transaction: Transaction) => Promise<void>,
    /**
     * Finds the E-Bilanz settings of the current tenant.
     */
    findSettings: () => Promise<EBilanzSettings | undefined>,
    /**
     * Replaces the ELSTER certificate and its PIN.
     */
    updateCertificate: (certificate: EBilanzFile, pin: string, actingUserId: string) => Promise<EBilanzSettings>,
    /**
     * Finds the accounts mapped to a position of their own.
     */
    findAccountMappings: () => Promise<EBilanzAccountMapping[]>,
    /**
     * Maps an account to a position of its own, in place of a mapping it had.
     * @throws A ConflictError for an account the books do not have.
     */
    updateAccountMapping: (mapping: EBilanzAccountMappingCreateData) => Promise<EBilanzAccountMapping>,
    /**
     * Removes the mapping of an account of its own.
     */
    deleteAccountMapping: (accountId: string) => Promise<void>
}
