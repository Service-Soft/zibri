import { type EBilanzExporterModel } from 'zibri-contract';

import { Property } from '../../../../entity/decorators/property.decorator';

/**
 * A format the E-Bilanz can be downloaded in, to be filed by hand.
 */
export class EBilanzExporterInfo implements EBilanzExporterModel {
    /**
     * The name of the exporter, which an export names.
     */
    @Property.string()
    name!: string;

    /**
     * The mime type of the file it writes.
     */
    @Property.string()
    mimeType!: string;

    /**
     * The extension of the file it writes.
     */
    @Property.string()
    fileExtension!: string;
}