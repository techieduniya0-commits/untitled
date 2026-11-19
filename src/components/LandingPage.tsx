import { useState } from 'react';
import {
  ArrowRight,
  AudioWaveform,
  FileSearch,
  FileText,
  Film,
  Image as ImageIcon,
  Layers,
  Scale,
  ScanEye,
  ShieldCheck,
} from 'lucide-react';
import { TruthLensLogo } from './TruthLensLogo';

interface LandingPageProps {
  onEnterWorkspace: (initialTab?: 'overview' | 'upload') => void;
}

const HERO_SPECIMEN_IMG =
  '/src/assets/images/forensic_specimen_architecture_1795085183127.jpg';
const OPTICS_SPECIMEN_IMG =
  '/src/assets/images/forensic_specimen_optics_1795085234710.jpg';

export function LandingPage({ onEnterWorkspace }: LandingPageProps) {
  const [previewTab, setPreviewTab] = useState<'signals' | 'watermark' | 'metadata'>('signals');
  const [heroImgError, setHeroImgError] = useState(false);
  const [opticsImgError, setOpticsImgError] = useState(false);

  return (
    <div className="min-h-screen bg-white text-[#172554]">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm border-b border-[#E5EAF2]">
        <div className="max-w-[1200px] mx-auto px-6 h-16 flex items-center justify-between gap-8">
          <a
            href="#home"
            className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] rounded-md"
          >
            <TruthLensLogo />
          </a>

          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-[#64748B]">
            <a
              href="#home"
              className="hover:text-[#172554] transition-colors whitespace-nowrap shrink-0"
            >
              Home
            </a>
            <a
              href="#features"
              className="hover:text-[#172554] transition-colors whitespace-nowrap shrink-0"
            >
              Features
            </a>
            <a
              href="#how-it-works"
              className="hover:text-[#172554] transition-colors whitespace-nowrap shrink-0"
            >
              How it works
            </a>
            <a
              href="#about"
              className="hover:text-[#172554] transition-colors whitespace-nowrap shrink-0"
            >
              About
            </a>
          </nav>

          <div className="shrink-0">
            <button
              type="button"
              onClick={() => onEnterWorkspace('overview')}
              className="px-4 py-2 text-sm font-medium text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] focus-visible:ring-offset-2"
            >
              Get started
            </button>
          </div>
        </div>
      </header>

      <main>
        {/* Hero Section */}
        <section id="home" className="pt-16 pb-20 lg:pt-24 lg:pb-24 border-b border-[#E5EAF2]">
          <div className="max-w-[1200px] mx-auto px-6">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-stretch">
              <div className="lg:col-span-6 flex flex-col justify-center">
                <p className="text-sm font-medium text-[#2563EB] mb-4">
                  Detect. Analyse. Verify.
                </p>
                <h1 className="text-[clamp(2.25rem,4vw,3.5rem)] font-bold leading-[1.08] tracking-[-0.03em] text-[#172554] max-w-xl">
                  Know What&apos;s Real. Detect What&apos;s AI.
                </h1>
                <p className="mt-6 text-[16px] leading-[1.65] text-[#64748B] max-w-[54ch]">
                  Analyse images, videos, documents and audio using multiple forensic detection
                  techniques. Discover AI-generated content, identify manipulation indicators and
                  understand the evidence behind every result.
                </p>

                <div className="mt-8 flex flex-wrap items-center gap-3.5">
                  <button
                    type="button"
                    onClick={() => onEnterWorkspace('upload')}
                    className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] focus-visible:ring-offset-2"
                  >
                    Start analysing
                    <ArrowRight className="w-4 h-4" />
                  </button>
                  <a
                    href="#features"
                    className="inline-flex items-center px-5 py-2.5 text-sm font-medium text-[#172554] bg-white hover:bg-[#F5F7FB] border border-[#E5EAF2] rounded-lg transition-colors whitespace-nowrap shrink-0"
                  >
                    Explore features
                  </a>
                </div>

                <div className="mt-10 pt-6 border-t border-[#E5EAF2] flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-[#64748B]">
                  <span>5 media pipelines</span>
                  <span aria-hidden="true">·</span>
                  <span>Dedicated watermark &amp; OCR scanner</span>
                  <span aria-hidden="true">·</span>
                  <span>Explainable experimental scoring</span>
                </div>
              </div>

              {/* Interactive Product Preview */}
              <div className="lg:col-span-6 flex flex-col">
                <div className="flex-1 bg-[#F5F7FB] border border-[#E5EAF2] rounded-xl p-5 flex flex-col justify-between">
                  <div className="flex items-center justify-between gap-4 pb-4 border-b border-[#E5EAF2]">
                    <div>
                      <p className="text-xs font-medium text-[#64748B]">
                        Illustrative Forensic Inspection Preview
                      </p>
                      <p className="text-sm font-semibold text-[#172554] mt-0.5">
                        research_pavilion_specimen.jpg
                      </p>
                    </div>
                    <div className="flex items-center gap-1 p-1 bg-white border border-[#E5EAF2] rounded-lg">
                      {(
                        [
                          ['signals', 'Signals'],
                          ['watermark', 'Watermark'],
                          ['metadata', 'Metadata'],
                        ] as const
                      ).map(([key, label]) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setPreviewTab(key)}
                          className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                            previewTab === key
                              ? 'bg-[#172554] text-white'
                              : 'text-[#64748B] hover:text-[#172554]'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Specimen Viewport */}
                  <div className="relative my-4 rounded-lg overflow-hidden border border-[#E5EAF2] bg-white aspect-[16/9]">
                    {!heroImgError ? (
                      <img
                        src={HERO_SPECIMEN_IMG}
                        alt="Architectural glass pavilion specimen under forensic inspection"
                        referrerPolicy="no-referrer"
                        onError={() => setHeroImgError(true)}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full bg-[#F5F7FB] flex items-center justify-center text-sm text-[#64748B]">
                        Forensic specimen preview
                      </div>
                    )}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#172554]/85 via-[#172554]/40 to-transparent px-4 py-3 flex items-end justify-between text-white">
                      <div className="text-xs">
                        <span className="font-mono tabular-nums opacity-90">
                          16:9 Specimen · SHA-256 Verified · Multi-Layer Pipeline
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => onEnterWorkspace('upload')}
                        className="text-xs font-medium underline underline-offset-4 hover:text-blue-200 cursor-pointer whitespace-nowrap shrink-0"
                      >
                        Run live analysis
                      </button>
                    </div>
                  </div>

                  {/* Dynamic Readout Based on Preview Tab */}
                  <div className="bg-white border border-[#E5EAF2] rounded-lg p-4">
                    {previewTab === 'signals' && (
                      <div className="space-y-2.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium text-[#172554]">
                            Multi-Layer Evidence Pipeline
                          </span>
                          <span className="text-[#64748B]">
                            Deterministic checks + Gemini reasoning
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-3 pt-1">
                          <div>
                            <p className="text-xs text-[#64748B]">Pixel &amp; ELA</p>
                            <p className="text-sm font-semibold font-mono tabular-nums text-[#172554] mt-0.5">
                              sharp RGBA
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-[#64748B]">Provenance</p>
                            <p className="text-sm font-semibold font-mono tabular-nums text-[#172554] mt-0.5">
                              C2PA / XMP
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-[#64748B]">Score Type</p>
                            <p className="text-sm font-semibold text-[#2563EB] mt-0.5">
                              Experimental
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                    {previewTab === 'watermark' && (
                      <div className="space-y-2 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-[#172554]">
                            Visible vs. Invisible Separation
                          </span>
                          <span className="font-mono text-[#64748B]">Corner-strip OCR</span>
                        </div>
                        <p className="text-[#64748B] leading-relaxed">
                          Scans full frames and zoomed 22% edge strips for Veo, Sora, Runway, Kling,
                          and Pika branding. Invisible SynthID checks are reported honestly as
                          unavailable when not integrated.
                        </p>
                      </div>
                    )}
                    {previewTab === 'metadata' && (
                      <div className="space-y-2 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-[#172554]">
                            Header &amp; Container Audit
                          </span>
                          <span className="font-mono text-[#64748B]">exifr · ffprobe · pdf-lib</span>
                        </div>
                        <p className="text-[#64748B] leading-relaxed">
                          Extracts EXIF, ICC, GPS, codecs, and PDF font dictionaries while guarding
                          against false conclusions from stripped or edited metadata.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Supported Media Types */}
        <section className="py-16 bg-[#F5F7FB] border-b border-[#E5EAF2]">
          <div className="max-w-[1200px] mx-auto px-6">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-10">
              <div>
                <h2 className="text-2xl md:text-3xl font-bold tracking-[-0.02em] text-[#172554]">
                  Media-specific forensic pipelines
                </h2>
                <p className="mt-2 text-sm text-[#64748B] max-w-2xl">
                  Uploaded files are verified by binary magic signature and routed strictly to
                  matching detectors — never running image heuristics on audio or text detectors on
                  video.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onEnterWorkspace('upload')}
                className="text-sm font-medium text-[#2563EB] hover:text-[#1D4ED8] inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                Upload a file
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              {[
                {
                  icon: ImageIcon,
                  title: 'Images',
                  formats: 'JPG · JPEG · PNG · WEBP',
                  detail:
                    'Pixel entropy, Laplacian noise residual, ELA, lighting/texture review, OCR, visible watermarks, EXIF & C2PA.',
                },
                {
                  icon: Film,
                  title: 'Videos',
                  formats: 'MP4 · MOV · WEBM',
                  detail:
                    'FFmpeg uniform multi-frame sampling, inter-frame deltas, cross-frame watermark tracking, facial & temporal review.',
                },
                {
                  icon: FileSearch,
                  title: 'PDF Documents',
                  formats: 'PDF',
                  detail:
                    'Text layer decoding, font & XObject inventory, container metadata, stylometry, burstiness & linguistic analysis.',
                },
                {
                  icon: FileText,
                  title: 'Text Documents',
                  formats: 'DOCX · TXT',
                  detail:
                    'Sentence-length variance, 4-gram repetition rates, writing-style consistency & passage-level inspection.',
                },
                {
                  icon: AudioWaveform,
                  title: 'Audio Recordings',
                  formats: 'WAV · MP3 · M4A',
                  detail:
                    '16 kHz PCM waveform & DFT spectral centroid, silence ratio, dynamic range, prosody & vocoder artifact review.',
                },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.title}
                    className="bg-white border border-[#E5EAF2] rounded-xl p-5 flex flex-col justify-between"
                  >
                    <div>
                      <Icon className="w-5 h-5 text-[#2563EB] mb-3.5" />
                      <h3 className="text-base font-semibold text-[#172554]">{item.title}</h3>
                      <p className="mt-1 text-xs font-mono text-[#64748B]">{item.formats}</p>
                      <p className="mt-3 text-xs leading-relaxed text-[#64748B]">{item.detail}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Detection Capabilities — Asymmetric Bento */}
        <section id="features" className="py-20 border-b border-[#E5EAF2]">
          <div className="max-w-[1200px] mx-auto px-6">
            <div className="max-w-2xl mb-12">
              <h2 className="text-2xl md:text-3xl font-bold tracking-[-0.02em] text-[#172554]">
                Built for inspectable evidence, not black-box scores
              </h2>
              <p className="mt-3 text-[15px] leading-relaxed text-[#64748B]">
                Every analysis pairs deterministic signal processing with structured multimodal
                reasoning, then documents each detector&apos;s raw output, reliability tier, and
                limitations.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              <div className="lg:col-span-7 bg-[#F5F7FB] border border-[#E5EAF2] rounded-xl p-7">
                <ScanEye className="w-5 h-5 text-[#2563EB] mb-4" />
                <h3 className="text-lg font-semibold text-[#172554]">
                  Dedicated Visible Watermark &amp; Cross-Frame Tracking
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-[#64748B]">
                  Standard multimodal passes frequently miss faint generator logos in video corners.
                  TruthLens runs a dedicated watermark pipeline that inspects full frames alongside
                  zoomed 22% margin crops across every sampled video timestamp — identifying visible
                  marks from services like Google Veo, OpenAI Sora, Runway, Kling, and Pika while
                  recording frame position, timestamp, confidence, and persistence.
                </p>
                <div className="mt-5 pt-4 border-t border-[#E5EAF2] text-xs text-[#64748B] flex flex-wrap gap-x-4 gap-y-1">
                  <span>Full-frame + edge-strip OCR</span>
                  <span aria-hidden="true">·</span>
                  <span>Multi-frame persistence tracking</span>
                  <span aria-hidden="true">·</span>
                  <span>Strict visible vs. invisible separation</span>
                </div>
              </div>

              <div className="lg:col-span-5 bg-white border border-[#E5EAF2] rounded-xl p-7">
                <Scale className="w-5 h-5 text-[#2563EB] mb-4" />
                <h3 className="text-lg font-semibold text-[#172554]">
                  Reliability-Weighted Evidence Aggregation
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-[#64748B]">
                  Rather than naively averaging detector outputs, the scoring engine groups
                  correlated methods to prevent double-counting, excludes unavailable checks, flags
                  conflicting signals, and reports AI-likelihood separately from Evidence Strength.
                </p>
                <div className="mt-5 pt-4 border-t border-[#E5EAF2] text-xs text-[#64748B]">
                  AI-Likelihood (0–100 Experimental) · Evidence Strength (Low / Moderate / Strong)
                </div>
              </div>

              <div className="lg:col-span-5 bg-white border border-[#E5EAF2] rounded-xl p-7">
                <Layers className="w-5 h-5 text-[#2563EB] mb-4" />
                <h3 className="text-lg font-semibold text-[#172554]">
                  Full-Duration Video Frame Sampling
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-[#64748B]">
                  Videos are never judged from a single frame. FFmpeg extracts evenly spaced
                  timestamped frames across the entire clip, computes pixel-level inter-frame deltas
                  and scene transitions, and links every finding back to an inspectable frame
                  timeline.
                </p>
              </div>

              <div className="lg:col-span-7 bg-white border border-[#E5EAF2] rounded-xl p-7">
                <ShieldCheck className="w-5 h-5 text-[#2563EB] mb-4" />
                <h3 className="text-lg font-semibold text-[#172554]">
                  Research-Grade Dataset &amp; Split Governance
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-[#64748B]">
                  Manage labeled evaluation datasets with a 33-column CSV schema separating train,
                  validation, test, and live uploads. Automatically check for duplicate hashes,
                  cross-split source leakage, missing metadata, and consent documentation — without
                  claiming that collecting metadata trains a model.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section id="how-it-works" className="py-20 bg-[#F5F7FB] border-b border-[#E5EAF2]">
          <div className="max-w-[1200px] mx-auto px-6">
            <div className="max-w-2xl mb-12">
              <h2 className="text-2xl md:text-3xl font-bold tracking-[-0.02em] text-[#172554]">
                How the forensic pipeline works
              </h2>
              <p className="mt-2 text-sm text-[#64748B]">
                Every uploaded file moves through eight observable backend processing stages with no
                simulated progress bars.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {[
                {
                  step: '01. Validate & Hash',
                  desc: 'Verify binary magic bytes, enforce decompression-bomb and size guards, compute SHA-256 fingerprint, and route by true media format.',
                },
                {
                  step: '02. Extract Signals',
                  desc: 'Parse EXIF/XMP/ICC, FFprobe stream codecs, PDF dictionaries, PCM acoustic waveforms, pixel noise residuals, and C2PA container markers.',
                },
                {
                  step: '03. Inspect & Track',
                  desc: 'Run dedicated visible watermark OCR/logo checks alongside Gemini multimodal inspection grounded strictly on observed pixels, frames, audio, or text.',
                },
                {
                  step: '04. Aggregate & Report',
                  desc: 'Deduplicate correlated signals, disclose unavailable detectors, separate observed evidence from AI narrative, and export PDF or JSON reports.',
                },
              ].map((item) => (
                <div
                  key={item.step}
                  className="bg-white border border-[#E5EAF2] rounded-xl p-6"
                >
                  <h3 className="text-base font-semibold text-[#172554]">{item.step}</h3>
                  <p className="mt-2.5 text-sm leading-relaxed text-[#64748B]">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Technology Overview & Trust / Transparency */}
        <section id="about" className="py-20 border-b border-[#E5EAF2]">
          <div className="max-w-[1200px] mx-auto px-6">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-stretch">
              <div className="lg:col-span-5">
                <div className="h-full min-h-[280px] rounded-xl overflow-hidden border border-[#E5EAF2] bg-[#F5F7FB]">
                  {!opticsImgError ? (
                    <img
                      src={OPTICS_SPECIMEN_IMG}
                      alt="Optical calibration lenses and laboratory reference cards"
                      referrerPolicy="no-referrer"
                      onError={() => setOpticsImgError(true)}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-sm text-[#64748B]">
                      Optical calibration reference
                    </div>
                  )}
                </div>
              </div>

              <div className="lg:col-span-7 flex flex-col justify-center">
                <h2 className="text-2xl md:text-3xl font-bold tracking-[-0.02em] text-[#172554]">
                  Epistemic transparency by design
                </h2>
                <p className="mt-4 text-[15px] leading-relaxed text-[#64748B]">
                  No multimedia detector can guarantee 100% accuracy. Compression, cropping, camera
                  denoising, and fast-evolving generative models create real uncertainty. TruthLens
                  is engineered to make that uncertainty explicit rather than hiding it behind a
                  single overconfident percentage.
                </p>

                <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-5 pt-6 border-t border-[#E5EAF2]">
                  <div>
                    <h3 className="text-sm font-semibold text-[#172554]">
                      Estimates, never definitive proof
                    </h3>
                    <p className="mt-1.5 text-xs leading-relaxed text-[#64748B]">
                      Uncalibrated composite scores are explicitly labeled Experimental
                      AI-Likelihood Estimates, distinguishing likely AI-generated, AI-assisted,
                      manipulated, inconclusive, and likely human-created results.
                    </p>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-[#172554]">
                      Honest reporting of unavailable tools
                    </h3>
                    <p className="mt-1.5 text-xs leading-relaxed text-[#64748B]">
                      When a specialized detector (such as SynthID invisible watermark verification,
                      dense optical flow, or ASVspoof voice biometrics) is not integrated,
                      TruthLens explicitly marks it as not performed.
                    </p>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-[#172554]">
                      Metadata is contextual, not conclusive
                    </h3>
                    <p className="mt-1.5 text-xs leading-relaxed text-[#64748B]">
                      Missing EXIF data or software tags never trigger automatic AI classifications,
                      as messaging apps and editors routinely strip or alter container headers.
                    </p>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-[#172554]">
                      Controlled media retention
                    </h3>
                    <p className="mt-1.5 text-xs leading-relaxed text-[#64748B]">
                      Uploaded files are validated without execution, linked by SHA-256 hash, and
                      purged automatically after the retention window or immediately upon deletion.
                    </p>
                  </div>
                </div>

                <div className="mt-8">
                  <button
                    type="button"
                    onClick={() => onEnterWorkspace('upload')}
                    className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-[#172554] hover:bg-[#1E3A8A] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Open Forensic Workspace
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Quiet Commercial Footer */}
      <footer className="py-10 bg-white">
        <div className="max-w-[1200px] mx-auto px-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <TruthLensLogo />
            <span className="text-xs text-[#64748B]">Detect. Analyse. Verify.</span>
          </div>
          <div className="flex flex-wrap items-center gap-6 text-xs text-[#64748B]">
            <button
              type="button"
              onClick={() => onEnterWorkspace('overview')}
              className="hover:text-[#172554] cursor-pointer"
            >
              Dashboard
            </button>
            <button
              type="button"
              onClick={() => onEnterWorkspace('upload')}
              className="hover:text-[#172554] cursor-pointer"
            >
              New analysis
            </button>
            <span>Detection scores are estimates, not definitive proof of authorship.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
