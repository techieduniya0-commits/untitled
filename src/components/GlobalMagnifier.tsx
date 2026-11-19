import { useEffect, useRef, useState } from 'react';

const LENS_SIZE = 86;
const LENS_HALF = LENS_SIZE / 2;

const INTERACTIVE_SELECTOR =
  'a, button, [role="button"], [role="tab"], input, select, textarea, label';

/**
 * Ultra-smooth, zero-jitter global optical magnifying glass.
 * - Uses delta-time normalized exponential damping (identical fluid physics on 60Hz, 120Hz, 144Hz).
 * - Pure compositor-only GPU transforms (zero DOM cloning or layout reads per frame — zero flicker or jumps).
 * - Responds naturally to pointer velocity with subtle glass specular light shift and interactive hover focus.
 * - Handles scrolling, route/section transitions, and touch devices gracefully (touch displays a brief
 *   non-blocking optical lens glide on tap/drag that fades cleanly without interfering with clicks or scroll).
 */
export function GlobalMagnifier() {
  const [reducedMotion, setReducedMotion] = useState(false);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const scaleRef = useRef<HTMLDivElement | null>(null);
  const specularRef = useRef<HTMLDivElement | null>(null);
  const auraRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (reducedMotion) return;

    let rafId = 0;
    let lastTime = performance.now();
    let visible = false;
    let targetOpacity = 0;
    let currentOpacity = 0;

    let targetX = -200;
    let targetY = -200;
    let currentX = -200;
    let currentY = -200;

    let targetScale = 1;
    let currentScale = 1;

    let lastProbeAt = 0;
    let touchFadeTimer: number | null = null;
    let isPressed = false;
    let isInteractive = false;

    const updateTargetScale = () => {
      targetScale = isPressed ? 0.94 : isInteractive ? 1.07 : 1;
    };

    const probeInteractive = (x: number, y: number) => {
      const hit = document.elementFromPoint(x, y);
      const nextInteractive = Boolean(hit && hit.closest(INTERACTIVE_SELECTOR));
      if (nextInteractive !== isInteractive) {
        isInteractive = nextInteractive;
        updateTargetScale();
        if (auraRef.current) {
          auraRef.current.style.opacity = nextInteractive ? '0.95' : '0.58';
        }
      }
    };

    const showAt = (x: number, y: number, immediateSnap: boolean) => {
      targetX = x;
      targetY = y;
      if (!visible || immediateSnap) {
        currentX = x;
        currentY = y;
        visible = true;
      }
      targetOpacity = 1;
    };

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        showAt(e.clientX, e.clientY, false);
        if (touchFadeTimer) window.clearTimeout(touchFadeTimer);
        touchFadeTimer = window.setTimeout(() => {
          targetOpacity = 0;
        }, 420);
        return;
      }

      showAt(e.clientX, e.clientY, !visible);

      const now = performance.now();
      if (now - lastProbeAt >= 60) {
        lastProbeAt = now;
        probeInteractive(e.clientX, e.clientY);
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        showAt(e.clientX, e.clientY, true);
        if (touchFadeTimer) window.clearTimeout(touchFadeTimer);
        touchFadeTimer = window.setTimeout(() => {
          targetOpacity = 0;
        }, 650);
        return;
      }
      isPressed = true;
      updateTargetScale();
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      isPressed = false;
      updateTargetScale();
    };

    const onLeaveViewport = () => {
      targetOpacity = 0;
      isPressed = false;
      isInteractive = false;
      updateTargetScale();
    };

    const onScroll = () => {
      if (visible && targetOpacity > 0) {
        const now = performance.now();
        if (now - lastProbeAt >= 80) {
          lastProbeAt = now;
          probeInteractive(targetX, targetY);
        }
      }
    };

    const tick = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
      lastTime = now;

      // Frame-rate independent smooth exponential interpolation (fluid on 60Hz & 120Hz+)
      const posFactor = 1 - Math.exp(-16 * dt);
      const scaleFactor = 1 - Math.exp(-14 * dt);
      const opacityFactor = 1 - Math.exp(-11 * dt);

      const prevX = currentX;
      const prevY = currentY;
      currentX += (targetX - currentX) * posFactor;
      currentY += (targetY - currentY) * posFactor;
      currentScale += (targetScale - currentScale) * scaleFactor;
      currentOpacity += (targetOpacity - currentOpacity) * opacityFactor;

      if (currentOpacity < 0.004 && targetOpacity === 0) {
        currentOpacity = 0;
        visible = false;
      }

      if (rootRef.current) {
        rootRef.current.style.opacity = currentOpacity.toFixed(3);
        if (currentOpacity > 0.003) {
          const x = currentX - LENS_HALF;
          const y = currentY - LENS_HALF;
          rootRef.current.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;
        }
      }

      if (scaleRef.current && currentOpacity > 0.003) {
        scaleRef.current.style.transform = `scale(${currentScale.toFixed(4)})`;
      }

      // Subtle velocity-reactive glass specular highlight drift (max ±5px)
      if (specularRef.current && currentOpacity > 0.003) {
        const vx = Math.max(-5, Math.min(5, (currentX - prevX) * 0.45));
        const vy = Math.max(-5, Math.min(5, (currentY - prevY) * 0.45));
        specularRef.current.style.transform = `translate3d(${vx.toFixed(2)}px, ${vy.toFixed(2)}px, 0)`;
      }

      rafId = window.requestAnimationFrame(tick);
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('pointerup', onPointerUp, { passive: true });
    document.addEventListener('mouseleave', onLeaveViewport);
    window.addEventListener('blur', onLeaveViewport);
    window.addEventListener('scroll', onScroll, { passive: true });

    rafId = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(rafId);
      if (touchFadeTimer) window.clearTimeout(touchFadeTimer);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('mouseleave', onLeaveViewport);
      window.removeEventListener('blur', onLeaveViewport);
      window.removeEventListener('scroll', onScroll);
    };
  }, [reducedMotion]);

  if (reducedMotion) return null;

  return (
    <div
      ref={rootRef}
      aria-hidden="true"
      className="pointer-events-none fixed top-0 left-0 z-[90] opacity-0 will-change-transform select-none"
      style={{
        width: LENS_SIZE,
        height: LENS_SIZE,
      }}
    >
      <div
        ref={scaleRef}
        className="relative w-full h-full will-change-transform"
      >
        {/* Subtle Pale-Blue & Soft Electric-Violet Ambient Halo */}
        <div
          ref={auraRef}
          className="absolute -inset-2.5 rounded-full transition-opacity duration-200 opacity-60"
          style={{
            background:
              'radial-gradient(circle, rgba(147, 197, 253, 0.22) 45%, rgba(139, 92, 246, 0.16) 72%, transparent 100%)',
            filter: 'blur(8px)',
          }}
        />

        {/* Refined Angled Optical Loupe Handle */}
        <div
          className="absolute left-[79%] top-[79%] origin-top-left rotate-45"
          style={{ width: 24, height: 7 }}
        >
          <div
            className="w-full h-full rounded-full border border-white/85"
            style={{
              background:
                'linear-gradient(90deg, rgba(147, 197, 253, 0.9) 0%, rgba(167, 139, 250, 0.86) 60%, rgba(99, 102, 241, 0.8) 100%)',
              boxShadow:
                '0 4px 12px rgba(30, 58, 138, 0.18), inset 0 1px 1px rgba(255, 255, 255, 0.9)',
            }}
          />
        </div>

        {/* Crystal Glass Circular Lens — Subtle Optical Clarity & Highlight Without Surrounding Distortion */}
        <div
          className="relative w-full h-full rounded-full overflow-hidden"
          style={{
            background:
              'radial-gradient(circle at 32% 28%, rgba(255, 255, 255, 0.42) 0%, rgba(239, 246, 255, 0.16) 54%, rgba(237, 233, 254, 0.14) 100%)',
            backdropFilter: 'contrast(1.06) brightness(1.03) saturate(1.1)',
            WebkitBackdropFilter: 'contrast(1.06) brightness(1.03) saturate(1.1)',
            boxShadow:
              '0 14px 30px -12px rgba(30, 58, 138, 0.2), 0 4px 12px -4px rgba(124, 58, 237, 0.14), inset 0 1.5px 2px rgba(255, 255, 255, 0.95), inset 0 -2px 8px rgba(147, 197, 253, 0.28)',
          }}
        >
          {/* Velocity-Responsive Curved Glass Specular Reflection */}
          <div
            ref={specularRef}
            className="absolute -inset-2 rounded-full will-change-transform"
            style={{
              background:
                'radial-gradient(ellipse 62% 32% at 36% 22%, rgba(255, 255, 255, 0.72) 0%, rgba(255, 255, 255, 0.16) 52%, transparent 78%)',
            }}
          />

          {/* Delicate Inner Optical Rim Shading */}
          <div
            className="absolute inset-0 rounded-full"
            style={{
              boxShadow: 'inset 0 0 12px rgba(147, 197, 253, 0.3)',
            }}
          />

          {/* Minimalist Cardinal Precision Ticks */}
          <span className="absolute top-1.5 left-1/2 -translate-x-1/2 w-[1px] h-1.5 bg-[#6366F1]/45" />
          <span className="absolute bottom-1.5 left-1/2 -translate-x-1/2 w-[1px] h-1.5 bg-[#6366F1]/45" />
          <span className="absolute left-1.5 top-1/2 -translate-y-1/2 h-[1px] w-1.5 bg-[#6366F1]/45" />
          <span className="absolute right-1.5 top-1/2 -translate-y-1/2 h-[1px] w-1.5 bg-[#6366F1]/45" />

          {/* Crisp Thin Pale-Blue to Soft Electric-Violet Border */}
          <div
            className="absolute inset-0 rounded-full"
            style={{
              border: '1.5px solid transparent',
              background:
                'linear-gradient(135deg, rgba(96, 165, 250, 0.85), rgba(167, 139, 250, 0.82), rgba(219, 234, 254, 0.95)) border-box',
              WebkitMask:
                'linear-gradient(#fff 0 0) padding-box, linear-gradient(#fff 0 0)',
              WebkitMaskComposite: 'xor',
              maskComposite: 'exclude',
            }}
          />
        </div>
      </div>
    </div>
  );
}
