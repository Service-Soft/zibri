import { HandlebarUtilities } from './handlebar.utilities';
import { AssetServiceInterface } from '../assets/asset-service.interface';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { GlobalRegistry } from '../global/global-registry';
import { MailingListSubscriber } from '../plugin/mailing-list/models/mailing-list-subscriber.model';
import { MailingList } from '../plugin/mailing-list/models/mailing-list.model';
import { OmitStrict } from '../types/omit-strict.type';
import { FsUtilities, FsPath } from '../utilities/fs.utilities';

// eslint-disable-next-line jsdoc/require-jsdoc
export type BaseEmailTemplateData = {
    /**
     * The base data shared by all email templates.
     */
    base: {
        /**
         * The title of the email.
         */
        title: string,
        /**
         * The base url of the app.
         */
        baseUrl: string,
        /**
         * Data about the mailing list that this email belongs to. If any.
         */
        mailingListData?: {
            /**
             * The base route for everything regarding mailing lists.
             */
            mailingListBaseRoute: string,
            /**
             * The subscriber if the email belongs to a mailing list.
             */
            subscriber: MailingListSubscriber,
            /**
             * The mailing list that the email belongs to, if any.
             */
            list: MailingList
        }
    }
};

// eslint-disable-next-line jsdoc/require-jsdoc
export type BaseEmailTemplateDataInput = {
    /**
     * The base data shared by all email templates.
     */
    base: OmitStrict<BaseEmailTemplateData['base'], 'baseUrl'>
};

// eslint-disable-next-line jsdoc/require-jsdoc
export type BasePageTemplateData = {
    /**
     * The base data shared by all page templates.
     */
    base: {
        /**
         * The base url of the app.
         */
        baseUrl: string,
        /**
         * The title of the page.
         */
        title: string
    }
};

// eslint-disable-next-line jsdoc/require-jsdoc
export type BasePageTemplateDataInput = {
    /**
     * The base data shared by all page templates.
     */
    base: OmitStrict<BasePageTemplateData['base'], 'baseUrl'>
};

/**
 * Renders the email template with the given name.
 * @param templateName - The name of the template.
 * @param data - The data to fill into the template.
 * @returns The rendered html.
 */
export async function renderEmailTemplate<T extends BaseEmailTemplateDataInput>(templateName: `${string}.hbs`, data: T): Promise<string> {
    (data.base as BasePageTemplateData['base']).baseUrl = GlobalRegistry.getAppData('baseUrl') ?? '';
    const assetService: AssetServiceInterface = inject(ZIBRI_DI_TOKENS.ASSET_SERVICE);
    const content: string = await renderTemplate(
        FsUtilities.getPath(assetService.emailTemplatePath, templateName) as `${FsPath}.hbs`,
        data
    );
    return await renderTemplate(
        FsUtilities.getPath(assetService.emailTemplatePath, 'base-email.hbs') as `${FsPath}.hbs`,
        { content, base: data.base }
    );
}

/**
 * Renders the template at the given path with the given data.
 * @param path - The path of the handlebars template file.
 * @param data - The data to fill into the template.
 * @returns The rendered html string.
 */
export async function renderTemplate<T extends Record<string, unknown>>(path: `${FsPath}.hbs`, data: T): Promise<string> {
    const source: string = await FsUtilities.readFile(path as FsPath);
    return renderTemplateString(source, data);
}

/**
 * Renders the given handlebars template string as html, using the provided data as variables.
 * @param templateString - The handlebars template string.
 * @param data - The data to use inside the template.
 * @returns The rendered html content.
 */
export function renderTemplateString<T extends Record<string, unknown>>(
    templateString: string,
    data: T
): string {
    const template: HandlebarsTemplateDelegate<T> = HandlebarUtilities.render(templateString);
    const html: string = template(data);
    return html;
}