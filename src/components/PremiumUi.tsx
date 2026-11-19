import { useState, type MouseEvent, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { MOTION_DURATION, MOTION_EASE, SCROLL_VIEWPORT } from '../lib/motion';

interface PremiumButtonProps {
  variant: 'primary' | 'secondary';
  children: ReactNode;
  onClick?: () => void;
  href?: string;
  size?: 'md' | 'lg';
  disabled?: boolean;
  className?: string;
}

/**
 * Apple-inspired luminous button for primary & secondary TruthLens CTAs.
 * Clean and minimal at rest; reveals soft electric-violet & pale-blue glow,
 * animated gradient drift, smooth elevation, cursor reflection, and light sweep on hover.
 */
export function PremiumButton({
  variant,
  children,
  onClick,
  href,
  size = 'lg',
  disabled = false,
  className = '',
}: PremiumButtonProps) {
  const [spot, setSpot] = useState({ x: 50, y: 50, active: false });

  const handleMove = (e: MouseEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    setSpot({
      x: ((e.clientX - rect.left) / rect.width) * 100,
      y: ((e.clientY - rect.top) / rect.height) * 100,
      active: true,
    });
  };

  const handleLeave = () => setSpot((prev) => ({ ...prev, active: false }));

  const isPrimary = variant === 'primary';
  const sizeClasses =
    size === 'lg' ? 'px-6 py-3 text-[14px] rounded-xl' : 'px-4 py-2 text-[13px] rounded-lg';

  const baseClasses = `group relative isolate inline-flex items-center justify-center gap-2.5 font-medium overflow-hidden whitespace-nowrap shrink-0 cursor-pointer select-none transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] focus-visible:ring-offset-2 focus-visible:ring-offset-white hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.985] disabled:opacity-50 disabled:pointer-events-none ${sizeClasses} ${
    isPrimary
      ? 'text-white border border-[#4338CA]/20 shadow-[0_6px_20px_-6px_rgba(37,99,235,0.28)] hover:border-[#8B5CF6]/55 hover:shadow-[0_16px_36px_-8px_rgba(124,58,237,0.42),0_6px_18px_-4px_rgba(59,130,246,0.3)]'
      : 'text-[#172554] bg-white/80 backdrop-blur-md border border-[#CBDDF8] shadow-[0_2px_10px_-4px_rgba(30,58,138,0.08)] hover:bg-white hover:text-[#4C1D95] hover:border-[#A78BFA]/70 hover:shadow-[0_14px_30px_-10px_rgba(124,58,237,0.22),0_4px_14px_-4px_rgba(96,165,250,0.22)]'
  } ${className}`;

  const innerContent = (
    <>
      {/* Animated gradient layer for primary button (clean deep navy-blue at rest, shifts toward electric violet on hover) */}
      {isPrimary && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] bg-[length:220%_220%] bg-[position:0%_50%] group-hover:bg-[position:100%_50%]"
          style={{
            backgroundImage:
              'linear-gradient(115deg, #172554 0%, #2563EB 44%, #7C3AED 78%, #6D28D9 100%)',
          }}
        />
      )}

      {/* Subtle pale-blue/lavender tint wash on hover for secondary button */}
      {!isPrimary && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          style={{
            background:
              'linear-gradient(120deg, rgba(239, 246, 255, 0.85) 0%, rgba(243, 240, 255, 0.9) 100%)',
          }}
        />
      )}

      {/* Cursor-responsive interactive reflection */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 transition-opacity duration-300"
        style={{
          opacity: spot.active ? 1 : 0,
          background: isPrimary
            ? `radial-gradient(125px circle at ${spot.x}% ${spot.y}%, rgba(255, 255, 255, 0.34), rgba(196, 181, 253, 0.16) 52%, transparent 78%)`
            : `radial-gradient(125px circle at ${spot.x}% ${spot.y}%, rgba(167, 139, 250, 0.22), rgba(147, 197, 253, 0.16) 54%, transparent 80%)`,
        }}
      />

      {/* Specular diagonal light sweep across button face on hover */}
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute inset-y-0 -left-2/3 w-1/2 -skew-x-12 opacity-0 transition-all duration-700 ease-out group-hover:left-[135%] group-hover:opacity-100 ${
          isPrimary
            ? 'bg-gradient-to-r from-transparent via-white/30 to-transparent'
            : 'bg-gradient-to-r from-transparent via-[#C4B5FD]/35 to-transparent'
        }`}
      />

      <span className="relative z-10 inline-flex items-center gap-2.5">{children}</span>
    </>
  );

  if (href) {
    return (
      <a
        href={href}
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
        className={baseClasses}
      >
        {innerContent}
      </a>
    );
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      className={baseClasses}
    >
      {innerContent}
    </button>
  );
}

interface GlassCardProps {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
}

/**
 * Apple-inspired frosted glass card with cursor-responsive pale-blue/violet lighting
 * and clean idle restraint.
 */
export function GlassCard({ children, className = '', interactive = true }: GlassCardProps) {
  const [light, setLight] = useState({ x: 50, y: 50, active: false });

  const handleMove = (e: MouseEvent<HTMLDivElement>) => {
    if (!interactive) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    setLight({
      x: ((e.clientX - rect.left) / rect.width) * 100,
      y: ((e.clientY - rect.top) / rect.height) * 100,
      active: true,
    });
  };

  const handleLeave = () => {
    if (!interactive) return;
    setLight((prev) => ({ ...prev, active: false }));
  };

  return (
    <div
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      className={`relative overflow-hidden rounded-2xl tl-glass-panel ${
        interactive ? 'tl-glass-panel-hover' : ''
      } ${className}`}
    >
      {interactive && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 transition-opacity duration-300"
          style={{
            opacity: light.active ? 1 : 0,
            background: `radial-gradient(280px circle at ${light.x}% ${light.y}%, rgba(167, 139, 250, 0.12), rgba(147, 197, 253, 0.1) 45%, transparent 75%)`,
          }}
        />
      )}
      <div className="relative z-10 h-full">{children}</div>
    </div>
  );
}

interface ScrollRevealProps {
  children: ReactNode;
  delay?: number;
  className?: string;
}

/**
 * Unified scroll-reveal wrapper using the app's single Apple deceleration curve.
 * Automatically renders immediately without animation under prefers-reduced-motion.
 */
export function ScrollReveal({ children, delay = 0, className = '' }: ScrollRevealProps) {
  const prefersReducedMotion = Boolean(useReducedMotion());

  if (prefersReducedMotion) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={SCROLL_VIEWPORT}
      transition={{
        duration: MOTION_DURATION.base,
        delay,
        ease: MOTION_EASE.apple,
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
