import { Button } from '@repo/ui/button';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/TextLayer.css';

const initialWidth = 640;

export default function PdfPreview({ url }: { url: string }) {
  const [worker, setWorker] = useState<InstanceType<typeof pdfjs.PDFWorker>>();
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(1);
  const [width, setWidth] = useState(initialWidth);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const port = new Worker(workerUrl, { type: 'module' });
    const instance = pdfjs.PDFWorker.create({ port });
    setWorker(instance);
    return () => {
      instance.destroy();
      port.terminate();
    };
  }, []);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      if (entry) {
        setWidth(Math.floor(entry.contentRect.width));
      }
    });
    if (container.current) {
      observer.observe(container.current);
    }
    return () => observer.disconnect();
  }, []);
  const options = useMemo(
    () => ({
      worker,
      isEvalSupported: false,
      cMapUrl: '/pdfjs/cmaps/',
      standardFontDataUrl: '/pdfjs/standard_fonts/',
      wasmUrl: '/pdfjs/wasm/',
    }),
    [worker],
  );
  return (
    <div ref={container} className="min-w-0 space-y-4">
      <div className="flex items-center gap-4">
        <Button variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          Previous page
        </Button>
        <span className="text-sm" aria-live="polite">
          Page {page} of {pages || '…'}
        </span>
        <Button
          variant="outline"
          disabled={!pages || page >= pages}
          onClick={() => setPage(page + 1)}
        >
          Next page
        </Button>
      </div>
      {worker && (
        <Document
          file={url}
          options={options}
          onLoadSuccess={({ numPages }) => setPages(numPages)}
          loading={<p role="status">Loading PDF…</p>}
          error={
            <p role="alert">
              This PDF could not be previewed. Download it to open it in a PDF reader.
            </p>
          }
        >
          <Page
            pageNumber={page}
            width={width}
            renderAnnotationLayer={false}
            loading={<p role="status">Rendering page…</p>}
          />
        </Document>
      )}
    </div>
  );
}
