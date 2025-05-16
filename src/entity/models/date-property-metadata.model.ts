export type DatePropertyMetadata = {
    required: boolean,
    type: 'date'
};

export type DatePropertyMetadataInput = Partial<DatePropertyMetadata> & Pick<DatePropertyMetadata, 'type'>;