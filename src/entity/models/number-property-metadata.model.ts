export type NumberPropertyMetadata = {
    required: boolean,
    type: 'number',
    primary: boolean
};

export type NumberPropertyMetadataInput = Partial<NumberPropertyMetadata> & Pick<NumberPropertyMetadata, 'type'>;