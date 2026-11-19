import { Type, ThinkingLevel } from '@google/genai';
import type {
  AnalysisRecord,
  DetectorResult,
  ExtractedMetadata,
  ForensicChecklistItem,
  ForensicKeyTakeaway,
  GeminiForensicSummary,
  MediaType,
  ScoringBreakdown,
  WatermarkFinding,
} from '../../src/types/forensics.ts';
import { runStructuredGeminiAnalysisWithMeta } from '../geminiClient.ts';

interface GeminiNarrativeOutput {
  verdictHeadline: string;
  executiveSummary: string;
  aiExplanation: string;
  evidenceCrossCheck: string;
  keyTakeaways: ForensicKeyTakeaway[];
  suspiciousIndicators: string[];
  technicalObservations: string[];
  recommendedNextSteps: string[];
  verificationChecklist: ForensicChecklistItem[];
  confidenceLimitations: string[];
}

const REPORT_NARRATIVE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    verdictHeadline: { type: Type.STRING },
    executiveSummary: { type: Type.STRING },
    aiExplanation: { type: Type.STRING },
    evidenceCrossCheck: { type: Type.STRING },
    keyTakeaways: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          detail: { type: Type.STRING },
          polarity: {
            type: Type.STRING,
            enum: ['ai_indicator', 'natural_capture', 'neutral', 'caution'],
          },
        },
        required: ['title', 'detail', 'polarity'],
      },
    },
    suspiciousIndicators: { type: Type.ARRAY, items: { type: Type.STRING } },
    technicalObservations: { type: Type.ARRAY, items: { type: Type.STRING } },
    recommendedNextSteps: { type: Type.ARRAY, items: { type: Type.STRING } },
    verificationChecklist: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          action: { type: Type.STRING },
          priority: { type: Type.STRING, enum: ['High', 'Medium', 'Low'] },
          rationale: { type: Type.STRING },
        },
        required: ['action', 'priority', 'rationale'],
      },
    },
    confidenceLimitations: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: [
    'verdictHeadline',
    'executiveSummary',
    'aiExplanation',
    'evidenceCrossCheck',
    'keyTakeaways',
    'suspiciousIndicators',
    'technicalObservations',
    'recommendedNextSteps',
    'verificationChecklist',
    'confidenceLimitations',
  ],
};

function buildDeterministicSummary(options: {
  mediaType: MediaType;
  detectors: DetectorResult[];
  observedEvidence: string[];
  scoring: ScoringBreakdown;
  geminiStatus?: AnalysisRecord['geminiStatus'];
  geminiFailureDetail?: string | null;
  reason: string;
}): GeminiForensicSummary {
  const { mediaType, detectors, observedEvidence, scoring, geminiStatus, geminiFailureDetail, reason } = options;
  const failedDetectors = detectors.filter((d) => d.status === 'failed');
  const partiallyCompletedDetectors = detectors.filter((d) => d.status === 'partially_completed');
  const unavailableDetectors = detectors.filter((d) => d.status === 'unavailable');

  const isPartial = failedDetectors.length > 0 || geminiStatus === 'failed' || geminiStatus === 'partially_completed';

  const suspiciousIndicators =
    scoring.evidenceSupportingAi.length > 0
      ? scoring.evidenceSupportingAi
      : detectors
          .filter((d) => d.ran && d.rawSignalScore !== null && d.rawSignalScore >= 60)
          .map((d) => `${d.methodName} (${d.rawSignalScore}/100): ${d.resultSummary}`);

  const verdictHeadline = isPartial
    ? `Partial ${mediaType} assessment (${scoring.classification}) — ${scoring.methodsPerformedCount} local detector(s) completed`
    : scoring.classification === 'Likely human-created'
      ? `Consistent with natural ${mediaType} capture (${scoring.aiLikelihoodScore}/100 Experimental)`
      : scoring.classification === 'Likely AI-generated'
        ? `Multiple synthetic-generation indicators detected (${scoring.aiLikelihoodScore}/100 Experimental)`
        : `${scoring.classification} — ${scoring.evidenceStrength.toLowerCase()} technical evidence (${scoring.aiLikelihoodScore}/100 Experimental)`;

  const executiveSummary = isPartial
    ? `Partial forensic report compiled for this ${mediaType} specimen: ${scoring.methodsPerformedCount} local/independent detector(s) completed while ${failedDetectors.length} Gemini-backed detector(s) failed due to temporary API unavailability (${unavailableDetectors.length} additional method(s) unavailable in runtime). Based exclusively on completed checks, the classification is ${scoring.classification} (${scoring.aiLikelihoodScore}/100 Experimental, ${scoring.overallReliability} reliability).`
    : `Forensic analysis completed ${scoring.methodsPerformedCount} detector(s) with an experimental AI-likelihood estimate of ${scoring.aiLikelihoodScore}/100 (${scoring.classification}, ${scoring.overallReliability} overall reliability, ${scoring.completenessPercent}% completeness). Observed ${scoring.evidenceSupportingAi.length} AI-supporting indicator(s), ${scoring.evidenceSupportingNaturalCapture.length} natural-capture cue(s), and ${scoring.neutralObservations.length} neutral observation(s).`;

  const aiExplanation = isPartial
    ? `Gemini multimodal reasoning did not complete (${geminiFailureDetail || reason}). All failed detectors were strictly excluded from evidence aggregation so upstream service errors never bias the result toward AI generation. ${
        partiallyCompletedDetectors.length > 0
          ? `${partiallyCompletedDetectors.length} hybrid detector(s) preserved their deterministic local measurements.`
          : 'All completed deterministic local measurements and extracted artifacts are preserved below.'
      }`
    : `Narrative synthesis fell back to deterministic summary because upstream AI reasoning returned an error (${reason}). All local forensic metrics, evidence polarity buckets, and scoring breakdowns remain intact below.`;

  const evidenceCrossCheck =
    scoring.conflictingFindings.length > 0
      ? `Cross-detector review flagged ${scoring.conflictingFindings.length} divergence(s) between completed methods. ${scoring.disagreementReasons[0] ?? 'Inspect individual detector scores alongside original capture provenance.'}`
      : `Completed detectors (${scoring.methodsPerformedCount}) showed no direct contradiction: ${scoring.evidenceSupportingAi.length} AI-supporting signal(s) versus ${scoring.evidenceSupportingNaturalCapture.length} natural-capture signal(s) and ${scoring.neutralObservations.length} neutral observation(s).`;

  const keyTakeaways: ForensicKeyTakeaway[] = [
    {
      title: 'Experimental Composite Estimate',
      detail: `${scoring.aiLikelihoodScore}/100 (${scoring.classification}) with ${scoring.evidenceStrength} evidence strength across ${scoring.methodsPerformedCount} completed check(s).`,
      polarity:
        scoring.classification === 'Likely AI-generated'
          ? 'ai_indicator'
          : scoring.classification === 'Likely human-created'
            ? 'natural_capture'
            : 'caution',
    },
    ...(scoring.evidenceSupportingAi.length > 0
      ? [
          {
            title: 'AI-Supporting Signals Flagged',
            detail: scoring.evidenceSupportingAi[0],
            polarity: 'ai_indicator' as const,
          },
        ]
      : []),
    ...(scoring.evidenceSupportingNaturalCapture.length > 0
      ? [
          {
            title: 'Natural-Capture Characteristics',
            detail: scoring.evidenceSupportingNaturalCapture[0],
            polarity: 'natural_capture' as const,
          },
        ]
      : []),
    {
      title: 'Pipeline Coverage & Provenance',
      detail: `${scoring.completenessPercent}% pipeline completeness; ${unavailableDetectors.length} specialized method(s) disclosed as unavailable.`,
      polarity: 'neutral',
    },
  ];

  const technicalObservations = [
    ...scoring.scoreExplanation,
    ...(scoring.disagreementReasons.length > 0 ? scoring.disagreementReasons : []),
    ...(failedDetectors.length > 0
      ? [
          `Failed (recoverable) detectors excluded from scoring: ${failedDetectors
            .map((d) => d.methodName)
            .join(', ')}.`,
        ]
      : []),
    ...(unavailableDetectors.length > 0
      ? [
          `Unavailable detectors not installed in this runtime: ${unavailableDetectors
            .map((d) => d.methodName)
            .join(', ')}.`,
        ]
      : []),
  ];

  const recommendedNextSteps = [
    ...(isPartial
      ? [
          'Use "Retry Gemini Analysis" or "Enhance Report with AI" once upstream Gemini demand subsides — extracted artifacts are cached on disk and will be reused.',
        ]
      : []),
    ...(scoring.conflictingFindings.length > 0
      ? [
          'Inspect the conflicting detector findings manually and request the original, un-reencoded camera file to resolve ambiguity between compression/processing and synthetic artifacts.',
        ]
      : []),
    'Verify original source provenance, capture device chain-of-custody, and unedited raw files where available.',
    'Review the completed deterministic telemetry (container metadata, C2PA markers, frame/pixel/acoustic signals) independently alongside human inspection.',
  ];

  const verificationChecklist: ForensicChecklistItem[] = [
    {
      action: isPartial
        ? 'Re-run AI multimodal synthesis when upstream service is available'
        : 'Request original camera or unedited export file',
      priority: 'High',
      rationale: isPartial
        ? 'Completing failed multimodal checks improves overall evidence coverage without losing cached local telemetry.'
        : 'Comparing original uncompressed files eliminates ambiguity caused by platform re-encoding or metadata stripping.',
    },
    {
      action: 'Cross-check source chain of custody and timestamps',
      priority: 'Medium',
      rationale: 'Technical detectors estimate probability and should be corroborated with independent provenance checks.',
    },
    {
      action: 'Inspect raw detector rows and media-specific telemetry below',
      priority: 'Low',
      rationale: 'Direct inspection of individual signal residuals and limitations prevents over-reliance on any single score.',
    },
  ];

  const confidenceLimitations = [
    'A detection score is an experimental estimate, not definitive proof of AI generation or human authorship.',
    'Absence of AI watermarks or C2PA provenance metadata is neutral and does not prove authenticity or AI generation.',
    ...(isPartial
      ? [
          `Gemini multimodal analysis status: ${geminiStatus ?? 'failed'} (${geminiFailureDetail || reason}). Conclusions rely exclusively on the ${scoring.methodsPerformedCount} detector(s) that genuinely executed.`,
          'Upstream API failures are never interpreted as evidence of AI generation.',
        ]
      : [
          'AI narrative synthesis was unavailable during this run; conclusions rely solely on completed detectors.',
        ]),
  ];

  return {
    verdictHeadline,
    executiveSummary,
    observedEvidence,
    aiExplanation,
    evidenceCrossCheck,
    keyTakeaways,
    suspiciousIndicators:
      suspiciousIndicators.length > 0
        ? suspiciousIndicators
        : [
            isPartial
              ? 'No elevated AI-generation indicators were flagged by the completed deterministic detectors (multimodal visual/watermark checks did not complete).'
              : 'No high-scoring synthetic indicators were flagged by completed detectors.',
          ],
    evidenceSupportingAi: scoring.evidenceSupportingAi,
    evidenceSupportingNaturalCapture: scoring.evidenceSupportingNaturalCapture,
    neutralObservations: scoring.neutralObservations,
    disagreementReasons: scoring.disagreementReasons,
    technicalObservations,
    recommendedNextSteps,
    verificationChecklist,
    confidenceLimitations,
    modelUsed: 'Deterministic partial-report engine (Gemini unavailable)',
    generatedAt: new Date().toISOString(),
  };
}

export async function generateForensicReportNarrative(options: {
  mediaType: MediaType;
  metadata: ExtractedMetadata;
  detectors: DetectorResult[];
  watermarks: WatermarkFinding[];
  scoring: ScoringBreakdown;
  samplingStrategy?: string;
  geminiStatus?: AnalysisRecord['geminiStatus'];
  geminiFailureDetail?: string | null;
  skipGeminiNarrative?: boolean;
  userContext?: AnalysisRecord['userContext'];
  originalSnapshot?: AnalysisRecord['originalSnapshot'];
  audioProfile?: AnalysisRecord['audioProfile'];
  videoTelemetry?: AnalysisRecord['videoTelemetry'];
  imageVisualMetrics?: AnalysisRecord['imageVisualMetrics'];
}): Promise<GeminiForensicSummary> {
  const {
    mediaType,
    metadata,
    detectors,
    watermarks,
    scoring,
    samplingStrategy,
    geminiStatus,
    geminiFailureDetail,
    skipGeminiNarrative,
    userContext,
    originalSnapshot,
    audioProfile,
    videoTelemetry,
    imageVisualMetrics,
  } = options;

  // Deterministic observed evidence list assembled strictly from real detector outputs (never generated by LLM)
  const observedEvidence: string[] = [];
  for (const d of detectors) {
    if (
      (d.status === 'completed' ||
        d.status === 'partially_completed' ||
        d.status === 'partially_implemented') &&
      d.ran
    ) {
      observedEvidence.push(`[${d.methodName}] ${d.resultSummary}`);
    }
  }
  const visibleWatermarks = watermarks.filter((w) => w.detected && w.type !== 'invisible_watermark');
  for (const wm of visibleWatermarks) {
    observedEvidence.push(
      `[Watermark] ${wm.recognizedTextOrLogo} at ${wm.positionInFrame ?? 'unknown position'}${wm.timestamp ? ` (${wm.timestamp})` : ''} — confidence: ${wm.recognitionConfidence}.`,
    );
  }

  if (skipGeminiNarrative) {
    return buildDeterministicSummary({
      mediaType,
      detectors,
      observedEvidence,
      scoring,
      geminiStatus,
      geminiFailureDetail,
      reason: geminiFailureDetail || 'Gemini multimodal service was unavailable during forensic analysis.',
    });
  }

  const completedSummary = detectors
    .filter(
      (d) =>
        (d.status === 'completed' ||
          d.status === 'partially_completed' ||
          d.status === 'partially_implemented') &&
        d.ran,
    )
    .map(
      (d) =>
        `- ${d.methodName} [${d.status}, polarity=${d.signalPolarity ?? 'auto'}] (score: ${d.rawSignalScore ?? 'informational'}, reliability: ${d.reliability}): ${d.resultSummary} | Evidence: ${d.evidence.slice(0, 3).join(' ; ')}`,
    )
    .join('\n');

  const failedSummary = detectors
    .filter((d) => d.status === 'failed')
    .map((d) => `- ${d.methodName}: ${d.resultSummary}`)
    .join('\n');

  const unavailableSummary = detectors
    .filter((d) => d.status === 'unavailable')
    .map((d) => `- ${d.methodName}: ${d.resultSummary}`)
    .join('\n');

  const mediaTelemetryLines: string[] = [];
  if (audioProfile) {
    mediaTelemetryLines.push(
      `Audio Telemetry: centroid=${audioProfile.spectralCentroidHz ?? 'N/A'}Hz, silenceRatio=${(audioProfile.silenceRatio * 100).toFixed(1)}%, dynamicRange=${audioProfile.dynamicRangeDb}dB, noiseFloor=${audioProfile.noiseFloorDb ?? 'N/A'}dB, alignedSyntheticIndicators=${audioProfile.syntheticIndicatorCount ?? 0}.`,
    );
    if (audioProfile.detectedIndicators?.length) {
      mediaTelemetryLines.push(`Audio Detected Evidence: ${audioProfile.detectedIndicators.join(' ; ')}`);
    }
    if (audioProfile.uncertainSignals?.length) {
      mediaTelemetryLines.push(`Audio Uncertain Signals: ${audioProfile.uncertainSignals.join(' ; ')}`);
    }
  }
  if (videoTelemetry) {
    mediaTelemetryLines.push(
      `Video Telemetry: ${videoTelemetry.extractedFramesCount} extracted frames, meanHistSim=${videoTelemetry.meanHistogramSimilarity ?? 'N/A'}, socialReencodeLikely=${Boolean(videoTelemetry.socialMediaReencodeLikely)}.`,
    );
  }
  if (imageVisualMetrics) {
    mediaTelemetryLines.push(
      `Image Telemetry: aspect=${imageVisualMetrics.aspectRatio}, laplacianVar=${imageVisualMetrics.laplacianVariance}, elaMean=${imageVisualMetrics.elaMeanDiff}, quadrantSpread=${(imageVisualMetrics.quadrantNoiseSpread * 100).toFixed(1)}%.`,
    );
  }

  const userContextBlock = userContext
    ? [
        '',
        '=== USER-PROVIDED CONTEXT (UNVERIFIED — NEVER TREAT AS INDEPENDENTLY VERIFIED EVIDENCE) ===',
        ...userContext.answers
          .filter((a) => a.answer.trim().length > 0)
          .map((a) => `- Q: ${a.question}\n  User Answer (unverified): ${a.answer}`),
        userContext.userStatement.trim()
          ? `- User Statement (unverified): ${userContext.userStatement.trim()}`
          : '',
        originalSnapshot
          ? `Original Automated Analysis Before Follow-Up: ${originalSnapshot.aiLikelihoodScore}/100 (${originalSnapshot.classification}, ${originalSnapshot.evidenceStrength} evidence strength, ${originalSnapshot.methodsPerformedCount} methods completed, ${originalSnapshot.methodsFailedCount} failed).`
          : '',
        'CRITICAL REPORTING RULE: Acknowledge the user-provided context clearly as UNVERIFIED USER CONTEXT separate from objectively detected findings. Explain whether user context offers a plausible contextual explanation for missing metadata or conflicting signals, while explicitly affirming that user opinions do NOT override objective detector evidence.',
      ]
        .filter(Boolean)
        .join('\n')
    : '';

  const prompt = [
    'Synthesize an executive-grade, balanced, deeply informative TruthLens forensic report based EXCLUSIVELY on the observed detector results and telemetry below.',
    'DO NOT invent any new watermarks, EXIF tags, timestamps, C2PA credentials, or scores.',
    'Never claim 100% proof or definitive authorship. Never treat a failed API detector, missing metadata, or absent watermarks as proof of AI generation or authenticity.',
    'Clearly acknowledge natural-capture observations when present, and explain WHY individual detectors agreed or disagreed.',
    '',
    `File: ${metadata.fileName} (${mediaType}, ${metadata.detectedMime}, ${metadata.fileSizeBytes} bytes)`,
    `Overall Experimental AI-Likelihood Score: ${scoring.aiLikelihoodScore}/100`,
    `Classification: ${scoring.classification}`,
    `Evidence Strength: ${scoring.evidenceStrength} | Overall Reliability: ${scoring.overallReliability} | Completeness: ${scoring.completenessPercent}%`,
    `Gemini Multimodal Status: ${geminiStatus ?? 'completed'}`,
    samplingStrategy ? `Video Sampling Strategy: ${samplingStrategy}` : '',
    ...mediaTelemetryLines,
    '',
    `Evidence Supporting AI Generation (${scoring.evidenceSupportingAi.length}):`,
    scoring.evidenceSupportingAi.length ? scoring.evidenceSupportingAi.map((e) => `- ${e}`).join('\n') : '- None observed',
    '',
    `Evidence Supporting Natural Capture (${scoring.evidenceSupportingNaturalCapture.length}):`,
    scoring.evidenceSupportingNaturalCapture.length ? scoring.evidenceSupportingNaturalCapture.map((e) => `- ${e}`).join('\n') : '- None observed',
    '',
    `Neutral Observations (${scoring.neutralObservations.length}):`,
    scoring.neutralObservations.length ? scoring.neutralObservations.slice(0, 6).map((e) => `- ${e}`).join('\n') : '- None',
    '',
    `Conflicting Findings: ${scoring.conflictingFindings.length ? scoring.conflictingFindings.join(' ') : 'None'}`,
    `Disagreement Explanations: ${scoring.disagreementReasons.length ? scoring.disagreementReasons.join(' ') : 'None'}`,
    '',
    'Completed & Partially Completed Detector Outputs:',
    completedSummary || 'None',
    '',
    'Failed Detectors (Recoverable — Excluded from Scoring):',
    failedSummary || 'None',
    '',
    'Unavailable Methods (Not Performed):',
    unavailableSummary || 'None',
    userContextBlock,
    '',
    'Return structured JSON with:',
    '- verdictHeadline: crisp 1-sentence forensic headline (<= 16 words) capturing the core finding without overclaiming.',
    '- executiveSummary: 2-3 clear sentences explaining the classification, balancing AI-supporting vs natural-capture evidence, and (if user context was provided) strictly separating objectively detected findings from unverified user context.',
    '- aiExplanation: concise plain-English explanation of why the scoring engine produced this estimate and what drove the confidence level.',
    '- evidenceCrossCheck: 2-3 sentences comparing deterministic local telemetry (metadata/pixels/frames/acoustics) against multimodal findings and noting agreement, tensions, or missing provenance.',
    '- keyTakeaways: 3 to 4 crisp executive takeaway objects ({ title, detail, polarity }) summarizing the highest-signal findings across detectors.',
    '- suspiciousIndicators: bullet list of concrete AI/manipulation indicators observed (or explicit note that none stood out).',
    '- technicalObservations: concise technical notes grounded strictly in the telemetry above.',
    '- recommendedNextSteps: practical human verification steps.',
    '- verificationChecklist: 3 prioritized actionable verification items ({ action, priority: High|Medium|Low, rationale }) specifically tailored to this file.',
    '- confidenceLimitations: clear limitations of this assessment.',
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const res = await runStructuredGeminiAnalysisWithMeta<GeminiNarrativeOutput>({
      parts: [{ text: prompt }],
      responseSchema: REPORT_NARRATIVE_SCHEMA,
      thinkingLevel: ThinkingLevel.MEDIUM,
      timeoutMs: 32_000,
    });
    const narrative = res.data;

    return {
      verdictHeadline: narrative.verdictHeadline?.trim() || undefined,
      executiveSummary: narrative.executiveSummary,
      observedEvidence,
      aiExplanation: narrative.aiExplanation,
      evidenceCrossCheck: narrative.evidenceCrossCheck?.trim() || undefined,
      keyTakeaways: Array.isArray(narrative.keyTakeaways)
        ? narrative.keyTakeaways.slice(0, 4)
        : undefined,
      suspiciousIndicators: Array.isArray(narrative.suspiciousIndicators)
        ? narrative.suspiciousIndicators
        : [],
      evidenceSupportingAi: scoring.evidenceSupportingAi,
      evidenceSupportingNaturalCapture: scoring.evidenceSupportingNaturalCapture,
      neutralObservations: scoring.neutralObservations,
      disagreementReasons: scoring.disagreementReasons,
      technicalObservations: Array.isArray(narrative.technicalObservations)
        ? narrative.technicalObservations
        : [],
      recommendedNextSteps: Array.isArray(narrative.recommendedNextSteps)
        ? narrative.recommendedNextSteps
        : [],
      verificationChecklist: Array.isArray(narrative.verificationChecklist)
        ? narrative.verificationChecklist.slice(0, 4)
        : undefined,
      confidenceLimitations: [
        'A detection score is an experimental estimate, not definitive proof of AI generation or human authorship.',
        'Absence of AI watermarks or C2PA metadata is neutral context and never establishes definitive authenticity.',
        ...(Array.isArray(narrative.confidenceLimitations) ? narrative.confidenceLimitations : []),
      ],
      modelUsed: res.modelUsed,
      generatedAt: new Date().toISOString(),
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'Upstream narrative model unavailable';
    return buildDeterministicSummary({
      mediaType,
      detectors,
      observedEvidence,
      scoring,
      geminiStatus,
      geminiFailureDetail,
      reason,
    });
  }
}
