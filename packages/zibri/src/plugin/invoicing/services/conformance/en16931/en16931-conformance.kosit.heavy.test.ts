import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { createInMemoryDataSource } from 'zibri-testing';

import { PeppolConformanceService } from './peppol-conformance.service.ts';
import { XRechnungConformanceService } from './x-rechnung-conformance.service.ts';
import { companyInfoProvider } from '../../../../../__testing__/mocks/company-info-provider.function.ts';
import { defaultTestServerEntities } from '../../../../../__testing__/test-server/create-test-data-source.function.ts';
import { defaultTestServerProviders } from '../../../../../__testing__/test-server/providers.ts';
import { StartedTestServer, startTestServer } from '../../../../../__testing__/test-server/start-test-server.function.ts';
import { inject } from '../../../../../di/inject.function.ts';
import { type CurrencyCode } from '../../../../../localization/models/currency-code.model.ts';
import { UUIDUtilities } from '../../../../../utilities/uuid.utilities.ts';
import { ZibriInvoicingPlugin } from '../../../invoicing.plugin.ts';
import { ElectronicAddress } from '../../../models/electronic-address.model.ts';
import { InvoiceItem } from '../../../models/invoice-item.model.ts';
import { InvoiceRecipientAbbreviation } from '../../../models/invoice-recipient-abbreviation.model.ts';
import { Invoice } from '../../../models/invoice.model.ts';
import { NumberInvoices } from '../../../models/number-invoices.model.ts';

// The electronic invoices of the plugin, checked by the validator KoSIT publishes for XRechnung, the one
// German authorities check what they receive with: EN 16931's rules and XRechnung's for an XRechnung,
// EN 16931's and Peppol's for a Peppol invoice. KoSIT's Peppol configuration covers UBL only and the
// plugin writes CII, so Peppol's rules for CII are compiled from OpenPeppol's sources here.

/**
 * The image the validator runs in. A JDK rather than a JRE, for `jar` to unpack the configuration with.
 */
const VALIDATOR_IMAGE: string = 'eclipse-temurin:21.0.12_8-jdk-noble';

/**
 * Something the validator needs, pinned by its checksum.
 */
type Artefact = {
    /**
     * The name it is stored and copied into the container under.
     */
    name: string,
    /**
     * Where it is downloaded from.
     */
    url: string,
    /**
     * Its sha256, as hex.
     */
    sha256: string
};

const ARTIFACTS: Artefact[] = [
    {
        name: 'validator.jar',
        url: 'https://github.com/itplr-kosit/validator/releases/download/v1.6.3/validator-1.6.3-standalone.jar',
        sha256: '799e64befca97d4080e03608c80b85dd5a5ecc5f4ae4f35d1116ec2855b9a7c9'
    },
    {
        name: 'xrechnung.zip',
        url: 'https://github.com/itplr-kosit/validator-configuration-xrechnung/releases/download/v2026-08-31/xrechnung-3.0.2-validator-configuration-2026-08-31.zip',
        sha256: '2530cd107c414511c5d0462ec10f886910395abfca820db82e83d70bf01221a8'
    },
    {
        name: 'PEPPOL-EN16931-CII.sch',
        url: 'https://raw.githubusercontent.com/OpenPeppol/peppol-bis-invoice-3/v3.0.20/rules/sch/PEPPOL-EN16931-CII.sch',
        sha256: 'a15bea71add713a425f0fab0043fdd5b03d54a62d27c4252ed6d8a4863da218d'
    },
    {
        // the Schematron compiler, as XSLT run by the Saxon inside the validator
        name: 'schxslt.jar',
        url: 'https://repo1.maven.org/maven2/name/dmaus/schxslt/schxslt/1.10.1/schxslt-1.10.1.jar',
        sha256: '4f4f21edab7b37f96ad59ae12a344d3510f1092ac46b6d81a4efa0120b73cb58'
    }
];

/**
 * Where the artifacts are kept between runs.
 */
const CACHE_FOLDER: string = path.join(tmpdir(), 'zibri-kosit-validator');

/**
 * Where the XRechnung configuration is unpacked, which the Peppol scenario reads its schema and the
 * rules of EN 16931 from as well.
 */
const REPOSITORY: string = '/validation/repository';

/**
 * The scenario checking a Peppol invoice written as CII, laid out like the scenarios of KoSIT's own
 * configurations.
 */
const PEPPOL_CII_SCENARIOS: string = `<?xml version="1.0" encoding="UTF-8"?>
<scenarios xmlns="http://www.xoev.de/de/validator/framework/1/scenarios" frameworkVersion="1.0.0">
  <name>Peppol BIS Billing 3.0 (CII)</name>
  <author>zibri</author>
  <date>2026-10-16</date>
  <description>
    <p>The rules of EN 16931 of the XRechnung configuration, and Peppol's rules for CII of peppol-bis-invoice-3 v3.0.20.</p>
  </description>
  <scenario>
    <name>Peppol BIS Billing 3.0 (CII)</name>
    <description>
      <p>Validates UN/CEFACT XML (SCRDM - CII uncoupled) version D16B.</p>
    </description>
    <namespace prefix="rsm">urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100</namespace>
    <namespace prefix="ram">urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100</namespace>
    <namespace prefix="rep">http://www.xoev.de/de/validator/varl/1</namespace>
    <match>exists(/rsm:CrossIndustryInvoice[rsm:ExchangedDocumentContext/ram:GuidelineSpecifiedDocumentContextParameter/ram:ID/text() = 'urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0'])</match>
    <validateWithXmlSchema>
      <resource>
        <name>XML Schema for UN/CEFACT XML (SCRDM - CII uncoupled)</name>
        <location>resources/cii/16b/xsd/CrossIndustryInvoice_100pD16B.xsd</location>
      </resource>
    </validateWithXmlSchema>
    <validateWithSchematron>
      <resource>
        <name>Schematron rules for EN16931 (CII)</name>
        <location>resources/cii/16b/xsl/EN16931-CII-validation.xsl</location>
      </resource>
    </validateWithSchematron>
    <validateWithSchematron>
      <resource>
        <name>Schematron rules for Peppol BIS Billing 3.0 (CII)</name>
        <location>peppol/PEPPOL-EN16931-CII.xsl</location>
      </resource>
    </validateWithSchematron>
    <createReport>
      <resource>
        <name>Validation report for Peppol BIS Billing 3.0 (CII)</name>
        <location>resources/xrechnung-report.xsl</location>
      </resource>
    </createReport>
    <acceptMatch>/rep:report/rep:assessment[1]/rep:accept[1]</acceptMatch>
  </scenario>
  <noScenarioReport>
    <resource>
      <name>Default Report</name>
      <location>resources/default-report.xsl</location>
    </resource>
  </noScenarioReport>
</scenarios>
`;

/**
 * The electronic invoice formats the plugin writes, and the scenarios each is checked by.
 */
const FORMATS: { name: string, scenarios: string, invoices: Record<string, Invoice>, generateXml: (invoice: Invoice) => Promise<string> }[] = [
    {
        name: 'xrechnung',
        scenarios: `${REPOSITORY}/scenarios.xml`,
        // the customer named by their email, and a fractional yen price, which XRechnung has no rule against
        invoices: getInvoices(undefined, 1000.5),
        generateXml: async invoice => await inject(XRechnungConformanceService).generateXml(invoice, 'Europe/Berlin')
    },
    {
        name: 'peppol',
        scenarios: '/validation/peppol-cii-scenarios.xml',
        // Peppol names the customer by their electronic address only, and refuses a line half a yen from
        // its quantity times its price - which invoicing.electronic-invoice.test.ts sees it do
        invoices: getInvoices({ scheme: '9930', value: 'DE987654321' }, 1001),
        generateXml: async invoice => await inject(PeppolConformanceService).generateXml(invoice, 'Europe/Berlin')
    }
];

/**
 * An item, a new object for its VAT each time, as items read from a data source are.
 * @param price - Its price.
 * @param vat - Its VAT.
 * @param amount - How many of it.
 * @returns The item.
 */
function itemOf(price: number, vat: InvoiceItem['vat'] = { categoryCode: 'S', rate: 19 }, amount: number = 1): InvoiceItem {
    return { name: 'Consulting', amount, amountUnit: { code: 'HUR', displayName: 'Hours' }, vat: { ...vat }, price };
}

/**
 * An invoice of the given items, with everything else EN 16931 asks of one.
 * @param items - Its items.
 * @param buyerElectronicAddress - The address the customer receives electronic invoices at, if any.
 * @param currency - Its currency.
 * @returns The invoice.
 */
function invoiceOf(items: InvoiceItem[], buyerElectronicAddress: ElectronicAddress | undefined, currency: CurrencyCode = 'EUR'): Invoice {
    return {
        id: UUIDUtilities.generate(),
        tenantId: UUIDUtilities.generate(),
        // cspell:disable-next-line
        number: '2026-GREATC-0001',
        items,
        date: new Date(Date.UTC(2026, 9, 16)),
        performanceDate: new Date(Date.UTC(2026, 9, 15)),
        dueDate: new Date(Date.UTC(2026, 9, 30)),
        customerAddressData: {
            formOfAddress: '',
            firstName: '',
            lastName: '',
            street: 'Great Street',
            number: '42',
            postcode: '12345',
            city: 'Great City',
            company: true,
            companyName: 'Great Company LLC',
            countryId: 'DE',
            email: 'info@great-company-llc.com',
            electronicAddress: buyerElectronicAddress
        },
        textBeforeItems: [],
        textAfterItems: [],
        currency
    };
}

/**
 * Gets the invoices checked, by a name their files are told apart by.
 * @param buyerElectronicAddress - The address the customer receives electronic invoices at, if any.
 * @param yenPrice - The price of the invoice in yen.
 * @returns The invoices.
 */
function getInvoices(buyerElectronicAddress: ElectronicAddress | undefined, yenPrice: number): Record<string, Invoice> {
    return {
        // the VAT of each line would be 1.8981, rounded 1.90 and 5.70 all told, where the group's is 5.69
        'mixed-rates': invoiceOf([itemOf(9.99), itemOf(9.99), itemOf(9.99), itemOf(10.05, { categoryCode: 'S', rate: 7 })], buyerElectronicAddress),
        'fractional-quantity': invoiceOf(
            [itemOf(50, { categoryCode: 'S', rate: 19 }, 4.752136), itemOf(90, { categoryCode: 'S', rate: 19 }, 4)],
            buyerElectronicAddress
        ),
        'tax-exempt': invoiceOf([itemOf(90, { categoryCode: 'E', rate: 0, exemptionReason: '§19 small business' }, 4)], buyerElectronicAddress),
        'credit-line': invoiceOf([itemOf(100), itemOf(-50, { categoryCode: 'S', rate: 7 })], buyerElectronicAddress),
        yen: invoiceOf([itemOf(yenPrice)], buyerElectronicAddress, 'JPY')
    };
}

/**
 * Gets the sha256 of the given content.
 * @param content - The content.
 * @returns The sha256, as hex.
 */
function getSha256(content: Buffer): string {
    return createHash('sha256').update(content)
        .digest('hex');
}

/**
 * Resolves an artefact from the cache, downloading it when the cache has no copy matching its checksum.
 * @param artefact - The artefact.
 * @returns Where it is on disk.
 * @throws When the download fails, or downloads something else than what is pinned.
 */
async function resolveArtefact(artefact: Artefact): Promise<string> {
    const file: string = path.join(CACHE_FOLDER, artefact.name);
    const cached: Buffer | undefined = await readFile(file).catch(() => undefined);
    if (cached != undefined && getSha256(cached) === artefact.sha256) {
        return file;
    }
    const response: Response = await fetch(artefact.url);
    if (!response.ok) {
        throw new Error(`Downloading ${artefact.url} answered ${response.status}.`);
    }
    const content: Buffer = Buffer.from(await response.arrayBuffer());
    const sha256: string = getSha256(content);
    if (sha256 !== artefact.sha256) {
        throw new Error(`${artefact.url} has the sha256 ${sha256}, where ${artefact.sha256} is pinned.`);
    }
    await mkdir(CACHE_FOLDER, { recursive: true });
    await writeFile(file, content);
    return file;
}

describe('the electronic invoices, checked by the KoSIT validator', () => {
    let server: StartedTestServer | undefined;
    let validator: StartedTestContainer | undefined;

    /**
     * Runs a command in the validator's container.
     * @param command - The command, run by a shell.
     * @param countsRejections - Whether the command is a validation, which exits with the number of
     * documents it rejected: the reports say which and why, so only a negative code is a failure.
     * @returns What it wrote.
     * @throws When it fails.
     */
    async function run(command: string, countsRejections: boolean = false): Promise<string> {
        if (validator == undefined) {
            throw new Error('The validator did not start.');
        }
        const { output, exitCode } = await validator.exec(['sh', '-c', command]);
        if (countsRejections ? exitCode < 0 : exitCode !== 0) {
            throw new Error(`"${command}" exited with ${exitCode}:\n${output}`);
        }
        return output;
    }

    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [createInMemoryDataSource({ entities: [...defaultTestServerEntities, Invoice, NumberInvoices, InvoiceRecipientAbbreviation] })],
            plugins: [new ZibriInvoicingPlugin()],
            providers: [
                ...defaultTestServerProviders,
                companyInfoProvider(() => ({
                    name: 'Example Company',
                    fullName: 'Example Company LLC',
                    email: 'info@example-company.com',
                    phone: '12345 67890123',
                    address: { street: 'Example street', number: '1b', postcode: '12345', city: 'Example city', countryId: 'DE' },
                    taxNumber: '123/456/78910',
                    vatNumber: 'DE123456789',
                    electronicAddress: { scheme: '9930', value: 'DE123456789' },
                    ceo: 'James Smith',
                    iban: 'DE75512108001245126199',
                    // cspell:disable-next-line
                    bic: 'ABCDDEFFXXX'
                }))
            ]
        });

        const files: { source: string, target: string }[] = [];
        for (const artefact of ARTIFACTS) {
            files.push({ source: await resolveArtefact(artefact), target: `/validation/${artefact.name}` });
        }
        const documents: { content: string, target: string }[] = [{ content: PEPPOL_CII_SCENARIOS, target: '/validation/peppol-cii-scenarios.xml' }];
        for (const format of FORMATS) {
            for (const [name, invoice] of Object.entries(format.invoices)) {
                documents.push({ content: await format.generateXml(invoice), target: `/invoices/${format.name}/${name}.xml` });
            }
        }

        validator = await new GenericContainer(VALIDATOR_IMAGE)
            .withCommand(['sleep', 'infinity'])
            .withCopyFilesToContainer(files)
            .withCopyContentToContainer(documents)
            .start();

        await run(`mkdir -p ${REPOSITORY} && cd ${REPOSITORY} && jar xf /validation/xrechnung.zip`);
        await run('mkdir -p /validation/schxslt && cd /validation/schxslt && jar xf /validation/schxslt.jar xslt');
        await run([
            // cspell:disable-next-line
            `mkdir -p ${REPOSITORY}/peppol && java -cp /validation/validator.jar net.sf.saxon.Transform`,
            '-s:/validation/PEPPOL-EN16931-CII.sch',
            // cspell:disable-next-line
            '-xsl:/validation/schxslt/xslt/2.0/pipeline-for-svrl.xsl',
            `-o:${REPOSITORY}/peppol/PEPPOL-EN16931-CII.xsl`
        ].join(' '));
        for (const format of FORMATS) {
            await run(
                `java -jar /validation/validator.jar -s ${format.scenarios} -r ${REPOSITORY} -o /reports/${format.name} /invoices/${format.name}/*.xml`,
                true
            );
        }
    }, 50000);

    afterAll(async () => {
        await validator?.stop();
        await server?.shutdown();
    }, 15000);

    describe.each(FORMATS.map(f => [f.name, Object.keys(f.invoices)] as const))('%s', (format, names) => {
        it.each(names)('accepts the invoice "%s", with no error', async name => {
            const report: string = await run(`cat /reports/${format}/${name}*.xml`);

            // every error, with the rule it broke, so a failure says what to fix
            const errors: string[] = [...report.matchAll(/<rep:message\b([^>]*)>([\S\s]*?)<\/rep:message>/g)]
                .filter(([, attributes]) => attributes?.includes('level="error"') === true)
                .map(([, attributes, text]) => `${/code="([^"]*)"/.exec(attributes ?? '')?.[1] ?? 'no code'}: ${text?.trim() ?? ''}`);
            expect({ accepted: /<rep:accept\b/.test(report), errors }).toEqual({ accepted: true, errors: [] });
        });
    });
});