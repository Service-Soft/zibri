import { type OmitStrict } from '../../../types/omit-strict.type';
import { type ProjectsPluginOptions } from './projects-plugin-options.model';

/**
 * Input for configuring the projects plugin: the guest roles, how users are named and how long an invitation lasts,
 * the columns of your own of an invitation unless none, and the events emitted unless none.
 */
export type ProjectsPluginOptionsInput = OmitStrict<ProjectsPluginOptions, 'invitationColumns' | 'eventNames'>
    & Partial<Pick<ProjectsPluginOptions, 'invitationColumns' | 'eventNames'>>;
