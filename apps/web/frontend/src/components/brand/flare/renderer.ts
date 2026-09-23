import { type Gpu, init, surface } from 'vgpu';
import { rasterizeLogo } from './logo-raster';
import {
  backingDimensions,
  canvasRaster,
  FlarePipeline,
  type FlarePlacement,
  followLight,
  LOGO_CENTER,
  mapAutonomousLight,
  type Point,
  runCleanups,
} from './pipeline';

export type RendererStatus = 'loading' | 'ready' | 'unavailable';
const MILLISECONDS_PER_SECOND = 1000;
const FRAMES_PER_SECOND = 30;
const FRAME_INTERVAL_MS = MILLISECONDS_PER_SECOND / FRAMES_PER_SECOND;
const MAX_FRAME_SECONDS = 0.05;
const PULSE_HOLD_SECONDS = 0.35;
const SUPERSAMPLE_DPR_THRESHOLD = 1.5;
const LOW_DPR_SUPERSAMPLE = 2;

export function createRenderer({
  canvas,
  onStatus,
}: {
  canvas: HTMLCanvasElement;
  onStatus: (status: RendererStatus) => void;
}) {
  let disposed = false;
  let gpu: Gpu | undefined;
  let pipeline: FlarePipeline | undefined;
  let placement: FlarePlacement | undefined;
  let animationFrame = 0;
  let light: Point = LOGO_CENTER;
  let pointer: Point | undefined;
  let pulseHold = 0;
  let frameIndex = 0;
  let staticDirty = true;
  let previousTime = 0;
  let previousRender = -Infinity;
  let visible = true;
  let inFlight = false;
  let generation = 0;
  let resizeTask: Promise<void> | undefined;
  let pendingResize = false;
  let rasterAbort: AbortController | undefined;
  const cleanups: (() => void)[] = [];
  const started = performance.now();

  const dispose = () => {
    if (disposed) {
      return;
    }
    disposed = true;
    generation += 1;
    runCleanups([
      () => cancelAnimationFrame(animationFrame),
      () => rasterAbort?.abort(),
      ...cleanups.reverse(),
      () => pipeline?.dispose(),
      () => gpu?.dispose(),
    ]);
  };
  const fail = (error: unknown) => {
    if (disposed) {
      return;
    }
    console.warn('Open Sync logo lighting unavailable:', error);
    onStatus('unavailable');
    dispose();
  };
  const schedule = () => {
    if (!disposed && !animationFrame && !document.hidden && visible && !inFlight) {
      animationFrame = requestAnimationFrame(tick);
    }
  };
  function tick(now: number) {
    animationFrame = 0;
    if (disposed || document.hidden || !visible || !pipeline || !placement) {
      return;
    }
    if (now - previousRender < FRAME_INTERVAL_MS) {
      schedule();
      return;
    }
    previousRender = now;
    const time = (now - started) / MILLISECONDS_PER_SECOND;
    const elapsed = Math.min(Math.max(time - previousTime, 0), MAX_FRAME_SECONDS);
    previousTime = time;
    light = followLight(light, pointer ?? mapAutonomousLight(time, placement), elapsed);
    pulseHold += ((pointer ? 1 : 0) - pulseHold) * (1 - Math.exp(-elapsed / PULSE_HOLD_SECONDS));
    try {
      pipeline.setFrameUniforms(placement, light, frameIndex, time, pulseHold);
      pipeline.draw(staticDirty);
      staticDirty = false;
      inFlight = true;
      void gpu!.gpu.queue
        .onSubmittedWorkDone()
        .then(() => {
          inFlight = false;
          if (disposed) {
            return;
          }
          if (frameIndex === 0) {
            onStatus('ready');
          }
          frameIndex += 1;
          schedule();
        })
        .catch(fail);
    } catch (error) {
      fail(error);
    }
  }
  const applySize = async (activePipeline: FlarePipeline) => {
    const revision = generation;
    const isStale = () => disposed || revision !== generation;
    const bounds = canvas.getBoundingClientRect();
    if (Math.min(bounds.width, bounds.height) <= 0) {
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    const size = backingDimensions(bounds.width, bounds.height, dpr);
    const supersample = dpr < SUPERSAMPLE_DPR_THRESHOLD ? LOW_DPR_SUPERSAMPLE : 1;
    const controller = new AbortController();
    rasterAbort = controller;
    try {
      const raster = await rasterizeLogo(Math.min(...size) * supersample, controller.signal);
      if (isStale()) {
        return;
      }
      const next = await activePipeline.replace(size, supersample, canvasRaster(raster), isStale);
      if (next) {
        placement = next;
        staticDirty = true;
        schedule();
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        throw error;
      }
    }
  };
  const drainResizes = async () => {
    while (pendingResize && !disposed && pipeline) {
      pendingResize = false;
      await applySize(pipeline);
    }
  };
  const resize = () => {
    pendingResize = true;
    generation += 1;
    rasterAbort?.abort();
    resizeTask ??= drainResizes()
      .catch(fail)
      .finally(() => {
        resizeTask = undefined;
      });
    return resizeTask;
  };
  const initialize = async () => {
    const nextGpu = await init({ label: 'open-sync-flare' });
    if (disposed) {
      nextGpu.dispose();
      return;
    }
    gpu = nextGpu;
    cleanups.push(gpu.onError(fail));
    void gpu.gpu.lost.then(() => fail(new Error('WebGPU device lost')));
    pipeline = new FlarePipeline(
      gpu,
      surface(gpu, canvas, { autoResize: false, alphaMode: 'opaque', format: 'bgra8unorm' }),
    );
    await resize();
    if (disposed) {
      return;
    }
    const observer = new ResizeObserver(() => {
      void resize();
    });
    observer.observe(canvas);
    cleanups.push(() => observer.disconnect());
    const visibility = new IntersectionObserver(([entry]) => {
      visible = Boolean(entry?.isIntersecting);
      schedule();
    });
    visibility.observe(canvas);
    cleanups.push(() => visibility.disconnect());
    const resetPointer = () => {
      pointer = undefined;
    };
    const movePointer = (event: PointerEvent) => {
      if (event.pointerType === 'touch') {
        return;
      }
      const bounds = canvas.getBoundingClientRect();
      pointer = [
        Math.min(1, Math.max(0, (event.clientX - bounds.left) / Math.max(1, bounds.width))),
        Math.min(1, Math.max(0, (event.clientY - bounds.top) / Math.max(1, bounds.height))),
      ];
    };
    canvas.addEventListener('pointermove', movePointer, { passive: true });
    canvas.addEventListener('pointerleave', resetPointer);
    document.addEventListener('visibilitychange', schedule);
    cleanups.push(() => canvas.removeEventListener('pointermove', movePointer));
    cleanups.push(() => canvas.removeEventListener('pointerleave', resetPointer));
    cleanups.push(() => document.removeEventListener('visibilitychange', schedule));
    schedule();
  };
  void initialize().catch(fail);
  return { dispose };
}
