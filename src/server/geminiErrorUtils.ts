export interface FormattedGeminiError {
  httpStatus: number;
  code: string;
  error: string;
}

function tryExtractGoogleErrorBody(rawMessage: string): {
  code?: number;
  status?: string;
  message?: string;
  retryDelaySeconds?: number;
} | null {
  if (!rawMessage || typeof rawMessage !== 'string') return null;

  const trimmed = rawMessage.trim();
  const jsonStart = trimmed.indexOf('{');
  if (jsonStart === -1) return null;

  try {
    const parsed = JSON.parse(trimmed.slice(jsonStart));
    const errObj = parsed?.error && typeof parsed.error === 'object' ? parsed.error : parsed;
    if (!errObj || typeof errObj !== 'object') return null;

    let retryDelaySeconds: number | undefined;
    if (Array.isArray(errObj.details)) {
      for (const detail of errObj.details) {
        if (typeof detail?.retryDelay === 'string') {
          const secMatch = detail.retryDelay.match(/^(\d+(?:\.\d+)?)s$/i);
          if (secMatch) {
            retryDelaySeconds = Math.ceil(Number(secMatch[1]));
          }
        }
      }
    }

    return {
      code: typeof errObj.code === 'number' ? errObj.code : undefined,
      status: typeof errObj.status === 'string' ? errObj.status : undefined,
      message: typeof errObj.message === 'string' ? errObj.message : undefined,
      retryDelaySeconds
    };
  } catch {
    return null;
  }
}

export function formatRetryDuration(seconds?: number): string | null {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return null;
  if (seconds < 60) return `${seconds}s`;
  const totalMinutes = Math.ceil(seconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

export function shouldFallbackFromGeminiError(err: any): boolean {
  const status = typeof err?.status === 'number' ? err.status : undefined;
  const rawMsg = typeof err?.message === 'string' ? err.message : '';
  const parsed = tryExtractGoogleErrorBody(rawMsg);
  const effectiveCode = parsed?.code ?? status;
  const effectiveStatus = (parsed?.status || '').toUpperCase();
  const combined = `${rawMsg} ${parsed?.message || ''}`.toLowerCase();

  if (effectiveCode === 503 || effectiveCode === 429) return true;
  if (effectiveStatus === 'RESOURCE_EXHAUSTED' || effectiveStatus === 'UNAVAILABLE') return true;
  if (
    combined.includes('quota') ||
    combined.includes('rate limit') ||
    combined.includes('rate-limit') ||
    combined.includes('resource_exhausted') ||
    combined.includes('high demand') ||
    combined.includes('overloaded')
  ) {
    return true;
  }

  return false;
}

export function isQuotaExhaustedError(err: any): boolean {
  const status = typeof err?.status === 'number' ? err.status : undefined;
  const rawMsg = typeof err?.message === 'string' ? err.message : '';
  const parsed = tryExtractGoogleErrorBody(rawMsg);
  const effectiveCode = parsed?.code ?? status;
  const effectiveStatus = (parsed?.status || '').toUpperCase();
  const combined = `${rawMsg} ${parsed?.message || ''}`.toLowerCase();

  return (
    effectiveCode === 429 ||
    effectiveStatus === 'RESOURCE_EXHAUSTED' ||
    combined.includes('quota') ||
    combined.includes('resource_exhausted')
  );
}

export function formatGeminiApiError(
  err: any,
  fallbackCode: string,
  fallbackMessage: string
): FormattedGeminiError {
  const status = typeof err?.status === 'number' ? err.status : undefined;
  const rawMsg = typeof err?.message === 'string' ? err.message : '';
  const parsed = tryExtractGoogleErrorBody(rawMsg);
  const effectiveCode = parsed?.code ?? status;
  const effectiveStatus = (parsed?.status || '').toUpperCase();
  const combined = `${rawMsg} ${parsed?.message || ''}`.toLowerCase();

  if (
    effectiveCode === 429 ||
    effectiveStatus === 'RESOURCE_EXHAUSTED' ||
    combined.includes('quota') ||
    combined.includes('resource_exhausted')
  ) {
    const waitLabel = formatRetryDuration(parsed?.retryDelaySeconds);
    return {
      httpStatus: 429,
      code: 'QUOTA_EXCEEDED',
      error: `Gemini API quota limit reached for your current API key${
        waitLabel ? ` (reset window: ~${waitLabel})` : ''
      }. Try switching to Gemini 3.1 Flash Lite, using Google Cloud Vision, or checking your Gemini plan/billing in Settings > Secrets.`
    };
  }

  if (
    effectiveCode === 401 ||
    effectiveCode === 403 ||
    effectiveStatus === 'PERMISSION_DENIED' ||
    combined.includes('api_key_invalid') ||
    combined.includes('api key not valid')
  ) {
    return {
      httpStatus: 403,
      code: 'API_KEY_INVALID',
      error: 'Gemini API key is invalid or lacks permission. Please verify your key in Settings > Secrets.'
    };
  }

  if (effectiveCode === 404 || effectiveStatus === 'NOT_FOUND') {
    return {
      httpStatus: 404,
      code: 'MODEL_NOT_FOUND',
      error: 'Selected Gemini model was not found. Please switch to Gemini 3.1 Flash Lite and retry.'
    };
  }

  if (effectiveCode === 503 || effectiveStatus === 'UNAVAILABLE' || combined.includes('high demand')) {
    return {
      httpStatus: 503,
      code: 'SERVICE_UNAVAILABLE',
      error: 'Gemini vision service is temporarily busy. Please retry in a few seconds.'
    };
  }

  const conciseMessage = parsed?.message
    ? parsed.message.split('\n')[0].trim()
    : rawMsg && !rawMsg.trim().startsWith('{')
    ? rawMsg.split('\n')[0].trim()
    : '';

  return {
    httpStatus: 500,
    code: fallbackCode,
    error: conciseMessage || fallbackMessage
  };
}
