import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  AnalysisRecord,
  MediaType,
  PipelineStage,
  PipelineStageId,
} from '../src/types/forensics.ts';
import { runAudioDetectionPipeline } from './audioDetection/index.ts';
import { runDocumentDetectionPipeline } from './documentDetection/index.ts';
import { FileValidationError, validateUploadedFile } from './fileValidation.ts';
import { GeminiServiceError } from './geminiClient.ts';
import { runImageDetectionPipeline } from './imageDetection/index.ts';
import { extractMetadataForFile } from './metadataExtraction/index.ts';
import { inspectProvenance } from './provenanceVerification/index.ts';
import { generateForensicReportNarrative } from './reportGeneration/index.ts';
import { aggregateForensicEvidence } from './scoringEngine/index.ts';
import {
  getAnalysisById,
  getSettings,
  listAnalyses,
  UPLOADS_DIR,
  upsertAnalysis,
} from './storage.ts';
import { runVideoDetectionPipeline } from './videoDetection/index.ts';

export class PipelineRetryError extends Error {
  statusCode: number;
  code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

/** Tracks actively executing analysis IDs to prevent duplicate concurrent pipeline jobs. */
const activePipelineRuns = new Set<string>();

export function isPipelineRunning(analysisId: string): boolean {
  return activePipelineRuns.has(analysisId);
}

function createInitialStages(): PipelineStage[] {
  return [
    { id: 'file_validation', label: 'File validation', status: 'pending' },
    { id: 'metadata_extraction', label: 'Metadata extraction', status: 'pending' },
    { id: 'media_preprocessing', label: 'Media preprocessing', status: 'pending' },
    { id: 'method_selection', label: 'Detection method selection', status: 'pending' },
    { id: 'forensic_analysis', label: 'Forensic analysis', status: 'pending' },
    { id: 'ai_assessment', label: 'AI-model assessment', status: 'pending' },
    { id: 'evidence_aggregation', label: 'Evidence aggregation', status: 'pending' },
    { id: 'report_generation', label: 'Report generation', status: 'pending' },
  ];
}

function getPlannedMethodsLabel(mediaType: MediaType): string {
  switch (mediaType) {
    case 'image':
      return 'Selected 12-method Image Forensics Pipeline (pixel entropy, Laplacian noise residual, ELA, frequency energy, visible watermark & OCR, lighting/texture/compositing, EXIF, C2PA; SynthID reported unavailable).';
    case 'video':
      return 'Selected 15-method Video Forensics Pipeline (FFmpeg multi-frame sampling, inter-frame pixel deltas, Bhattacharyya histogram similarity, GOP I/P/B, scene transitions, cross-frame visible watermark tracking, OCR, facial/temporal/lighting review, FFprobe streams, C2PA).';
    case 'audio':
      return 'Selected 7-method Audio Forensics Pipeline (16 kHz PCM waveform & DFT spectral centroid, dynamic range, silence ratio, acoustic artifacts, prosody, voice continuity, container metadata).';
    case 'pdf':
      return 'Selected 9-method PDF Forensics Pipeline (PDF text layer extraction, pdf-lib metadata & font/XObject inspection, stylometry, burstiness, n-gram repetition, linguistic assessment).';
    case 'document':
      return 'Selected Document Forensics Pipeline (text decoding, structural inspection, stylometry, sentence burstiness, n-gram repetition, linguistic pattern assessment).';
  }
}

async function findRetainedOriginalPath(analysisId: string): Promise<string | null> {
  const dir = path.join(UPLOADS_DIR, analysisId);
  try {
    const files = await fs.readdir(dir);
    const orig = files.find((f) => f.startsWith('original.'));
    return orig ? path.join(dir, orig) : null;
  } catch {
    return null;
  }
}

async function verifyCachedVideoFrames(analysis: AnalysisRecord): Promise<boolean> {
  if (analysis.mediaType !== 'video' || !analysis.videoFrames?.length || !analysis.metadata) {
    return false;
  }
  const framesDir = path.join(UPLOADS_DIR, analysis.id, 'frames');
  try {
    for (const frame of analysis.videoFrames) {
      await fs.access(path.join(framesDir, frame.thumbnailFile));
    }
    return true;
  } catch {
    return false;
  }
}

export async function createQueuedAnalysis(options: {
  tempFilePath: string;
  originalName: string;
  declaredMime: string;
}): Promise<{ analysis: AnalysisRecord; storedFilePath: string }> {
  const settings = await getSettings();
  const id = `TL-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  const analysisDir = path.join(UPLOADS_DIR, id);
  await fs.mkdir(analysisDir, { recursive: true });

  const safeExt = path.extname(options.originalName).toLowerCase().replace(/[^.a-z0-9]/g, '') || '.bin';
  const storedFilePath = path.join(analysisDir, `original${safeExt}`);
  await fs.copyFile(options.tempFilePath, storedFilePath);
  await fs.rm(options.tempFilePath, { force: true }).catch(() => undefined);

  const stat = await fs.stat(storedFilePath);
  const now = new Date();
  const expires = new Date(now.getTime() + settings.retainOriginalMediaHours * 3600 * 1000);

  // Quick preliminary guess before full magic-byte validation stage runs
  const extGuess: MediaType = ['.mp4', '.mov', '.webm'].includes(safeExt)
    ? 'video'
    : ['.wav', '.mp3', '.m4a'].includes(safeExt)
      ? 'audio'
      : safeExt === '.pdf'
        ? 'pdf'
        : ['.docx', '.txt'].includes(safeExt)
          ? 'document'
          : 'image';

  const analysis: AnalysisRecord = {
    id,
    fileName: options.originalName,
    mediaType: extGuess,
    uploadDate: now.toISOString(),
    fileHash: 'pending',
    fileSizeBytes: stat.size,
    mimeType: options.declaredMime || 'application/octet-stream',
    status: 'processing',
    stages: createInitialStages(),
    mediaRetained: true,
    mediaExpiresAt: expires.toISOString(),
    previewUrl: `/api/analyses/${id}/media`,
    detectors: [],
    watermarks: [],
    retryCount: 0,
  };

  await upsertAnalysis(analysis);
  return { analysis, storedFilePath };
}

export async function executeForensicPipeline(
  analysis: AnalysisRecord,
  storedFilePath: string,
  options?: { reuseVideoPreprocessing?: boolean },
): Promise<void> {
  if (activePipelineRuns.has(analysis.id)) {
    return;
  }
  activePipelineRuns.add(analysis.id);

  try {
    await runPipelineInternal(analysis, storedFilePath, options);
  } finally {
    activePipelineRuns.delete(analysis.id);
  }
}

async function runPipelineInternal(
  analysis: AnalysisRecord,
  storedFilePath: string,
  options?: { reuseVideoPreprocessing?: boolean },
): Promise<void> {
  const settings = await getSettings();
  const reuseVideoPreprocessing = Boolean(options?.reuseVideoPreprocessing);

  const updateStage = async (
    id: PipelineStageId,
    status: PipelineStage['status'],
    detail?: string,
  ) => {
    const nowIso = new Date().toISOString();
    const isTerminal =
      status === 'completed' ||
      status === 'partially_completed' ||
      status === 'warning' ||
      status === 'failed' ||
      status === 'unavailable';

    analysis.stages = analysis.stages.map((st) => {
      if (st.id !== id) return st;
      return {
        ...st,
        status,
        startedAt: st.startedAt ?? nowIso,
        completedAt: isTerminal ? nowIso : undefined,
        detail: detail ?? st.detail,
      };
    });
    await upsertAnalysis({ ...analysis });
  };

  let currentStage: PipelineStageId = 'file_validation';

  try {
    let mediaType: MediaType = analysis.mediaType;
    let metadata = analysis.metadata;
    let extractedText: string | undefined;
    let provenance = await inspectProvenance(storedFilePath, mediaType);

    if (reuseVideoPreprocessing && analysis.mediaType === 'video' && metadata && analysis.videoFrames?.length) {
      // Preserve completed preprocessing stages without repeating FFmpeg extraction or validation
      currentStage = 'forensic_analysis';
      await updateStage(
        'media_preprocessing',
        'completed',
        `Reused ${analysis.videoFrames.length} cached video frames on disk — FFmpeg extraction skipped (retry #${analysis.retryCount ?? 1}).`,
      );
    } else {
      // Stage 1: File validation
      currentStage = 'file_validation';
      await updateStage(
        'file_validation',
        'running',
        'Verifying binary magic bytes, file integrity, size limits, and SHA-256 hash.',
      );
      const validated = await validateUploadedFile(
        storedFilePath,
        analysis.fileName,
        analysis.mimeType,
        settings.maxUploadSizeMb,
      );
      mediaType = validated.mediaType;
      analysis.mediaType = validated.mediaType;
      analysis.mimeType = validated.detectedMime;
      analysis.fileHash = validated.sha256;
      analysis.fileSizeBytes = validated.fileSizeBytes;

      // Duplicate SHA-256 audit check against prior completed/partial analyses
      const existingAnalyses = await listAnalyses();
      const priorMatch = existingAnalyses.find(
        (a) =>
          a.id !== analysis.id &&
          (a.status === 'completed' || a.status === 'partially_completed') &&
          a.fileHash === validated.sha256,
      );
      if (priorMatch) {
        analysis.duplicateOfAnalysisId = priorMatch.id;
      }

      await updateStage(
        'file_validation',
        'completed',
        `Verified ${validated.mediaType.toUpperCase()} (${validated.detectedMime}) · SHA-256 ${validated.sha256.slice(0, 12)}…${priorMatch ? ` · Matches prior ${priorMatch.id}` : ''}`,
      );

      // Stage 2: Metadata extraction + Provenance scan
      currentStage = 'metadata_extraction';
      await updateStage(
        'metadata_extraction',
        'running',
        'Extracting container headers, EXIF/XMP/codec tags, and scanning for C2PA JUMBF provenance markers.',
      );
      provenance = await inspectProvenance(storedFilePath, validated.mediaType);
      const metaRes = await extractMetadataForFile(storedFilePath, validated, provenance);
      metadata = metaRes.metadata;
      extractedText = metaRes.extractedText;
      analysis.metadata = metadata;
      await updateStage(
        'metadata_extraction',
        'completed',
        `Metadata present: ${metadata.metadataPresent ? 'Yes' : 'No'} · C2PA status: ${metadata.c2paStatus}.`,
      );

      // Stage 3: Media preprocessing
      currentStage = 'media_preprocessing';
      await updateStage(
        'media_preprocessing',
        'running',
        validated.mediaType === 'video'
          ? 'Preparing FFmpeg controlled multi-frame extraction.'
          : validated.mediaType === 'audio'
            ? 'Preparing FFmpeg 16 kHz mono PCM waveform decoding.'
            : validated.mediaType === 'image'
              ? 'Decoding normalized RGB pixel matrix and watermark inspection strips.'
              : 'Segmenting extracted text into passages for stylometric and linguistic inspection.',
      );

      // Stage 4: Detection method selection (strictly media-type specific)
      currentStage = 'method_selection';
      await updateStage('media_preprocessing', 'completed', 'Media preprocessed safely in isolated working buffer.');
      await updateStage('method_selection', 'running', 'Selecting applicable media-specific forensic detectors.');
      await updateStage('method_selection', 'completed', getPlannedMethodsLabel(validated.mediaType));
    }

    if (!metadata) {
      throw new Error('Metadata missing prior to forensic analysis.');
    }

    // Stage 5 & 6: Forensic analysis + AI-model assessment
    currentStage = 'forensic_analysis';
    await updateStage(
      'forensic_analysis',
      'running',
      'Executing independent deterministic forensic signal checks and watermark detection.',
    );

    const stageCallback = (
      stageId: 'media_preprocessing' | 'forensic_analysis' | 'ai_assessment',
      detail: string,
      statusOverride?: 'running' | 'retrying',
    ) => {
      const nextStatus: PipelineStage['status'] = statusOverride ?? 'running';
      if (stageId === 'forensic_analysis') {
        const preStage = analysis.stages.find((s) => s.id === 'media_preprocessing');
        if (preStage && preStage.status === 'running') {
          void updateStage('media_preprocessing', 'completed');
        }
        void updateStage('forensic_analysis', nextStatus, detail);
      } else if (stageId === 'ai_assessment') {
        currentStage = 'ai_assessment';
        const preStage = analysis.stages.find((s) => s.id === 'media_preprocessing');
        if (preStage && preStage.status === 'running') {
          void updateStage('media_preprocessing', 'completed');
        }
        const forensicStage = analysis.stages.find((s) => s.id === 'forensic_analysis');
        if (forensicStage && (forensicStage.status === 'running' || forensicStage.status === 'retrying')) {
          void updateStage('forensic_analysis', 'completed');
        }
        void updateStage('ai_assessment', nextStatus, detail);
      } else {
        void updateStage(stageId, nextStatus, detail);
      }
    };

    const cropsDir = path.join(UPLOADS_DIR, analysis.id, 'watermarks');

    if (mediaType === 'image') {
      const res = await runImageDetectionPipeline({
        analysisId: analysis.id,
        filePath: storedFilePath,
        cropsOutputDir: cropsDir,
        metadata,
        provenance,
        onStageProgress: stageCallback,
      });
      analysis.detectors = res.detectors;
      analysis.watermarks = res.watermarks;
      analysis.imageVisualMetrics = res.imageVisualMetrics;
      analysis.geminiStatus = res.geminiStatus;
      analysis.geminiModelUsed = res.geminiModelUsed;
      analysis.geminiFailureDetail = res.geminiFailureDetail;
    } else if (mediaType === 'video') {
      const framesDir = path.join(UPLOADS_DIR, analysis.id, 'frames');
      const res = await runVideoDetectionPipeline({
        analysisId: analysis.id,
        filePath: storedFilePath,
        framesOutputDir: framesDir,
        cropsOutputDir: cropsDir,
        metadata,
        provenance,
        targetFrameCount: settings.videoFrameSampleCount,
        reuseExistingFrames: reuseVideoPreprocessing ? analysis.videoFrames : undefined,
        reuseSamplingStrategy: reuseVideoPreprocessing ? analysis.videoSamplingStrategy : undefined,
        onStageProgress: stageCallback,
      });
      analysis.detectors = res.detectors;
      analysis.watermarks = res.watermarks;
      analysis.videoFrames = res.videoFrames;
      analysis.videoSamplingStrategy = res.videoSamplingStrategy;
      analysis.videoTelemetry = res.videoTelemetry;
      analysis.geminiStatus = res.geminiStatus;
      analysis.geminiModelUsed = res.geminiModelUsed;
      analysis.geminiFailureDetail = res.geminiFailureDetail;
    } else if (mediaType === 'audio') {
      const res = await runAudioDetectionPipeline({
        filePath: storedFilePath,
        metadata,
        provenance,
        onStageProgress: stageCallback,
      });
      analysis.detectors = res.detectors;
      analysis.watermarks = res.watermarks;
      analysis.audioProfile = res.audioProfile;
      analysis.geminiStatus = res.geminiStatus;
      analysis.geminiModelUsed = res.geminiModelUsed;
      analysis.geminiFailureDetail = res.geminiFailureDetail;
    } else {
      const res = await runDocumentDetectionPipeline({
        extractedText: extractedText ?? '',
        metadata,
        provenance,
        isPdf: mediaType === 'pdf',
        onStageProgress: stageCallback,
      });
      analysis.detectors = res.detectors;
      analysis.watermarks = res.watermarks;
      analysis.documentSegments = res.documentSegments;
      analysis.documentStats = res.documentStats;
      analysis.geminiStatus = res.geminiStatus;
      analysis.geminiModelUsed = res.geminiModelUsed;
      analysis.geminiFailureDetail = res.geminiFailureDetail;
    }

    const completedCount = analysis.detectors.filter(
      (d) =>
        (d.status === 'completed' || d.status === 'partially_implemented') && d.ran,
    ).length;
    const partiallyCompletedCount = analysis.detectors.filter(
      (d) => d.status === 'partially_completed' && d.ran,
    ).length;
    const failedCount = analysis.detectors.filter((d) => d.status === 'failed').length;
    const unavailableCount = analysis.detectors.filter((d) => d.status === 'unavailable').length;

    const forensicStageFailed = analysis.detectors.some(
      (d) =>
        d.status === 'failed' &&
        (d.id === 'visible_watermark_detection' || d.id === 'ocr_text_recognition'),
    );

    const forensicStageStatus: PipelineStage['status'] =
      forensicStageFailed || partiallyCompletedCount > 0
        ? 'partially_completed'
        : unavailableCount > 0
          ? 'warning'
          : 'completed';

    await updateStage(
      'forensic_analysis',
      forensicStageStatus,
      `${completedCount} completed${partiallyCompletedCount > 0 ? `, ${partiallyCompletedCount} partially completed` : ''}${failedCount > 0 ? `, ${failedCount} failed (recoverable)` : ''}; ${unavailableCount} unavailable method(s) explicitly disclosed.`,
    );

    if (analysis.geminiStatus === 'completed') {
      await updateStage(
        'ai_assessment',
        'completed',
        `Structured Gemini multimodal forensic reasoning completed (${analysis.geminiModelUsed ?? 'configured model'}).`,
      );
    } else if (analysis.geminiStatus === 'partially_completed') {
      await updateStage(
        'ai_assessment',
        'partially_completed',
        `Gemini analysis partially completed (${analysis.geminiFailureDetail ?? 'one or more multimodal calls failed'}). Completed detectors preserved.`,
      );
    } else if (analysis.geminiStatus === 'failed') {
      await updateStage(
        'ai_assessment',
        'failed',
        `Gemini multimodal analysis failed after retries (${analysis.geminiFailureDetail ?? 'upstream unavailable'}). Independent local detectors preserved; continuing to evidence aggregation.`,
      );
    } else {
      await updateStage(
        'ai_assessment',
        'unavailable',
        'Gemini multimodal analysis not applicable or skipped (e.g., insufficient text volume).',
      );
    }

    // Stage 7: Evidence aggregation — ALWAYS runs on whatever independent detectors completed
    currentStage = 'evidence_aggregation';
    await updateStage(
      'evidence_aggregation',
      'running',
      'Aggregating reliability-weighted correlation groups (excluding unavailable & failed detectors).',
    );
    const scoring = aggregateForensicEvidence(analysis.detectors);
    analysis.scoring = scoring;
    await updateStage(
      'evidence_aggregation',
      failedCount > 0 ? 'partially_completed' : 'completed',
      `Score ${scoring.aiLikelihoodScore}/100 (Experimental) · Evidence strength: ${scoring.evidenceStrength} · ${scoring.classification}${failedCount > 0 ? ` (${failedCount} failed detector(s) excluded)` : ''}.`,
    );

    const isPartialReport =
      failedCount > 0 ||
      analysis.geminiStatus === 'failed' ||
      analysis.geminiStatus === 'partially_completed';

    analysis.isPartialReport = isPartialReport;
    analysis.canRetryGemini = Boolean(isPartialReport && analysis.mediaRetained);

    // Stage 8: Report generation — produces full or honest partial report
    currentStage = 'report_generation';
    await updateStage(
      'report_generation',
      'running',
      isPartialReport
        ? 'Compiling partial forensic report clearly separating completed local findings from failed Gemini detectors.'
        : 'Compiling forensic report separating observed evidence from AI explanations.',
    );
    analysis.geminiSummary = await generateForensicReportNarrative({
      mediaType,
      metadata,
      detectors: analysis.detectors,
      watermarks: analysis.watermarks,
      scoring,
      samplingStrategy: analysis.videoSamplingStrategy,
      geminiStatus: analysis.geminiStatus,
      geminiFailureDetail: analysis.geminiFailureDetail,
      skipGeminiNarrative: analysis.geminiStatus === 'failed',
    });

    analysis.status = isPartialReport ? 'partially_completed' : 'completed';
    analysis.errorCode = undefined;
    analysis.errorMessage = undefined;
    analysis.completedDate = new Date().toISOString();
    await updateStage(
      'report_generation',
      isPartialReport ? 'partially_completed' : 'completed',
      isPartialReport
        ? 'Partial forensic report compiled and persisted. Retry Gemini Analysis available without repeating video preprocessing.'
        : 'Forensic report compiled and persisted.',
    );
  } catch (error) {
    let errorCode = 'PROCESSING_ERROR';
    let message = error instanceof Error ? error.message : 'Unexpected forensic pipeline failure.';

    if (error instanceof FileValidationError) {
      errorCode = error.code;
      message = error.message;
    } else if (error instanceof GeminiServiceError) {
      errorCode = error.code;
      message = error.message;
    }

    analysis.status = 'failed';
    analysis.errorCode = errorCode;
    analysis.errorMessage = message;
    analysis.canRetryGemini = Boolean(analysis.mediaRetained);
    await updateStage(currentStage, 'failed', message);
  }
}

export async function retryAnalysisPipeline(
  analysisId: string,
  options?: { awaitCompletion?: boolean },
): Promise<AnalysisRecord> {
  const record = await getAnalysisById(analysisId);
  if (!record) {
    throw new PipelineRetryError(404, 'NOT_FOUND', 'Analysis record not found.');
  }
  if (record.status === 'processing' || activePipelineRuns.has(record.id)) {
    throw new PipelineRetryError(409, 'ALREADY_PROCESSING', 'This analysis is already running.');
  }

  const originalPath = await findRetainedOriginalPath(record.id);
  const canReuseVideoFrames = await verifyCachedVideoFrames(record);

  if (!originalPath) {
    throw new PipelineRetryError(
      410,
      'ARTIFACTS_EXPIRED',
      'Original media file has been purged under retention policy. Please upload the file again.',
    );
  }

  record.retryCount = (record.retryCount ?? 0) + 1;
  record.status = 'processing';
  record.errorCode = undefined;
  record.errorMessage = undefined;
  record.geminiFailureDetail = null;

  if (canReuseVideoFrames) {
    // Keep validation, metadata, preprocessing, and method selection intact; reset stages 5-8 only
    const resetIds = new Set<PipelineStageId>([
      'forensic_analysis',
      'ai_assessment',
      'evidence_aggregation',
      'report_generation',
    ]);
    record.stages = record.stages.map((st) => {
      if (st.id === 'media_preprocessing') {
        return {
          ...st,
          status: 'completed',
          detail: `Cached ${record.videoFrames?.length ?? 0} video frames preserved on disk — skipping FFmpeg extraction on retry #${record.retryCount}.`,
        };
      }
      if (resetIds.has(st.id)) {
        return { id: st.id, label: st.label, status: 'pending' };
      }
      return st;
    });
  } else {
    record.stages = createInitialStages();
  }

  await upsertAnalysis(record);
  const pipelinePromise = executeForensicPipeline(record, originalPath, {
    reuseVideoPreprocessing: canReuseVideoFrames,
  });

  if (options?.awaitCompletion) {
    await pipelinePromise;
    return (await getAnalysisById(record.id)) ?? record;
  }

  void pipelinePromise;
  return record;
}
