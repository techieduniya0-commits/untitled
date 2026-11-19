import { GoogleGenAI, ThinkingLevel, type Schema } from '@google/genai';

// Approved non-deprecated models (only configured/verified aliases are permitted)
const ALLOWED_FALLBACK_MODELS = new Set<string>([
  'gemini-4-hydrogen',
  'gemini-3.1-flash-lite',
]);

function resolveApprovedModel(envValue: string | undefined, defaultModel: string): string {
  const candidate = envValue?.trim();
  if (candidate && ALLOWED_FALLBACK_MODELS.has(candidate)) {
    return candidate;
  }
  return defaultModel;
}

export const GEMINI_FORENSIC_MODEL = resolveApprovedModel(
  process.env.GEMINI_MODEL,
  'gemini-4-hydrogen',
);

export const GEMINI_FALLBACK_MODEL = resolveApprovedModel(
  process.env.GEMINI_FALLBACK_MODEL,
  'gemini-3.1-flash-lite',
);

export interface GeminiRetryPolicy {
  maxRetriesPerModel: number;
  baseDelayMs: number;
  maxDelayMs: number;
  defaultTimeoutMs: number;
}

export const GEMINI_RETRY_POLICY: GeminiRetryPolicy = {
  maxRetriesPerModel: Math.max(
    1,
    Math.min(4, Number.parseInt(process.env.GEMINI_MAX_RETRIES ?? '2', 10) || 2),
  ),
  baseDelayMs: Math.max(
    300,
    Math.min(5000, Number.parseInt(process.env.GEMINI_RETRY_BASE_MS ?? '900', 10) || 900),
  ),
  maxDelayMs: 8_000,
  defaultTimeoutMs: Math.max(
    10_000,
    Math.min(60_000, Number.parseInt(process.env.GEMINI_TIMEOUT_MS ?? '25000', 10) || 25_000),
  ),
};

export type GeminiErrorCode =
  | 'API_KEY_UNAVAILABLE'
  | 'GEMINI_HIGH_DEMAND_503'
  | 'GEMINI_RATE_LIMIT_429'
  | 'GEMINI_NETWORK_ERROR'
  | 'GEMINI_API_FAILURE'
  | 'PROCESSING_TIMEOUT'
  | 'INVALID_RESPONSE';

export class GeminiServiceError extends Error {
  code: GeminiErrorCode;
  statusCode: number;
  retryable: boolean;
  attemptsMade: number;

  constructor(
    message: string,
    code: GeminiErrorCode,
    statusCode = 502,
    retryable = false,
    attemptsMade = 1,
  ) {
    super(message);
    this.name = 'GeminiServiceError';
    this.code = code;
    this.statusCode = statusCode;
    this.retryable = retryable;
    this.attemptsMade = attemptsMade;
  }
}

export function isGeminiConfigured(): boolean {
  const key = process.env.GEMINI_API_KEY?.trim();
  return Boolean(key && key !== 'MY_GEMINI_API_KEY');
}

export function getConfiguredGeminiModels(): string[] {
  const models = [GEMINI_FORENSIC_MODEL];
  if (GEMINI_FALLBACK_MODEL && GEMINI_FALLBACK_MODEL !== GEMINI_FORENSIC_MODEL) {
    models.push(GEMINI_FALLBACK_MODEL);
  }
  return models;
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new GeminiServiceError(
      'Gemini API key is not configured on the server. Set GEMINI_API_KEY in Settings > Secrets.',
      'API_KEY_UNAVAILABLE',
      503,
      false,
      0,
    );
  }

  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export interface InlineMediaPart {
  inlineData: {
    mimeType: string;
    data: string;
  };
}

export interface TextPart {
  text: string;
}

export type ForensicContentPart = InlineMediaPart | TextPart;

export interface GeminiRetryEvent {
  model: string;
  nextModel: string;
  attempt: number;
  totalAttempts: number;
  delayMs: number;
  reason: string;
  httpStatus?: number;
}

export interface GeminiCallMeta<T> {
  data: T;
  modelUsed: string;
  attemptsMade: number;
  usedFallbackModel: boolean;
}

const STRICT_FORENSIC_SYSTEM_INSTRUCTION = [
  'You are a careful, calibrated digital forensics analyst assisting TruthLens.',
  'STRICT EVIDENTIARY & ANTI-FALSE-POSITIVE RULES:',
  '1. Never claim 100% certainty or definitive proof of AI generation or human authorship.',
  '2. Never invent or fabricate watermarks, logos, EXIF fields, C2PA credentials, camera models, timestamps, or detector outputs that are not directly present in the media or supplied technical evidence.',
  '3. If a signal or attribute is absent or cannot be determined from the provided media, explicitly state "Not available" or "Inconclusive".',
  '4. Clearly distinguish between directly observed visual/acoustic/textual indicators and interpretive explanations.',
  '5. Do NOT treat consistent facial landmarks, natural temporal stability, high inter-frame histogram similarity, stable lighting, consistent backgrounds, smartphone HDR/EIS/beautification, or social-media re-encoding as evidence of AI generation — these are normal traits of authentic camera-recorded human videos.',
  '6. Do NOT treat missing metadata, stripped EXIF/container tags, or absence of AI watermarks/C2PA as proof of either AI generation or authenticity; missing metadata and absent watermarks are neutral.',
  '7. Only assign elevated AI-likelihood anomaly scores (>= 60/100) when concrete, directly observable synthetic-generation or manipulation artifacts are present (e.g., warping anatomy/text, face-swap blending seams, temporal identity drift, unnatural morphing physics, or verified AI provenance/watermarks).',
  '8. Return concise, precise JSON strictly adhering to the requested response schema.',
].join('\n');

function classifyUpstreamError(error: unknown, attemptsMade: number): GeminiServiceError {
  if (error instanceof GeminiServiceError) {
    return new GeminiServiceError(
      error.message,
      error.code,
      error.statusCode,
      error.retryable,
      attemptsMade,
    );
  }

  const rawMsg = error instanceof Error ? error.message : String(error);
  const lower = rawMsg.toLowerCase();

  if (
    lower.includes('api_key_invalid') ||
    lower.includes('permission_denied') ||
    lower.includes('"code":403') ||
    lower.includes('401')
  ) {
    return new GeminiServiceError(
      'Gemini API authentication failed. Verify GEMINI_API_KEY in server configuration.',
      'API_KEY_UNAVAILABLE',
      403,
      false,
      attemptsMade,
    );
  }

  if (
    lower.includes('503') ||
    lower.includes('unavailable') ||
    lower.includes('high demand') ||
    lower.includes('overloaded') ||
    lower.includes('service unavailable')
  ) {
    return new GeminiServiceError(
      'HTTP 503 — Gemini model is temporarily experiencing high demand (UNAVAILABLE).',
      'GEMINI_HIGH_DEMAND_503',
      503,
      true,
      attemptsMade,
    );
  }

  if (
    lower.includes('429') ||
    lower.includes('resource_exhausted') ||
    lower.includes('rate limit') ||
    lower.includes('quota')
  ) {
    return new GeminiServiceError(
      'HTTP 429 — Gemini API rate limit or quota reached (RESOURCE_EXHAUSTED).',
      'GEMINI_RATE_LIMIT_429',
      429,
      true,
      attemptsMade,
    );
  }

  if (
    lower.includes('fetch failed') ||
    lower.includes('econnreset') ||
    lower.includes('etimedout') ||
    lower.includes('enotfound') ||
    lower.includes('socket hang up') ||
    lower.includes('network')
  ) {
    return new GeminiServiceError(
      `Network error communicating with Gemini API: ${rawMsg.slice(0, 140)}`,
      'GEMINI_NETWORK_ERROR',
      502,
      true,
      attemptsMade,
    );
  }

  if (lower.includes('500') || lower.includes('502') || lower.includes('504') || lower.includes('internal')) {
    return new GeminiServiceError(
      `Temporary upstream Gemini server error: ${rawMsg.slice(0, 160)}`,
      'GEMINI_API_FAILURE',
      502,
      true,
      attemptsMade,
    );
  }

  return new GeminiServiceError(
    `Gemini multimodal analysis failed: ${rawMsg.slice(0, 200)}`,
    'GEMINI_API_FAILURE',
    502,
    false,
    attemptsMade,
  );
}

function computeJitteredBackoffMs(retryIndex: number, baseDelayMs: number, maxDelayMs: number): number {
  const exponential = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, retryIndex));
  // Equal-to-full jitter between 60% and 120% of exponential delay to prevent thundering herds
  const jitterFactor = 0.6 + Math.random() * 0.6;
  return Math.round(Math.min(maxDelayMs, exponential * jitterFactor));
}

function parseStrictJsonResponse<T>(rawText: string): T {
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new GeminiServiceError(
      'Gemini returned an empty forensic analysis payload.',
      'INVALID_RESPONSE',
      502,
      true,
    );
  }

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // Strip markdown fences or leading/trailing commentary if present
    const cleaned = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    try {
      return JSON.parse(cleaned) as T;
    } catch {
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          return JSON.parse(match[0]) as T;
        } catch {
          // Fall through
        }
      }
      throw new GeminiServiceError(
        'Gemini returned malformed JSON that could not be parsed.',
        'INVALID_RESPONSE',
        502,
        true,
      );
    }
  }
}

type TestInvokeHandler = (
  model: string,
  attemptNumber: number,
  options: { responseSchema: Schema },
) => Promise<string>;

let globalTestInvokeOverride: TestInvokeHandler | null = null;

/** Test-only hook for deterministic HTTP 503/429 integration tests (inactive in production). */
export function __setGeminiTestOverride(handler: TestInvokeHandler | null): void {
  globalTestInvokeOverride = handler;
}

export async function runStructuredGeminiAnalysisWithMeta<T>(options: {
  parts: ForensicContentPart[];
  responseSchema: Schema;
  systemInstruction?: string;
  thinkingLevel?: ThinkingLevel;
  timeoutMs?: number;
  maxRetriesPerModel?: number;
  baseDelayMs?: number;
  onRetry?: (event: GeminiRetryEvent) => void;
  /** Test-only override hook for deterministic unit/integration testing of 503/429 handling */
  __testInvokeOverride?: (model: string, attemptNumber: number) => Promise<string>;
}): Promise<GeminiCallMeta<T>> {
  const activeOverride = options.__testInvokeOverride
    ? (m: string, a: number) => options.__testInvokeOverride!(m, a)
    : globalTestInvokeOverride
      ? (m: string, a: number) => globalTestInvokeOverride!(m, a, { responseSchema: options.responseSchema })
      : null;

  const ai = activeOverride ? null : getGeminiClient();
  const timeoutMs = Math.min(
    options.timeoutMs ?? GEMINI_RETRY_POLICY.defaultTimeoutMs,
    45_000,
  );
  const maxRetriesPerModel = options.maxRetriesPerModel ?? GEMINI_RETRY_POLICY.maxRetriesPerModel;
  const baseDelayMs = options.baseDelayMs ?? GEMINI_RETRY_POLICY.baseDelayMs;
  const candidateModels = getConfiguredGeminiModels();

  // Build ordered execution plan: [primary x maxRetriesPerModel, fallback x maxRetriesPerModel]
  const attemptPlan: string[] = [];
  for (const model of candidateModels) {
    for (let r = 0; r < maxRetriesPerModel; r++) {
      attemptPlan.push(model);
    }
  }

  let lastClassified: GeminiServiceError | null = null;
  let attemptsMade = 0;

  for (let idx = 0; idx < attemptPlan.length; idx++) {
    const modelName = attemptPlan[idx];
    attemptsMade = idx + 1;

    try {
      let rawText: string;

      if (activeOverride) {
        rawText = await activeOverride(modelName, attemptsMade);
      } else {
        const config: Record<string, unknown> = {
          systemInstruction: options.systemInstruction
            ? `${STRICT_FORENSIC_SYSTEM_INSTRUCTION}\n\n${options.systemInstruction}`
            : STRICT_FORENSIC_SYSTEM_INSTRUCTION,
          responseMimeType: 'application/json',
          responseSchema: options.responseSchema,
        };
        if (modelName === 'gemini-4-hydrogen' && options.thinkingLevel) {
          config.thinkingConfig = {
            thinkingLevel: options.thinkingLevel,
          };
        }

        const callPromise = ai!.models.generateContent({
          model: modelName,
          contents: { parts: options.parts },
          config,
        });

        let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(() => {
            reject(
              new GeminiServiceError(
                `Gemini request (${modelName}) timed out after ${Math.round(timeoutMs / 1000)}s.`,
                'PROCESSING_TIMEOUT',
                504,
                true,
                attemptsMade,
              ),
            );
          }, timeoutMs);
        });

        try {
          const response = await Promise.race([callPromise, timeoutPromise]);
          rawText = response.text ?? '';
        } finally {
          if (timeoutHandle) clearTimeout(timeoutHandle);
        }
      }

      const parsed = parseStrictJsonResponse<T>(rawText);
      return {
        data: parsed,
        modelUsed: modelName,
        attemptsMade,
        usedFallbackModel: modelName !== candidateModels[0],
      };
    } catch (error) {
      const classified = classifyUpstreamError(error, attemptsMade);
      lastClassified = classified;

      // Never retry authentication/configuration errors
      if (!classified.retryable) {
        throw classified;
      }

      const hasMoreAttempts = idx < attemptPlan.length - 1;
      if (!hasMoreAttempts) {
        break;
      }

      const nextModel = attemptPlan[idx + 1];
      const switchingModel = nextModel !== modelName;
      const delayMs = switchingModel
        ? Math.min(1200, computeJitteredBackoffMs(0, baseDelayMs, GEMINI_RETRY_POLICY.maxDelayMs))
        : computeJitteredBackoffMs(idx, baseDelayMs, GEMINI_RETRY_POLICY.maxDelayMs);

      options.onRetry?.({
        model: modelName,
        nextModel,
        attempt: attemptsMade,
        totalAttempts: attemptPlan.length,
        delayMs,
        reason: classified.message,
        httpStatus: classified.statusCode,
      });

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw (
    lastClassified ??
    new GeminiServiceError(
      'Gemini multimodal analysis failed after exhausting configured retries.',
      'GEMINI_API_FAILURE',
      502,
      true,
      attemptsMade,
    )
  );
}

export async function runStructuredGeminiAnalysis<T>(options: {
  parts: ForensicContentPart[];
  responseSchema: Schema;
  systemInstruction?: string;
  thinkingLevel?: ThinkingLevel;
  timeoutMs?: number;
  maxRetriesPerModel?: number;
  onRetry?: (event: GeminiRetryEvent) => void;
}): Promise<T> {
  const result = await runStructuredGeminiAnalysisWithMeta<T>(options);
  return result.data;
}
