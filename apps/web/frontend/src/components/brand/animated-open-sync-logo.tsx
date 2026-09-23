import { cn } from '@repo/ui/class-names';
import { useEffect, useRef, useState } from 'react';
import type { RendererStatus } from './flare/renderer';
import { OpenSyncLogo } from './open-sync-logo';

export function AnimatedOpenSyncLogo({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<RendererStatus>('loading');
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let generation = 0;
    let dispose: (() => void) | undefined;
    const start = () => {
      const revision = ++generation;
      dispose?.();
      dispose = undefined;
      if (motion.matches || !navigator.gpu) {
        setStatus('unavailable');
        return;
      }
      setStatus('loading');
      void import('./flare/renderer')
        .then(({ createRenderer }) => {
          if (revision !== generation) {
            return;
          }
          dispose = createRenderer({ canvas, onStatus: setStatus }).dispose;
        })
        .catch(() => {
          if (revision === generation) {
            setStatus('unavailable');
          }
        });
    };
    motion.addEventListener('change', start);
    start();
    return () => {
      generation += 1;
      motion.removeEventListener('change', start);
      dispose?.();
    };
  }, []);
  return (
    <div
      aria-hidden="true"
      data-light-state={status}
      className={cn('logo-flare relative isolate overflow-hidden', className)}
    >
      <canvas ref={canvasRef} className="absolute inset-0 block size-full" />
      {status !== 'ready' && (
        <div className="absolute inset-0 flex items-center justify-center bg-inherit">
          <OpenSyncLogo className="size-[62cqw] max-h-[62cqh] max-w-[62cqh] text-foreground opacity-70" />
        </div>
      )}
    </div>
  );
}
