import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';
import type { DatasetRecord, SystemCapabilities } from './src/types/forensics.ts';
import { evaluateBenchmarkDataset } from './services/evaluationEngine.ts';
import { GEMINI_FORENSIC_MODEL, isGeminiConfigured } from './services/geminiClient.ts';
import {
  createQueuedAnalysis,
  executeForensicPipeline,
  PipelineRetryError,
  retryAnalysisPipeline,
} from './services/orchestrator.ts';
import {
  deleteAnalysis,
  deleteDatasetRecord,
  ensureStorageReady,
  getAnalysisById,
  getSettings,
  importDatasetRecords,
  listAnalyses,
  listDatasetRecords,
  parseCsvToDatasetRecords,
  purgeExpiredMedia,
  serializeDatasetToCsv,
  updateSettings,
  UPLOADS_DIR,
  upsertDatasetRecord,
  validateDatasetCollection,
} from './services/storage.ts';

const execFileAsync = promisify(execFile);

const PORT = 3000;
const TEMP_UPLOAD_DIR = path.join(os.tmpdir(), 'truthlens-uploads');

async function detectSystemCapabilities(): Promise<SystemCapabilities> {
  const checkBin = async (bin: string) => {
    try {
      await execFileAsync(bin, ['-version'], { timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  };
  const [ffmpegAvailable, ffprobeAvailable] = await Promise.all([
    checkBin('ffmpeg'),
    checkBin('ffprobe'),
  ]);
  return {
    ffmpegAvailable,
    ffprobeAvailable,
    sharpAvailable: true,
    geminiConfigured: isGeminiConfigured(),
    synthIdVerifierAvailable: false,
    c2paCryptographicVerifierAvailable: false,
    storageMode: 'Local server disk JSON persistence (./data)',
    geminiModel: GEMINI_FORENSIC_MODEL,
  };
}

async function startServer() {
  await ensureStorageReady();
  await fs.mkdir(TEMP_UPLOAD_DIR, { recursive: true });
  await purgeExpiredMedia();

  // Periodic retention cleanup every 30 minutes
  setInterval(() => {
    void purgeExpiredMedia();
  }, 30 * 60 * 1000);

  const app = express();
  app.use(express.json({ limit: '10mb' }));

  const upload = multer({
    dest: TEMP_UPLOAD_DIR,
    limits: {
      fileSize: 500 * 1024 * 1024, // Streaming disk cap 500MB; per-setting limit checked in fileValidation
      files: 6,
    },
  });

  // Health & capabilities
  app.get('/api/health', async (_req, res) => {
    const capabilities = await detectSystemCapabilities();
    res.json({ status: 'ok', capabilities });
  });

  // Settings
  app.get('/api/settings', async (_req, res) => {
    const [settings, capabilities] = await Promise.all([getSettings(), detectSystemCapabilities()]);
    res.json({ settings, capabilities });
  });

  app.put('/api/settings', async (req, res) => {
    const updated = await updateSettings(req.body ?? {});
    res.json({ settings: updated });
  });

  // Analyses list + live stats
  app.get('/api/analyses', async (req, res) => {
    const all = await listAnalyses();
    const q = String(req.query.q ?? '').trim().toLowerCase();
    const mediaType = String(req.query.mediaType ?? '').trim();
    const classification = String(req.query.classification ?? '').trim();

    const filtered = all.filter((item) => {
      if (q && !item.fileName.toLowerCase().includes(q) && !item.id.toLowerCase().includes(q)) {
        return false;
      }
      if (mediaType && mediaType !== 'all' && item.mediaType !== mediaType) return false;
      if (
        classification &&
        classification !== 'all' &&
        (item.scoring?.classification ?? '') !== classification
      ) {
        return false;
      }
      return true;
    });

    const completed = all.filter(
      (a) => a.status === 'completed' || a.status === 'partially_completed',
    );
    const partialCount = all.filter((a) => a.status === 'partially_completed').length;
    const elevatedAiCount = completed.filter(
      (a) =>
        a.scoring?.classification === 'Likely AI-generated' ||
        a.scoring?.classification === 'Potentially AI-assisted' ||
        a.scoring?.classification === 'Potentially manipulated',
    ).length;
    const inconclusiveCount = completed.filter(
      (a) => a.scoring?.classification === 'Inconclusive',
    ).length;
    const likelyHumanCount = completed.filter(
      (a) => a.scoring?.classification === 'Likely human-created',
    ).length;

    const mediaDistribution: Record<string, number> = {
      image: 0,
      video: 0,
      pdf: 0,
      document: 0,
      audio: 0,
    };
    for (const a of all) {
      mediaDistribution[a.mediaType] = (mediaDistribution[a.mediaType] ?? 0) + 1;
    }

    res.json({
      analyses: filtered,
      stats: {
        totalAnalyses: all.length,
        completedCount: completed.length,
        partialCount,
        processingCount: all.filter((a) => a.status === 'processing').length,
        elevatedAiCount,
        inconclusiveCount,
        likelyHumanCount,
        mediaDistribution,
      },
    });
  });

  // Get single analysis (polled by Analysis Workspace for live stages)
  app.get('/api/analyses/:id', async (req, res) => {
    const record = await getAnalysisById(req.params.id);
    if (!record) {
      res.status(404).json({ error: 'Analysis record not found.' });
      return;
    }
    res.json({ analysis: record });
  });

  // Upload one or multiple files and launch real async forensic pipeline
  app.post('/api/analyses/upload', (req, res) => {
    upload.array('files', 6)(req, res, async (err) => {
      if (err) {
        const message =
          err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE'
            ? 'Uploaded file exceeds the maximum allowed upload size.'
            : err.message || 'Upload failed.';
        res.status(400).json({ error: message, code: 'UPLOAD_ERROR' });
        return;
      }

      const files = (req.files as Express.Multer.File[]) ?? [];
      if (files.length === 0) {
        res.status(400).json({ error: 'Please select at least one file to analyse.', code: 'NO_FILES' });
        return;
      }

      try {
        const created = [];
        for (const file of files) {
          const { analysis, storedFilePath } = await createQueuedAnalysis({
            tempFilePath: file.path,
            originalName: file.originalname,
            declaredMime: file.mimetype,
          });
          created.push(analysis);
          // Execute real pipeline asynchronously so Analysis Workspace tracks live server stages
          void executeForensicPipeline(analysis, storedFilePath);
        }

        res.status(202).json({ analyses: created });
      } catch (e) {
        res.status(500).json({
          error: e instanceof Error ? e.message : 'Failed to initialize forensic analysis.',
          code: 'PIPELINE_INIT_ERROR',
        });
      }
    });
  });

  // Built-in sample specimen trigger so reviewers can verify the complete real backend pipeline in one click
  app.post('/api/analyses/sample', async (req, res) => {
    const sampleType = String(req.body?.sampleType ?? 'image');
    try {
      let tempPath = '';
      let originalName = '';
      let declaredMime = '';

      if (sampleType === 'document') {
        tempPath = path.join(TEMP_UPLOAD_DIR, `sample_${Date.now()}.txt`);
        const sampleDoc = [
          'Executive Briefing: Municipal Water Resilience Infrastructure Plan (2026-2030)',
          '',
          'In today’s rapidly evolving climate landscape, urban municipalities face unprecedented challenges in maintaining reliable potable water distribution systems. It is important to note that comprehensive modernization plays a pivotal role in safeguarding public infrastructure while simultaneously optimizing long-term operational expenditures.',
          '',
          'Furthermore, by leveraging advanced acoustic leak-detection telemetry alongside predictive hydraulic modeling, utility operators can seamlessly identify structural anomalies prior to catastrophic main failures. This holistic approach not only enhances service continuity, but also underscores our unwavering commitment to sustainable resource stewardship.',
          '',
          'Field engineer note (added 14 Nov): Pump station #4 on Mercer Ave still loses ~11 psi every Tuesday morning when the dairy plant shifts washdown cycles—recommend swapping the 1998 check valve before winter freeze hits.',
        ].join('\n');
        await fs.writeFile(tempPath, sampleDoc, 'utf-8');
        originalName = 'municipal_water_briefing_specimen.txt';
        declaredMime = 'text/plain';
      } else {
        const specimenSrc = path.resolve(
          process.cwd(),
          'src/assets/images/forensic_specimen_architecture_1795085183127.jpg',
        );
        tempPath = path.join(TEMP_UPLOAD_DIR, `sample_${Date.now()}.jpg`);
        await fs.copyFile(specimenSrc, tempPath);
        originalName = 'research_pavilion_specimen.jpg';
        declaredMime = 'image/jpeg';
      }

      const { analysis, storedFilePath } = await createQueuedAnalysis({
        tempFilePath: tempPath,
        originalName,
        declaredMime,
      });
      void executeForensicPipeline(analysis, storedFilePath);
      res.status(202).json({ analysis });
    } catch (e) {
      res.status(500).json({
        error: e instanceof Error ? e.message : 'Unable to launch sample specimen analysis.',
      });
    }
  });

  // Retry recoverable analysis or Gemini multimodal stage (reuses cached video frames when present)
  app.post('/api/analyses/:id/retry', async (req, res) => {
    try {
      const analysis = await retryAnalysisPipeline(req.params.id);
      res.status(202).json({ analysis });
    } catch (e) {
      if (e instanceof PipelineRetryError) {
        res.status(e.statusCode).json({ error: e.message, code: e.code });
        return;
      }
      res.status(500).json({
        error: e instanceof Error ? e.message : 'Unable to retry forensic analysis.',
        code: 'RETRY_ERROR',
      });
    }
  });

  // Delete analysis and purge stored media
  app.delete('/api/analyses/:id', async (req, res) => {
    const deleted = await deleteAnalysis(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Analysis not found.' });
      return;
    }
    res.json({ deleted: true });
  });

  // Safely serve retained original media (never executed; nosniff headers)
  app.get('/api/analyses/:id/media', async (req, res) => {
    const record = await getAnalysisById(req.params.id);
    if (!record || !record.mediaRetained) {
      res.status(404).json({ error: 'Original media file is no longer retained.' });
      return;
    }
    const dir = path.join(UPLOADS_DIR, record.id);
    try {
      const files = await fs.readdir(dir);
      const orig = files.find((f) => f.startsWith('original.'));
      if (!orig) {
        res.status(404).json({ error: 'Original file missing on disk.' });
        return;
      }
      const fullPath = path.join(dir, orig);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; media-src 'self'; img-src 'self';");
      res.setHeader('Content-Type', record.mimeType || 'application/octet-stream');
      if (req.query.download === '1') {
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${record.fileName.replace(/["\\]/g, '')}"`,
        );
      }
      res.sendFile(fullPath);
    } catch {
      res.status(404).json({ error: 'Media file unavailable.' });
    }
  });

  // Serve extracted video frame JPEG thumbnail
  app.get('/api/analyses/:id/frames/:frameFile', async (req, res) => {
    const safeName = path.basename(req.params.frameFile);
    if (!/^frame_\d+\.jpg$/.test(safeName)) {
      res.status(400).json({ error: 'Invalid frame filename.' });
      return;
    }
    const framePath = path.join(UPLOADS_DIR, path.basename(req.params.id), 'frames', safeName);
    try {
      await fs.access(framePath);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Type', 'image/jpeg');
      res.sendFile(framePath);
    } catch {
      res.status(404).json({ error: 'Frame thumbnail not found.' });
    }
  });

  // Serve saved watermark evidence crop screenshot
  app.get('/api/analyses/:id/watermarks/:cropFile', async (req, res) => {
    const safeName = path.basename(req.params.cropFile);
    if (!/^wm_crop_\d+\.jpg$/.test(safeName)) {
      res.status(400).json({ error: 'Invalid watermark crop filename.' });
      return;
    }
    const cropPath = path.join(UPLOADS_DIR, path.basename(req.params.id), 'watermarks', safeName);
    try {
      await fs.access(cropPath);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Type', 'image/jpeg');
      res.sendFile(cropPath);
    } catch {
      res.status(404).json({ error: 'Watermark crop image not found.' });
    }
  });

  // Export JSON forensic report
  app.get('/api/analyses/:id/export/json', async (req, res) => {
    const record = await getAnalysisById(req.params.id);
    if (!record) {
      res.status(404).json({ error: 'Analysis not found.' });
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="truthlens-report-${record.id}.json"`);
    res.send(JSON.stringify(record, null, 2));
  });

  // Dataset management routes
  app.get('/api/datasets', async (_req, res) => {
    const records = await listDatasetRecords();
    const validation = validateDatasetCollection(records);
    res.json({ records, validation });
  });

  // Real benchmark evaluation metrics (FPR, FNR, Precision, Recall, F1, Accuracy, ROC-AUC)
  app.get('/api/datasets/evaluate', async (req, res) => {
    const thresholdRaw = Number(req.query.threshold ?? 60);
    const threshold = Number.isFinite(thresholdRaw) ? thresholdRaw : 60;
    const [records, analyses] = await Promise.all([listDatasetRecords(), listAnalyses()]);
    const evaluation = evaluateBenchmarkDataset(records, analyses, threshold);
    res.json({ evaluation });
  });

  app.post('/api/datasets', async (req, res) => {
    const body = req.body as Partial<DatasetRecord>;
    if (!body?.sample_id || !body?.file_name) {
      res.status(400).json({ error: 'sample_id and file_name are required.' });
      return;
    }
    const record: DatasetRecord = {
      sample_id: String(body.sample_id).trim(),
      file_name: String(body.file_name).trim(),
      media_type: body.media_type || 'image',
      ground_truth_label: body.ground_truth_label || 'UNKNOWN',
      generation_platform: body.generation_platform || '',
      generation_model: body.generation_model || '',
      creation_method: body.creation_method || '',
      visible_watermark: Boolean(body.visible_watermark),
      watermark_text: body.watermark_text || '',
      invisible_watermark_status: body.invisible_watermark_status || 'not_verified',
      c2pa_status: body.c2pa_status || 'absent',
      mime_type: body.mime_type || '',
      file_size_bytes: body.file_size_bytes ?? null,
      width: body.width ?? null,
      height: body.height ?? null,
      duration_seconds: body.duration_seconds ?? null,
      frame_rate: body.frame_rate ?? null,
      codec: body.codec || '',
      creation_timestamp: body.creation_timestamp || '',
      modification_timestamp: body.modification_timestamp || '',
      encoder: body.encoder || '',
      exif_software: body.exif_software || '',
      camera_make: body.camera_make || '',
      camera_model: body.camera_model || '',
      metadata_present: Boolean(body.metadata_present),
      compression_level: body.compression_level || '',
      editing_history: body.editing_history || '',
      manipulation_type: body.manipulation_type || '',
      dataset_source: body.dataset_source || 'Manual Entry',
      license: body.license || '',
      consent_status: body.consent_status || '',
      split: body.split || 'train',
      notes: body.notes || '',
      file_hash: body.file_hash || '',
      recording_condition: body.recording_condition || '',
      predicted_score:
        typeof body.predicted_score === 'number' && Number.isFinite(body.predicted_score)
          ? Math.max(0, Math.min(100, Math.round(body.predicted_score)))
          : null,
      predicted_classification: body.predicted_classification || '',
      linked_analysis_id: body.linked_analysis_id || '',
      is_illustrative_seed: false,
    };
    try {
      const saved = await upsertDatasetRecord(record);
      const records = await listDatasetRecords();
      res.status(201).json({ record: saved, validation: validateDatasetCollection(records) });
    } catch (e) {
      res.status(409).json({
        error: e instanceof Error ? e.message : 'Dataset record conflicts with split governance.',
      });
    }
  });

  app.delete('/api/datasets/:sampleId', async (req, res) => {
    const deleted = await deleteDatasetRecord(req.params.sampleId);
    if (!deleted) {
      res.status(404).json({ error: 'Dataset record not found.' });
      return;
    }
    const records = await listDatasetRecords();
    res.json({ deleted: true, validation: validateDatasetCollection(records) });
  });

  app.post('/api/datasets/import', async (req, res) => {
    const csvText = String(req.body?.csv ?? '');
    if (!csvText.trim()) {
      res.status(400).json({ error: 'CSV content is empty.' });
      return;
    }
    const parsed = parseCsvToDatasetRecords(csvText);
    if (parsed.length === 0) {
      res.status(400).json({ error: 'No valid data rows found in CSV.' });
      return;
    }
    const result = await importDatasetRecords(parsed);
    const records = await listDatasetRecords();
    res.json({ ...result, records, validation: validateDatasetCollection(records) });
  });

  app.get('/api/datasets/export', async (_req, res) => {
    const records = await listDatasetRecords();
    const csv = serializeDatasetToCsv(records);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="truthlens-dataset-schema.csv"');
    res.send(csv);
  });

  // Mount Vite middleware in development, static dist in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`TruthLens server running at http://0.0.0.0:${PORT}`);
  });
}

void startServer();
