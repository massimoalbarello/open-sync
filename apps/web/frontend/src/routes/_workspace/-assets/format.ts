export type PreviewFormat = 'image' | 'video' | 'audio' | 'pdf' | 'docx' | 'spreadsheet' | 'text';

const extensions: Record<string, PreviewFormat> = {
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  gif: 'image',
  webp: 'image',
  avif: 'image',
  bmp: 'image',
  svg: 'image',
  mp4: 'video',
  webm: 'video',
  mov: 'video',
  ogv: 'video',
  mp3: 'audio',
  wav: 'audio',
  ogg: 'audio',
  m4a: 'audio',
  flac: 'audio',
  pdf: 'pdf',
  docx: 'docx',
  xls: 'spreadsheet',
  xlsx: 'spreadsheet',
  xlsm: 'spreadsheet',
  xlsb: 'spreadsheet',
  ods: 'spreadsheet',
  csv: 'spreadsheet',
  tsv: 'spreadsheet',
  txt: 'text',
  md: 'text',
  json: 'text',
  xml: 'text',
  log: 'text',
  yaml: 'text',
  yml: 'text',
};
const mediaTypes: Record<string, PreviewFormat> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'spreadsheet',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'spreadsheet',
  'application/vnd.oasis.opendocument.spreadsheet': 'spreadsheet',
  'text/csv': 'spreadsheet',
  'text/tab-separated-values': 'spreadsheet',
  'text/plain': 'text',
  'text/markdown': 'text',
  'application/json': 'text',
};
export function previewFormat(asset: {
  name: string;
  mediaType: string;
}): PreviewFormat | undefined {
  const mediaType = asset.mediaType.split(';')[0]!.trim().toLowerCase();
  if (mediaType.startsWith('image/')) {
    return 'image';
  }
  if (mediaType.startsWith('audio/')) {
    return 'audio';
  }
  if (mediaType.startsWith('video/')) {
    return 'video';
  }
  const extension = asset.name.split('.').pop()!.toLowerCase();
  return (
    (Object.hasOwn(mediaTypes, mediaType) ? mediaTypes[mediaType] : undefined) ??
    (Object.hasOwn(extensions, extension) ? extensions[extension] : undefined)
  );
}
