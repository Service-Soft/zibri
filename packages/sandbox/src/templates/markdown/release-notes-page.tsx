import { TsxComponent } from 'zibri';

import { BasePage } from '../components/base-page';
import ReleaseNotes from './release-notes.mdx';

// the page written in markdown inside the layout of the other pages, as an application renders one
export const ReleaseNotesPage: TsxComponent = () => {
    return (
        <BasePage title="Release notes" activeRoute="/release-notes">
            <ReleaseNotes/>
        </BasePage>
    );
};