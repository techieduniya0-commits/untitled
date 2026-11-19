/**
 * Continuous global white & pale-blue mixed ambient backdrop with subtle lavender depth.
 * Mounted once at the application root so every page, section, header, workspace, and footer
 * shares one uninterrupted atmospheric canvas with ultra-slow light drift.
 */
export function GlobalAmbientCanvas() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden select-none"
      style={{
        background:
          'linear-gradient(155deg, #FFFFFF 0%, #FAFCFF 32%, #F1F7FF 66%, #F6F4FF 100%)',
      }}
    >
      {/* Top-Left Soft Pale-Blue Daylight Wash */}
      <div
        className="absolute -top-[18%] -left-[12%] w-[62vw] h-[62vw] max-w-[880px] max-h-[880px] rounded-full blur-[110px] animate-ambient-primary"
        style={{
          background:
            'radial-gradient(circle, rgba(191, 219, 254, 0.52) 0%, rgba(219, 234, 254, 0.26) 46%, rgba(255, 255, 255, 0) 74%)',
        }}
      />

      {/* Top-Right Atmospheric Ice-Blue + Whisper of Lavender */}
      <div
        className="absolute -top-[14%] -right-[10%] w-[58vw] h-[58vw] max-w-[820px] max-h-[820px] rounded-full blur-[115px] animate-ambient-secondary"
        style={{
          background:
            'radial-gradient(circle, rgba(219, 234, 254, 0.58) 0%, rgba(237, 233, 254, 0.34) 48%, rgba(255, 255, 255, 0) 74%)',
        }}
      />

      {/* Mid-Left Subtle Electric-Violet / Lavender Horizon Glow */}
      <div
        className="absolute top-[42%] -left-[16%] w-[50vw] h-[50vw] max-w-[720px] max-h-[720px] rounded-full blur-[120px] animate-ambient-lavender"
        style={{
          background:
            'radial-gradient(circle, rgba(221, 214, 254, 0.36) 0%, rgba(219, 234, 254, 0.24) 50%, rgba(255, 255, 255, 0) 74%)',
        }}
      />

      {/* Bottom-Right Soft Pale-Blue & Periwinkle Corner Illumination */}
      <div
        className="absolute -bottom-[18%] -right-[8%] w-[60vw] h-[60vw] max-w-[860px] max-h-[860px] rounded-full blur-[120px] animate-ambient-primary"
        style={{
          background:
            'radial-gradient(circle, rgba(191, 219, 254, 0.48) 0%, rgba(233, 213, 255, 0.22) 46%, rgba(255, 255, 255, 0) 75%)',
        }}
      />

      {/* Pure White Center Dominance Veil to Keep Contrast Crisp */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 75% 65% at 50% 35%, rgba(255, 255, 255, 0.58) 0%, rgba(255, 255, 255, 0.14) 68%, rgba(255, 255, 255, 0) 100%)',
        }}
      />
    </div>
  );
}
