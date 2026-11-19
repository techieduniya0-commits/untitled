import { useCallback, useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import type { AnalysisRecord, AppSettings } from './types/forensics';
import { MOTION_DURATION, MOTION_EASE } from './lib/motion';
import { AnalysisWorkspace } from './components/AnalysisWorkspace';
import { DashboardView } from './components/DashboardView';
import { DatasetManagerView } from './components/DatasetManagerView';
import { ForensicReportView } from './components/ForensicReportView';
import { GlobalAmbientCanvas } from './components/GlobalAmbientCanvas';
import { GlobalMagnifier } from './components/GlobalMagnifier';
import { HistoryView } from './components/HistoryView';
import { LandingPage } from './components/LandingPage';
import { SettingsView } from './components/SettingsView';
import { UploadWorkspace } from './components/UploadWorkspace';
import { WorkspaceShell, type WorkspaceTab } from './components/WorkspaceShell';

export default function App() {
  const [inWorkspace, setInWorkspace] = useState(false);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('overview');
  const [analyses, setAnalyses] = useState<AnalysisRecord[]>([]);
  const [loadingAnalyses, setLoadingAnalyses] = useState(false);
  const [activeAnalysisId, setActiveAnalysisId] = useState<string | null>(null);
  const [selectedReport, setSelectedReport] = useState<AnalysisRecord | null>(null);
  const [settings, setSettings] = useState<AppSettings>({
    retainOriginalMediaHours: 24,
    videoFrameSampleCount: 6,
    maxUploadSizeMb: 50,
    storageBackend: 'Local server filesystem JSON persistence (./data)',
    storageNotice: '',
  });
  const [runningSample, setRunningSample] = useState(false);
  const [toastError, setToastError] = useState<string | null>(null);
  const prefersReducedMotion = Boolean(useReducedMotion());

  const fetchAnalyses = useCallback(async () => {
    setLoadingAnalyses(true);
    try {
      const res = await fetch('/api/analyses');
      if (res.ok) {
        const data = await res.json();
        const serverList = (data.analyses ?? []) as AnalysisRecord[];
        setAnalyses((prev) => {
          const merged = new Map<string, AnalysisRecord>();
          for (const item of prev) merged.set(item.id, item);
          for (const item of serverList) merged.set(item.id, item);
          return Array.from(merged.values()).sort(
            (a, b) => new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime(),
          );
        });
      }
    } catch {
      // Ignore transient network errors on initial load
    } finally {
      setLoadingAnalyses(false);
    }
  }, []);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/settings');
      if (res.ok) {
        const data = await res.json();
        if (data.settings) setSettings(data.settings);
      }
    } catch {
      // Use defaults
    }
  }, []);

  useEffect(() => {
    if (inWorkspace) {
      void fetchAnalyses();
      void fetchSettings();
    }
  }, [inWorkspace, fetchAnalyses, fetchSettings]);

  const handleEnterWorkspace = (initialTab: 'overview' | 'upload' = 'overview') => {
    setInWorkspace(true);
    setActiveTab(initialTab);
    window.scrollTo({ top: 0, behavior: 'auto' });
  };

  const handleAnalysesStarted = (created: AnalysisRecord[]) => {
    setToastError(null);
    setSelectedReport(null);
    setAnalyses((prev) => {
      const byId = new Map<string, AnalysisRecord>();
      for (const item of created) byId.set(item.id, item);
      for (const item of prev) {
        if (!byId.has(item.id)) byId.set(item.id, item);
      }
      return Array.from(byId.values()).sort(
        (a, b) => new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime(),
      );
    });
    if (created.length > 0) {
      setActiveAnalysisId(created[0].id);
      setActiveTab('analysis-live');
    }
  };

  const handleAnalysisUpdated = useCallback((updated: AnalysisRecord) => {
    setAnalyses((prev) => {
      const exists = prev.some((item) => item.id === updated.id);
      if (!exists) return [updated, ...prev];
      return prev.map((item) => (item.id === updated.id ? updated : item));
    });
  }, []);

  const handleOpenAnalysis = (record: AnalysisRecord) => {
    if (record.status === 'completed' || record.status === 'partially_completed') {
      setSelectedReport(record);
      setActiveTab('report-detail');
    } else {
      setActiveAnalysisId(record.id);
      setActiveTab('analysis-live');
    }
  };

  const handleRetryAnalysis = async (id: string) => {
    setToastError(null);
    try {
      const res = await fetch(`/api/analyses/${encodeURIComponent(id)}/retry`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok || !data.analysis) {
        setToastError(data.error || 'Could not retry forensic analysis.');
        return;
      }
      const updated = data.analysis as AnalysisRecord;
      handleAnalysisUpdated(updated);
      setSelectedReport(null);
      setActiveAnalysisId(updated.id);
      setActiveTab('analysis-live');
    } catch {
      setToastError('Could not connect to TruthLens backend to retry analysis.');
    }
  };

  const handleDeleteAnalysis = async (id: string) => {
    const res = await fetch(`/api/analyses/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      setAnalyses((prev) => prev.filter((item) => item.id !== id));
      if (selectedReport?.id === id) {
        setSelectedReport(null);
        setActiveTab('analyses');
      }
    }
  };

  const handleRunSample = async (sampleType: 'image' | 'document') => {
    setToastError(null);
    setRunningSample(true);
    try {
      const res = await fetch('/api/analyses/sample', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sampleType }),
      });
      const rawText = await res.text();
      let data: { analysis?: AnalysisRecord; error?: string } = {};
      try {
        data = JSON.parse(rawText) as { analysis?: AnalysisRecord; error?: string };
      } catch {
        data = {
          error:
            res.status === 404
              ? 'Backend API endpoint /api/analyses/sample returned 404 (not found).'
              : `Unexpected server response (${res.status}).`,
        };
      }
      if (!res.ok || !data.analysis) {
        setToastError(data.error || `Failed to launch sample specimen analysis (${res.status}).`);
        return;
      }
      const created = data.analysis;
      setSelectedReport(null);
      setAnalyses((prev) => [created, ...prev.filter((item) => item.id !== created.id)]);
      setActiveAnalysisId(created.id);
      setActiveTab('analysis-live');
    } catch {
      setToastError('Could not connect to TruthLens backend to run sample specimen.');
    } finally {
      setRunningSample(false);
    }
  };

  const handleSaveAnalysisToDataset = async (analysis: AnalysisRecord) => {
    const visibleWm = analysis.watermarks.find(
      (w) => w.detected && (w.type === 'visible_text' || w.type === 'visible_logo'),
    );
    await fetch('/api/datasets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sample_id: `LIVE-${analysis.id}`,
        file_name: analysis.fileName,
        media_type: analysis.mediaType,
        ground_truth_label: 'UNKNOWN',
        generation_platform: visibleWm?.possiblePlatform || 'Unknown',
        visible_watermark: Boolean(visibleWm),
        watermark_text: visibleWm?.recognizedTextOrLogo || '',
        invisible_watermark_status: 'not_verified',
        c2pa_status: analysis.metadata?.c2paStatus || 'absent',
        mime_type: analysis.mimeType,
        file_size_bytes: analysis.fileSizeBytes,
        width: analysis.metadata?.width ?? null,
        height: analysis.metadata?.height ?? null,
        duration_seconds: analysis.metadata?.durationSeconds ?? null,
        frame_rate: analysis.metadata?.frameRate ?? null,
        codec: analysis.metadata?.videoCodec || analysis.metadata?.codec || '',
        encoder: analysis.metadata?.encoder || '',
        exif_software: analysis.metadata?.software || '',
        camera_make: analysis.metadata?.cameraMake || '',
        camera_model: analysis.metadata?.cameraModel || '',
        metadata_present: Boolean(analysis.metadata?.metadataPresent),
        dataset_source: 'Live TruthLens Upload',
        license: 'User-submitted specimen',
        consent_status: 'Pending explicit curation review',
        split: 'live_upload',
        file_hash: analysis.fileHash,
        linked_analysis_id: analysis.id,
        predicted_score: analysis.scoring?.aiLikelihoodScore ?? null,
        predicted_classification: analysis.scoring?.classification ?? '',
        recording_condition:
          analysis.mediaType === 'video'
            ? analysis.videoTelemetry?.cameraCharacteristicsDetected?.length
              ? 'Smartphone / Camera Human Video'
              : analysis.videoTelemetry?.socialMediaReencodeLikely
                ? 'Social Media Re-Encoded Video'
                : ''
            : '',
        notes: `Logged from report ${analysis.id} (Experimental score: ${analysis.scoring?.aiLikelihoodScore ?? 'N/A'}/100 — ${analysis.scoring?.classification ?? 'Pending'}).`,
      }),
    });
  };

  const breadcrumbMap: Record<WorkspaceTab, string> = {
    overview: 'Overview',
    upload: 'New analysis',
    analyses: 'My analyses',
    history: 'Detection history',
    reports: 'Reports',
    datasets: 'Datasets',
    settings: 'Settings',
    'analysis-live': `Analysis pipeline · ${activeAnalysisId ?? ''}`,
    'report-detail': `Forensic report · ${selectedReport?.id ?? ''}`,
  };

  return (
    <div className="relative min-h-screen">
      {/* Continuous White & Pale-Blue Gradient Across Every Page and Section */}
      <GlobalAmbientCanvas />

      {/* Desktop-Wide Smooth Optical Magnifying Glass */}
      <GlobalMagnifier />

      {!inWorkspace ? (
        <LandingPage onEnterWorkspace={handleEnterWorkspace} />
      ) : (
        <WorkspaceShell
          activeTab={activeTab}
          breadcrumb={breadcrumbMap[activeTab]}
          onNavigate={(tab) => {
            setToastError(null);
            setActiveTab(tab);
          }}
          onReturnHome={() => {
            setInWorkspace(false);
            window.scrollTo({ top: 0, behavior: 'auto' });
          }}
        >
          <motion.div
            key={`${activeTab}-${activeAnalysisId ?? ''}-${selectedReport?.id ?? ''}`}
            initial={prefersReducedMotion ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: MOTION_DURATION.fast + 0.12, ease: MOTION_EASE.apple }}
          >
      {toastError && (
        <div
          role="alert"
          className="mb-5 bg-[#FEF2F2] border border-[#FECACA] rounded-xl px-4 py-3 text-xs text-[#991B1B]"
        >
          {toastError}
        </div>
      )}

      {activeTab === 'overview' && (
        <DashboardView
          analyses={analyses}
          loading={loadingAnalyses}
          onStartUpload={() => setActiveTab('upload')}
          onOpenAnalysis={handleOpenAnalysis}
          onRunSample={(type) => void handleRunSample(type)}
          runningSample={runningSample}
        />
      )}

      {activeTab === 'upload' && (
        <UploadWorkspace
          maxUploadSizeMb={settings.maxUploadSizeMb}
          onAnalysesStarted={handleAnalysesStarted}
          onRunSample={(type) => void handleRunSample(type)}
          runningSample={runningSample}
        />
      )}

      {activeTab === 'analyses' && (
        <HistoryView
          mode="analyses"
          analyses={analyses}
          loading={loadingAnalyses}
          onOpenAnalysis={handleOpenAnalysis}
          onDeleteAnalysis={handleDeleteAnalysis}
          onStartUpload={() => setActiveTab('upload')}
        />
      )}

      {activeTab === 'history' && (
        <HistoryView
          mode="history"
          analyses={analyses}
          loading={loadingAnalyses}
          onOpenAnalysis={handleOpenAnalysis}
          onDeleteAnalysis={handleDeleteAnalysis}
          onStartUpload={() => setActiveTab('upload')}
        />
      )}

      {activeTab === 'reports' && (
        <HistoryView
          mode="reports"
          analyses={analyses}
          loading={loadingAnalyses}
          onOpenAnalysis={handleOpenAnalysis}
          onDeleteAnalysis={handleDeleteAnalysis}
          onStartUpload={() => setActiveTab('upload')}
        />
      )}

      {activeTab === 'datasets' && <DatasetManagerView />}

      {activeTab === 'settings' && (
        <SettingsView onSettingsChanged={(next) => setSettings(next)} />
      )}

      {activeTab === 'analysis-live' && activeAnalysisId && (
        <AnalysisWorkspace
          analysisId={activeAnalysisId}
          initialRecord={analyses.find((a) => a.id === activeAnalysisId) ?? null}
          onAnalysisUpdated={handleAnalysisUpdated}
          onViewReport={(rec) => {
            setSelectedReport(rec);
            setActiveTab('report-detail');
          }}
          onRetryAnalysis={handleRetryAnalysis}
          onNewUpload={() => {
            setToastError(null);
            setSelectedReport(null);
            setActiveAnalysisId(null);
            setActiveTab('upload');
          }}
        />
      )}

      {activeTab === 'report-detail' && selectedReport && (
        <ForensicReportView
          analysis={selectedReport}
          onBack={() => setActiveTab('reports')}
          onNewUpload={() => {
            setToastError(null);
            setSelectedReport(null);
            setActiveAnalysisId(null);
            setActiveTab('upload');
          }}
          onSaveToDataset={handleSaveAnalysisToDataset}
          onRetryAnalysis={handleRetryAnalysis}
        />
      )}
          </motion.div>
        </WorkspaceShell>
      )}
    </div>
  );
}
