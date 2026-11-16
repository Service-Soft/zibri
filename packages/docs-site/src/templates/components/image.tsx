import { MdxImageProps, TsxComponent, useContext } from 'zibri';

import { DocsPageContext } from './docs-page-context';
import { ImageUtilities } from '../../navigation/image.utilities';

// an image beside its page, which the build copies into the assets
export const Image: TsxComponent<MdxImageProps> = ({ src, alt, title }) => {
    const file: string = useContext(DocsPageContext);
    return <img src={ImageUtilities.resolveImage(src, file)} alt={alt} title={title} className="max-w-full rounded-sm"/>;
};