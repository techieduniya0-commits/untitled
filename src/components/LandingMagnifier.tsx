import { useEffect, useRef, useState, type RefObject } from 'react';

const LENS_SIZE = 140;
const LENS_HALF = LENS_SIZE / 2;
const ZOOM_FACTOR = 1.65;

interface LandingMagnifierProps {
  targetRef: RefObject<HTMLDivElement | null>;
}

/**
 * Real interactive optical magnifying glass — mounted EXCLUSIVELY on the TruthLens Landing Page.
 * - Renders a live synchronized 1.65× optically zoomed mirror of the exact landing page content
 *   underneath the circular glass lens.
 * - Clones the target subtree once on mount + resize (never during pointermove) and updates only
 *   compositor GPU transforms per frame for silky 60/120Hz real-time tracking with zero jitter.
 * - Automatically stays aligned during mouse movement and vertical scrolling.
 * - Strictly pointer-events-none so buttons, links, and scroll never get blocked.
 */
export function LandingMagnifier({ targetRef }: LandingMagnifierProps) {
  const [disabled, setDisabled] = useState(false);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const zoomLayerRef = useRef<HTMLDivElement | null>(null);
  const specularRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const mqMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const mqCoarse = window.matchMedia('(pointer: coarse)');
    const check = () => setDisabled(mqMotion.matches || mqCoarse.matches);
    check();
    mqMotion.addEventListener('change', check);
    mqCoarse.addEventListener('change', check);
    return () => {
      mqMotion.removeEventListener('change', check);
      mqCoarse.removeEventListener('change', check);
    };
  }, []);

  // Build and maintain a clean non-interactive mirror of the landing page content for real 1.65× zoom
  useEffect(() => {
    if (disabled) return;
    const targetEl = targetRef.current;
    const zoomHost = zoomLayerRef.current;
    if (!targetEl || !zoomHost) return;

    const rebuildClone = () => {
      const src = targetRef.current;
      const host = zoomLayerRef.current;
      if (!src || !host) return;

      const rect = src.getBoundingClientRect();
      if (rect.width <= 0) return;

      const clone = src.cloneNode(true) as HTMLElement;
      clone.setAttribute('aria-hidden', 'true');
      clone.style.width = `${rect.width}px`;
      clone.style.minHeight = `${rect.height}px`;
      clone.style.margin = '0';
      clone.style.pointerEvents = 'none';
      clone.style.userSelect = 'none';

      // Strip IDs to avoid duplicate DOM IDs, remove animated canvases, and reveal scroll-animated sections
      clone.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
      clone.querySelectorAll('canvas').forEach((el) => el.remove());
      clone.querySelectorAll('[data-scroll-reveal="true"]').forEach((el) => {
        const htmlEl = el as HTMLElement;
        htmlEl.style.opacity = '1';
        htmlEl.style.transform = 'none';
      });
      clone.querySelectorAll('h1 span, p, div').forEach((el) => {
        const htmlEl = el as HTMLElement;
        if (htmlEl.style.opacity === '0') {
          htmlEl.style.opacity = '1';
          htmlEl.style.transform = 'none';
        }
      });

      host.replaceChildren(clone);
    };

    // Initial build + delayed refresh after Framer Motion hero entrance settles
    rebuildClone();
    const settleTimer = window.setTimeout(rebuildClone, 950);

    let resizeTimer: number | null = null;
    const handleResize = () => {
      if (resizeTimer) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(rebuildClone, 180);
    };

    window.addEventListener('resize', handleResize, { passive: true });
    const ro =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => handleResize())
        : null;
    ro?.observe(targetEl);

    return () => {
      window.clearTimeout(settleTimer);
      if (resizeTimer) window.clearTimeout(resizeTimer);
      window.removeEventListener('resize', handleResize);
      ro?.disconnect();
      zoomHost.replaceChildren();
    };
  }, [disabled, targetRef]);

  // Smooth real-time pointer + scroll tracking synced with zoomed lens optics
  useEffect(() => {
    if (disabled) return;

    let rafId = 0;
    let lastTime = performance.now();
    let visible = false;
    let targetOpacity = 0;
    let currentOpacity = 0;

    let targetX = -300;
    let targetY = -300;
    let currentX = -300;
    let currentY = -300;

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        targetOpacity = 0;
        return;
      }
      targetX = e.clientX;
      targetY = e.clientY;

      const src = targetRef.current;
      const topBoundary = src ? Math.max(66, src.getBoundingClientRect().top) : 66;
      const insideLandingBody = e.clientY >= topBoundary;

      if (!visible && insideLandingBody) {
        currentX = e.clientX;
        currentY = e.clientY;
        visible = true;
      }
      targetOpacity = insideLandingBody ? 1 : 0;
    };

    const onLeave = () => {
      targetOpacity = 0;
    };

    const tick = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
      lastTime = now;

      const posFactor = 1 - Math.exp(-26 * dt);
      const opacityFactor = 1 - Math.exp(-14 * dt);

      const prevX = currentX;
      const prevY = currentY;
      currentX += (targetX - currentX) * posFactor;
      currentY += (targetY - currentY) * posFactor;
      currentOpacity += (targetOpacity - currentOpacity) * opacityFactor;

      if (currentOpacity < 0.004 && targetOpacity === 0) {
        currentOpacity = 0;
        visible = false;
      }

      if (rootRef.current) {
        rootRef.current.style.opacity = currentOpacity.toFixed(3);
        if (currentOpacity > 0.003) {
          const lx = currentX - LENS_HALF;
          const ly = currentY - LENS_HALF;
          rootRef.current.style.transform = `translate3d(${lx.toFixed(2)}px, ${ly.toFixed(2)}px, 0)`;
        }
      }

      // Align cloned page content inside the circular aperture so the exact point underneath
      // (currentX, currentY) maps pixel-accurately to the center (LENS_HALF, LENS_HALF) at 1.65×
      if (zoomLayerRef.current && targetRef.current && currentOpacity > 0.003) {
        const rect = targetRef.current.getBoundingClientRect();
        const localX = currentX - rect.left;
        const localY = currentY - rect.top;
        const tx = LENS_HALF - localX * ZOOM_FACTOR;
        const ty = LENS_HALF - localY * ZOOM_FACTOR;
        zoomLayerRef.current.style.transform = `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0) scale(${ZOOM_FACTOR})`;
      }

      if (specularRef.current && currentOpacity > 0.003) {
        const vx = Math.max(-6, Math.min(6, (currentX - prevX) * 0.4));
        const vy = Math.max(-6, Math.min(6, (currentY - prevY) * 0.4));
        specularRef.current.style.transform = `translate3d(${vx.toFixed(2)}px, ${vy.toFixed(2)}px, 0)`;
      }

      rafId = window.requestAnimationFrame(tick);
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    document.addEventListener('mouseleave', onLeave);
    window.addEventListener('blur', onLeave);
    rafId = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('mouseleave', onLeave);
      window.removeEventListener('blur', onLeave);
    };
  }, [disabled, targetRef]);

  if (disabled) return null;

  return (
    <div
      ref={rootRef}
      aria-hidden="true"
      className="pointer-events-none fixed top-0 left-0 z-[55] opacity-0 will-change-transform select-none"
      style={{
        width: LENS_SIZE,
        height: LENS_SIZE,
      }}
    >
      {/* Subtle Pale-Blue & Violet Optical Halo */}
      <div
        className="absolute -inset-2.5 rounded-full"
        style={{
          background:
            'radial-gradient(circle, rgba(96, 165, 250, 0.22) 45%, rgba(124, 58, 237, 0.16) 72%, transparent 100%)',
          filter: 'blur(9px)',
        }}
      />

      {/* Refined Angled Optical Loupe Handle */}
      <div
        className="absolute left-[82%] top-[82%] origin-top-left rotate-45"
        style={{ width: 32, height: 9 }}
      >
        <div
          className="w-full h-full rounded-full border border-white/85"
          style={{
            background:
              'linear-gradient(90deg, #60A5FA 0%, #8B5CF6 58%, #4F46E5 100%)',
            boxShadow:
              '0 6px 14px rgba(30, 58, 138, 0.22), inset 0 1px 1px rgba(255, 255, 255, 0.9)',
          }}
        />
      </div>

      {/* Circular Magnifying Glass Aperture Containing Real 1.65× Zoomed Content */}
      <div
        className="relative w-full h-full rounded-full overflow-hidden"
        style={{
          background:
            'linear-gradient(155deg, #FFFFFF 0%, #F4F9FF 50%, #EAF3FF 100%)',
          boxShadow:
            '0 18px 38px -12px rgba(30, 58, 138, 0.28), 0 6px 16px -4px rgba(124, 58, 237, 0.2), inset 0 1.5px 2px rgba(255, 255, 255, 0.95)',
        }}
      >
        {/* Synchronized Zoomed DOM Layer */}
        <div
          ref={zoomLayerRef}
          className="absolute top-0 left-0 origin-top-left will-change-transform pointer-events-none"
        />

        {/* Subtle Convex Crystal Reflection & Edge Vignette */}
        <div
          ref={specularRef}
          className="absolute -inset-2 rounded-full pointer-events-none will-change-transform"
          style={{
            background:
              'radial-gradient(ellipse 64% 30% at 34% 20%, rgba(255, 255, 255, 0.52) 0%, rgba(255, 255, 255, 0.08) 54%, transparent 78%)',
          }}
        />
        <div
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{
            boxShadow:
              'inset 0 0 16px rgba(37, 99, 235, 0.16), inset 0 1px 2px rgba(255, 255, 255, 0.9)',
          }}
        />

        {/* Minimalist Cardinal Precision Ticks */}
        <span className="absolute top-1.5 left-1/2 -translate-x-1/2 w-[1px] h-2 bg-[#6366F1]/50 pointer-events-none" />
        <span className="absolute bottom-1.5 left-1/2 -translate-x-1/2 w-[1px] h-2 bg-[#6366F1]/50 pointer-events-none" />
        <span className="absolute left-1.5 top-1/2 -translate-y-1/2 h-[1px] w-2 bg-[#6366F1]/50 pointer-events-none" />
        <span className="absolute right-1.5 top-1/2 -translate-y-1/2 h-[1px] w-2 bg-[#6366F1]/50 pointer-events-none" />

        {/* Crisp Blue-to-Violet Optical Lens Ring */}
        <div
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{
            border: '2px solid transparent',
            background:
              'linear-gradient(135deg, rgba(59, 130, 246, 0.9), rgba(124, 58, 237, 0.88), rgba(191, 219, 254, 0.95)) border-box',
            WebkitMask:
              'linear-gradient(#fff 0 0) padding-box, linear-gradient(#fff 0 0)',
            WebkitMaskComposite: 'xor',
            maskComposite: 'exclude',
          }}
        />
      </div>
    </div>
  );
}
