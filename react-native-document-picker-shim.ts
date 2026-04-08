import * as ExpoDocumentPicker from 'expo-document-picker';

type PickOptions = {
  type?: string[];
};

type PickResultItem = {
  uri: string;
  name?: string | null;
  size?: number | null;
  fileCopyUri?: string | null;
  mimeType?: string | null;
};

const DocumentPicker = {
  types: {
    allFiles: '*/*',
  },
  pick: async (options: PickOptions = {}): Promise<PickResultItem[]> => {
    const type = options.type && options.type.length > 0 ? options.type[0] : '*/*';

    const result = await ExpoDocumentPicker.getDocumentAsync({
      type,
      multiple: false,
      copyToCacheDirectory: true,
    });

    if ('canceled' in result && result.canceled) {
      throw new Error('Document picking cancelled');
    }

    const asset = 'assets' in result && result.assets && result.assets[0];

    if (!asset) {
      throw new Error('No document selected');
    }

    return [
      {
        uri: asset.uri,
        name: asset.name ?? null,
        size: asset.size ?? null,
        fileCopyUri: null,
        mimeType: asset.mimeType ?? null,
      },
    ];
  },
};

export default DocumentPicker;

