import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Circle,
  Loader2,
  MinusCircle,
  RefreshCw,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import type { AnalysisRecord, PipelineStage } from '../types/forensics';
import { formatBytes, formatDateTime, mediaTypeLabel } from '../lib/formatters';

interface AnalysisWorkspaceProps {
  analysisId: string;
  initialRecord?: AnalysisRecord | null;
  onAnalysisUpdated: (record: AnalysisRecord) => void;
  onViewReport: (record: AnalysisRecord) => void;
  onRetryAnalysis: (id: string) => Promise<void>;
  onNewUpload: () => void;
}

function StageStatusIcon({ status }: { status: PipelineStage['status'] }) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="w-5 h-5 text-[#16A34A] shrink-0" />;
    case 'partially_completed':
    case 'warning':
      return <AlertTriangle className="w-5 h-5 text-[#D97706] shrink-0" />;
    case 'running':
      return <Loader2 className="w-5 h-5 text-[#2563EB] animate-spin shrink-0" />;
    case 'retrying':
      return <RefreshCw className="w-5 h-5 text-[#D97706] animate-spin shrink-0" />;
    case 'failed':
      return <XCircle className="w-5 h-5 text-[#DC2626] shrink-0" />;
    case 'unavailable':
      return <MinusCircle className="w-5 h-5 text-[#64748B] shrink-0" />;
    default:
      return <Circle className="w-5 h-5 text-[#CBD5E1] shrink-0" />;
  }
}

function stageStatusLabel(status: PipelineStage['status']): string {
  switch (status) {
    case 'completed':
      return 'Completed';
    case 'partially_completed':
      return 'Partially completed';
    case 'warning':
      return 'Completed (unavailable methods disclosed)';
    case 'running':
      return 'Running on server';
    case 'retrying':
      return 'Retrying with backoff';
    case 'failed':
      return 'Failed';
    case 'unavailable':
      return 'Unavailable';
    default:
      return 'Pending';
  }
}

export function AnalysisWorkspace({
  analysisId,
  initialRecord,
  onAnalysisUpdated,
  onViewReport,
  onRetryAnalysis,
  onNewUpload,
}: AnalysisWorkspaceProps) {
  const [record, setRecord] = useState<AnalysisRecord | null>(initialRecord ?? null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const initialRecordRef = useRef<AnalysisRecord | null | undefined>(initialRecord);
  initialRecordRef.current = initialRecord;

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let notFoundRetries = 0;

    const seeded =
      initialRecordRef.current && initialRecordRef.current.id === analysisId
        ? initialRecordRef.current
        : null;

    setFetchError(null);
    setRecord(seeded);

    // If the upload endpoint already returned a terminal record (e.g., synchronous serverless mode),
    // render it directly without firing a GET poll that could hit a separate stateless container.
    if (seeded && seeded.status !== 'processing' && !retrying) {
      return () => {
        active = false;
      };
    }

    const poll = async () => {
      try {
        const res = await fetch(`/api/analyses/${encodeURIComponent(analysisId)}`);
        const rawText = await res.text();
        let data: { analysis?: AnalysisRecord; error?: string } = {};
        try {
          data = JSON.parse(rawText) as { analysis?: AnalysisRecord; error?: string };
        } catch {
          data = {
            error:
              res.status === 404
                ? 'Analysis status endpoint returned 404 (record not found).'
                : `Unexpected server response (${res.status}).`,
          };
        }
        if (!active) return;

        if (!res.ok) {
          // Retry briefly on transient 404 while initial disk write settles
          if (res.status === 404 && notFoundRetries < 3) {
            notFoundRetries += 1;
            timer = setTimeout(poll, 800);
            return;
          }
          setFetchError(data.error || `Could not load analysis status (${res.status}).`);
          return;
        }

        if (!data.analysis) {
          setFetchError('Analysis payload was empty.');
          return;
        }

        notFoundRetries = 0;
        setFetchError(null);
        const latest = data.analysis;
        setRecord(latest);
        onAnalysisUpdated(latest);

        if (latest.status === 'processing') {
          timer = setTimeout(poll, 1000);
        }
      } catch {
        if (!active) return;
        setFetchError('Connection lost while polling backend analysis state.');
        timer = setTimeout(poll, 2500);
      }
    };

    void poll();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [analysisId, onAnalysisUpdated, retrying]);

  const handleRetryClick = async () => {
    if (!record) return;
    setRetrying(true);
    try {
      await onRetryAnalysis(record.id);
    } finally {
      setRetrying(false);
    }
  };

  if (fetchError && !record) {
    return (
      <div className="bg-white border border-[#FECACA] rounded-xl p-8 max-w-2xl">
        <div className="flex items-start gap-3">
          <XCircle className="w-5 h-5 text-[#DC2626] mt-0.5 shrink-0" />
          <div>
            <h2 className="text-base font-semibold text-[#172554]">Unable to load analysis</h2>
            <p className="mt-1 text-sm text-[#64748B]">{fetchError}</p>
            <button
              type="button"
              onClick={onNewUpload}
              className="mt-4 px-4 py-2 text-xs font-medium text-white bg-[#2563EB] rounded-lg cursor-pointer"
            >
              Return to Upload Workspace
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!record) {
    return (
      <div className="space-y-4 max-w-[920px]">
        <div className="h-20 bg-white border border-[#E5EAF2] rounded-xl animate-pulse" />
        <div className="h-96 bg-white border border-[#E5EAF2] rounded-xl animate-pulse" />
      </div>
    );
  }

  const finishedCount = record.stages.filter(
    (s) =>
      s.status === 'completed' ||
      s.status === 'partially_completed' ||
      s.status === 'warning' ||
      s.status === 'unavailable',
  ).length;

  const isReportReady = record.status === 'completed' || record.status === 'partially_completed';
  const canRetry =
    (record.status === 'partially_completed' || record.status === 'failed') &&
    Boolean(record.mediaRetained || record.canRetryGemini);

  return (
    <div className="space-y-6 max-w-[960px]">
      {/* File Header Card */}
      <div className="bg-white border border-[#E5EAF2] rounded-xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#64748B] font-mono tabular-nums">
            <span>{record.id}</span>
            <span aria-hidden="true">·</span>
            <span>{mediaTypeLabel(record.mediaType)}</span>
            <span aria-hidden="true">·</span>
            <span>{formatBytes(record.fileSizeBytes)}</span>
            <span aria-hidden="true">·</span>
            <span>
              {finishedCount} of {record.stages.length} stages finished
            </span>
            {record.retryCount ? (
              <>
                <span aria-hidden="true">·</span>
                <span>Retry #{record.retryCount}</span>
              </>
            ) : null}
          </div>
          <h1 className="mt-1.5 text-xl font-bold text-[#172554] truncate">{record.fileName}</h1>
          {record.fileHash && record.fileHash !== 'pending' && (
            <p className="mt-1 text-xs font-mono text-[#64748B] truncate">
              SHA-256: {record.fileHash}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {canRetry && (
            <button
              type="button"
              disabled={retrying}
              onClick={() => void handleRetryClick()}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-medium text-[#172554] bg-white hover:bg-[#F5F7FB] border border-[#E5EAF2] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${retrying ? 'animate-spin' : ''}`} />
              {retrying
                ? 'Restarting…'
                : record.status === 'partially_completed'
                  ? 'Retry Gemini Analysis'
                  : 'Retry Analysis'}
            </button>
          )}
          {isReportReady && (
            <button
              type="button"
              onClick={() => onViewReport(record)}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-medium text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {record.status === 'partially_completed'
                ? 'Open Partial Report'
                : 'Open Forensic Report'}
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
          {record.status === 'failed' && (
            <button
              type="button"
              onClick={onNewUpload}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-medium text-[#172554] bg-[#F5F7FB] hover:bg-[#E5EAF2] border border-[#E5EAF2] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Try another file
            </button>
          )}
        </div>
      </div>

      {/* Partial Completion Banner */}
      {record.status === 'partially_completed' && (
        <div
          role="status"
          className="bg-[#FFFBEB] border border-[#FDE68A] rounded-xl p-5 flex flex-col sm:flex-row sm:items-start justify-between gap-4"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-[#D97706] shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-semibold text-[#92400E]">
                Partial Forensic Report Generated — Independent Detectors Preserved
              </p>
              <p className="text-xs leading-relaxed text-[#92400E]/90">
                Gemini multimodal analysis did not complete (
                {record.geminiFailureDetail || 'upstream service temporarily unavailable'}). All
                local deterministic detectors completed and were aggregated without treating the API
                error as evidence of AI generation.
                {record.mediaType === 'video' && record.videoFrames?.length
                  ? ` ${record.videoFrames.length} extracted video frames are cached on disk and will be reused if you retry.`
                  : ''}
              </p>
            </div>
          </div>
          {canRetry && (
            <button
              type="button"
              disabled={retrying}
              onClick={() => void handleRetryClick()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#92400E] bg-white hover:bg-[#FEF3C7]/40 border border-[#FCD34D] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${retrying ? 'animate-spin' : ''}`} />
              Retry Gemini Analysis
            </button>
          )}
        </div>
      )}

      {/* Failure Alert */}
      {record.status === 'failed' && (
        <div
          role="alert"
          className="bg-[#FEF2F2] border border-[#FECACA] rounded-xl p-5 flex items-start gap-3"
        >
          <XCircle className="w-5 h-5 text-[#DC2626] shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-[#991B1B]">
              Forensic pipeline halted ({record.errorCode || 'PROCESSING_ERROR'})
            </p>
            <p className="text-xs leading-relaxed text-[#991B1B]/90">
              {record.errorMessage || 'An unexpected error occurred while processing this file.'}
            </p>
          </div>
        </div>
      )}

      {/* 8 Real Backend Pipeline Stages */}
      <div className="bg-white border border-[#E5EAF2] rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[#E5EAF2] flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-[#172554]">
              Live Backend Processing Stages
            </h2>
            <p className="text-xs text-[#64748B] mt-0.5">
              Reflects actual server execution states — no simulated progress percentages
            </p>
          </div>
          <span className="text-xs font-mono tabular-nums text-[#64748B]">
            {record.status === 'processing'
              ? 'Polling backend…'
              : record.status === 'completed'
                ? `Completed ${formatDateTime(record.completedDate)}`
                : record.status === 'partially_completed'
                  ? `Partial report ${formatDateTime(record.completedDate)}`
                  : 'Stopped'}
          </span>
        </div>

        <ol className="divide-y divide-[#E5EAF2]">
          {record.stages.map((stage, idx) => (
            <li
              key={stage.id}
              className={`px-6 py-4 flex items-start justify-between gap-4 transition-colors ${
                stage.status === 'running'
                  ? 'bg-[#2563EB]/[0.03]'
                  : stage.status === 'retrying'
                    ? 'bg-[#FFFBEB]/70'
                    : ''
              }`}
            >
              <div className="flex items-start gap-3.5 min-w-0">
                <div className="mt-0.5">
                  <StageStatusIcon status={stage.status} />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
                    <span className="text-xs font-mono tabular-nums text-[#64748B]">
                      {String(idx + 1).padStart(2, '0')}.
                    </span>
                    <span className="text-sm font-semibold text-[#172554]">{stage.label}</span>
                    <span className="text-xs text-[#64748B]">·</span>
                    <span
                      className={`text-xs font-medium ${
                        stage.status === 'completed'
                          ? 'text-[#16A34A]'
                          : stage.status === 'warning' ||
                              stage.status === 'partially_completed' ||
                              stage.status === 'retrying'
                            ? 'text-[#D97706]'
                            : stage.status === 'running'
                              ? 'text-[#2563EB]'
                              : stage.status === 'failed'
                                ? 'text-[#DC2626]'
                                : 'text-[#64748B]'
                      }`}
                    >
                      {stageStatusLabel(stage.status)}
                    </span>
                  </div>
                  {stage.detail && (
                    <p className="mt-1 text-xs leading-relaxed text-[#64748B]">{stage.detail}</p>
                  )}
                </div>
              </div>

              <div className="text-right shrink-0 text-xs font-mono tabular-nums text-[#64748B] whitespace-nowrap">
                {stage.completedAt
                  ? new Date(stage.completedAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })
                  : stage.status === 'retrying'
                    ? 'Retrying'
                    : stage.startedAt
                      ? 'In progress'
                      : 'Waiting'}
              </div>
            </li>
          ))}
        </ol>
      </div>

      {/* Completion Preview Bar */}
      {isReportReady && record.scoring && (
        <div className="bg-white border border-[#E5EAF2] rounded-xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="text-xs text-[#64748B]">
              {record.scoring.calibrationLabel}
              {record.status === 'partially_completed' ? ' · Partial report' : ''}
            </p>
            <p className="mt-1 text-lg font-bold text-[#172554] font-mono tabular-nums">
              {record.scoring.aiLikelihoodScore}/100 — {record.scoring.classification}
            </p>
            <p className="mt-0.5 text-xs text-[#64748B]">
              Evidence strength: {record.scoring.evidenceStrength} ·{' '}
              {record.scoring.methodsPerformedCount} completed ·{' '}
              {record.scoring.methodsFailedCount > 0
                ? `${record.scoring.methodsFailedCount} failed (excluded) · `
                : ''}
              {record.scoring.methodsUnavailableCount} unavailable disclosed
            </p>
          </div>
          <button
            type="button"
            onClick={() => onViewReport(record)}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-[#172554] hover:bg-[#1E3A8A] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {record.status === 'partially_completed'
              ? 'Inspect partial forensic report'
              : 'Inspect full forensic report'}
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
