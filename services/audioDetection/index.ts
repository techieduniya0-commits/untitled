import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import { promisify } from 'node:util';
import { Type, ThinkingLevel } from '@google/genai';
import type {
  AudioProfile,
  AudioSegmentFinding,
  DetectorResult,
  ExtractedMetadata,
  WatermarkFinding,
} from '../../src/types/forensics.ts';
import {
  GEMINI_FORENSIC_MODEL,
  type GeminiRetryEvent,
  runStructuredGeminiAnalysisWithMeta,
} from '../geminiClient.ts';
import type { ProvenanceInspectionOutput } from '../provenanceVerification/index.ts';

const execFileAsync = promisify(execFile);

interface GeminiAudioForensicsResponse {
  speechDetected: boolean;
  aiSpeechScore: number | null;
  aiSpeechSummary: string;
  aiSpeechEvidence: string[];
  prosodyScore: number | null;
  prosodySummary: string;
  prosodyEvidence: string[];
  artifactScore: number;
  artifactSummary: string;
  artifactEvidence: string[];
  voiceConsistencyScore: number | null;
  voiceConsistencySummary: string;
  voiceConsistencyEvidence: string[];
  notableTimestampObservations: Array<{
    timestampLabel: string;
    observation: string;
  }>;
}

const AUDIO_FORENSICS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    speechDetected: { type: Type.BOOLEAN },
    aiSpeechScore: { type: Type.INTEGER, nullable: true },
    aiSpeechSummary: { type: Type.STRING },
    aiSpeechEvidence: { type: Type.ARRAY, items: { type: Type.STRING } },
    prosodyScore: { type: Type.INTEGER, nullable: true },
    prosodySummary: { type: Type.STRING },
    prosodyEvidence: { type: Type.ARRAY, items: { type: Type.STRING } },
    artifactScore: { type: Type.INTEGER },
    artifactSummary: { type: Type.STRING },
    artifactEvidence: { type: Type.ARRAY, items: { type: Type.STRING } },
    voiceConsistencyScore: { type: Type.INTEGER, nullable: true },
    voiceConsistencySummary: { type: Type.STRING },
    voiceConsistencyEvidence: { type: Type.ARRAY, items: { type: Type.STRING } },
    notableTimestampObservations: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          timestampLabel: { type: Type.STRING },
          observation: { type: Type.STRING },
        },
        required: ['timestampLabel', 'observation'],
      },
    },
  },
  required: [
    'speechDetected',
    'aiSpeechSummary',
    'aiSpeechEvidence',
    'prosodySummary',
    'prosodyEvidence',
    'artifactScore',
    'artifactSummary',
    'artifactEvidence',
    'voiceConsistencySummary',
    'voiceConsistencyEvidence',
    'notableTimestampObservations',
  ],
};

function formatAudioTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
}

async function computeAcousticProfile(filePath: string): Promise<AudioProfile> {
  const sampleRate = 16000;
  // Decode up to first 90 seconds into raw 16kHz mono signed 16-bit PCM for real acoustic signal analysis
  const { stdout } = await execFileAsync(
    'ffmpeg',
    [
      '-i',
      filePath,
      '-t',
      '90',
      '-ac',
      '1',
      '-ar',
      String(sampleRate),
      '-f',
      's16le',
      '-v',
      'error',
      'pipe:1',
    ],
    { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024, timeout: 25_000 },
  );

  const sampleCount = Math.floor(stdout.length / 2);
  if (sampleCount < 256) {
    return {
      waveformPeaks: [0.1, 0.2, 0.15, 0.1],
      spectralCentroidHz: null,
      highFreqEnergyRatio: null,
      silenceRatio: 1,
      dynamicRangeDb: 0,
      clippingRate: 0,
      segments: [],
    };
  }

  const samples = new Float32Array(sampleCount);
  let silentCount = 0;
  let clippedCount = 0;

  for (let i = 0; i < sampleCount; i++) {
    const val = stdout.readInt16LE(i * 2) / 32768;
    samples[i] = val;
    const abs = Math.abs(val);
    if (abs < 0.008) silentCount++;
    if (abs >= 0.992) clippedCount++;
  }

  // Build 64-bin waveform peaks for visualization
  const numBins = 64;
  const binSize = Math.max(1, Math.floor(sampleCount / numBins));
  const waveformPeaks: number[] = [];
  for (let b = 0; b < numBins; b++) {
    let peak = 0;
    const start = b * binSize;
    const end = Math.min(sampleCount, start + binSize);
    for (let i = start; i < end; i++) {
      const a = Math.abs(samples[i]);
      if (a > peak) peak = a;
    }
    waveformPeaks.push(Number(peak.toFixed(3)));
  }

  // Segment-level RMS (dB) and Zero-Crossing Rate (ZCR) across 6–10 time windows
  const totalSec = sampleCount / sampleRate;
  const numSegs = Math.min(8, Math.max(3, Math.ceil(totalSec / 3)));
  const segLen = Math.floor(sampleCount / numSegs);
  const rmsValues: number[] = [];
  const segments: AudioSegmentFinding[] = [];

  for (let s = 0; s < numSegs; s++) {
    const startIdx = s * segLen;
    const endIdx = s === numSegs - 1 ? sampleCount : (s + 1) * segLen;
    let sqSum = 0;
    let zcr = 0;
    for (let i = startIdx; i < endIdx; i++) {
      sqSum += samples[i] * samples[i];
      if (i > startIdx && ((samples[i] >= 0 && samples[i - 1] < 0) || (samples[i] < 0 && samples[i - 1] >= 0))) {
        zcr++;
      }
    }
    const count = Math.max(1, endIdx - startIdx);
    const rms = Math.sqrt(sqSum / count);
    const rmsDb = Number((20 * Math.log10(Math.max(rms, 1e-6))).toFixed(1));
    const zcrRate = Number((zcr / count).toFixed(4));
    rmsValues.push(rmsDb);

    const startSec = Number((startIdx / sampleRate).toFixed(1));
    const endSec = Number((endIdx / sampleRate).toFixed(1));
    let observation = 'Nominal acoustic energy and zero-crossing profile.';
    let flagged = false;
    if (rmsDb < -48) {
      observation = 'Near-digital-zero silence floor (minimal ambient room tone).';
      flagged = true;
    } else if (zcrRate > 0.28) {
      observation = 'Elevated high-frequency zero-crossing density (sibilance, metallic vocoder hiss, or noise).';
      flagged = true;
    }

    segments.push({
      startSec,
      endSec,
      timestampLabel: `${formatAudioTime(startSec)} – ${formatAudioTime(endSec)}`,
      rmsDb,
      zeroCrossingRate: zcrRate,
      observation,
      flagged,
    });
  }

  // Coarse spectral centroid & high-frequency energy ratio via 256-point DFT on active mid-clip frame
  const fftN = 256;
  const midStart = Math.max(0, Math.floor(sampleCount / 2) - fftN / 2);
  let weightedFreqSum = 0;
  let magSum = 0;
  let highFreqMag = 0;

  for (let k = 1; k < fftN / 2; k++) {
    let re = 0;
    let im = 0;
    for (let n = 0; n < fftN; n++) {
      const sample = samples[midStart + n] ?? 0;
      const win = 0.54 - 0.46 * Math.cos((2 * Math.PI * n) / (fftN - 1));
      const angle = (2 * Math.PI * k * n) / fftN;
      re += sample * win * Math.cos(angle);
      im -= sample * win * Math.sin(angle);
    }
    const mag = Math.sqrt(re * re + im * im);
    const freqHz = (k * sampleRate) / fftN;
    weightedFreqSum += freqHz * mag;
    magSum += mag;
    if (freqHz >= 4000) highFreqMag += mag;
  }

  const spectralCentroidHz = magSum > 0 ? Math.round(weightedFreqSum / magSum) : null;
  const highFreqEnergyRatio = magSum > 0 ? Number((highFreqMag / magSum).toFixed(3)) : null;

  const activeRms = rmsValues.filter((v) => v > -60);
  const dynamicRangeDb =
    activeRms.length >= 2
      ? Number((Math.max(...activeRms) - Math.min(...activeRms)).toFixed(1))
      : 0;

  return {
    waveformPeaks,
    spectralCentroidHz,
    highFreqEnergyRatio,
    silenceRatio: Number((silentCount / sampleCount).toFixed(3)),
    dynamicRangeDb,
    clippingRate: Number((clippedCount / sampleCount).toFixed(4)),
    segments,
  };
}

export interface AudioPipelineOutput {
  detectors: DetectorResult[];
  watermarks: WatermarkFinding[];
  audioProfile: AudioProfile;
  geminiStatus: 'completed' | 'failed';
  geminiModelUsed: string | null;
  geminiFailureDetail: string | null;
}

export async function runAudioDetectionPipeline(options: {
  filePath: string;
  metadata: ExtractedMetadata;
  provenance: ProvenanceInspectionOutput;
  onStageProgress?: (
    stageId: 'forensic_analysis' | 'ai_assessment',
    detail: string,
    statusOverride?: 'running' | 'retrying',
  ) => void;
}): Promise<AudioPipelineOutput> {
  const { filePath, metadata, provenance, onStageProgress } = options;

  onStageProgress?.('forensic_analysis', 'Decoding PCM waveform and computing spectral centroid, silence ratio, and dynamic range.');
  const audioProfile = await computeAcousticProfile(filePath);

  onStageProgress?.('ai_assessment', 'Sending audio recording for Gemini multimodal speech artifact, prosody, and voice-consistency analysis.');

  // Prepare audio payload for Gemini (cap at ~12MB inline or transcode snippet to MP3 if oversized)
  let audioBytes = await fs.readFile(filePath);
  let audioMime = metadata.detectedMime;
  if (audioMime === 'audio/x-wav' || audioMime === 'audio/vnd.wave') audioMime = 'audio/wav';
  if (audioMime === 'audio/x-m4a' || audioMime === 'audio/m4a') audioMime = 'audio/mp4';

  if (audioBytes.length > 12 * 1024 * 1024) {
    const { stdout } = await execFileAsync(
      'ffmpeg',
      ['-i', filePath, '-t', '60', '-ac', '1', '-ar', '22050', '-b:a', '96k', '-f', 'mp3', '-v', 'error', 'pipe:1'],
      { encoding: 'buffer', maxBuffer: 12 * 1024 * 1024, timeout: 25_000 },
    );
    audioBytes = stdout;
    audioMime = 'audio/mpeg';
  }

  let aiAudio: GeminiAudioForensicsResponse | null = null;
  let aiModelUsed: string | null = null;
  let aiAudioError: string | null = null;

  try {
    const res = await runStructuredGeminiAnalysisWithMeta<GeminiAudioForensicsResponse>({
      parts: [
        {
          inlineData: {
            mimeType: audioMime,
            data: audioBytes.toString('base64'),
          },
        },
        {
          text: [
            'Analyse this audio recording for indicators of AI-generated speech (TTS), synthetic voice artifacts, or unnatural acoustic splicing.',
            'Measured deterministic acoustic telemetry:',
            `- Format: ${metadata.audioFormat ?? 'Unknown'}, Codec: ${metadata.codec ?? 'Unknown'}, Duration: ${metadata.durationSeconds ?? 'Unknown'}s, Sample Rate: ${metadata.sampleRate ?? 'Unknown'} Hz, Channels: ${metadata.audioChannels ?? 'Unknown'}`,
            `- Spectral Centroid Estimate: ${audioProfile.spectralCentroidHz ?? 'N/A'} Hz | High-Freq (>=4kHz) Energy Ratio: ${audioProfile.highFreqEnergyRatio ?? 'N/A'}`,
            `- Silence Ratio: ${(audioProfile.silenceRatio * 100).toFixed(1)}% | Dynamic Range: ${audioProfile.dynamicRangeDb} dB | Clipping Rate: ${(audioProfile.clippingRate * 100).toFixed(2)}%`,
            'Assess carefully: breathing naturalness, micro-pauses, pitch/prosody cadence, vocoder metallic phasing, room-tone continuity, and voice timbre stability.',
            'If no human speech is present (e.g. instrumental music or ambient noise), set speechDetected=false and leave speech-only scores null.',
            'Keep scores conservative (0-100; 40-60 = inconclusive) and never claim 100% certainty.',
          ].join('\n'),
        },
      ],
      responseSchema: AUDIO_FORENSICS_SCHEMA,
      thinkingLevel: ThinkingLevel.LOW,
      timeoutMs: 30_000,
      onRetry: (evt: GeminiRetryEvent) => {
        onStageProgress?.(
          'ai_assessment',
          `Gemini audio review retrying (${evt.attempt}/${evt.totalAttempts} → ${evt.nextModel} in ${(evt.delayMs / 1000).toFixed(1)}s): ${evt.reason}`,
          'retrying',
        );
      },
    });
    aiAudio = res.data;
    aiModelUsed = res.modelUsed;
  } catch (err) {
    aiAudioError = err instanceof Error ? err.message : 'Gemini audio forensic analysis failed.';
  }

  // Merge any AI timestamp notes into segment observations if matching
  if (aiAudio?.notableTimestampObservations?.length) {
    for (const obs of aiAudio.notableTimestampObservations) {
      audioProfile.segments.push({
        startSec: 0,
        endSec: 0,
        timestampLabel: obs.timestampLabel,
        rmsDb: 0,
        zeroCrossingRate: 0,
        observation: `Multimodal observation: ${obs.observation}`,
        flagged: true,
      });
    }
  }

  const encoderAiPattern = /elevenlabs|murf|playht|resemble|bark|tortoise|vits|xtts|suno|udio|lyria/i;
  const encoderMatchesAi = Boolean(metadata.encoder && encoderAiPattern.test(metadata.encoder));

  const detectors: DetectorResult[] = [
    aiAudio
      ? {
          id: 'ai_speech_classification',
          methodName: 'AI-Generated Speech Classification',
          category: 'ai_reasoning',
          status: aiAudio.speechDetected ? 'completed' : 'not_applicable',
          ran: aiAudio.speechDetected,
          resultSummary: aiAudio.speechDetected
            ? aiAudio.aiSpeechSummary
            : 'Not applicable — no intelligible human speech detected in this recording.',
          rawSignalScore:
            aiAudio.speechDetected && typeof aiAudio.aiSpeechScore === 'number'
              ? Math.max(5, Math.min(95, aiAudio.aiSpeechScore))
              : null,
          reliability: 'Experimental',
          calibrationStatus: 'Uncalibrated (Experimental)',
          applicability: 'Spoken-word recordings',
          evidenceStrength: aiAudio.speechDetected ? 'Moderate' : 'Low',
          evidence: aiAudio.aiSpeechEvidence,
          limitations: [
            'Multimodal audio reasoning is experimental and can misclassify heavy studio noise-gating, podcast compression, or low-bitrate codecs as synthetic speech.',
          ],
          toolUsed: `Gemini Multimodal Audio Analysis (${aiModelUsed ?? GEMINI_FORENSIC_MODEL})`,
          correlationGroup: 'audio_ai_speech',
        }
      : {
          id: 'ai_speech_classification',
          methodName: 'AI-Generated Speech Classification',
          category: 'ai_reasoning',
          status: 'failed',
          ran: false,
          resultSummary: `Failed (recoverable) — Gemini audio classification unavailable: ${aiAudioError}`,
          rawSignalScore: null,
          reliability: 'Experimental',
          calibrationStatus: 'Uncalibrated (Experimental)',
          applicability: 'Spoken-word recordings',
          evidenceStrength: 'Low',
          evidence: [`Upstream error: ${aiAudioError}`],
          limitations: ['Excluded from scoring; retry Gemini analysis when available.'],
          toolUsed: `Gemini Multimodal Audio Analysis (${GEMINI_FORENSIC_MODEL})`,
          correlationGroup: 'audio_ai_speech',
        },
    {
      id: 'voice_cloning_biometric',
      methodName: 'Specialized Voice-Cloning Biometric Detector',
      category: 'signal',
      status: 'unavailable',
      ran: false,
      resultSummary:
        'Not performed — dedicated ASVspoof / RawNet2 / AASIST neural anti-spoofing model is not installed in this server environment.',
      rawSignalScore: null,
      reliability: 'High',
      calibrationStatus: 'Calibrated',
      applicability: 'Voice cloning and neural vocoder detection',
      evidenceStrength: 'Low',
      evidence: [
        'Requires a dedicated neural anti-spoofing classifier (e.g., AASIST/RawNet2) plus speaker reference audio for biometric verification.',
      ],
      limitations: [
        'Without a reference speaker enrollment sample, verifying whether a specific person’s voice was cloned is not possible.',
      ],
      toolUsed: 'Not integrated (Unavailable)',
      correlationGroup: 'voice_cloning_biometric',
    },
    {
      id: 'audio_spectral_analysis',
      methodName: 'Spectral & Frequency-Band Analysis',
      category: 'signal',
      status: 'completed',
      ran: true,
      resultSummary: `Spectral centroid estimated at ${audioProfile.spectralCentroidHz ?? 'N/A'} Hz; high-frequency (>=4 kHz) energy share ${audioProfile.highFreqEnergyRatio !== null ? `${(audioProfile.highFreqEnergyRatio * 100).toFixed(1)}%` : 'N/A'}.`,
      rawSignalScore: null,
      reliability: 'Low',
      calibrationStatus: 'Deterministic Check',
      applicability: '16 kHz mono PCM DFT window analysis',
      evidenceStrength: 'Low',
      evidence: [
        `Estimated mid-clip spectral centroid: ${audioProfile.spectralCentroidHz ?? 'N/A'} Hz.`,
        `Dynamic range across active windows: ${audioProfile.dynamicRangeDb} dB | Silence ratio: ${(audioProfile.silenceRatio * 100).toFixed(1)}%.`,
        `Clipping rate: ${(audioProfile.clippingRate * 100).toFixed(2)}%.`,
      ],
      limitations: [
        'Lossy MP3/AAC encoding naturally truncates upper frequency bands above 16 kHz regardless of whether audio is real or synthetic.',
      ],
      toolUsed: 'FFmpeg PCM Decoder + TruthLens DFT Spectral Analyzer',
      correlationGroup: 'audio_signal_metrics',
    },
    aiAudio
      ? {
          id: 'prosody_speech_pattern',
          methodName: 'Prosody & Speech Cadence Analysis',
          category: 'linguistic',
          status: aiAudio.speechDetected ? 'completed' : 'not_applicable',
          ran: aiAudio.speechDetected,
          resultSummary: aiAudio.speechDetected ? aiAudio.prosodySummary : 'Not applicable (no speech detected).',
          rawSignalScore:
            aiAudio.speechDetected && typeof aiAudio.prosodyScore === 'number'
              ? Math.max(5, Math.min(95, aiAudio.prosodyScore))
              : null,
          reliability: 'Experimental',
          calibrationStatus: 'Uncalibrated (Experimental)',
          applicability: 'Intonation, breathing, micro-pauses, and emotional rhythm',
          evidenceStrength: aiAudio.speechDetected ? 'Moderate' : 'Low',
          evidence: aiAudio.prosodyEvidence,
          limitations: [
            'Scripted narration, teleprompter reads, and trained broadcast speakers naturally exhibit regular cadence.',
          ],
          toolUsed: `Gemini Prosody Assessment (${aiModelUsed ?? GEMINI_FORENSIC_MODEL})`,
          correlationGroup: 'audio_ai_speech',
        }
      : {
          id: 'prosody_speech_pattern',
          methodName: 'Prosody & Speech Cadence Analysis',
          category: 'linguistic',
          status: 'failed',
          ran: false,
          resultSummary: `Failed (recoverable) — Gemini prosody review unavailable: ${aiAudioError}`,
          rawSignalScore: null,
          reliability: 'Experimental',
          calibrationStatus: 'Uncalibrated (Experimental)',
          applicability: 'Intonation, breathing, micro-pauses, and emotional rhythm',
          evidenceStrength: 'Low',
          evidence: ['Excluded from scoring; retry Gemini analysis when available.'],
          limitations: ['Upstream Gemini service unavailable.'],
          toolUsed: `Gemini Prosody Assessment (${GEMINI_FORENSIC_MODEL})`,
          correlationGroup: 'audio_ai_speech',
        },
    aiAudio
      ? {
          id: 'audio_artifact_analysis',
          methodName: 'Acoustic Artifact & Vocoder Distortion Inspection',
          category: 'signal',
          status: 'completed',
          ran: true,
          resultSummary: aiAudio.artifactSummary,
          rawSignalScore: Math.max(5, Math.min(95, aiAudio.artifactScore)),
          reliability: 'Experimental',
          calibrationStatus: 'Uncalibrated (Experimental)',
          applicability: 'Phase smearing, metallic vocoder buzz, abrupt noise-floor gating, and splice clicks',
          evidenceStrength: 'Moderate',
          evidence: aiAudio.artifactEvidence,
          limitations: [
            'Aggressive AI noise suppression (e.g., Krisp, RNNoise, Zoom) on authentic recordings can introduce similar gating and spectral artifacts.',
          ],
          toolUsed: `PCM Profile + Gemini Acoustic Artifact Review (${aiModelUsed ?? GEMINI_FORENSIC_MODEL})`,
          correlationGroup: 'audio_artifacts',
        }
      : {
          id: 'audio_artifact_analysis',
          methodName: 'Acoustic Artifact & Vocoder Distortion Inspection',
          category: 'signal',
          status: 'failed',
          ran: false,
          resultSummary: `Failed (recoverable) — Gemini acoustic artifact review unavailable: ${aiAudioError}`,
          rawSignalScore: null,
          reliability: 'Experimental',
          calibrationStatus: 'Uncalibrated (Experimental)',
          applicability: 'Phase smearing, metallic vocoder buzz, abrupt noise-floor gating, and splice clicks',
          evidenceStrength: 'Low',
          evidence: ['Local PCM waveform & RMS/ZCR segments completed; Gemini vocoder review excluded from scoring.'],
          limitations: ['Upstream Gemini service unavailable.'],
          toolUsed: `PCM Profile + Gemini Acoustic Artifact Review (${GEMINI_FORENSIC_MODEL})`,
          correlationGroup: 'audio_artifacts',
        },
    aiAudio
      ? {
          id: 'voice_consistency_analysis',
          methodName: 'Voice Timbre & Room-Tone Consistency',
          category: 'temporal',
          status: aiAudio.speechDetected ? 'completed' : 'not_applicable',
          ran: aiAudio.speechDetected,
          resultSummary: aiAudio.speechDetected
            ? aiAudio.voiceConsistencySummary
            : 'Not applicable (no speech detected).',
          rawSignalScore:
            aiAudio.speechDetected && typeof aiAudio.voiceConsistencyScore === 'number'
              ? Math.max(5, Math.min(95, aiAudio.voiceConsistencyScore))
              : null,
          reliability: 'Experimental',
          calibrationStatus: 'Uncalibrated (Experimental)',
          applicability: 'Speaker identity continuity and background acoustic floor across segments',
          evidenceStrength: 'Low',
          evidence: aiAudio.voiceConsistencyEvidence,
          limitations: [
            'Edited podcasts or multi-take studio recordings legitimately splice room tone across takes.',
          ],
          toolUsed: `Gemini Audio Continuity Review (${aiModelUsed ?? GEMINI_FORENSIC_MODEL})`,
          correlationGroup: 'audio_continuity',
        }
      : {
          id: 'voice_consistency_analysis',
          methodName: 'Voice Timbre & Room-Tone Consistency',
          category: 'temporal',
          status: 'failed',
          ran: false,
          resultSummary: `Failed (recoverable) — Gemini continuity review unavailable: ${aiAudioError}`,
          rawSignalScore: null,
          reliability: 'Experimental',
          calibrationStatus: 'Uncalibrated (Experimental)',
          applicability: 'Speaker identity continuity and background acoustic floor across segments',
          evidenceStrength: 'Low',
          evidence: ['Excluded from scoring; retry Gemini analysis when available.'],
          limitations: ['Upstream Gemini service unavailable.'],
          toolUsed: `Gemini Audio Continuity Review (${GEMINI_FORENSIC_MODEL})`,
          correlationGroup: 'audio_continuity',
        },
    {
      id: 'audio_metadata_inspection',
      methodName: 'Audio Container & Encoder Metadata Inspection',
      category: 'metadata',
      status: 'completed',
      ran: true,
      resultSummary: encoderMatchesAi
        ? `Audio encoder tag ("${metadata.encoder}") matches a known AI audio synthesis platform.`
        : `Format: ${metadata.audioFormat || 'Unknown'}, Sample Rate: ${metadata.sampleRate ?? 'Unknown'} Hz, Bitrate: ${metadata.bitrate ? `${Math.round(metadata.bitrate / 1000)} kbps` : 'Unknown'}.`,
      rawSignalScore: encoderMatchesAi ? 76 : null,
      reliability: encoderMatchesAi ? 'Moderate' : 'Low',
      calibrationStatus: 'Deterministic Check',
      applicability: 'ID3, MP4/M4A atoms, RIFF/WAV headers',
      evidenceStrength: encoderMatchesAi ? 'Moderate' : 'Low',
      evidence: [
        `Encoder / Tool: ${metadata.encoder || 'Not present'}.`,
        `Channels: ${metadata.audioChannels ?? 'Unknown'} | Codec: ${metadata.codec || 'Unknown'}.`,
        `Metadata tags present: ${Object.keys(metadata.tags ?? {}).length}.`,
      ],
      limitations: [
        'Audio transcoding strips or overwrites original encoder headers; missing tags do not indicate AI generation.',
      ],
      toolUsed: 'music-metadata + FFprobe',
      correlationGroup: 'metadata_context',
    },
    provenance.synthIdDetector,
  ];

  return {
    detectors,
    watermarks: provenance.provenanceWatermarks,
    audioProfile,
    geminiStatus: aiAudio ? 'completed' : 'failed',
    geminiModelUsed: aiModelUsed,
    geminiFailureDetail: aiAudioError,
  };
}
