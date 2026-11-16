import { MdxImageProps, TsxComponent } from 'zibri';

export const Image: TsxComponent<MdxImageProps> = ({ src, alt, title }) => {
    return <img src={src} alt={alt} title={title} className="max-w-full rounded-sm"/>;
};