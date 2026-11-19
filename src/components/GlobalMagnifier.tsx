import { useEffect, useRef, useState } from 'react';

const LENS_DIAMETER = 96;
const LENS_RADIUS = LENS_DIAMETER / 2;
const MAGNIFICATION = 1.26;

const MAGNIFIABLE_SELECTOR =
  'h1, h2, h3, h4, p, img, button, a, td, th, li, figcaption, blockquote, [data-magnify="true"]';

const INTERACTIVE_SELECTOR =
  'a, button, [role="button"], [role="tab"], input, select, textarea, label';

function isFormControl(el: Element | null): boolean {
  if (!el) return false;
  return Boolean(el.closest('input, textarea, select, [contenteditable="true"]'));
}

function findMagnifiableTarget(el: Element | null): HTMLElement | null {
  if (!el || isFormControl(el)) return null;
  // Prefer direct image first for crisp photo magnification
  if (el instanceof HTMLImageElement) return el;

  const candidate = el.closest(MAGNIFIABLE_SELECTOR);
  if (!(candidate instanceof HTMLElement)) return null;
  if (candidate.closest('[data-magnifier-ignore="true"]')) return null;

  const rect = candidate.getBoundingClientRect();
  // Skip tiny icons or massive full-page wrappers
  if (rect.width < 12 || rect.height < 10) return null;
  if (rect.width > 1280 || rect.height > 780) return null;

  return candidate;
}

function stripInteractiveIds(node: HTMLElement) {
  node.removeAttribute('id');
  node.setAttribute('aria-hidden', 'true');
  node.style.pointerEvents = 'none';
  node.querySelectorAll('[id]').forEach((child) => child.removeAttribute('id'));
  node.querySelectorAll('a, button, input, select, textarea').forEach((ctrl) => {
    ctrl.setAttribute('tabindex', '-1');
  });
}

/**
 * Global desktop magnifying-glass cursor overlay.
 * - Glides smoothly across every page & section via compositor-only transform interpolation.
 * - Realistically magnifies text, headings, buttons, and images directly beneath the circular lens.
 * - Translucent frosted crystal lens with pale-blue/violet glowing rim, specular reflection, and soft handle.
 * - Strictly pointer-events: none so clicks, links, buttons, text selection, and scrolling are never blocked.
 * - Automatically disabled on touchscreens, small viewports, and prefers-reduced-motion.
 */
export function GlobalMagnifier() {
  const [enabled, setEnabled] = useState(false);

  const shellRef = useRef<HTMLDivElement | null>(null);
  const lensBodyRef = useRef<HTMLDivElement | null>(null);
  const ringGlowRef = useRef<HTMLDivElement | null>(null);
  const mirrorHostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const coarseMq = window.matchMedia('(pointer: coarse)');
    const noHoverMq = window.matchMedia('(hover: none)');
    const reducedMq = window.matchMedia('(prefers-reduced-motion: reduce)');

    const evaluate = () => {
      const hasTouchOnly = coarseMq.matches || noHoverMq.matches;
      const isDesktopWidth = window.innerWidth >= 768;
      setEnabled(!hasTouchOnly && isDesktopWidth && !reducedMq.matches);
    };

    evaluate();
    coarseMq.addEventListener('change', evaluate);
    noHoverMq.addEventListener('change', evaluate);
    reducedMq.addEventListener('change', evaluate);
    window.addEventListener('resize', evaluate, { passive: true });

    return () => {
      coarseMq.removeEventListener('change', evaluate);
      noHoverMq.removeEventListener('change', evaluate);
      reducedMq.removeEventListener('change', evaluate);
      window.removeEventListener('resize', evaluate);
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;

    let rafId = 0;
    let visible = false;
    let isInteractive = false;
    let targetX = -200;
    let targetY = -200;
    let currentX = -200;
    let currentY = -200;

    let activeSourceEl: HTMLElement | null = null;
    let activeCloneEl: HTMLElement | null = null;
    let lastProbeAt = 0;

    const clearMirror = () => {
      activeSourceEl = null;
      activeCloneEl = null;
      if (mirrorHostRef.current) {
        mirrorHostRef.current.replaceChildren();
        mirrorHostRef.current.style.opacity = '0';
      }
    };

    const mountMirrorForElement = (source: HTMLElement) => {
      const host = mirrorHostRef.current;
      if (!host) return;

      const rect = source.getBoundingClientRect();
      const computed = window.getComputedStyle(source);

      const clone = source.cloneNode(true) as HTMLElement;
      stripInteractiveIds(clone);

      // Lock exact dimensions & computed typography so magnified letters align pixel-perfectly
      clone.style.position = 'absolute';
      clone.style.top = '0px';
      clone.style.left = '0px';
      clone.style.margin = '0';
      clone.style.width = `${rect.width}px`;
      clone.style.height = `${rect.height}px`;
      clone.style.boxSizing = 'border-box';
      clone.style.transformOrigin = '0 0';
      clone.style.willChange = 'transform';
      clone.style.fontFamily = computed.fontFamily;
      clone.style.fontSize = computed.fontSize;
      clone.style.fontWeight = computed.fontWeight;
      clone.style.lineHeight = computed.lineHeight;
      clone.style.letterSpacing = computed.letterSpacing;
      clone.style.textAlign = computed.textAlign;
      clone.style.color = computed.color;
      clone.style.background = computed.background;
      clone.style.borderRadius = computed.borderRadius;
      clone.style.padding = computed.padding;
      clone.style.display = computed.display === 'inline' ? 'inline-block' : computed.display;
      clone.style.whiteSpace = computed.whiteSpace;

      host.replaceChildren(clone);
      host.style.opacity = '1';
      activeSourceEl = source;
      activeCloneEl = clone;
    };

    const probeElementUnderCursor = (x: number, y: number) => {
      const hit = document.elementFromPoint(x, y);
      const nextInteractive = Boolean(hit && hit.closest(INTERACTIVE_SELECTOR));
      if (nextInteractive !== isInteractive) {
        isInteractive = nextInteractive;
        if (lensBodyRef.current) {
          lensBodyRef.current.style.transform = isInteractive ? 'scale(1.07)' : 'scale(1)';
        }
        if (ringGlowRef.current) {
          ringGlowRef.current.style.opacity = isInteractive ? '1' : '0.68';
        }
      }

      const nextTarget = findMagnifiableTarget(hit);
      if (nextTarget !== activeSourceEl) {
        if (nextTarget) {
          mountMirrorForElement(nextTarget);
        } else {
          clearMirror();
        }
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        visible = false;
        if (shellRef.current) shellRef.current.style.opacity = '0';
        return;
      }

      targetX = e.clientX;
      targetY = e.clientY;

      if (!visible) {
        currentX = targetX;
        currentY = targetY;
        visible = true;
        if (shellRef.current) shellRef.current.style.opacity = '1';
      }

      const now = performance.now();
      if (now - lastProbeAt > 24) {
        lastProbeAt = now;
        probeElementUnderCursor(e.clientX, e.clientY);
      }
    };

    const onMouseLeaveDocument = () => {
      visible = false;
      clearMirror();
      if (shellRef.current) shellRef.current.style.opacity = '0';
    };

    const onScrollOrResize = () => {
      if (visible) {
        probeElementUnderCursor(targetX, targetY);
      }
    };

    const tick = () => {
      if (visible && shellRef.current) {
        // Smooth Apple-like spring lerp
        currentX += (targetX - currentX) * 0.22;
        currentY += (targetY - currentY) * 0.22;

        shellRef.current.style.transform = `translate3d(${(currentX - LENS_RADIUS).toFixed(2)}px, ${(currentY - LENS_RADIUS).toFixed(2)}px, 0)`;

        // Align magnified mirror seamlessly to the smoothed lens center
        if (activeSourceEl && activeCloneEl) {
          if (!activeSourceEl.isConnected) {
            clearMirror();
          } else {
            const rect = activeSourceEl.getBoundingClientRect();
            const tx = LENS_RADIUS - (currentX - rect.left) * MAGNIFICATION;
            const ty = LENS_RADIUS - (currentY - rect.top) * MAGNIFICATION;
            activeCloneEl.style.transform = `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0) scale(${MAGNIFICATION})`;
          }
        }
      }
      rafId = window.requestAnimationFrame(tick);
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    document.addEventListener('mouseleave', onMouseLeaveDocument);
    window.addEventListener('blur', onMouseLeaveDocument);
    window.addEventListener('scroll', onScrollOrResize, { passive: true });

    rafId = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('mouseleave', onMouseLeaveDocument);
      window.removeEventListener('blur', onMouseLeaveDocument);
      window.removeEventListener('scroll', onScrollOrResize);
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div
      ref={shellRef}
      aria-hidden="true"
      data-magnifier-ignore="true"
      className="pointer-events-none fixed top-0 left-0 z-[90] opacity-0 transition-opacity duration-300 ease-out will-change-transform"
      style={{
        width: LENS_DIAMETER,
        height: LENS_DIAMETER,
      }}
    >
      <div
        ref={lensBodyRef}
        className="relative w-full h-full transition-transform duration-200 ease-out will-change-transform"
      >
        {/* Soft Outer Pale-Blue & Subtle Violet Optical Halo */}
        <div
          ref={ringGlowRef}
          className="absolute -inset-2 rounded-full transition-opacity duration-200 opacity-70"
          style={{
            background:
              'radial-gradient(circle, rgba(147, 197, 253, 0.2) 48%, rgba(139, 92, 246, 0.22) 72%, transparent 100%)',
            filter: 'blur(7px)',
          }}
        />

        {/* Angled Frosted-Aluminum & Sapphire Magnifier Handle */}
        <div
          className="absolute left-[80%] top-[80%] origin-top-left rotate-45"
          style={{ width: 28, height: 8 }}
        >
          <div
            className="w-full h-full rounded-full border border-white/80"
            style={{
              background:
                'linear-gradient(90deg, rgba(147, 197, 253, 0.92) 0%, rgba(167, 139, 250, 0.9) 55%, rgba(99, 102, 241, 0.85) 100%)',
              boxShadow:
                '0 4px 12px rgba(37, 99, 235, 0.22), inset 0 1px 1px rgba(255, 255, 255, 0.85)',
            }}
          />
        </div>

        {/* Circular Translucent Crystal Lens Body */}
        <div
          className="relative w-full h-full rounded-full overflow-hidden"
          style={{
            background:
              'radial-gradient(circle at 32% 28%, rgba(255, 255, 255, 0.52) 0%, rgba(239, 246, 255, 0.24) 55%, rgba(237, 233, 254, 0.22) 100%)',
            backdropFilter: 'contrast(1.04) saturate(1.08) brightness(1.02)',
            WebkitBackdropFilter: 'contrast(1.04) saturate(1.08) brightness(1.02)',
            boxShadow:
              '0 14px 32px -10px rgba(30, 58, 138, 0.2), 0 4px 14px -4px rgba(124, 58, 237, 0.16), inset 0 1.5px 2px rgba(255, 255, 255, 0.95), inset 0 -2px 8px rgba(147, 197, 253, 0.3)',
          }}
        >
          {/* Real Magnified Underlying Content Layer */}
          <div
            ref={mirrorHostRef}
            className="absolute inset-0 overflow-hidden opacity-0 transition-opacity duration-150"
            style={{
              background: 'rgba(255, 255, 255, 0.92)',
            }}
          />

          {/* Curved Glass Specular Reflection Arc (Top-Left) */}
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background:
                'radial-gradient(ellipse 68% 36% at 34% 18%, rgba(255, 255, 255, 0.72) 0%, rgba(255, 255, 255, 0.18) 54%, transparent 78%)',
            }}
          />

          {/* Subtle Optical Edge Vignette + Calibration Micro-Ticks */}
          <div
            className="absolute inset-0 rounded-full"
            style={{
              boxShadow: 'inset 0 0 14px rgba(147, 197, 253, 0.32)',
            }}
          />
          <span className="absolute top-1.5 left-1/2 -translate-x-1/2 w-[1px] h-2 bg-indigo-400/45" />
          <span className="absolute bottom-1.5 left-1/2 -translate-x-1/2 w-[1px] h-2 bg-indigo-400/45" />
          <span className="absolute left-1.5 top-1/2 -translate-y-1/2 h-[1px] w-2 bg-indigo-400/45" />
          <span className="absolute right-1.5 top-1/2 -translate-y-1/2 h-[1px] w-2 bg-indigo-400/45" />

          {/* Crisp Thin Pale-Blue / Electric-Violet Rim */}
          <div
            className="absolute inset-0 rounded-full pointer-events-none"
            style={{
              border: '1.5px solid transparent',
              background:
                'linear-gradient(135deg, rgba(96, 165, 250, 0.85), rgba(167, 139, 250, 0.88), rgba(219, 234, 254, 0.95)) border-box',
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
