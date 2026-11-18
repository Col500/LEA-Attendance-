import { ImageAnnotatorClient } from '@google-cloud/vision';
import { GoogleAuth } from 'google-auth-library';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GeminiExtractionResult, MarkStatus } from '../types/attendance';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Potential paths for the service account key
const possibleKeyPaths = [
  path.resolve(process.cwd(), 'credentials', 'google-vision-key.json'),
  path.resolve(__dirname, '..', '..', 'credentials', 'google-vision-key.json'),
  '/credentials/google-vision-key.json'
];

interface ServiceAccountData {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
}

let cachedCredentials: ServiceAccountData | null = null;
let cachedClient: ImageAnnotatorClient | null = null;

export function getServiceAccountCredentials(forceReload = false): ServiceAccountData | null {
  if (cachedCredentials && !forceReload) return cachedCredentials;

  for (const p of possibleKeyPaths) {
    if (fs.existsSync(p)) {
      try {
        const raw = fs.readFileSync(p, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed.client_email && parsed.private_key && parsed.project_id) {
          cachedCredentials = parsed;
          return cachedCredentials;
        }
      } catch (err) {
        console.error('Error reading service account file at', p, err);
      }
    }
  }
  return null;
}

export function resetVisionClientCache(): void {
  cachedCredentials = null;
  cachedClient = null;
}

export function getVisionClient(): ImageAnnotatorClient | null {
  if (cachedClient) return cachedClient;

  const creds = getServiceAccountCredentials();
  if (!creds) return null;

  try {
    const auth = new GoogleAuth({
      credentials: creds,
      scopes: ['https://www.googleapis.com/auth/cloud-platform']
    });
    cachedClient = new ImageAnnotatorClient({ auth: auth as any });
    return cachedClient;
  } catch (err) {
    console.error('Failed to initialize Google Cloud Vision client:', err);
    return null;
  }
}

export function getCloudVisionApiKey(): string | null {
  const key = process.env.GOOGLE_CLOUD_VISION_API_KEY?.trim();
  return key && key.length > 0 ? key : null;
}

export interface CloudVisionStatus {
  configured: boolean;
  authMethod?: 'api-key' | 'service-account';
  projectId?: string;
  clientEmail?: string;
  billingUrl?: string;
}

export function getGoogleCloudVisionInfo(): CloudVisionStatus {
  const apiKey = getCloudVisionApiKey();
  const creds = getServiceAccountCredentials();

  if (apiKey) {
    return {
      configured: true,
      authMethod: 'api-key',
      projectId: creds?.project_id || 'Google Cloud Vision (API Key)',
      clientEmail: 'REST API Key (.env GOOGLE_CLOUD_VISION_API_KEY)',
      billingUrl: creds?.project_id
        ? `https://console.developers.google.com/billing/enable?project=${creds.project_id}`
        : undefined
    };
  }

  if (!creds) {
    return {
      configured: false
    };
  }

  return {
    configured: true,
    authMethod: 'service-account',
    projectId: creds.project_id,
    clientEmail: creds.client_email,
    billingUrl: `https://console.developers.google.com/billing/enable?project=${creds.project_id}`
  };
}

function resolveSchoolWeekday(targetDate?: string): string {
  const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  if (targetDate) {
    const iso = targetDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) {
      const dt = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
      const day = dt.getDay();
      if (day >= 1 && day <= 5) return weekdays[day - 1];
    }
    const lower = targetDate.trim().toLowerCase();
    const matched = weekdays.find((w) => w.toLowerCase() === lower);
    if (matched) return matched;
  }
  const nowDay = new Date().getDay();
  if (nowDay >= 1 && nowDay <= 5) return weekdays[nowDay - 1];
  return 'Friday';
}

interface PositionedSymbol {
  text: string;
  xCenter: number;
  xMin: number;
  xMax: number;
  yCenter: number;
}

interface PositionedWord {
  text: string;
  xCenter: number;
  xMin: number;
  xMax: number;
  yCenter: number;
  yMin: number;
  yMax: number;
  height: number;
  symbols: PositionedSymbol[];
}

function extractWordsFromAnnotation(fullTextAnnotation: any): {
  pageWidth: number;
  pageHeight: number;
  words: PositionedWord[];
} {
  const pages = Array.isArray(fullTextAnnotation?.pages) ? fullTextAnnotation.pages : [];
  if (pages.length === 0) return { pageWidth: 0, pageHeight: 0, words: [] };

  const firstPage = pages[0];
  const pageWidth = Number(firstPage?.width || 0);
  const pageHeight = Number(firstPage?.height || 0);
  const words: PositionedWord[] = [];

  for (const page of pages) {
    for (const block of page?.blocks || []) {
      for (const para of block?.paragraphs || []) {
        for (const word of para?.words || []) {
          const rawSymbols = Array.isArray(word?.symbols) ? word.symbols : [];
          const text = rawSymbols
            .map((s: any) => s?.text || '')
            .join('')
            .trim();
          const vertices = word?.boundingBox?.vertices;
          if (!text || !Array.isArray(vertices) || vertices.length < 4) continue;

          const xs = vertices.map((v: any) => Number(v?.x || 0));
          const ys = vertices.map((v: any) => Number(v?.y || 0));
          const xMin = Math.min(...xs);
          const xMax = Math.max(...xs);
          const yMin = Math.min(...ys);
          const yMax = Math.max(...ys);

          const wordWidth = Math.max(1, xMax - xMin);
          const symLen = Math.max(1, rawSymbols.length);
          const symbols: PositionedSymbol[] = rawSymbols
            .map((s: any, idx: number) => {
              const st = String(s?.text || '');
              const sv = s?.boundingBox?.vertices;
              if (Array.isArray(sv) && sv.length >= 4) {
                const sxs = sv.map((v: any) => Number(v?.x || 0));
                const sys = sv.map((v: any) => Number(v?.y || 0));
                const sxMin = Math.min(...sxs);
                const sxMax = Math.max(...sxs);
                const syMin = Math.min(...sys);
                const syMax = Math.max(...sys);
                return {
                  text: st,
                  xMin: sxMin,
                  xMax: sxMax,
                  xCenter: (sxMin + sxMax) / 2,
                  yCenter: (syMin + syMax) / 2
                };
              }
              const sxMin = xMin + (idx / symLen) * wordWidth;
              const sxMax = xMin + ((idx + 1) / symLen) * wordWidth;
              return {
                text: st,
                xMin: sxMin,
                xMax: sxMax,
                xCenter: (sxMin + sxMax) / 2,
                yCenter: (yMin + yMax) / 2
              };
            })
            .filter((s: PositionedSymbol) => s.text.length > 0);

          words.push({
            text,
            xMin,
            xMax,
            xCenter: (xMin + xMax) / 2,
            yMin,
            yMax,
            yCenter: (yMin + yMax) / 2,
            height: Math.max(8, yMax - yMin),
            symbols
          });
        }
      }
    }
  }

  return { pageWidth, pageHeight, words };
}

/**
 * Reconstructs horizontal table rows from Cloud Vision fullTextAnnotation word bounding boxes
 * so tabular columns (S/N, Name, Admission No, Marks) stay aligned on the same line.
 */
export function reconstructRowsFromVisionAnnotation(fullTextAnnotation: any): string {
  const fallbackText = typeof fullTextAnnotation?.text === 'string' ? fullTextAnnotation.text : '';
  const { words } = extractWordsFromAnnotation(fullTextAnnotation);
  if (words.length === 0) return fallbackText;

  words.sort((a, b) => a.yCenter - b.yCenter || a.xMin - b.xMin);

  const lines: PositionedWord[][] = [];
  for (const word of words) {
    const lastLine = lines[lines.length - 1];
    if (!lastLine) {
      lines.push([word]);
      continue;
    }
    const avgY = lastLine.reduce((acc, w) => acc + w.yCenter, 0) / lastLine.length;
    const avgH = lastLine.reduce((acc, w) => acc + w.height, 0) / lastLine.length;
    const tolerance = Math.max(10, avgH * 0.6);

    if (Math.abs(word.yCenter - avgY) <= tolerance) {
      lastLine.push(word);
    } else {
      lines.push([word]);
    }
  }

  return lines
    .map((row) =>
      row
        .sort((a, b) => a.xMin - b.xMin)
        .map((w) => w.text)
        .join(' ')
        .trim()
    )
    .filter(Boolean)
    .join('\n');
}

interface LeaWeekColumn {
  weekNumber: number;
  weekLabel: string;
  weekEnding: string | null;
  days: Array<{
    day: 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday';
    xCenter: number;
    dayWidth: number;
  }>;
}

interface LeaParsedResult {
  classDetected: string | null;
  periodDetected: string | null;
  isLeftRosterPage: boolean;
  students: Array<{ studentNumber: number; fullName: string; admissionNumber: string | null }>;
  attendance: GeminiExtractionResult;
}

const FULL_WEEKDAYS: Array<'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday'> = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday'
];

function computeMedian(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function fitLinearSlope(points: Array<{ x: number; y: number }>): number {
  if (points.length < 3) return 0;
  const meanX = points.reduce((s, p) => s + p.x, 0) / points.length;
  const meanY = points.reduce((s, p) => s + p.y, 0) / points.length;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.x - meanX) * (p.y - meanY);
    den += (p.x - meanX) * (p.x - meanX);
  }
  if (den < 1) return 0;
  const slope = num / den;
  return Math.max(-0.12, Math.min(0.12, slope));
}

function cleanGluedAdmissionNumber(tokens: string[]): string | null {
  for (const raw of tokens) {
    let t = raw.replace(/[^A-Za-z0-9/-]/g, '').trim();
    if (!t) continue;
    // Handle Sex+Admission OCR merges like F10157, M9573, Fl0445, F9673
    const glued = t.match(/^[MF][lI]?(\d{3,6})$/i);
    if (glued) {
      if (/^[MF]l\d{4}$/i.test(t)) {
        return `1${glued[1]}`;
      }
      return glued[1];
    }
    if (/^Fl0\d{3}$/i.test(t)) {
      return `1${t.slice(2)}`;
    }
    if (/^\d{3,6}$/.test(t)) {
      return t;
    }
    if (/^[A-Z]{2,}[/-]\d+/.test(t)) {
      return t;
    }
  }
  return null;
}

/**
 * Spatial bounding-box parser specifically tailored to Nigerian LEA Primary School Attendance Registers.
 * Supports both Left Pages (Roster + Weeks 1-3) and Right Pages (Weeks 4-7 + TOTAL).
 * Returns null if the Cloud Vision annotation does not match an LEA register table layout.
 */
export function parseLeaRegisterFromAnnotation(
  fullTextAnnotation: any,
  targetClassName?: string,
  targetDate?: string
): LeaParsedResult | null {
  const { pageWidth: rawW, pageHeight: rawH, words } = extractWordsFromAnnotation(fullTextAnnotation);
  if (words.length < 15) return null;

  const pageWidth = rawW || Math.max(...words.map((w) => w.xMax), 1000);
  const pageHeight = rawH || Math.max(...words.map((w) => w.yMax), 1000);

  // Locate core printed table header anchors
  const nameHeader = words.find((w) => w.text === 'NAME' && w.yCenter < pageHeight * 0.55);
  const sexHeader = words.find((w) => /^Sex$/i.test(w.text) && w.yCenter < pageHeight * 0.55);
  const admissionHeader = words.find((w) => /^Admission$/i.test(w.text) && w.yCenter < pageHeight * 0.55);
  const ageHeader = words.find((w) => /^Age$/i.test(w.text) && w.yCenter < pageHeight * 0.55);
  const datePromoHeader = words.find((w) => /^Date$/i.test(w.text) && w.yCenter < pageHeight * 0.55);
  const noHeader = words.find(
    (w) =>
      /^No\.?$/i.test(w.text) &&
      w.yCenter < pageHeight * 0.55 &&
      w.xCenter > (admissionHeader?.xMax ?? sexHeader?.xMax ?? nameHeader?.xMax ?? pageWidth * 0.45)
  );
  const weekHeaders = words.filter((w) => /^(Week|Wook)$/i.test(w.text) && w.yCenter < pageHeight * 0.55);
  const totalHeader = words.find((w) => /^TOTAL$/i.test(w.text) && w.yCenter < pageHeight * 0.55);

  const isLeftRosterPage = Boolean(nameHeader || (sexHeader && admissionHeader));
  const hasWeekGrid = weekHeaders.length >= 1;
  if (!isLeftRosterPage && !hasWeekGrid) {
    return null;
  }

  // Find candidate day-header tokens (M, T, W, Th, F or glued MTW / MTWTh)
  const weekMedianY = weekHeaders.length > 0 ? computeMedian(weekHeaders.map((w) => w.yCenter)) : 0;
  const headerRefY =
    weekMedianY ||
    nameHeader?.yCenter ||
    sexHeader?.yCenter ||
    admissionHeader?.yCenter ||
    pageHeight * 0.3;

  const dayHeaderCandidates = words.filter((w) => {
    if (w.yCenter < headerRefY - pageHeight * 0.025 || w.yCenter > headerRefY + pageHeight * 0.085) {
      return false;
    }
    return /^(M|T|W|Th|F|MTWTh|MTW|TW|ThF|MT|WF)$/i.test(w.text);
  });

  // Estimate page tilt slope separately for Left Roster half and Right Grid half
  // because open register books bend slightly at the center spine.
  // First exclude opposite-page spine slivers near far-left (<9% width) or far-right (>86% width on Left pages)
  const rawGridCandidates = dayHeaderCandidates
    .filter((w) => !sexHeader || w.xCenter > sexHeader.xMax + pageWidth * 0.045)
    .sort((a, b) => a.xCenter - b.xCenter);

  // Split by horizontal spine gaps (> 6.5% of page width) so opposite-page edge slivers never bias rightSlope
  const xClusters: PositionedWord[][] = [];
  for (const cand of rawGridCandidates) {
    const last = xClusters[xClusters.length - 1];
    if (!last || cand.xCenter - last[last.length - 1].xCenter > pageWidth * 0.065) {
      xClusters.push([cand]);
    } else {
      last.push(cand);
    }
  }
  const mainGridClusters = xClusters.filter((grp) => {
    const minX = grp[0].xCenter;
    const maxX = grp[grp.length - 1].xCenter;
    if (maxX < pageWidth * 0.12 && xClusters.length > 1) return false;
    if (isLeftRosterPage && minX > pageWidth * 0.85 && xClusters.length > 1) return false;
    return true;
  });
  const gridDayCandidates =
    mainGridClusters.length > 0 ? mainGridClusters.flat() : rawGridCandidates;

  const rightSlopePoints = gridDayCandidates.map((w) => ({ x: w.xCenter, y: w.yCenter }));
  const rightSlope = fitLinearSlope(rightSlopePoints);

  const yCorrRight = (x: number, y: number) => y - rightSlope * x;
  const yCorr = yCorrRight;

  // Determine exact day-header Y band in tilt-corrected coordinates
  const dayHeaderBaseY =
    gridDayCandidates.length >= 3
      ? computeMedian(gridDayCandidates.map((w) => yCorr(w.xCenter, w.yCenter)))
      : yCorr(headerRefY, headerRefY) + pageHeight * 0.025;

  // Measure left-page row tilt & keystone fan directly from matched serial-number pairs (left S/N vs No. column)
  // Strictly below dayHeaderBaseY so Week header digits ('1', '2', '3') cannot falsely match serial rows.
  const matchedPairs: Array<{
    n: number;
    yMid: number;
    yLeft: number;
    yRight: number;
    xLeft: number;
    xRight: number;
    slope: number;
  }> = [];
  const minSerialRawY = dayHeaderBaseY + pageHeight * 0.022;
  if (noHeader) {
    const noSearchPad = Math.max(16, pageWidth * 0.018);
    const leftNums = words.filter(
      (w) =>
        w.xCenter < pageWidth * 0.16 &&
        w.yCenter > minSerialRawY &&
        /^\d{1,2}$/.test(w.text)
    );
    const rightNums = words.filter(
      (w) =>
        w.xCenter >= noHeader.xMin - noSearchPad &&
        w.xCenter <= noHeader.xMax + noSearchPad &&
        w.yCenter > minSerialRawY &&
        /^\d{1,2}$/.test(w.text)
    );
    for (const ln of leftNums) {
      const rn = rightNums.find(
        (r) =>
          r.text === ln.text &&
          Math.abs(r.yCenter - ln.yCenter) < pageHeight * 0.04 &&
          r.xCenter - ln.xCenter > pageWidth * 0.28
      );
      if (rn) {
        const slope = Math.max(
          -0.12,
          Math.min(0.12, (rn.yCenter - ln.yCenter) / (rn.xCenter - ln.xCenter))
        );
        matchedPairs.push({
          n: Number(ln.text),
          yMid: (ln.yCenter + rn.yCenter) / 2,
          yLeft: ln.yCenter,
          yRight: rn.yCenter,
          xLeft: ln.xCenter,
          xRight: rn.xCenter,
          slope
        });
      }
    }
  }

  const rawMedianSlope =
    matchedPairs.length >= 2
      ? computeMedian(matchedPairs.map((p) => p.slope))
      : rightSlope;
  const cleanPairs = matchedPairs.filter((p) => Math.abs(p.slope - rawMedianSlope) <= 0.035);
  const pairsForFit = cleanPairs.length >= 2 ? cleanPairs : matchedPairs;

  const baseLeftSlope =
    pairsForFit.length >= 2
      ? computeMedian(pairsForFit.map((p) => p.slope))
      : rightSlope;

  // Linear fit of slope vs yMid captures subtle vertical keystone fan across top..bottom rows
  let slopeIntercept = baseLeftSlope;
  let slopeGrad = 0;
  if (pairsForFit.length >= 4) {
    const meanY = pairsForFit.reduce((s, p) => s + p.yMid, 0) / pairsForFit.length;
    const meanS = pairsForFit.reduce((s, p) => s + p.slope, 0) / pairsForFit.length;
    let num = 0;
    let den = 0;
    for (const p of pairsForFit) {
      num += (p.yMid - meanY) * (p.slope - meanS);
      den += (p.yMid - meanY) * (p.yMid - meanY);
    }
    if (den > 100) {
      slopeGrad = Math.max(-0.0002, Math.min(0.0002, num / den));
      slopeIntercept = meanS - slopeGrad * meanY;
    }
  }

  const leftSlopeAtY = (y: number): number =>
    Math.max(-0.12, Math.min(0.12, slopeIntercept + slopeGrad * y));

  const yCorrLeft = (x: number, y: number) => y - leftSlopeAtY(y) * x;

  const cleanDayWords = gridDayCandidates
    .filter((w) => Math.abs(yCorr(w.xCenter, w.yCenter) - dayHeaderBaseY) <= Math.max(18, pageHeight * 0.02))
    .sort((a, b) => a.xCenter - b.xCenter);

  // Expand glued day-header tokens like "MTW" into individual day markers
  const expandedDayTokens: Array<{ idx: number; xCenter: number; glued: boolean }> = [];
  const tokenToIndices = (txt: string): number[] => {
    const up = txt.toUpperCase();
    if (up === 'M') return [0];
    if (up === 'T') return [1];
    if (up === 'W') return [2];
    if (up === 'TH') return [3];
    if (up === 'F') return [4];
    if (up === 'MTW') return [0, 1, 2];
    if (up === 'MTWTH') return [0, 1, 2, 3];
    if (up === 'MT') return [0, 1];
    if (up === 'TW') return [1, 2];
    if (up === 'THF') return [3, 4];
    return [];
  };

  for (const w of cleanDayWords) {
    const idxs = tokenToIndices(w.text);
    if (idxs.length === 1) {
      expandedDayTokens.push({ idx: idxs[0], xCenter: w.xCenter, glued: false });
    } else if (idxs.length > 1) {
      const span = Math.max(1, w.xMax - w.xMin);
      idxs.forEach((dIdx, k) => {
        expandedDayTokens.push({
          idx: dIdx,
          xCenter: w.xMin + ((k + 0.5) / idxs.length) * span,
          glued: true
        });
      });
    }
  }

  // Estimate median single-day spacing from adjacent intact tokens
  const dayDeltas: number[] = [];
  for (let i = 1; i < expandedDayTokens.length; i++) {
    const prev = expandedDayTokens[i - 1];
    const curr = expandedDayTokens[i];
    if (!prev.glued && !curr.glued && curr.idx === prev.idx + 1) {
      const dx = curr.xCenter - prev.xCenter;
      if (dx > pageWidth * 0.01 && dx < pageWidth * 0.16) dayDeltas.push(dx);
    }
  }
  const dayStep = dayDeltas.length > 0 ? computeMedian(dayDeltas) : Math.max(20, pageWidth * 0.025);

  // Group expanded day tokens into Week blocks
  const rawWeekGroups: Array<Array<{ idx: number; xCenter: number }>> = [];
  for (const tok of expandedDayTokens) {
    const lastGrp = rawWeekGroups[rawWeekGroups.length - 1];
    if (!lastGrp) {
      rawWeekGroups.push([tok]);
      continue;
    }
    const prevTok = lastGrp[lastGrp.length - 1];
    const gap = tok.xCenter - prevTok.xCenter;
    if (tok.idx > prevTok.idx && gap < dayStep * 3.8) {
      lastGrp.push(tok);
    } else {
      rawWeekGroups.push([tok]);
    }
  }

  // Filter out narrow edge-sliver blocks from an adjacent page (e.g. Week 4 sliver on far right edge of Left Page)
  const validWeekGroups = rawWeekGroups.filter((grp, gIdx) => {
    const minX = grp[0].xCenter;
    const maxX = grp[grp.length - 1].xCenter;
    if (grp.length < 3 && (minX > pageWidth * 0.88 || maxX < pageWidth * 0.08)) return false;
    if (isLeftRosterPage && gIdx >= 3) {
      const prevGrp = rawWeekGroups[gIdx - 1];
      const spineGap = minX - prevGrp[prevGrp.length - 1].xCenter;
      if (minX > pageWidth * 0.84 || spineGap > dayStep * 3.2) return false;
    }
    return grp.length >= 2;
  });

  const weekColumns: LeaWeekColumn[] = validWeekGroups.map((grp, wIdx) => {
    // Interpolate all 5 days (M..F) cleanly even if 1 header letter was glued/missing
    const anchor = grp.find((g) => g.idx === 0) || grp[0];
    const estimatedM = anchor.xCenter - anchor.idx * dayStep;
    const days = FULL_WEEKDAYS.map((dayName, dIdx) => {
      const exact = grp.find((g) => g.idx === dIdx);
      const xCenter = exact ? exact.xCenter : estimatedM + dIdx * dayStep;
      return { day: dayName, xCenter, dayWidth: dayStep };
    });

    const weekXMin = days[0].xCenter - dayStep * 0.6;
    const weekXMax = days[4].xCenter + dayStep * 0.6;

    // Look above week block for Week Number (1..15) and Week ending date
    const aboveWords = words.filter(
      (w) =>
        w.xCenter >= weekXMin &&
        w.xCenter <= weekXMax &&
        yCorr(w.xCenter, w.yCenter) < dayHeaderBaseY - pageHeight * 0.005 &&
        yCorr(w.xCenter, w.yCenter) > dayHeaderBaseY - pageHeight * 0.075
    );

    const numToken = aboveWords.find((w) => /^\d{1,2}$/.test(w.text) && Number(w.text) >= 1 && Number(w.text) <= 16);
    const defaultWeekNum = isLeftRosterPage ? wIdx + 1 : wIdx + 4;
    const weekNumber = numToken ? Number(numToken.text) : defaultWeekNum;
    const dateToken = aboveWords.find((w) => /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(w.text));

    return {
      weekNumber,
      weekLabel: `Week ${weekNumber}`,
      weekEnding: dateToken ? dateToken.text : null,
      days
    };
  });

  // Extract Class & Term Metadata from top region
  const topYCutoff = dayHeaderBaseY - pageHeight * 0.035;
  const topWords = words.filter((w) => yCorr(w.xCenter, w.yCenter) < topYCutoff);

  let classDetected: string | null = null;
  const classLabel = topWords.find(
    (w) => /^Class$/i.test(w.text) && w.xCenter > pageWidth * 0.25 && w.xCenter < pageWidth * 0.65
  );
  if (classLabel) {
    const labelYC = yCorrLeft(classLabel.xCenter, classLabel.yCenter);
    const nbNote = topWords.find((w) => /N\.?B\.?/i.test(w.text));
    const maxClassX = nbNote ? nbNote.xMin - pageWidth * 0.015 : pageWidth * 0.6;
    const classTokens = topWords
      .filter(
        (w) =>
          w.xMin > classLabel.xMax - pageWidth * 0.004 &&
          w.xMax < maxClassX &&
          Math.abs(yCorrLeft(w.xCenter, w.yCenter) - labelYC) <= Math.max(16, pageHeight * 0.014) &&
          !/^\(?N\.?B\.?\)?$/i.test(w.text) &&
          !/^Department$/i.test(w.text)
      )
      .sort((a, b) => a.xMin - b.xMin)
      .map((w) =>
        w.text
          .replace(/\bfiue\b/gi, 'FIVE')
          .replace(/\bJE\b/g, 'FIVE')
      );
    const joined = classTokens.join(' ').replace(/\(\s*\)/g, '').trim();
    if (joined.length >= 2) classDetected = joined;
  }

  let periodDetected: string | null = null;
  const termWord = topWords.find((w) => /^Term$/i.test(w.text));
  if (termWord) {
    const tYC = yCorr(termWord.xCenter, termWord.yCenter);
    const termTokens = topWords
      .filter(
        (w) =>
          w.xCenter < pageWidth * 0.36 &&
          w.xCenter > (termWord.xMin - pageWidth * 0.14) &&
          Math.abs(yCorr(w.xCenter, w.yCenter) - tYC) <= Math.max(16, pageHeight * 0.015) &&
          !/^(Fees|paid)$/i.test(w.text)
      )
      .sort((a, b) => a.xMin - b.xMin)
      .map((w) => w.text);
    if (termTokens.length > 0) periodDetected = termTokens.join(' ');
  }

  // Estimate row height from vertical spacing between consecutive serial numbers (1..45)
  const serialCandidates: PositionedWord[] = [];
  if (noHeader) {
    const noSearchPad = Math.max(22, pageWidth * 0.028);
    const noMinX = noHeader.xMin - noSearchPad;
    const noMaxX = noHeader.xMax + noSearchPad;
    serialCandidates.push(
      ...words.filter(
        (w) =>
          w.xCenter >= noMinX &&
          w.xCenter <= noMaxX &&
          yCorr(w.xCenter, w.yCenter) >= dayHeaderBaseY + pageHeight * 0.018 &&
          /^\d{1,2}$/.test(w.text) &&
          Number(w.text) >= 1 &&
          Number(w.text) <= 45
      )
    );
  }
  const leftSerialWords = words.filter(
    (w) =>
      w.xCenter < pageWidth * 0.16 &&
      yCorr(w.xCenter, w.yCenter) >= dayHeaderBaseY + pageHeight * 0.018 &&
      /^\d{1,2}$/.test(w.text) &&
      Number(w.text) >= 1 &&
      Number(w.text) <= 45
  );

  const spacingSource = (serialCandidates.length >= 4 ? serialCandidates : leftSerialWords)
    .map((w) => ({ n: Number(w.text), yc: yCorr(w.xCenter, w.yCenter) }))
    .sort((a, b) => a.yc - b.yc);

  const rowDiffs: number[] = [];
  for (let i = 1; i < spacingSource.length; i++) {
    const diff = spacingSource[i].yc - spacingSource[i - 1].yc;
    const stepNum = spacingSource[i].n - spacingSource[i - 1].n;
    if (stepNum >= 1 && stepNum <= 2 && diff > pageHeight * 0.008 && diff < pageHeight * 0.055) {
      rowDiffs.push(diff / stepNum);
    }
  }
  const rowHeight =
    rowDiffs.length > 0 ? computeMedian(rowDiffs) : Math.max(20, dayStep * 1.12);

  // Body top begins below day header & optional "PARENT PHONE/NO" subheader
  const parentPhoneWord = words.find(
    (w) =>
      /^(PARENT|PARGUT|PAREM|PHONE)$/i.test(w.text) &&
      yCorr(w.xCenter, w.yCenter) > dayHeaderBaseY &&
      yCorr(w.xCenter, w.yCenter) < dayHeaderBaseY + rowHeight * 2.5
  );
  const bodyTopY = parentPhoneWord
    ? yCorr(parentPhoneWord.xCenter, parentPhoneWord.yCenter) + rowHeight * 0.65
    : dayHeaderBaseY + rowHeight * 1.9;

  // Extract Strike / Public Holiday vertical annotations across the grid
  const holidayBannerWords = words.filter(
    (w) =>
      yCorr(w.xCenter, w.yCenter) >= bodyTopY - rowHeight * 0.5 &&
      /^(STRIKE|Strukce|N\.?U\.?T\.?|WORKERS|PUBLIC|HOLIDAY|TAAY|Eid|Al|adha|Solidarity|NLC)$/i.test(w.text)
  );
  const holidayWordSet = new Set<PositionedWord>(holidayBannerWords);
  const holidayColumnSet = new Set<string>();
  const detectedHolidayNotes: string[] = [];

  for (const hw of holidayBannerWords) {
    if (!detectedHolidayNotes.includes(hw.text)) detectedHolidayNotes.push(hw.text);
    for (const wk of weekColumns) {
      for (const dc of wk.days) {
        if (hw.xMax >= dc.xCenter - dc.dayWidth * 0.52 && hw.xMin <= dc.xCenter + dc.dayWidth * 0.52) {
          holidayColumnSet.add(`${wk.weekLabel}::${dc.day}`);
        }
      }
    }
  }

  // Build Row Bands (Left Page anchors on NAME/Serials using leftSlopeAtY; Right Page anchors on Grid/TOTAL marks)
  interface RowBand {
    rowNumber: number;
    yc: number;
    ycLeft: number;
    fullName: string | null;
    admissionNumber: string | null;
  }

  const rowBands: RowBand[] = [];

  if (isLeftRosterPage) {
    const leftBodyTopY = parentPhoneWord
      ? yCorrLeft(parentPhoneWord.xCenter, parentPhoneWord.yCenter) + rowHeight * 0.65
      : (nameHeader ? yCorrLeft(nameHeader.xCenter, nameHeader.yCenter) : dayHeaderBaseY) +
        rowHeight * 2.1;

    // Phone / Fees right edge vs NAME column bounds
    const feesHeaderWords = words.filter(
      (w) =>
        /^(Fees|month|PARENT|PARGUT|PAREM|PHONE)$/i.test(w.text) &&
        w.xCenter < (nameHeader?.xMin ?? pageWidth * 0.35) &&
        yCorrLeft(w.xCenter, w.yCenter) > headerRefY - pageHeight * 0.05 &&
        yCorrLeft(w.xCenter, w.yCenter) < leftBodyTopY
    );
    const phoneDigits = words.filter(
      (w) =>
        yCorrLeft(w.xCenter, w.yCenter) >= leftBodyTopY - rowHeight * 0.3 &&
        w.xCenter < (nameHeader?.xCenter ?? pageWidth * 0.35) &&
        /^0[789]\d{4,10}$/.test(w.text.replace(/[^0-9]/g, ''))
    );
    const feesRightEdge = Math.max(
      feesHeaderWords.length > 0 ? Math.max(...feesHeaderWords.map((w) => w.xMax)) : pageWidth * 0.22,
      phoneDigits.length > 0 ? Math.max(...phoneDigits.map((w) => w.xMax)) : pageWidth * 0.22
    );

    const nameLeft = feesRightEdge + pageWidth * 0.008;
    const nameRight = (sexHeader?.xMin ?? admissionHeader?.xMin ?? pageWidth * 0.43) - pageWidth * 0.008;
    const admLeft = nameRight + 1;
    const admRight =
      (ageHeader?.xMin ?? datePromoHeader?.xMin ?? noHeader?.xMin ?? pageWidth * 0.54) -
      pageWidth * 0.005;

    const nameWords = words
      .filter((w) => {
        const yc = yCorrLeft(w.xCenter, w.yCenter);
        if (yc < leftBodyTopY - rowHeight * 0.3 || yc > pageHeight * 0.92) return false;
        if (w.xCenter < nameLeft || w.xCenter > nameRight) return false;
        // Skip phone fragment numbers & Sex M/F drifting near right boundary
        if (/^\d{3,}$/.test(w.text)) return false;
        if (/^[MF]$/i.test(w.text) && w.xCenter > nameRight - pageWidth * 0.045) return false;
        return /[A-Za-z]/.test(w.text);
      })
      .sort((a, b) => yCorrLeft(a.xCenter, a.yCenter) - yCorrLeft(b.xCenter, b.yCenter) || a.xMin - b.xMin);

    // Cluster NAME words into pupil row bands
    const nameClusters: Array<{ yc: number; words: PositionedWord[] }> = [];
    for (const nw of nameWords) {
      const yc = yCorrLeft(nw.xCenter, nw.yCenter);
      const last = nameClusters[nameClusters.length - 1];
      if (!last || Math.abs(yc - last.yc) > rowHeight * 0.55) {
        nameClusters.push({ yc, words: [nw] });
      } else {
        last.words.push(nw);
        last.yc = computeMedian(last.words.map((w) => yCorrLeft(w.xCenter, w.yCenter)));
      }
    }

    // Also include right-page grid anchor from No. column if available for the same row index
    const rightSerialByNum = new Map<number, PositionedWord>();
    serialCandidates.forEach((sc) => {
      const num = Number(sc.text);
      if (num >= 1 && num <= 45 && !rightSerialByNum.has(num)) {
        rightSerialByNum.set(num, sc);
      }
    });

    nameClusters.forEach((cluster) => {
      // Deduplicate accidental double-reads at nearly identical coordinates
      const sorted = [...cluster.words].sort((a, b) => a.xMin - b.xMin);
      const deduped: PositionedWord[] = [];
      for (const w of sorted) {
        const dup = deduped.find(
          (d) =>
            d.text.toUpperCase() === w.text.toUpperCase() &&
            Math.abs(d.xCenter - w.xCenter) < pageWidth * 0.018 &&
            Math.abs(d.yCenter - w.yCenter) < rowHeight * 0.75
        );
        if (!dup) deduped.push(w);
      }

      const fullName = deduped
        .map((w) => w.text)
        .join(' ')
        .replace(/\s+/g, ' ')
        .replace(/^['"`.,-]+|['"`.,-]+$/g, '')
        .replace(/\s+[MF]$/i, '')
        .trim();

      const admTokens = words
        .filter((w) => {
          const yc = yCorrLeft(w.xCenter, w.yCenter);
          return (
            Math.abs(yc - cluster.yc) <= rowHeight * 0.48 &&
            w.xCenter >= admLeft &&
            w.xCenter <= admRight
          );
        })
        .sort((a, b) => a.xMin - b.xMin)
        .map((w) => w.text);

      const admNumber = cleanGluedAdmissionNumber(admTokens);
      // Skip bleed-through / isolated 2-3 char ghost fragments with no admission number
      if (fullName.length <= 3 && !admNumber) return;
      if (fullName === fullName.toLowerCase() && fullName.length <= 4 && !admNumber) return;

      const matchedLeftSn = leftSerialWords.find(
        (w) => Math.abs(yCorrLeft(w.xCenter, w.yCenter) - cluster.yc) <= rowHeight * 0.48
      );
      const matchedRightSn = serialCandidates.find(
        (w) => Math.abs(yCorrLeft(w.xCenter, w.yCenter) - cluster.yc) <= rowHeight * 0.52
      );
      const printedNum = Number(matchedLeftSn?.text || matchedRightSn?.text || 0);
      const prevRowNum = rowBands.length > 0 ? rowBands[rowBands.length - 1].rowNumber : 0;
      const rowNumber =
        printedNum >= 1 &&
        printedNum <= 45 &&
        printedNum > prevRowNum &&
        printedNum - prevRowNum <= 6
          ? printedNum
          : prevRowNum + 1;

      const rightSer = rightSerialByNum.get(rowNumber);
      const anchorWord = deduped[deduped.length - 1] || cluster.words[0];
      const gridYc = rightSer
        ? yCorrRight(rightSer.xCenter, rightSer.yCenter)
        : yCorrRight(
            anchorWord.xCenter,
            cluster.yc + leftSlopeAtY(anchorWord.yCenter) * anchorWord.xCenter
          );

      rowBands.push({
        rowNumber,
        yc: gridYc,
        ycLeft: cluster.yc,
        fullName: fullName || null,
        admissionNumber: admNumber
      });
    });
  } else {
    // Right-hand Grid Page (Weeks 4-7 + TOTAL): cluster populated mark rows across grid & TOTAL
    const gridMinX = weekColumns.length > 0 ? weekColumns[0].days[0].xCenter - dayStep : pageWidth * 0.1;
    const gridMaxX = totalHeader ? totalHeader.xMax + pageWidth * 0.18 : pageWidth * 0.96;

    const markRowWords = words
      .filter((w) => {
        const yc = yCorr(w.xCenter, w.yCenter);
        if (yc < bodyTopY - rowHeight * 0.35 || yc > pageHeight * 0.92) return false;
        if (w.xCenter < gridMinX || w.xCenter > gridMaxX) return false;
        if (holidayWordSet.has(w)) return false;
        return /[0oODV/\\✓✔\d]/.test(w.text);
      })
      .sort((a, b) => yCorr(a.xCenter, a.yCenter) - yCorr(b.xCenter, b.yCenter));

    const markClusters: Array<{ yc: number; words: PositionedWord[] }> = [];
    for (const mw of markRowWords) {
      const yc = yCorr(mw.xCenter, mw.yCenter);
      const last = markClusters[markClusters.length - 1];
      if (!last || Math.abs(yc - last.yc) > rowHeight * 0.55) {
        markClusters.push({ yc, words: [mw] });
      } else {
        last.words.push(mw);
        last.yc = computeMedian(last.words.map((w) => yCorr(w.xCenter, w.yCenter)));
      }
    }

    markClusters.forEach((cluster) => {
      const matchedSn = serialCandidates.find(
        (w) => Math.abs(yCorr(w.xCenter, w.yCenter) - cluster.yc) <= rowHeight * 0.48
      );
      const printedNum = Number(matchedSn?.text || 0);
      const prevRowNum = rowBands.length > 0 ? rowBands[rowBands.length - 1].rowNumber : 0;
      const rowNumber =
        printedNum >= 1 &&
        printedNum <= 45 &&
        printedNum > prevRowNum &&
        printedNum - prevRowNum <= 6
          ? printedNum
          : prevRowNum + 1;

      rowBands.push({
        rowNumber,
        yc: cluster.yc,
        ycLeft: cluster.yc,
        fullName: null,
        admissionNumber: null
      });
    });
  }

  if (rowBands.length === 0) return null;

  // Map every symbol in non-holiday grid words to (rowBand, week, day)
  const gridLeftX = weekColumns.length > 0 ? weekColumns[0].days[0].xCenter - dayStep : pageWidth;
  const gridRightX =
    weekColumns.length > 0
      ? weekColumns[weekColumns.length - 1].days[4].xCenter + dayStep
      : pageWidth;

  const gridSymbols: PositionedSymbol[] = [];
  for (const w of words) {
    if (holidayWordSet.has(w)) continue;
    if (w.xMax < gridLeftX || w.xMin > gridRightX) continue;
    const yc = yCorr(w.xCenter, w.yCenter);
    if (yc < bodyTopY - rowHeight * 0.45 || yc > pageHeight * 0.95) continue;
    for (const sym of w.symbols) {
      gridSymbols.push(sym);
    }
  }

  let presentCount = 0;
  let absentCount = 0;
  let blankCount = 0;
  let uncertainCount = 0;

  const rows: GeminiExtractionResult['rows'] = rowBands.map((rb) => {
    const marks: GeminiExtractionResult['rows'][number]['marks'] = [];

    for (const wk of weekColumns) {
      for (const dc of wk.days) {
        const key = `${wk.weekLabel}::${dc.day}`;
        if (holidayColumnSet.has(key)) {
          blankCount += 1;
          marks.push({
            week: wk.weekLabel,
            day: dc.day,
            status: 'BLANK',
            rawSymbol: 'HOLIDAY',
            notes: 'Strike / Public Holiday noted in register column'
          });
          continue;
        }

        const cellSyms = gridSymbols.filter((s) => {
          const syc = yCorr(s.xCenter, s.yCenter);
          return (
            Math.abs(syc - rb.yc) <= rowHeight * 0.44 &&
            Math.abs(s.xCenter - dc.xCenter) <= dc.dayWidth * 0.48
          );
        });

        const symText = cellSyms.map((s) => s.text).join('');
        const hasAbsent = /[0oOD]/.test(symText);
        const hasPresent = /[/\\✓✔VvY]/.test(symText);

        if (hasAbsent && !hasPresent) {
          absentCount += 1;
          marks.push({
            week: wk.weekLabel,
            day: dc.day,
            status: 'ABSENT',
            rawSymbol: '00',
            notes: null
          });
        } else if (hasPresent && !hasAbsent) {
          presentCount += 1;
          marks.push({
            week: wk.weekLabel,
            day: dc.day,
            status: 'PRESENT',
            rawSymbol: 'V',
            notes: null
          });
        } else if (hasAbsent && hasPresent) {
          uncertainCount += 1;
          marks.push({
            week: wk.weekLabel,
            day: dc.day,
            status: 'UNCERTAIN',
            rawSymbol: symText,
            isCorrectionOrOverwritten: true,
            notes: `Conflicting marks (${symText}) detected in cell — verify`
          });
        } else {
          uncertainCount += 1;
          marks.push({
            week: wk.weekLabel,
            day: dc.day,
            status: 'UNCERTAIN',
            rawSymbol: '?',
            notes: 'Pen check-tick (V) not read as text by OCR — verify Present vs Blank'
          });
        }
      }
    }

    // Fallback single-day mark if no week columns were visible on a roster-only crop
    if (marks.length === 0) {
      const fallbackDay = resolveSchoolWeekday(targetDate);
      blankCount += 1;
      marks.push({
        week: 'Week 1',
        day: fallbackDay,
        status: 'BLANK',
        rawSymbol: '',
        notes: 'No attendance grid columns visible on this sheet'
      });
    }

    const rowUncertain = marks.some((m) => m.status === 'UNCERTAIN');
    return {
      rowNumber: rb.rowNumber,
      studentNameDetected: rb.fullName,
      admissionNumberDetected: rb.admissionNumber,
      marks,
      uncertaintyNotes: rowUncertain
        ? 'Some check-tick (V) cells need quick visual confirmation (Cloud Vision reads 00 absent marks & headers reliably while pen strokes may require review).'
        : null
    };
  });

  const students = rowBands
    .filter((rb) => Boolean(rb.fullName))
    .map((rb) => ({
      studentNumber: rb.rowNumber,
      fullName: rb.fullName!,
      admissionNumber: rb.admissionNumber
    }));

  const detectedWeeks = weekColumns.map((w) => w.weekLabel);
  const layoutNotesParts = [
    `LEA Primary Register (${isLeftRosterPage ? 'Left Roster + Grid Page' : 'Right Multi-Week Grid Page'}) parsed via Google Cloud Vision bounding boxes.`,
    `${rowBands.length} populated pupil row(s) aligned across ${weekColumns.length} week block(s).`
  ];
  if (detectedHolidayNotes.length > 0) {
    layoutNotesParts.push(`Strike/Holiday notes detected: ${detectedHolidayNotes.join(', ')}.`);
  }
  if (uncertainCount > 0) {
    layoutNotesParts.push(
      'Absent marks (00) and holidays were detected automatically; cells marked "?" had faint/diagonal pen check-ticks (V) not emitted as text by OCR and require confirmation.'
    );
  }

  return {
    classDetected,
    periodDetected,
    isLeftRosterPage,
    students,
    attendance: {
      schoolIdentified: null,
      classIdentified: classDetected || targetClassName || null,
      periodIdentified: periodDetected || targetDate || detectedWeeks.join(', '),
      layoutNotes: layoutNotesParts.join(' '),
      layoutQuality: {
        pageBoundariesDetected: true,
        tableBoundariesDetected: true,
        detectedWeeks,
        uncertainHeadings: [],
        layoutTooDistorted: false,
        retakeOrCropAdvice: null
      },
      gridGeometry: {
        pageWidth,
        pageHeight,
        rightSlope,
        rowHeight,
        dayHeaderBaseY,
        bodyTopY,
        isLeftRosterPage,
        rows: rowBands.map((rb) => ({
          rowNumber: rb.rowNumber,
          yCenterAtZeroX: rb.yc
        })),
        weeks: weekColumns.map((wk) => ({
          weekLabel: wk.weekLabel,
          days: wk.days.map((d) => ({
            day: d.day,
            xCenter: d.xCenter,
            dayWidth: d.dayWidth
          }))
        }))
      },
      totalRowsDetected: rows.length,
      detectedDays: FULL_WEEKDAYS,
      rows,
      ambiguityDetected: uncertainCount > 0,
      summaryStatistics: {
        presentCount,
        absentCount,
        blankCount,
        uncertainCount
      },
      overallConfidence: students.length > 0 || absentCount > 0 ? 'MEDIUM' : 'LOW',
      disclaimer: 'Extracted using Google Cloud Vision API. Verification required by school administrator.'
    }
  };
}

/**
 * Parses OCR text from Google Cloud Vision into structured attendance format.
 */
export function parseVisionOCRToAttendance(
  fullText: string,
  targetClassName?: string,
  targetDate?: string,
  _targetPeriod?: string
): GeminiExtractionResult {
  const resolvedWeekday = resolveSchoolWeekday(targetDate);
  const lines = fullText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  let schoolIdentified: string | null = null;
  let classIdentified: string | null = null;
  let periodIdentified: string | null = null;

  for (const line of lines) {
    const upper = line.toUpperCase();
    if (!schoolIdentified && (upper.includes('L.E.A') || upper.includes('PRIMARY SCHOOL') || upper.includes('ACADEMY'))) {
      schoolIdentified = line;
    }
    if (!classIdentified && (upper.includes('CLASS:') || upper.includes('PRIMARY ') || upper.includes('GRADE '))) {
      classIdentified = line;
    }
    if (!periodIdentified && (upper.includes('TERM') || upper.includes('SESSION') || upper.includes('DATE:'))) {
      periodIdentified = line;
    }
  }

  const rows: GeminiExtractionResult['rows'] = [];
  let rowCounter = 1;

  for (const line of lines) {
    const lineMatch = line.match(/^(\d+)[.):\-\s]+(.+)$/);

    if (lineMatch) {
      const rowNum = parseInt(lineMatch[1], 10);
      let remaining = lineMatch[2].trim();
      const remainingUpper = remaining.toUpperCase();

      if (
        remainingUpper.includes('ATTENDANCE REGISTER') ||
        remainingUpper.includes('PUPIL FULL NAME') ||
        remainingUpper.includes('STUDENT NAME') ||
        remainingUpper.includes('FULL NAME') ||
        remainingUpper.includes('ADMISSION NO') ||
        /^CLASS\s*:/i.test(remaining) ||
        remainingUpper.startsWith('WEEK ')
      ) {
        continue;
      }

      const markTokens: string[] = [];
      const singleTrailingMarkRegex = /\s+([/\\✓✔0OX?]+|present|absent|uncertain|sick(?:\s*\/\s*illness)?)$/i;
      while (true) {
        const m = remaining.match(singleTrailingMarkRegex);
        if (!m) break;
        markTokens.unshift(m[1].trim());
        remaining = remaining.slice(0, remaining.length - m[0].length).trim();
      }
      const rest = markTokens.join(' ').trim();
      const restLower = rest.toLowerCase();

      let admNo: string | undefined;
      const admMatch = remaining.match(
        /\s+(LEA\/[0-9A-Za-z/-]+|[A-Z]{2,}(?:\/[A-Z0-9-]+)+|[A-Z]{2,}[/-]?[0-9]{2,}[A-Z0-9/-]*)$/i
      );
      if (admMatch) {
        admNo = admMatch[1].trim();
        remaining = remaining.slice(0, remaining.length - admMatch[0].length).trim();
      }

      if (!/^[A-Za-z]/.test(remaining)) {
        continue;
      }
      const studentName = remaining.replace(/\s+/g, ' ').trim();

      let markStatus: MarkStatus = 'UNCERTAIN';
      let rawSymbol = '?';
      let notes: string | null = 'No clear attendance mark symbol detected by OCR — please verify';

      if (
        /(?:^|\s)(0|O|X)(?:\s|$)/i.test(rest) ||
        restLower.includes('absent') ||
        restLower.includes('sick') ||
        rest.includes('0')
      ) {
        markStatus = 'ABSENT';
        rawSymbol = rest.toUpperCase().includes('X') ? 'X' : '0';
        notes = restLower.includes('sick') ? 'Sick / Illness' : null;
      } else if (rest.includes('?') || restLower.includes('uncertain')) {
        markStatus = 'UNCERTAIN';
        rawSymbol = '?';
        notes = 'Ambiguous mark detected in OCR text';
      } else if (
        rest.includes('/') ||
        rest.includes('\\') ||
        rest.includes('✓') ||
        rest.includes('✔') ||
        restLower.includes('present')
      ) {
        markStatus = 'PRESENT';
        rawSymbol = rest.includes('\\') ? '\\' : rest.includes('✓') || rest.includes('✔') ? '✓' : '/';
        notes = null;
      } else if (rest.length === 0) {
        markStatus = 'BLANK';
        rawSymbol = '';
        notes = 'No mark detected next to pupil entry';
      }

      rows.push({
        rowNumber: rowNum || rowCounter++,
        studentNameDetected: studentName,
        admissionNumberDetected: admNo || null,
        marks: [
          {
            week: 'Week 1',
            day: resolvedWeekday,
            status: markStatus,
            rawSymbol,
            notes
          }
        ],
        uncertaintyNotes: markStatus === 'UNCERTAIN' ? notes : null
      });
    }
  }

  if (rows.length === 0) {
    const studentLineCandidates = lines.filter((line) => {
      const upper = line.toUpperCase();
      return (
        !upper.includes('OFFICIAL') &&
        !upper.includes('ATTENDANCE REGISTER') &&
        !upper.includes('PUPIL FULL NAME') &&
        !upper.includes('STUDENT NAME') &&
        !upper.includes('ADMISSION NO') &&
        !upper.includes('S/N') &&
        !upper.includes('TEACHER') &&
        line.length > 3
      );
    });

    studentLineCandidates.forEach((line, idx) => {
      let markStatus: MarkStatus = 'PRESENT';
      let rawSymbol = '/';
      let cleanName = line;

      if (line.includes(' 0') || line.endsWith('0')) {
        markStatus = 'ABSENT';
        rawSymbol = '0';
        cleanName = line.replace(/\s*0\s*$/, '').trim();
      } else if (line.includes(' /') || line.endsWith('/')) {
        markStatus = 'PRESENT';
        rawSymbol = '/';
        cleanName = line.replace(/\s*\/\s*$/, '').trim();
      }

      rows.push({
        rowNumber: idx + 1,
        studentNameDetected: cleanName,
        admissionNumberDetected: null,
        marks: [
          {
            week: 'Week 1',
            day: resolvedWeekday,
            status: markStatus,
            rawSymbol
          }
        ]
      });
    });
  }

  const presentCount = rows.filter((r) => r.marks[0]?.status === 'PRESENT').length;
  const absentCount = rows.filter((r) => r.marks[0]?.status === 'ABSENT').length;
  const uncertainCount = rows.filter((r) => r.marks[0]?.status === 'UNCERTAIN').length;
  const blankCount = rows.filter((r) => r.marks[0]?.status === 'BLANK').length;

  return {
    schoolIdentified: schoolIdentified || null,
    classIdentified: classIdentified || targetClassName || null,
    periodIdentified: periodIdentified || targetDate || resolvedWeekday,
    layoutNotes: `Parsed via Google Cloud Vision Document Text OCR (${lines.length} text lines detected).`,
    totalRowsDetected: rows.length,
    detectedDays: [resolvedWeekday],
    rows,
    ambiguityDetected: uncertainCount > 0,
    summaryStatistics: {
      presentCount,
      absentCount,
      blankCount,
      uncertainCount
    },
    overallConfidence: rows.length > 0 ? 'HIGH' : 'LOW',
    disclaimer: 'Extracted using Google Cloud Vision API. Verification required by school administrator.'
  };
}

/**
 * Parses Google Cloud Vision OCR text into a student enrollment roster list.
 */
export function parseVisionOCRToRoster(fullText: string): {
  classDetected: string | null;
  students: Array<{ studentNumber: number; fullName: string; admissionNumber: string | null }>;
} {
  const lines = fullText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  let classDetected: string | null = null;
  const students: Array<{ studentNumber: number; fullName: string; admissionNumber: string | null }> = [];
  let seq = 1;

  for (const line of lines) {
    const upper = line.toUpperCase();
    if (!classDetected && (/^CLASS\s*:/i.test(line) || upper.includes('PRIMARY ') || upper.includes('GRADE '))) {
      classDetected = line.replace(/^CLASS\s*:\s*/i, '').trim();
    }

    if (
      upper.includes('ATTENDANCE REGISTER') ||
      upper.includes('PUPIL FULL NAME') ||
      upper.includes('STUDENT NAME') ||
      upper.includes('FULL NAME') ||
      upper.includes('ADMISSION NO') ||
      upper === 'S/N' ||
      upper.startsWith('S/N ') ||
      upper.startsWith('TOTAL') ||
      /^CLASS\s*:/i.test(line)
    ) {
      continue;
    }

    const snMatch = line.match(
      /^(\d+)[.):\-\s]+([A-Za-z][A-Za-z\s'.-]{1,}?)(?:\s+([A-Z]{2,}(?:\/[A-Z0-9-]+)+|[A-Z0-9]{2,}[/-][0-9A-Z/-]{2,}))?(?:\s+(?:[/\\0OX?✓\s]+))?$/i
    );

    if (snMatch) {
      const studentNumber = parseInt(snMatch[1], 10) || seq;
      const fullName = snMatch[2].replace(/\s+/g, ' ').trim();
      const admissionNumber = snMatch[3] ? snMatch[3].trim() : null;
      if (fullName.length >= 2) {
        students.push({ studentNumber, fullName, admissionNumber });
        seq = studentNumber + 1;
      }
      continue;
    }

    // Also match unnumbered name + optional admission number lines if clearly a person's name
    const nameMatch = line.match(
      /^([A-Za-z][A-Za-z'.-]+(?:\s+[A-Za-z][A-Za-z'.-]+){1,4})(?:\s+([A-Z]{2,}(?:\/[A-Z0-9-]+)+|[A-Z0-9]{2,}[/-][0-9A-Z/-]{2,}))?$/
    );
    if (nameMatch && !upper.includes('PRIMARY SCHOOL') && !upper.includes('TERM') && !upper.includes('SESSION')) {
      const fullName = nameMatch[1].replace(/\s+/g, ' ').trim();
      const admissionNumber = nameMatch[2] ? nameMatch[2].trim() : null;
      students.push({ studentNumber: seq++, fullName, admissionNumber });
    }
  }

  return { classDetected, students };
}

async function runVisionDocumentTextDetection(imageBuffer: Buffer): Promise<{
  ok: boolean;
  fullText?: string;
  reconstructedText?: string;
  annotation?: any;
  error?: string;
  code?: string;
  billingUrl?: string;
}> {
  const apiKey = getCloudVisionApiKey();
  const creds = getServiceAccountCredentials();

  // 1. Prefer API Key REST v1 endpoint if GOOGLE_CLOUD_VISION_API_KEY is configured
  if (apiKey) {
    try {
      const endpoint = `https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(apiKey)}`;
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [
            {
              image: { content: imageBuffer.toString('base64') },
              features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
              imageContext: { languageHints: ['en'] }
            }
          ]
        })
      });

      const payload: any = await resp.json().catch(() => ({}));

      if (!resp.ok) {
        const apiErr = payload?.error || {};
        const message = apiErr?.message || `Google Cloud Vision REST request failed (${resp.status}).`;
        if (resp.status === 403 && message.toLowerCase().includes('billing')) {
          return {
            ok: false,
            code: 'GCP_BILLING_REQUIRED',
            error: message,
            billingUrl: 'https://console.cloud.google.com/billing'
          };
        }
        if (resp.status === 400 || resp.status === 403) {
          return {
            ok: false,
            code: 'API_KEY_INVALID',
            error: message
          };
        }
        return {
          ok: false,
          code: 'GCP_VISION_ERROR',
          error: message
        };
      }

      const firstResp = Array.isArray(payload?.responses) ? payload.responses[0] : undefined;
      if (firstResp?.error) {
        return {
          ok: false,
          code: firstResp.error.code ? String(firstResp.error.code) : 'GCP_VISION_ERROR',
          error: firstResp.error.message || 'Google Cloud Vision returned an error processing this image.'
        };
      }

      const annotation = firstResp?.fullTextAnnotation;
      const rawText = annotation?.text || '';
      const reconstructedText = reconstructRowsFromVisionAnnotation(annotation);

      return {
        ok: true,
        fullText: rawText,
        reconstructedText: reconstructedText || rawText,
        annotation
      };
    } catch (err: any) {
      return {
        ok: false,
        code: 'GCP_VISION_NETWORK_ERROR',
        error: err?.message || 'Network error while contacting Google Cloud Vision API.'
      };
    }
  }

  // 2. Fallback to Service Account client if credentials/google-vision-key.json is present
  const client = getVisionClient();
  if (!client || !creds) {
    return {
      ok: false,
      code: 'NO_CREDENTIALS',
      error: 'Google Cloud Vision API key or service account is not configured.'
    };
  }

  try {
    const [result] = await client.documentTextDetection({
      image: { content: imageBuffer },
      imageContext: { languageHints: ['en'] }
    });

    const annotation = result.fullTextAnnotation;
    const rawText = annotation?.text || '';
    const reconstructedText = reconstructRowsFromVisionAnnotation(annotation);

    return {
      ok: true,
      fullText: rawText,
      reconstructedText: reconstructedText || rawText,
      annotation
    };
  } catch (err: any) {
    console.error('Google Cloud Vision execution error:', err?.message || err);

    if (err?.code === 7 || err?.message?.includes('billing to be enabled')) {
      const projectId = creds.project_id;
      return {
        ok: false,
        code: 'GCP_BILLING_REQUIRED',
        error: `Google Cloud Vision API authenticated with service account (${creds.client_email}), but requires billing to be enabled on Google Cloud Project "${projectId}".`,
        billingUrl: `https://console.developers.google.com/billing/enable?project=${projectId}`
      };
    }

    return {
      ok: false,
      code: err?.code ? String(err.code) : 'GCP_VISION_ERROR',
      error: err?.message || 'Error occurred during Google Cloud Vision document text detection.'
    };
  }
}

export async function processWithGoogleCloudVision(
  imageBuffer: Buffer,
  className?: string,
  date?: string,
  period?: string
): Promise<{ ok: boolean; data?: GeminiExtractionResult; rawText?: string; error?: string; code?: string; billingUrl?: string }> {
  const ocrResult = await runVisionDocumentTextDetection(imageBuffer);
  if (!ocrResult.ok) {
    return {
      ok: false,
      code: ocrResult.code,
      error: ocrResult.error,
      billingUrl: ocrResult.billingUrl
    };
  }

  const leaParsed = parseLeaRegisterFromAnnotation(ocrResult.annotation, className, date);
  const parsedData =
    leaParsed?.attendance ||
    parseVisionOCRToAttendance(
      ocrResult.reconstructedText || ocrResult.fullText || '',
      className,
      date,
      period
    );

  return {
    ok: true,
    data: parsedData,
    rawText: ocrResult.reconstructedText || ocrResult.fullText || ''
  };
}

export async function extractRosterWithGoogleCloudVision(
  imageBuffer: Buffer
): Promise<{
  ok: boolean;
  classDetected?: string | null;
  students?: Array<{ studentNumber: number; fullName: string; admissionNumber: string | null }>;
  rawText?: string;
  error?: string;
  code?: string;
}> {
  const ocrResult = await runVisionDocumentTextDetection(imageBuffer);
  if (!ocrResult.ok) {
    return {
      ok: false,
      code: ocrResult.code,
      error: ocrResult.error
    };
  }

  const leaParsed = parseLeaRegisterFromAnnotation(ocrResult.annotation);
  if (leaParsed) {
    if (!leaParsed.isLeftRosterPage) {
      return {
        ok: false,
        code: 'ROSTER_COLUMNS_NOT_FOUND',
        error:
          'This looks like a right-hand attendance grid page (Weeks 4–7) without the student names column. Please scan the left-hand register page containing the NAME and Admission Number columns.'
      };
    }
    if (leaParsed.students.length > 0) {
      return {
        ok: true,
        classDetected: leaParsed.classDetected,
        students: leaParsed.students,
        rawText: ocrResult.reconstructedText || ocrResult.fullText || ''
      };
    }
  }

  const parsed = parseVisionOCRToRoster(ocrResult.reconstructedText || ocrResult.fullText || '');
  return {
    ok: true,
    classDetected: parsed.classDetected,
    students: parsed.students,
    rawText: ocrResult.reconstructedText || ocrResult.fullText || ''
  };
}
