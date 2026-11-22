import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import {
  SummaryNoteExtractedClass,
  SummaryNoteExtractionResult
} from '../types/attendance';
import { formatGeminiApiError } from './geminiErrorUtils.js';
import { getGeminiApiKey, ROSTER_CORRECTION_MODEL } from './rosterNameCorrectionService.js';
import { runRawVisionOcrForSummary } from './googleCloudVisionService.js';

export interface SummaryClassRef {
  id: string;
  name: string;
  enrolledCount?: number;
}

function normalizeClassToken(str: string): string {
  return str
    .toLowerCase()
    .replace(/\bpry\.?\b/g, 'primary')
    .replace(/\bpri\.?\b/g, 'primary')
    .replace(/\bp(\d)/g, 'primary $1')
    .replace(/\bnur\.?\b/g, 'nursery')
    .replace(/\beccd\.?\b/g, 'eccde')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function matchClassNameToRoster(
  detectedName: string,
  classes: SummaryClassRef[]
): string | null {
  if (!detectedName || classes.length === 0) return null;
  const targetNorm = normalizeClassToken(detectedName);
  if (!targetNorm) return null;

  // 1. Exact normalized match
  const exact = classes.find((c) => normalizeClassToken(c.name) === targetNorm);
  if (exact) return exact.id;

  // 2. Compact alphanumeric match (e.g., "primary 3a" == "primary 3 a")
  const targetCompact = targetNorm.replace(/\s+/g, '');
  const compact = classes.find(
    (c) => normalizeClassToken(c.name).replace(/\s+/g, '') === targetCompact
  );
  if (compact) return compact.id;

  // 3. Containment match for single-arm classes (e.g. "primary 3" -> "primary 3a" if unique)
  const partialMatches = classes.filter((c) => {
    const cNorm = normalizeClassToken(c.name);
    return cNorm.includes(targetNorm) || targetNorm.includes(cNorm);
  });
  if (partialMatches.length === 1) return partialMatches[0].id;

  return null;
}

export function normalizeExtractedSummaryItem(
  raw: {
    classNameDetected: string;
    presentCount: number;
    absentCount: number;
    totalCount?: number;
    notes?: string | null;
  },
  classes: SummaryClassRef[]
): SummaryNoteExtractedClass {
  const present = Math.max(0, Math.round(Number(raw.presentCount) || 0));
  const absent = Math.max(0, Math.round(Number(raw.absentCount) || 0));
  const rawTotal =
    typeof raw.totalCount === 'number' && !isNaN(raw.totalCount) && raw.totalCount > 0
      ? Math.round(raw.totalCount)
      : present + absent;

  const matchedClassId = matchClassNameToRoster(raw.classNameDetected, classes);
  const hasMathMismatch = rawTotal > 0 && present + absent !== rawTotal;

  return {
    classNameDetected: (raw.classNameDetected || '').trim() || 'Unknown Class',
    matchedClassId,
    presentCount: present,
    absentCount: absent,
    totalCount: rawTotal,
    hasMathMismatch,
    notes: raw.notes?.trim() || null
  };
}

/**
 * Deterministic fallback parser for clean Vision OCR summary lines when Gemini key is absent.
 * Handles common Nigerian school notebook formats like:
 * - "Primary 3A: Present 24, Absent 4, Total 28"
 * - "Pry 2B - 22/25 (3 absent)"
 * - "Primary 1A  26  4  30"
 */
export function parseSummaryLinesFromVisionText(
  ocrText: string,
  classes: SummaryClassRef[],
  selectedClassName?: string
): SummaryNoteExtractedClass[] {
  const lines = ocrText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const results: SummaryNoteExtractedClass[] = [];

  for (const line of lines) {
    const classHeaderMatch = line.match(
      /^((?:primary|pry\.?|pri\.?|nursery|nur\.?|eccde?|kg|jss|grade)\s*\d*\s*[a-z]?)\b[:\-\s]*(.*)$/i
    );
    if (!classHeaderMatch) continue;

    const classNameDetected = classHeaderMatch[1].trim();
    const rest = classHeaderMatch[2] || '';

    const presentMatch = rest.match(/\b(?:present|pres\.?|p)\s*[:=\-]?\s*(\d{1,3})\b/i);
    const absentMatch = rest.match(/\b(?:absent|abs\.?|a)\s*[:=\-]?\s*(\d{1,3})\b/i);
    const totalMatch = rest.match(/\b(?:total|tot\.?|enrolled|t)\s*[:=\-]?\s*(\d{1,3})\b/i);
    const slashMatch = rest.match(/\b(\d{1,3})\s*\/\s*(\d{1,3})\b/);

    let presentCount = 0;
    let absentCount = 0;
    let totalCount = 0;

    if (presentMatch || absentMatch || totalMatch) {
      presentCount = presentMatch ? parseInt(presentMatch[1], 10) : 0;
      absentCount = absentMatch ? parseInt(absentMatch[1], 10) : 0;
      totalCount = totalMatch ? parseInt(totalMatch[1], 10) : presentCount + absentCount;
      if (!absentMatch && totalCount >= presentCount) {
        absentCount = totalCount - presentCount;
      } else if (!presentMatch && totalCount >= absentCount) {
        presentCount = totalCount - absentCount;
      }
    } else if (slashMatch) {
      presentCount = parseInt(slashMatch[1], 10);
      totalCount = parseInt(slashMatch[2], 10);
      absentCount = Math.max(0, totalCount - presentCount);
    } else {
      const nums = (rest.match(/\b\d{1,3}\b/g) || []).map((n) => parseInt(n, 10));
      if (nums.length >= 3) {
        presentCount = nums[0];
        absentCount = nums[1];
        totalCount = nums[2];
      } else if (nums.length === 2) {
        presentCount = nums[0];
        absentCount = nums[1];
        totalCount = presentCount + absentCount;
      } else {
        continue;
      }
    }

    results.push(
      normalizeExtractedSummaryItem(
        {
          classNameDetected,
          presentCount,
          absentCount,
          totalCount
        },
        classes
      )
    );
  }

  // If the photo was tightly cropped around a single class's numbers without repeating the class name
  if (results.length === 0 && selectedClassName) {
    const presentMatch = ocrText.match(/\b(?:present|pres\.?|p)\s*[:=\-]?\s*(\d{1,3})\b/i);
    const absentMatch = ocrText.match(/\b(?:absent|abs\.?|a)\s*[:=\-]?\s*(\d{1,3})\b/i);
    const totalMatch = ocrText.match(/\b(?:total|tot\.?|enrolled|t)\s*[:=\-]?\s*(\d{1,3})\b/i);
    if (presentMatch || absentMatch) {
      const p = presentMatch ? parseInt(presentMatch[1], 10) : 0;
      const a = absentMatch ? parseInt(absentMatch[1], 10) : 0;
      const t = totalMatch ? parseInt(totalMatch[1], 10) : p + a;
      results.push(
        normalizeExtractedSummaryItem(
          {
            classNameDetected: selectedClassName,
            presentCount: p,
            absentCount: absentMatch ? a : Math.max(0, t - p),
            totalCount: t
          },
          classes
        )
      );
    }
  }

  return results;
}

/**
 * Combined Google Cloud Vision OCR + Gemini (gemini-4-hydrogen) handwritten summary parser.
 * Reads notebook summaries written by the admin (single class or multi-class page) and
 * maps each entry cleanly to the school's enrolled classes with math verification.
 */
export async function analyzeHandwrittenSummaryNote(params: {
  imageBuffer: Buffer;
  mimeType: string;
  base64Data: string;
  classes: SummaryClassRef[];
  selectedClassName?: string;
  targetDate?: string;
}): Promise<
  | { ok: true; data: SummaryNoteExtractionResult }
  | { ok: false; code: string; httpStatus: number; error: string }
> {
  const { imageBuffer, mimeType, base64Data, classes, selectedClassName, targetDate } = params;

  // Step 1: Run Google Cloud Vision OCR if configured (non-fatal if only Gemini is configured)
  const visionRes = await runRawVisionOcrForSummary(imageBuffer);
  const visionText = visionRes.ok ? visionRes.reconstructedText || visionRes.fullText || '' : '';

  const geminiApiKey = getGeminiApiKey();

  // If neither Vision nor Gemini is configured, return a clear real configuration error
  if (!visionRes.ok && !geminiApiKey) {
    return {
      ok: false,
      code: visionRes.code || 'NO_OCR_OR_GEMINI_CREDENTIALS',
      httpStatus: 503,
      error:
        visionRes.error ||
        'Configure Google Cloud Vision or GEMINI_API_KEY in server environment variables to scan written summary notes.'
    };
  }

  // Step 2: Combine Vision OCR text + notebook photo in Gemini (gemini-4-hydrogen) when configured
  if (geminiApiKey) {
    const ai = new GoogleGenAI({
      apiKey: geminiApiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build'
        }
      }
    });

    const enrolledSummary = classes.map((c) => ({
      id: c.id,
      name: c.name,
      enrolledCount: c.enrolledCount ?? null
    }));

    const promptLines = [
      'Extract class attendance totals from this handwritten school notebook summary page.',
      `Target date: ${targetDate || 'Today'}.`,
      selectedClassName
        ? `Currently selected class in app: "${selectedClassName}" (if the cropped photo only shows numbers without a class heading, assign them to "${selectedClassName}").`
        : '',
      `School's enrolled classes JSON:\n${JSON.stringify(enrolledSummary)}`,
      visionText
        ? `\nGoogle Cloud Vision OCR transcript (use alongside the image to resolve unclear handwriting):\n${visionText.slice(0, 4000)}`
        : '',
      '',
      'Rules:',
      '1. Read every handwritten class row visible in the image (e.g., "Pry 1A - 26 Present, 4 Absent, Total 30" or "P3: 22/25").',
      '2. Match abbreviations (Pry, Pri, P1, P2A, Nur) to the closest school class name when clear, otherwise keep the exact written class label.',
      '3. If only Present and Total are written, compute Absent = max(0, Total - Present). If only Present and Absent are written, compute Total = Present + Absent. Never invent classes that are not written on the page.',
      '4. If Present + Absent does not equal the written Total, preserve the exact written numbers and add a short note explaining the arithmetic mismatch so the admin can review.'
    ].filter(Boolean);

    try {
      const response = await ai.models.generateContent({
        model: ROSTER_CORRECTION_MODEL,
        contents: {
          parts: [
            {
              inlineData: {
                mimeType,
                data: base64Data
              }
            },
            { text: promptLines.join('\n') }
          ]
        },
        config: {
          systemInstruction:
            'You are a meticulous Nigerian primary school records assistant transcribing handwritten attendance summary notebooks into structured JSON. Be faithful to the written numbers and never fabricate unseen classes.',
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              dateDetected: {
                type: Type.STRING,
                description: 'Written date if visible on the notebook page, else empty string.'
              },
              items: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    classNameDetected: {
                      type: Type.STRING,
                      description: 'Class name matched to school roster or exact handwritten class label.'
                    },
                    presentCount: {
                      type: Type.INTEGER,
                      description: 'Number of pupils present.'
                    },
                    absentCount: {
                      type: Type.INTEGER,
                      description: 'Number of pupils absent.'
                    },
                    totalCount: {
                      type: Type.INTEGER,
                      description: 'Total number of pupils written or Present + Absent.'
                    },
                    notes: {
                      type: Type.STRING,
                      description: 'Short note if handwriting was faint or numbers did not add up.'
                    }
                  },
                  required: ['classNameDetected', 'presentCount', 'absentCount', 'totalCount']
                }
              }
            },
            required: ['items']
          }
        }
      });

      const parsed = JSON.parse((response.text ?? '{}').trim()) as {
        dateDetected?: string;
        items?: Array<{
          classNameDetected: string;
          presentCount: number;
          absentCount: number;
          totalCount: number;
          notes?: string;
        }>;
      };

      const normalizedItems = (Array.isArray(parsed?.items) ? parsed.items : []).map((item) =>
        normalizeExtractedSummaryItem(item, classes)
      );

      return {
        ok: true,
        data: {
          dateDetected: parsed?.dateDetected?.trim() || null,
          items: normalizedItems,
          rawText: visionText,
          modelUsed: visionRes.ok
            ? `Google Cloud Vision + ${ROSTER_CORRECTION_MODEL}`
            : ROSTER_CORRECTION_MODEL,
          aiStatus: 'applied',
          aiNote: visionRes.ok
            ? 'Combined Google Cloud Vision OCR + Gemini handwriting verification.'
            : 'Extracted via Gemini multimodal handwriting recognition.'
        }
      };
    } catch (err: any) {
      // If Vision succeeded, surface the real Gemini error if Vision extracted nothing, or return clear error
      const formatted = formatGeminiApiError(
        err,
        'GEMINI_SUMMARY_ERROR',
        'Could not analyze handwritten summary note with Gemini.'
      );
      return {
        ok: false,
        code: formatted.code,
        httpStatus: formatted.httpStatus,
        error: formatted.error
      };
    }
  }

  // Vision-only path when GEMINI_API_KEY is not configured
  const visionItems = parseSummaryLinesFromVisionText(visionText, classes, selectedClassName);
  return {
    ok: true,
    data: {
      dateDetected: null,
      items: visionItems,
      rawText: visionText,
      modelUsed: 'Google Cloud Vision API',
      aiStatus: 'vision-only',
      aiNote:
        'Extracted via Google Cloud Vision OCR (configure GEMINI_API_KEY in server secrets for enhanced messy handwriting recognition).'
    }
  };
}
