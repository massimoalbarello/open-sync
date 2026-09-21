import { Button } from '@repo/ui/button';
import { Select } from '@repo/ui/select';
import { useQuery } from '@tanstack/react-query';
import DOMPurify from 'dompurify';
import { useState } from 'react';
import { assetPreviewOptions } from '../../../queries/asset-preview';
import type { DocumentPreview as Preview } from './document-worker';
import type { PreviewFormat } from './format';

export function DocumentPreview(input: { userId: string; id: string; format: PreviewFormat }) {
  const query = useQuery(assetPreviewOptions(input));
  if (query.isPending) {
    return <p role="status">Preparing preview…</p>;
  }
  if (query.error) {
    return (
      <div className="space-y-3">
        <p role="alert">{query.error.message}</p>
        <Button variant="outline" onClick={() => void query.refetch()}>
          Try again
        </Button>
      </div>
    );
  }
  const preview = query.data;
  if (preview.type === 'text') {
    return (
      <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-5 text-sm">
        {preview.body}
      </pre>
    );
  }
  if (preview.type === 'spreadsheet') {
    return <Spreadsheet preview={preview} />;
  }
  return (
    <iframe
      title="Document preview"
      sandbox=""
      className="h-[70vh] w-full rounded-lg border bg-white"
      srcDoc={`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><style>body{font:16px/1.65 system-ui,sans-serif;margin:32px;color:#202020;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{border-collapse:collapse;display:block;overflow:auto}td,th{border:1px solid #ddd;padding:8px}a{color:#2856a8}h1,h2,h3{line-height:1.3}</style></head><body>${DOMPurify.sanitize(preview.body, { USE_PROFILES: { html: true }, FORBID_TAGS: ['style'], FORBID_ATTR: ['style'] })}</body></html>`}
    />
  );
}
function Spreadsheet({ preview }: { preview: Extract<Preview, { type: 'spreadsheet' }> }) {
  const [name, setName] = useState(preview.sheets[0]?.name ?? '');
  const sheet = preview.sheets.find((item) => item.name === name);
  return (
    <div className="min-w-0 space-y-4">
      <div className="max-w-xs space-y-2">
        <label htmlFor="preview-sheet" className="text-sm">
          Sheet
        </label>
        <Select
          id="preview-sheet"
          value={name}
          onValueChange={setName}
          options={preview.sheets.map((item) => ({ value: item.name, label: item.name }))}
        />
      </div>
      {sheet?.rows.length ? (
        <div className="max-h-[65vh] overflow-auto rounded-lg border">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">{sheet.name}</caption>
            <thead className="sticky top-0 bg-muted">
              <tr>
                {sheet.columns.map((column) => (
                  <th
                    key={column}
                    scope="col"
                    className="border-border border-b px-4 py-2 text-left"
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sheet.rows.map(
                // biome-ignore lint/complexity/useMaxParams: Array.map supplies the fixed worksheet row index.
                (row, rowIndex) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: Worksheet rows are immutable and identified by their position.
                  <tr key={rowIndex}>
                    {sheet.columns.map(
                      // biome-ignore lint/complexity/useMaxParams: Array.map supplies the worksheet column index.
                      (column, index) => (
                        <td
                          key={column}
                          className="max-w-96 whitespace-pre-wrap break-words border-border border-b px-4 py-2"
                        >
                          {row[index]}
                        </td>
                      ),
                    )}
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <p>This sheet is empty.</p>
      )}
      {(sheet?.truncated || preview.truncated) && (
        <p className="text-muted-foreground text-sm">
          Preview limited to 200 rows, 50 columns, and 20 sheets. Download the workbook to view
          everything.
        </p>
      )}
    </div>
  );
}
