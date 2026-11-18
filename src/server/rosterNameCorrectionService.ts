import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { formatGeminiApiError } from './geminiErrorUtils.js';

export interface RosterStudentCandidate {
  studentNumber: number;
  fullName: string;
  admissionNumber?: string | null;
  originalOcrName?: string;
  aiCorrected?: boolean;
  aiCorrectionNote?: string;
}

export interface RosterNameCorrectionSuggestion {
  studentNumber: number;
  correctedFullName: string;
  reason?: string;
}

export interface RosterNameCorrectionResult {
  ok: boolean;
  students: RosterStudentCandidate[];
  correctedCount: number;
  status: 'applied' | 'not_configured' | 'error';
  modelUsed?: string;
  code?: string;
  httpStatus?: number;
  message?: string;
}

export const ROSTER_CORRECTION_MODEL = 'gemini-4-hydrogen';

export function getGeminiApiKey(): string | null {
  const key = process.env.GEMINI_API_KEY?.trim();
  return key && key.length > 0 ? key : null;
}

/**
 * Normalizes Nigerian student names to clean Title Case while preserving hyphenated names
 * and initials cleanly.
 */
export function cleanNigerianStudentName(raw: string): string {
  const collapsed = raw
    .replace(/[|_~`^=*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!collapsed) return '';

  return collapsed
    .split(' ')
    .map((word) => {
      if (!word) return '';
      if (word.includes('-')) {
        return word
          .split('-')
          .map((part) =>
            part.length > 0
              ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
              : ''
          )
          .join('-');
      }
      if (/^[A-Za-z]\.?$/.test(word)) {
        return word.charAt(0).toUpperCase() + (word.endsWith('.') ? '.' : '');
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .filter(Boolean)
    .join(' ');
}

/**
 * Safely merges Gemini Nigerian-context name corrections into OCR-extracted roster rows
 * without adding, removing, or renumbering any student row.
 */
export function mergeNigerianNameCorrections(
  rows: RosterStudentCandidate[],
  suggestions: RosterNameCorrectionSuggestion[]
): { students: RosterStudentCandidate[]; correctedCount: number } {
  const byRow = new Map<number, RosterNameCorrectionSuggestion>();
  for (const s of suggestions) {
    const rowNum = Number(s?.studentNumber);
    const cleaned = cleanNigerianStudentName(String(s?.correctedFullName || ''));
    if (Number.isInteger(rowNum) && rowNum > 0 && cleaned.length >= 2) {
      byRow.set(rowNum, {
        studentNumber: rowNum,
        correctedFullName: cleaned,
        reason: typeof s?.reason === 'string' ? s.reason.trim() : undefined
      });
    }
  }

  let correctedCount = 0;
  const students = rows.map((row) => {
    const originalOcrName = row.originalOcrName ?? row.fullName;
    const suggestion = byRow.get(row.studentNumber);
    if (!suggestion) {
      return {
        ...row,
        originalOcrName,
        aiCorrected: Boolean(row.aiCorrected)
      };
    }

    const currentNormalized = cleanNigerianStudentName(row.fullName);
    const didChange =
      suggestion.correctedFullName.toLowerCase() !== row.fullName.trim().toLowerCase() &&
      suggestion.correctedFullName.length >= 2;

    if (didChange) {
      correctedCount++;
      return {
        ...row,
        fullName: suggestion.correctedFullName,
        originalOcrName,
        aiCorrected: true,
        aiCorrectionNote:
          suggestion.reason || 'Refined to closest Nigerian register spelling'
      };
    }

    // Even if letters match, apply clean Title Case formatting if raw OCR was ALL CAPS
    if (currentNormalized && currentNormalized !== row.fullName.trim()) {
      return {
        ...row,
        fullName: currentNormalized,
        originalOcrName,
        aiCorrected: Boolean(row.aiCorrected)
      };
    }

    return {
      ...row,
      originalOcrName,
      aiCorrected: Boolean(row.aiCorrected)
    };
  });

  return { students, correctedCount };
}

/**
 * Uses Gemini (gemini-4-hydrogen) on the server to fix OCR handwriting errors in enrolled
 * pupil names based on what is closest visually/phonetically and Nigerian naming conventions.
 */
export async function correctNigerianRosterNames(params: {
  students: RosterStudentCandidate[];
  rawText?: string;
  image?: { mimeType: string; base64Data: string } | null;
}): Promise<RosterNameCorrectionResult> {
  const { students, rawText, image } = params;
  if (!Array.isArray(students) || students.length === 0) {
    return {
      ok: true,
      students: [],
      correctedCount: 0,
      status: 'applied',
      modelUsed: ROSTER_CORRECTION_MODEL
    };
  }

  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return {
      ok: false,
      students,
      correctedCount: 0,
      status: 'not_configured',
      code: 'NO_GEMINI_KEY',
      httpStatus: 503,
      message:
        'Gemini API key (GEMINI_API_KEY) is not configured in your server environment variables.'
    };
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build'
      }
    }
  });

  const compactInput = students.map((s) => ({
    studentNumber: s.studentNumber,
    fullName: s.fullName,
    admissionNumber: s.admissionNumber || ''
  }));

  const promptLines = [
    'Review and correct OCR-extracted pupil names from a Nigerian primary school attendance register.',
    'Rules:',
    '1. Only fix obvious handwriting OCR errors (e.g. swapped/garbled letters like rn->m, 0->o, 1->l, "Abubaker"->"Abubakar", "Chukwurna"->"Chukwuma", "Adebay0"->"Adebayo", "Ibrahirn"->"Ibrahim", "Oluwasegun", "Balarabe", "Khadijat", "Chinedu", "Zainab", "Sadiq", "Ngozi", "Abdullahi", "Toluwanimi", "Favour", "Blessing") using what is closest to the OCR text and the attached register image if provided.',
    '2. Apply Nigerian context (Hausa, Fulani, Igbo, Yoruba, Nupe, Gbagyi, Tiv, Edo, Ijaw, and Nigerian English/Christian/Islamic names common in Abuja L.E.A. schools).',
    '3. NEVER invent new students, NEVER swap identities across rows, and NEVER replace a valid name with an unrelated name.',
    '4. Strip stray non-name OCR artifacts (slashes, brackets, serial numbers, admission numbers accidentally merged into the name).',
    '5. Return clean Title Case names for every studentNumber provided.',
    '',
    `Extracted rows JSON:\n${JSON.stringify(compactInput)}`
  ];

  if (rawText && rawText.trim().length > 0) {
    promptLines.push(`\nRaw OCR page text context:\n${rawText.slice(0, 4000)}`);
  }

  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
  if (image?.base64Data && image?.mimeType) {
    parts.push({
      inlineData: {
        mimeType: image.mimeType,
        data: image.base64Data
      }
    });
  }
  parts.push({ text: promptLines.join('\n') });

  try {
    const response = await ai.models.generateContent({
      model: ROSTER_CORRECTION_MODEL,
      contents: { parts },
      config: {
        systemInstruction:
          'You are a careful Nigerian primary-school records clerk proofreading pupil roster names extracted by OCR. Keep corrections conservative and strictly closest to the visible handwriting and authentic Nigerian naming conventions.',
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            corrections: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  studentNumber: {
                    type: Type.INTEGER,
                    description: 'Exact student row number from the input.'
                  },
                  correctedFullName: {
                    type: Type.STRING,
                    description: 'Closest corrected full name in Title Case.'
                  },
                  reason: {
                    type: Type.STRING,
                    description: 'Short plain-English note if letters were fixed, else empty string.'
                  }
                },
                required: ['studentNumber', 'correctedFullName']
              }
            }
          },
          required: ['corrections']
        }
      }
    });

    const jsonText = (response.text ?? '{}').trim();
    const parsed = JSON.parse(jsonText) as {
      corrections?: RosterNameCorrectionSuggestion[];
    };
    const suggestions = Array.isArray(parsed?.corrections) ? parsed.corrections : [];
    const merged = mergeNigerianNameCorrections(students, suggestions);

    return {
      ok: true,
      students: merged.students,
      correctedCount: merged.correctedCount,
      status: 'applied',
      modelUsed: ROSTER_CORRECTION_MODEL
    };
  } catch (err: any) {
    const formatted = formatGeminiApiError(
      err,
      'GEMINI_ROSTER_CORRECTION_ERROR',
      'Could not run AI Nigerian-context name correction.'
    );
    return {
      ok: false,
      students,
      correctedCount: 0,
      status: 'error',
      code: formatted.code,
      httpStatus: formatted.httpStatus,
      message: formatted.error
    };
  }
}
