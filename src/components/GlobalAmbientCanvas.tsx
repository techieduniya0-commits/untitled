/**
 * Consistent global pale-blue and pure-white mixed atmospheric gradient.
 * Predominantly soft white with a gentle, evenly distributed pale-blue tint across every
 * section and page so the gradient remains calm, refined, and continuously perceptible
 * without oversaturated blues or abrupt section boundaries.
 */
export function GlobalAmbientCanvas() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden select-none"
      style={{
        background:
          'linear-gradient(150deg, #FFFFFF 0%, #F4F9FF 34%, #EAF3FF 68%, #F3F7FF 100%)',
      }}
    >
      {/* Top-Left Calm Pale-Blue Atmospheric Wash */}
      <div
        className="absolute -top-[16%] -left-[10%] w-[58vw] h-[58vw] max-w-[820px] max-h-[820px] rounded-full blur-[110px] animate-ambient-primary"
        style={{
          background:
            'radial-gradient(circle, rgba(186, 220, 255, 0.56) 0%, rgba(219, 234, 254, 0.34) 48%, rgba(255, 255, 255, 0) 76%)',
        }}
      />

      {/* Top-Right Soft Ice-Blue & Whisper of Lavender Depth */}
      <div
        className="absolute -top-[10%] -right-[10%] w-[56vw] h-[56vw] max-w-[800px] max-h-[800px] rounded-full blur-[115px] animate-ambient-secondary"
        style={{
          background:
            'radial-gradient(circle, rgba(206, 228, 255, 0.54) 0%, rgba(233, 227, 255, 0.28) 50%, rgba(255, 255, 255, 0) 76%)',
        }}
      />

      {/* Center-Left Gentle Horizon Pale-Blue Mist (prevents flat white washout in mid-page) */}
      <div
        className="absolute top-[38%] -left-[12%] w-[52vw] h-[52vw] max-w-[740px] max-h-[740px] rounded-full blur-[120px] animate-ambient-lavender"
        style={{
          background:
            'radial-gradient(circle, rgba(203, 226, 255, 0.44) 0%, rgba(232, 241, 255, 0.26) 52%, rgba(255, 255, 255, 0) 76%)',
        }}
      />

      {/* Bottom-Right Balanced Pale-Blue Ambient Anchor */}
      <div
        className="absolute -bottom-[16%] -right-[8%] w-[58vw] h-[58vw] max-w-[840px] max-h-[840px] rounded-full blur-[115px] animate-ambient-primary"
        style={{
          background:
            'radial-gradient(circle, rgba(191, 219, 254, 0.52) 0%, rgba(224, 236, 255, 0.28) 48%, rgba(255, 255, 255, 0) 76%)',
        }}
      />

      {/* Subtle Soft-White Luminous Highlight Keeps Text Contrast Effortless Without Erasing Tint */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 68% 58% at 50% 24%, rgba(255, 255, 255, 0.42) 0%, rgba(255, 255, 255, 0.1) 66%, rgba(255, 255, 255, 0) 100%)',
        }}
      />
    </div>
  );
}
