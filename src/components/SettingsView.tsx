import { useEffect, useState } from 'react';
import { CheckCircle2, Info, Save } from 'lucide-react';
import type { AppSettings, SystemCapabilities } from '../types/forensics';

interface SettingsViewProps {
  onSettingsChanged: (settings: AppSettings) => void;
}

export function SettingsView({ onSettingsChanged }: SettingsViewProps) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [capabilities, setCapabilities] = useState<SystemCapabilities | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = await fetch('/api/settings');
      if (res.ok) {
        const data = await res.json();
        setSettings(data.settings);
        setCapabilities(data.capabilities);
      }
    })();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    setSaving(true);
    setSavedNotice(false);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          retainOriginalMediaHours: settings.retainOriginalMediaHours,
          videoFrameSampleCount: settings.videoFrameSampleCount,
          maxUploadSizeMb: settings.maxUploadSizeMb,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setSettings(data.settings);
        onSettingsChanged(data.settings);
        setSavedNotice(true);
        setTimeout(() => setSavedNotice(false), 2500);
      }
    } finally {
      setSaving(false);
    }
  };

  if (!settings) {
    return (
      <div className="space-y-4 max-w-3xl">
        <div className="h-44 bg-white border border-[#E5EAF2] rounded-xl animate-pulse" />
        <div className="h-56 bg-white border border-[#E5EAF2] rounded-xl animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[880px]">
      <div>
        <h1 className="text-2xl font-bold tracking-[-0.02em] text-[#172554]">
          Platform Settings &amp; Runtime Transparency
        </h1>
        <p className="mt-1 text-sm text-[#64748B]">
          Configure media retention, video frame sampling density, and inspect which forensic
          processing libraries are active in this server runtime.
        </p>
      </div>

      {/* Pipeline & Retention Policy Form */}
      <form
        onSubmit={handleSave}
        className="bg-white border border-[#E5EAF2] rounded-xl p-6 space-y-5"
      >
        <h2 className="text-base font-semibold text-[#172554]">
          Retention &amp; Forensic Pipeline Controls
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          <label className="space-y-1.5 block">
            <span className="text-xs font-medium text-[#172554]">
              Original Media Retention (hours)
            </span>
            <input
              type="number"
              min={1}
              max={168}
              value={settings.retainOriginalMediaHours}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  retainOriginalMediaHours: Number(e.target.value) || 24,
                })
              }
              className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-[#E5EAF2] rounded-lg text-[#172554]"
            />
            <span className="text-[11px] text-[#64748B] block">
              Uploaded files auto-purge after this window (1–168h).
            </span>
          </label>

          <label className="space-y-1.5 block">
            <span className="text-xs font-medium text-[#172554]">
              Video Frame Samples per Clip
            </span>
            <input
              type="number"
              min={4}
              max={10}
              value={settings.videoFrameSampleCount}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  videoFrameSampleCount: Number(e.target.value) || 6,
                })
              }
              className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-[#E5EAF2] rounded-lg text-[#172554]"
            />
            <span className="text-[11px] text-[#64748B] block">
              Evenly sampled keyframes across full video duration (4–10).
            </span>
          </label>

          <label className="space-y-1.5 block">
            <span className="text-xs font-medium text-[#172554]">
              Max Upload File Size (MB)
            </span>
            <input
              type="number"
              min={5}
              max={500}
              value={settings.maxUploadSizeMb}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  maxUploadSizeMb: Number(e.target.value) || 50,
                })
              }
              className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-[#E5EAF2] rounded-lg text-[#172554]"
            />
            <span className="text-[11px] text-[#64748B] block">
              Server-enforced limit (5–500 MB).
            </span>
          </label>
        </div>

        <div className="flex items-center justify-between pt-3 border-t border-[#E5EAF2]">
          <div className="text-xs text-[#16A34A] flex items-center gap-1.5">
            {savedNotice && (
              <>
                <CheckCircle2 className="w-4 h-4" />
                Settings saved to persistent server configuration.
              </>
            )}
          </div>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-lg transition-colors cursor-pointer disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? 'Saving…' : 'Save configuration'}
          </button>
        </div>
      </form>

      {/* Storage Transparency */}
      <div className="bg-white border border-[#E5EAF2] rounded-xl p-6 space-y-2.5">
        <div className="flex items-center gap-2">
          <Info className="w-4 h-4 text-[#2563EB]" />
          <h2 className="text-base font-semibold text-[#172554]">Storage &amp; Persistence</h2>
        </div>
        <p className="text-xs font-mono text-[#172554]">{settings.storageBackend}</p>
        <p className="text-xs leading-relaxed text-[#64748B]">{settings.storageNotice}</p>
      </div>

      {/* Active Forensic Runtime Inventory */}
      {capabilities && (
        <div className="bg-white border border-[#E5EAF2] rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-[#E5EAF2]">
            <h2 className="text-base font-semibold text-[#172554]">
              Verified Forensic Runtime Capabilities
            </h2>
            <p className="text-xs text-[#64748B] mt-0.5">
              TruthLens only claims capabilities that are installed and verified on the server.
            </p>
          </div>
          <div className="divide-y divide-[#E5EAF2] text-xs">
            {[
              [
                'FFmpeg / FFprobe (Video & Audio Processing)',
                capabilities.ffmpegAvailable && capabilities.ffprobeAvailable
                  ? 'Active — frame sampling, GOP I/P/B packet probing, PCM decoding, container probing'
                  : 'Unavailable',
                capabilities.ffmpegAvailable && capabilities.ffprobeAvailable,
              ],
              [
                'sharp + exifr (Image Pixel Forensics, ELA & EXIF)',
                capabilities.sharpAvailable
                  ? 'Active — raw RGBA pixel matrix, Laplacian noise, Q90/Q75 double-JPEG delta, watermark crop extraction, EXIF/XMP'
                  : 'Unavailable',
                capabilities.sharpAvailable,
              ],
              [
                'PDF & Document Parsers (unpdf, pdf-lib, mammoth)',
                'Active — PDF text/fonts/XObjects, DOCX extraction, stylometry',
                true,
              ],
              [
                'Gemini Multimodal Forensic Reasoning',
                capabilities.geminiConfigured
                  ? `Active (${capabilities.geminiModel}, server-side configured)`
                  : 'Unavailable — server GEMINI_API_KEY not configured',
                capabilities.geminiConfigured,
              ],
              [
                'C2PA Cryptographic Trust-List Verifier (c2patool)',
                'Unavailable — binary JUMBF/XMP header detection runs, full X.509 chain verification requires native c2patool',
                false,
              ],
              [
                'SynthID Invisible Watermark Verification',
                'Unavailable — proprietary verifier not integrated; reported explicitly as not performed',
                false,
              ],
            ].map(([name, detail, active]) => (
              <div
                key={String(name)}
                className="px-6 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
              >
                <div>
                  <p className="font-medium text-[#172554]">{name}</p>
                  <p className="text-[#64748B] mt-0.5">{detail}</p>
                </div>
                <span
                  className={`text-xs font-semibold whitespace-nowrap ${
                    active ? 'text-[#16A34A]' : 'text-[#64748B]'
                  }`}
                >
                  {active ? 'Integrated' : 'Not integrated'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
