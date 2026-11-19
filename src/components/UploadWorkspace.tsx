import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  AudioWaveform,
  CheckCircle2,
  FileSearch,
  FileText,
  Film,
  Image as ImageIcon,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { AnalysisRecord, MediaType } from '../types/forensics';
import { formatBytes, mediaTypeLabel } from '../lib/formatters';
import { PremiumButton } from './PremiumUi';

interface UploadWorkspaceProps {
  maxUploadSizeMb: number;
  onAnalysesStarted: (analyses: AnalysisRecord[]) => void;
  onRunSample: (sampleType: 'image' | 'document') => void;
  runningSample: boolean;
}

type UploadStage =
  | 'idle'
  | 'selected'
  | 'validating'
  | 'uploading'
  | 'completed'
  | 'failed'
  | 'cancelled';

interface QueuedFile {
  id: string;
  file: File;
  mediaType: MediaType;
  previewUrl?: string;
  magicSignatureNote: string;
}

interface UploadErrorState {
  category:
    | 'Unsupported format'
    | 'Exceeds size limit'
    | 'Upload interrupted'
    | 'Corrupted or invalid file'
    | 'Validation error';
  message: string;
  retryable: boolean;
}

const SUPPORTED_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.mp4',
  '.mov',
  '.webm',
  '.pdf',
  '.docx',
  '.txt',
  '.wav',
  '.mp3',
  '.m4a',
]);

function detectClientMediaType(file: File): MediaType | null {
  const ext = `.${file.name.split('.').pop()?.toLowerCase() ?? ''}`;
  if (!SUPPORTED_EXTENSIONS.has(ext)) return null;
  if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) return 'image';
  if (['.mp4', '.mov', '.webm'].includes(ext)) return 'video';
  if (['.wav', '.mp3', '.m4a'].includes(ext)) return 'audio';
  if (ext === '.pdf') return 'pdf';
  return 'document';
}

async function inspectClientHeaderSignature(
  file: File,
  expectedType: MediaType,
): Promise<{ ok: boolean; note: string; error?: string }> {
  try {
    const slice = await file.slice(0, 16).arrayBuffer();
    const bytes = new Uint8Array(slice);
    if (bytes.length === 0) {
      return { ok: false, note: 'Empty file', error: `"${file.name}" contains 0 bytes.` };
    }

    const startsWith = (sig: number[]) => sig.every((b, idx) => bytes[idx] === b);
    const ascii = String.fromCharCode(...bytes);

    if (expectedType === 'image') {
      if (startsWith([0xff, 0xd8, 0xff])) return { ok: true, note: 'JPEG magic verified (FF D8 FF)' };
      if (startsWith([0x89, 0x50, 0x4e, 0x47])) return { ok: true, note: 'PNG magic verified (89 50 4E 47)' };
      if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') {
        return { ok: true, note: 'WEBP RIFF magic verified' };
      }
      return {
        ok: false,
        note: 'Header mismatch',
        error: `"${file.name}" does not match a valid JPEG, PNG, or WEBP binary signature (extension alone is not trusted).`,
      };
    }

    if (expectedType === 'pdf') {
      if (ascii.startsWith('%PDF-')) return { ok: true, note: 'PDF header verified (%PDF-)' };
      return {
        ok: false,
        note: 'Header mismatch',
        error: `"${file.name}" lacks a valid %PDF- binary header and may be corrupted or mislabeled.`,
      };
    }

    if (expectedType === 'video') {
      if (ascii.slice(4, 8) === 'ftyp') return { ok: true, note: 'ISO BMFF / MP4 / MOV header verified' };
      if (startsWith([0x1a, 0x45, 0xdf, 0xa3])) return { ok: true, note: 'WebM / EBML header verified' };
      return {
        ok: false,
        note: 'Header mismatch',
        error: `"${file.name}" does not have a recognized MP4, MOV, or WebM container signature.`,
      };
    }

    if (expectedType === 'audio') {
      if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WAVE') {
        return { ok: true, note: 'WAV RIFF header verified' };
      }
      if (ascii.startsWith('ID3') || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) {
        return { ok: true, note: 'MP3 audio header verified' };
      }
      if (ascii.slice(4, 8) === 'ftyp') {
        return { ok: true, note: 'M4A / MP4 audio header verified' };
      }
      return { ok: true, note: 'Deferred to server FFprobe & magic check' };
    }

    // document (.docx ZIP signature or .txt UTF-8)
    const ext = `.${file.name.split('.').pop()?.toLowerCase() ?? ''}`;
    if (ext === '.docx') {
      if (startsWith([0x50, 0x4b, 0x03, 0x04])) return { ok: true, note: 'DOCX ZIP container verified' };
      return {
        ok: false,
        note: 'Header mismatch',
        error: `"${file.name}" is not a valid DOCX archive (missing PK zip header).`,
      };
    }

    // Plain text: check for null bytes indicating binary spoofing
    const hasNullByte = bytes.some((b) => b === 0x00);
    if (hasNullByte) {
      return {
        ok: false,
        note: 'Binary content in .txt',
        error: `"${file.name}" contains binary null bytes and does not appear to be plain UTF-8 text.`,
      };
    }
    return { ok: true, note: 'Plain UTF-8 text header checked' };
  } catch {
    return { ok: true, note: 'Server magic-byte verification pending' };
  }
}

function plannedMethodsForType(type: MediaType): string[] {
  switch (type) {
    case 'image':
      return [
        'Pixel entropy, Laplacian & noise residual (sharp)',
        'Error Level Analysis (ELA Q90 + Q90/Q75 double-JPEG delta)',
        'Visible watermark OCR + zoomed edge/corner strips',
        'EXIF / XMP / ICC & C2PA manifest scan',
        'PRNU & Copy-Move explicitly disclosed as unavailable',
      ];
    case 'video':
      return [
        'FFprobe stream/codec & GOP I/P/B structure inspection',
        'FFmpeg multi-frame sampling with full frame count disclosure',
        'Bhattacharyya histogram similarity & inter-frame delta',
        'Cross-frame visible watermark tracking + cropped evidence capture',
        'Temporal, lighting & facial consistency review',
      ];
    case 'audio':
      return [
        '16 kHz PCM waveform & DFT spectral centroid',
        'Dynamic range, silence ratio & clipping analysis',
        'Multimodal speech, prosody & vocoder artifact review',
        'Audio container & encoder metadata inspection',
      ];
    case 'pdf':
      return [
        'PDF text layer extraction & structural inspection',
        'Font & embedded Image XObject inventory',
        'Stylometry, sentence burstiness & 4-gram repetition',
        'Cautious linguistic pattern assessment',
      ];
    case 'document':
      return [
        'DOCX / UTF-8 text extraction & structural check',
        'Sentence-length variance & lexical diversity',
        'Repetitive pattern & passage-level inspection',
        'Cautious linguistic assessment (limitations disclosed)',
      ];
  }
}

function categorizeServerError(status: number, message: string): UploadErrorState {
  const lower = message.toLowerCase();
  if (status === 413 || lower.includes('exceeds') || lower.includes('limit') || lower.includes('size') || lower.includes('payload too large')) {
    return { category: 'Exceeds size limit', message, retryable: false };
  }
  if (status === 404) {
    return {
      category: 'Upload interrupted',
      message:
        message ||
        'Upload endpoint (/api/analyses/upload) returned 404. Ensure the TruthLens backend API is deployed and reachable.',
      retryable: true,
    };
  }
  if (lower.includes('unsupported') || lower.includes('format') || lower.includes('mime')) {
    return { category: 'Unsupported format', message, retryable: false };
  }
  if (lower.includes('corrupt') || lower.includes('bomb') || lower.includes('decode') || lower.includes('invalid')) {
    return { category: 'Corrupted or invalid file', message, retryable: false };
  }
  return { category: 'Validation error', message, retryable: status >= 500 || status === 0 };
}

export function UploadWorkspace({
  maxUploadSizeMb,
  onAnalysesStarted,
  onRunSample,
  runningSample,
}: UploadWorkspaceProps) {
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadStage, setUploadStage] = useState<UploadStage>('idle');
  const [uploadError, setUploadError] = useState<UploadErrorState | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [bytesTransferred, setBytesTransferred] = useState<{ loaded: number; total: number } | null>(
    null,
  );
  const inputRef = useRef<HTMLInputElement | null>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  useEffect(() => {
    return () => {
      if (xhrRef.current) {
        xhrRef.current.abort();
        xhrRef.current = null;
      }
      for (const item of queue) {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isUploading = uploadStage === 'uploading';
  const isValidating = uploadStage === 'validating';

  const addFiles = async (incoming: FileList | File[]) => {
    setUploadError(null);
    setUploadStage('validating');
    const maxBytes = maxUploadSizeMb * 1024 * 1024;
    const accepted: QueuedFile[] = [];
    let firstError: UploadErrorState | null = null;

    for (const file of Array.from(incoming)) {
      if (queue.length + accepted.length >= 6) {
        firstError = firstError ?? {
          category: 'Validation error',
          message: 'Maximum 6 files can be queued in a single upload batch.',
          retryable: false,
        };
        break;
      }
      const type = detectClientMediaType(file);
      if (!type) {
        firstError = firstError ?? {
          category: 'Unsupported format',
          message: `"${file.name}" is not a supported format. Allowed: JPG, JPEG, PNG, WEBP, MP4, MOV, WEBM, PDF, DOCX, TXT, WAV, MP3, M4A.`,
          retryable: false,
        };
        continue;
      }
      if (file.size === 0) {
        firstError = firstError ?? {
          category: 'Corrupted or invalid file',
          message: `"${file.name}" is empty (0 bytes) and cannot be analysed.`,
          retryable: false,
        };
        continue;
      }
      if (file.size > maxBytes) {
        firstError = firstError ?? {
          category: 'Exceeds size limit',
          message: `"${file.name}" (${formatBytes(file.size)}) exceeds the ${maxUploadSizeMb} MB upload limit.`,
          retryable: false,
        };
        continue;
      }

      const sig = await inspectClientHeaderSignature(file, type);
      if (!sig.ok) {
        firstError = firstError ?? {
          category: 'Corrupted or invalid file',
          message: sig.error || `"${file.name}" failed binary signature verification.`,
          retryable: false,
        };
        continue;
      }

      accepted.push({
        id: `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        file,
        mediaType: type,
        previewUrl: type === 'image' ? URL.createObjectURL(file) : undefined,
        magicSignatureNote: sig.note,
      });
    }

    if (firstError) {
      setUploadError(firstError);
    }

    if (accepted.length > 0) {
      setQueue((prev) => [...prev, ...accepted]);
      setUploadStage('selected');
    } else {
      setUploadStage(queue.length > 0 ? 'selected' : 'idle');
    }
  };

  const removeFile = (id: string) => {
    setQueue((prev) => {
      const target = prev.find((f) => f.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      const next = prev.filter((f) => f.id !== id);
      if (next.length === 0) {
        setUploadStage('idle');
        setUploadError(null);
      }
      return next;
    });
  };

  const handleCancelUpload = () => {
    if (xhrRef.current) {
      xhrRef.current.abort();
      xhrRef.current = null;
    }
    setUploadStage('cancelled');
    setUploadProgress(0);
    setBytesTransferred(null);
    setUploadError({
      category: 'Upload interrupted',
      message: 'Transfer was cancelled before completion. Your queued files remain ready to retry.',
      retryable: true,
    });
  };

  const handleUploadAndAnalyse = () => {
    if (queue.length === 0 || isUploading || isValidating) return;
    setUploadError(null);
    setUploadStage('uploading');
    setUploadProgress(0);
    setBytesTransferred(null);

    const formData = new FormData();
    for (const item of queue) {
      formData.append('files', item.file);
    }

    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open('POST', '/api/analyses/upload');

    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable) {
        setUploadProgress(Math.round((evt.loaded / evt.total) * 100));
        setBytesTransferred({ loaded: evt.loaded, total: evt.total });
      }
    };

    xhr.onload = () => {
      xhrRef.current = null;
      if (inputRef.current) {
        inputRef.current.value = '';
      }
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300 && Array.isArray(data.analyses)) {
          setUploadStage('completed');
          setUploadProgress(100);
          for (const item of queue) {
            if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
          }
          setQueue([]);
          onAnalysesStarted(data.analyses as AnalysisRecord[]);
        } else {
          setUploadStage('failed');
          setUploadError(
            categorizeServerError(
              xhr.status,
              data.error || `Upload failed with server status ${xhr.status}.`,
            ),
          );
        }
      } catch {
        setUploadStage('failed');
        const fallbackMsg =
          xhr.status === 413
            ? 'Uploaded file exceeds the hosting platform request body limit (4.5 MB on serverless deployments). Try a smaller file or run the Node server directly.'
            : xhr.status === 404
              ? 'Backend upload endpoint (/api/analyses/upload) returned 404. Please redeploy or restart the backend service and retry.'
              : `Server returned an unexpected response (${xhr.status}).`;
        setUploadError(categorizeServerError(xhr.status, fallbackMsg));
      }
    };

    xhr.onerror = () => {
      xhrRef.current = null;
      setUploadStage('failed');
      setUploadError({
        category: 'Upload interrupted',
        message: 'Network error interrupted the upload to the TruthLens backend. Check connectivity and retry.',
        retryable: true,
      });
    };

    xhr.onabort = () => {
      xhrRef.current = null;
    };

    xhr.send(formData);
  };

  const uploadSteps: Array<{ key: UploadStage; label: string }> = [
    { key: 'selected', label: '1. Selected' },
    { key: 'validating', label: '2. Validating' },
    { key: 'uploading', label: '3. Uploading' },
    {
      key: 'completed',
      label:
        uploadStage === 'failed'
          ? '4. Failed'
          : uploadStage === 'cancelled'
            ? '4. Cancelled'
            : '4. Handoff to Analysis',
    },
  ];

  const stepRank: Record<UploadStage, number> = {
    idle: -1,
    selected: 0,
    validating: 1,
    uploading: 2,
    completed: 3,
    failed: 3,
    cancelled: 3,
  };
  const currentRank = stepRank[uploadStage];

  return (
    <div className="space-y-7 max-w-[1000px]">
      <div>
        <h1 className="text-2xl font-bold tracking-[-0.02em] text-[#172554]">
          New Forensic Analysis
        </h1>
        <p className="mt-1 text-sm text-[#64748B]">
          Upload an image, video, PDF, text document, or audio recording. TruthLens validates
          binary magic signatures before transfer, streams SHA-256 verification on the server, and
          routes each file exclusively to its matching forensic pipeline.
        </p>
      </div>

      {/* Drag-and-Drop Zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          if (e.dataTransfer.files?.length) void addFiles(e.dataTransfer.files);
        }}
        className={`rounded-2xl border-2 border-dashed p-10 text-center transition-all duration-300 backdrop-blur-xl ${
          isDragging
            ? 'border-[#7C3AED] bg-gradient-to-br from-[#EFF6FF]/90 to-[#F3F0FF]/90 shadow-[0_18px_40px_-14px_rgba(124,58,237,0.22)]'
            : 'border-[#BFDBFE] bg-white/75 hover:border-[#A78BFA] hover:bg-white/88 shadow-[0_8px_28px_-14px_rgba(37,99,235,0.12)]'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".jpg,.jpeg,.png,.webp,.mp4,.mov,.webm,.pdf,.docx,.txt,.wav,.mp3,.m4a"
          onChange={(e) => {
            if (e.target.files?.length) {
              void addFiles(e.target.files);
              e.target.value = '';
            }
          }}
          className="hidden"
        />

        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#EFF6FF] to-[#F3F0FF] border border-[#DBEAFE] flex items-center justify-center mx-auto mb-4 shadow-xs">
          <Upload className="w-5 h-5 text-[#5B21B6]" />
        </div>

        <p className="text-base font-semibold text-[#0F172A]">
          Drag and drop media files here, or browse from your device
        </p>
        <p className="mt-1.5 text-xs text-[#52607A]">
          Images (JPG, JPEG, PNG, WEBP) · Videos (MP4, MOV, WEBM) · Documents (PDF, DOCX, TXT) ·
          Audio (WAV, MP3, M4A)
        </p>
        <p className="mt-1 text-xs font-mono tabular-nums text-[#64748B]">
          Up to 6 files per batch · Max {maxUploadSizeMb} MB per file · 100 MP bomb guard · Files
          are never executed
        </p>

        <div className="mt-5 flex items-center justify-center gap-3">
          <PremiumButton
            variant="primary"
            size="md"
            disabled={isUploading}
            onClick={() => inputRef.current?.click()}
          >
            Browse files
          </PremiumButton>
        </div>
      </div>

      {/* Categorized Upload / Validation Error Banner */}
      {uploadError && (
        <div
          role="alert"
          className="bg-[#FEF2F2] border border-[#FECACA] rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-sm text-[#991B1B]"
        >
          <div className="flex items-start gap-3">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-[#DC2626]" />
            <div>
              <p className="font-semibold text-xs">{uploadError.category}</p>
              <p className="mt-0.5 text-xs leading-relaxed">{uploadError.message}</p>
            </div>
          </div>
          {uploadError.retryable && queue.length > 0 && (
            <button
              type="button"
              onClick={handleUploadAndAnalyse}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#991B1B] bg-white border border-[#FECACA] hover:bg-[#FEF2F2] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Retry upload
            </button>
          )}
        </div>
      )}

      {/* Queued Files List + Explicit Upload Stage Separation */}
      {queue.length > 0 && (
        <div className="tl-glass-panel rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-[#DCE8F8]/80 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-[#0F172A]">
                Upload Queue ({queue.length} {queue.length === 1 ? 'file' : 'files'})
              </h2>
              <p className="text-xs text-[#52607A] mt-0.5">
                Transfer status is tracked independently from the 8-stage server forensic pipeline
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {isUploading ? (
                <button
                  type="button"
                  onClick={handleCancelUpload}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#DC2626] bg-[#FEF2F2] hover:bg-[#FEE2E2] border border-[#FECACA] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                  Cancel upload
                </button>
              ) : (
                <PremiumButton
                  variant="primary"
                  size="md"
                  disabled={isValidating}
                  onClick={handleUploadAndAnalyse}
                >
                  <span>
                    {uploadStage === 'failed' || uploadStage === 'cancelled'
                      ? 'Retry upload & analysis'
                      : 'Start forensic analysis'}
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
                </PremiumButton>
              )}
            </div>
          </div>

          {/* Separated Upload Lifecycle Strip */}
          <div className="px-6 py-3 bg-[#EFF6FF]/45 border-b border-[#DCE8F8]/80 space-y-2.5">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              <span className="font-semibold text-[#172554]">Upload stage:</span>
              {uploadSteps.map((step, idx) => {
                const isActive = idx === currentRank;
                const isDone = idx < currentRank && uploadStage !== 'failed' && uploadStage !== 'cancelled';
                const isTerminalErr =
                  idx === 3 && (uploadStage === 'failed' || uploadStage === 'cancelled');
                return (
                  <span
                    key={step.key}
                    className={`font-mono tabular-nums ${
                      isTerminalErr
                        ? 'text-[#DC2626] font-semibold'
                        : isActive
                          ? 'text-[#2563EB] font-semibold'
                          : isDone
                            ? 'text-[#16A34A]'
                            : 'text-[#64748B]'
                    }`}
                  >
                    {step.label}
                  </span>
                );
              })}
            </div>

            {isUploading && (
              <div>
                <div className="flex items-center justify-between text-xs text-[#64748B] mb-1.5">
                  <span>
                    {uploadProgress >= 100
                      ? 'Transfer complete — initializing forensic pipeline on server…'
                      : `Streaming bytes via XHR${
                          bytesTransferred
                            ? ` (${formatBytes(bytesTransferred.loaded)} / ${formatBytes(bytesTransferred.total)})`
                            : '…'
                        }`}
                  </span>
                  <span className="font-mono tabular-nums font-semibold text-[#172554]">
                    {uploadProgress}%
                  </span>
                </div>
                <div className="h-1.5 bg-[#DBEAFE] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-[#2563EB] to-[#7C3AED] transition-all duration-150"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="divide-y divide-[#E5EAF2]">
            {queue.map((item) => (
              <div key={item.id} className="p-5 flex flex-col sm:flex-row gap-4 justify-between">
                <div className="flex items-start gap-4 min-w-0">
                  <div className="w-16 h-16 rounded-lg border border-[#E5EAF2] bg-[#F5F7FB] overflow-hidden shrink-0 flex items-center justify-center">
                    {item.previewUrl ? (
                      <img
                        src={item.previewUrl}
                        alt={item.file.name}
                        className="w-full h-full object-cover"
                      />
                    ) : item.mediaType === 'video' ? (
                      <Film className="w-6 h-6 text-[#172554]" />
                    ) : item.mediaType === 'audio' ? (
                      <AudioWaveform className="w-6 h-6 text-[#16A34A]" />
                    ) : item.mediaType === 'pdf' ? (
                      <FileSearch className="w-6 h-6 text-[#0284C7]" />
                    ) : (
                      <FileText className="w-6 h-6 text-[#64748B]" />
                    )}
                  </div>

                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[#172554] truncate">
                      {item.file.name}
                    </p>
                    <p className="mt-0.5 text-xs text-[#64748B] font-mono tabular-nums">
                      {mediaTypeLabel(item.mediaType)} · {formatBytes(item.file.size)} ·{' '}
                      <span className="text-[#16A34A] inline-flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />
                        {item.magicSignatureNote}
                      </span>
                    </p>
                    <div className="mt-2.5">
                      <p className="text-xs font-medium text-[#172554]">
                        Selected pipeline methods:
                      </p>
                      <p className="mt-0.5 text-xs text-[#64748B] leading-relaxed">
                        {plannedMethodsForType(item.mediaType).join(' · ')}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="shrink-0">
                  <button
                    type="button"
                    disabled={isUploading}
                    onClick={() => removeFile(item.id)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-[#64748B] hover:text-[#DC2626] hover:bg-[#FEF2F2] rounded-lg transition-colors cursor-pointer disabled:opacity-40"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sample Specimens for Immediate End-to-End Verification */}
      <div className="tl-glass-panel rounded-2xl p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
          <div>
            <h2 className="text-sm font-semibold text-[#0F172A]">
              Test with built-in sample specimens
            </h2>
            <p className="text-xs text-[#52607A] mt-0.5">
              Runs the real server-side extraction, pixel/stylometric forensics, watermark scanner,
              and multimodal reasoning pipeline end to end.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button
            type="button"
            disabled={runningSample || isUploading}
            onClick={() => onRunSample('image')}
            className="group text-left p-4 rounded-xl border border-[#DCE8F8] bg-white/75 hover:bg-white hover:border-[#A78BFA]/70 hover:-translate-y-0.5 hover:shadow-[0_12px_28px_-12px_rgba(124,58,237,0.18)] transition-all duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] cursor-pointer disabled:opacity-50"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <ImageIcon className="w-4 h-4 text-[#5B21B6]" />
                <span className="text-sm font-semibold text-[#0F172A]">
                  Research Pavilion Specimen (JPEG)
                </span>
              </div>
              <ArrowRight className="w-4 h-4 text-[#64748B] transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-[#5B21B6]" />
            </div>
            <p className="mt-1.5 text-xs text-[#52607A] leading-relaxed">
              Executes the full Image Forensics Pipeline including sharp ELA + Q90/Q75 double-JPEG
              delta, noise residuals, edge-strip watermark OCR, EXIF/C2PA inspection, and multimodal
              visual reasoning.
            </p>
          </button>

          <button
            type="button"
            disabled={runningSample || isUploading}
            onClick={() => onRunSample('document')}
            className="group text-left p-4 rounded-xl border border-[#DCE8F8] bg-white/75 hover:bg-white hover:border-[#A78BFA]/70 hover:-translate-y-0.5 hover:shadow-[0_12px_28px_-12px_rgba(124,58,237,0.18)] transition-all duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] cursor-pointer disabled:opacity-50"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <FileText className="w-4 h-4 text-[#2563EB]" />
                <span className="text-sm font-semibold text-[#0F172A]">
                  Municipal Water Briefing (TXT)
                </span>
              </div>
              <ArrowRight className="w-4 h-4 text-[#64748B] transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-[#5B21B6]" />
            </div>
            <p className="mt-1.5 text-xs text-[#52607A] leading-relaxed">
              Mixed formal and field-note document testing quantitative stylometry, burstiness CV,
              4-gram repetition, passage highlighting, and AI-text limitation disclaimers.
            </p>
          </button>
        </div>
      </div>
    </div>
  );
}
