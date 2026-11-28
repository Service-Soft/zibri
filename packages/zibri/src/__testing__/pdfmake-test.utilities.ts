import { afterAll, beforeAll, describe } from '@jest/globals';

import { PdfmakeUtilities } from '../document/pdfmake.utilities';

/**
 * Runs tests with each version of pdfmake a pdf can be made with: 0.2, installed as itself, and 0.3, installed
 * beside it as `pdfmake-0.3`.
 */
export abstract class PdfmakeTestUtilities {
    /**
     * The names pdfmake is installed under, one for each version.
     */
    static readonly installs: string[] = ['pdfmake', 'pdfmake-0.3'];

    /**
     * Declares tests once for each version of pdfmake.
     * @param name - The name of the tests.
     * @param fn - Declares the tests, given the install they run with.
     */
    static describeOnEvery(name: string, fn: (installedAs: string) => void): void {
        for (const installedAs of this.installs) {
            this.describeWith(installedAs, name, () => fn(installedAs));
        }
    }

    /**
     * Declares tests that make their pdfs with one install of pdfmake.
     * @param installedAs - The install, one of {@link PdfmakeTestUtilities.installs}.
     * @param name - The name of the tests.
     * @param fn - Declares the tests.
     */
    static describeWith(installedAs: string, name: string, fn: () => void): void {
        describe(`${name}, with ${installedAs}`, () => {
            beforeAll(() => {
                PdfmakeUtilities.packageName = installedAs;
            });
            afterAll(() => {
                PdfmakeUtilities.packageName = 'pdfmake';
            });
            fn();
        });
    }

    /**
     * Runs a function with one install of pdfmake, for a test comparing what the versions make.
     * @param installedAs - The install, one of {@link PdfmakeTestUtilities.installs}.
     * @param fn - The function.
     * @returns What it returns.
     */
    static async resolveWith<T>(installedAs: string, fn: () => Promise<T>): Promise<T> {
        PdfmakeUtilities.packageName = installedAs;
        try {
            return await fn();
        }
        finally {
            PdfmakeUtilities.packageName = 'pdfmake';
        }
    }
}