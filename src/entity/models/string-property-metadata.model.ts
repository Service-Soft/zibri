export type StringPropertyMetadata = {
    required: boolean,
    type: 'string',
    primary: boolean
};

export type StringPropertyMetadataInput = Partial<StringPropertyMetadata> & Pick<StringPropertyMetadata, 'type'>;