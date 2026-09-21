export type DocumentFormat = 'docx' | 'spreadsheet' | 'text';

export type DocumentPreview =
  | { type: 'html'; body: string }
  | { type: 'text'; body: string }
  | {
      type: 'spreadsheet';
      sheets: { name: string; rows: string[][]; columns: string[]; truncated: boolean }[];
      truncated: boolean;
    };

export const documentPreviewLimits = {
  bytes: 20_971_520,
  rows: 200,
  columns: 50,
  sheets: 20,
} as const;
