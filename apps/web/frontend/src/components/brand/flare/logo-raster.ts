// biome-ignore-all lint/complexity/useMaxParams: Rasterization and Promise executor signatures.
// Adapted from https://vgpu.sh/examples/nextjs-flare/source.md (MIT, Vercel).

import logoSvg from '../../../assets/open-sync.svg?raw';
import { logoPixelSize } from './pipeline';

const logoDocument = () => {
  const document = new DOMParser().parseFromString(logoSvg, 'image/svg+xml');
  const root = document.documentElement;
  root.setAttribute('fill', 'none');
  root.setAttribute('stroke', '#ffffff');
  root.setAttribute('stroke-width', '0.14');
  return new XMLSerializer().serializeToString(root);
};

export async function rasterizeLogo(
  size: number,
  signal?: AbortSignal,
): Promise<HTMLCanvasElement> {
  if (signal?.aborted) {
    throw new DOMException('Logo rasterization aborted.', 'AbortError');
  }
  const [width, height] = logoPixelSize(size);
  const pad = 3;
  const canvas = document.createElement('canvas');
  canvas.width = width + pad * 2;
  canvas.height = height + pad * 2;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Could not create the logo raster canvas.');
  }
  const image = new Image();
  let abort: (() => void) | undefined;
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Could not decode the Open Sync logo SVG.'));
    abort = () => {
      image.onload = null;
      image.onerror = null;
      image.src = '';
      reject(new DOMException('Logo rasterization aborted.', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
  if (signal?.aborted) {
    abort?.();
  } else {
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(logoDocument())}`;
  }
  try {
    await loaded;
  } finally {
    image.onload = null;
    image.onerror = null;
    if (abort) {
      signal?.removeEventListener('abort', abort);
    }
  }
  if (signal?.aborted) {
    throw new DOMException('Logo rasterization aborted.', 'AbortError');
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, pad, pad, width, height);
  return canvas;
}
