import {
  type DocumentFormat,
  type DocumentPreview,
  documentPreviewLimits as limits,
} from './contract';

self.onmessage = async (event: MessageEvent<{ format: DocumentFormat; buffer: ArrayBuffer }>) => {
  try {
    self.postMessage({ preview: await parse(event.data) });
  } catch {
    self.postMessage({
      error:
        'This file could not be previewed. It may be damaged, encrypted, or use an unsupported format.',
    });
  }
};

async function parse(input: {
  format: DocumentFormat;
  buffer: ArrayBuffer;
}): Promise<DocumentPreview> {
  if (input.format === 'docx') {
    const mammoth = await import('mammoth');
    const result = await mammoth.convertToHtml(
      { arrayBuffer: input.buffer },
      { externalFileAccess: false },
    );
    return { type: 'html', body: result.value };
  }
  if (input.format === 'spreadsheet') {
    const { read, utils } = await import('xlsx');
    const workbook = read(input.buffer, {
      type: 'array',
      sheetRows: limits.rows + 1,
      cellHTML: false,
      cellFormula: false,
    });
    return {
      type: 'spreadsheet',
      truncated: workbook.SheetNames.length > limits.sheets,
      sheets: workbook.SheetNames.slice(0, limits.sheets).map((name) => {
        const sheet = workbook.Sheets[name]!;
        if (!sheet['!ref']) {
          return { name, rows: [], columns: [], truncated: false };
        }
        const fullRange = utils.decode_range(sheet['!fullref'] ?? sheet['!ref']);
        const range = utils.decode_range(sheet['!ref']);
        range.e.r = Math.min(range.e.r, range.s.r + limits.rows - 1);
        range.e.c = Math.min(range.e.c, range.s.c + limits.columns - 1);
        return {
          name,
          rows: utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: '', range }),
          columns: Array.from(
            { length: range.e.c - range.s.c + 1 },
            // biome-ignore lint/complexity/useMaxParams: Array.from supplies the column index.
            (_, index) => utils.encode_col(range.s.c + index),
          ),
          truncated: fullRange.e.r > range.e.r || fullRange.e.c > range.e.c,
        };
      }),
    };
  }
  return { type: 'text', body: new TextDecoder().decode(input.buffer) };
}
