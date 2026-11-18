import type {
  DayOfWeek,
  GeminiExtractionMark,
  GeminiExtractionResult,
  GeminiExtractionRow,
  LeaGridGeometry,
  MarkStatus
} from '../types/attendance';

export interface RgbaVerificationInput {
  rgba: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
  extraction: GeminiExtractionResult;
}

interface HorizontalBand {
  leftTopY: number;
  leftBotY: number;
  rightTopY: number;
  rightBotY: number;
}

interface CellPixelMetrics {
  inkRatio: number;
  inkCount: number;
  redRatioAll: number;
  multiRunFrac: number;
  enclosedHoles: number;
  spanYFrac: number;
  leftHalfRuns: number;
  rightHalfRuns: number;
  bottomCenterFrac: number;
}

function clampInt(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v | 0;
}

function medianSorted(arr: number[]): number {
  if (arr.length === 0) return 0;
  const mid = arr.length >> 1;
  return arr.length % 2 === 1 ? arr[mid] : (arr[mid - 1] + arr[mid]) * 0.5;
}

/**
 * Computes luminance (0..255) quickly from an RGBA byte buffer.
 */
function sampleLum(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number
): number {
  const ix = clampInt(Math.round(x), 0, width - 1);
  const iy = clampInt(Math.round(y), 0, height - 1);
  const idx = (iy * width + ix) << 2;
  return 0.299 * rgba[idx] + 0.587 * rgba[idx + 1] + 0.114 * rgba[idx + 2];
}

/**
 * Checks if a pixel has reddish ballpoint/pen ink (used for vertical strike & holiday rulings).
 */
function isRedInkPixel(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number
): boolean {
  const ix = clampInt(Math.round(x), 0, width - 1);
  const iy = clampInt(Math.round(y), 0, height - 1);
  const idx = (iy * width + ix) << 2;
  const r = rgba[idx];
  const g = rgba[idx + 1];
  const b = rgba[idx + 2];
  return r - b > 20 && r - g > 10 && r > 70;
}

/**
 * Detects horizontal printed gridlines in a vertical column slice [xMin..xMax] using
 * the horizontal median luminance along small local slope segments.
 */
function detectHalfGridlines(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  xMin: number,
  xMax: number,
  slope: number,
  dayHeaderY0: number,
  approxRowH: number
): { headerBottomY: number; row1BottomY: number; stepY: number; lines: number[] } {
  const midX = (xMin + xMax) * 0.5;
  const yStart = clampInt(Math.round(dayHeaderY0 + slope * midX), 4, height - 12);
  const maxSpan = Math.round(approxRowH * 28);
  const yEnd = clampInt(yStart + maxSpan, yStart + 20, height - 6);

  const len = yEnd - yStart + 1;
  const rowMed = new Float32Array(len);
  const scratch: number[] = [];
  const xStep = Math.max(2, Math.floor((xMax - xMin) / 48));

  for (let i = 0; i < len; i++) {
    const yBase = yStart + i;
    scratch.length = 0;
    for (let x = xMin; x <= xMax; x += xStep) {
      scratch.push(sampleLum(rgba, width, height, x, yBase + slope * (x - midX)));
    }
    scratch.sort((a, b) => a - b);
    rowMed[i] = scratch[scratch.length >> 1] || 180;
  }

  // Require peak separation >= 0.72 * approxRowH so handwritten ink inside rows never splits a rule
  const rawPeaks: number[] = [];
  const win = Math.max(4, Math.min(8, Math.round(approxRowH * 0.16)));
  for (let i = win; i < len - win; i++) {
    const bgLeft = Math.max(rowMed[i - win], rowMed[i - win + 1]);
    const bgRight = Math.max(rowMed[i + win - 1], rowMed[i + win]);
    const bg = Math.max(bgLeft, bgRight);
    if (
      rowMed[i] < bg - 9 &&
      rowMed[i] <= rowMed[i - 1] &&
      rowMed[i] <= rowMed[i + 1]
    ) {
      const absY = yStart + i;
      if (rawPeaks.length === 0 || absY - rawPeaks[rawPeaks.length - 1] > approxRowH * 0.72) {
        rawPeaks.push(absY);
      } else if (rowMed[i] < rowMed[rawPeaks[rawPeaks.length - 1] - yStart]) {
        rawPeaks[rawPeaks.length - 1] = absY;
      }
    }
  }

  // Anchor header bottom rule (strong dark rule shortly below dayHeaderBaseY)
  const hdrMaxY = yStart + approxRowH * 1.15;
  let headerBottomY = yStart + approxRowH * 0.45;
  let bestHdrLum = 255;
  for (const p of rawPeaks) {
    if (p >= yStart + 2 && p <= hdrMaxY) {
      const l = rowMed[p - yStart];
      if (l < bestHdrLum) {
        bestHdrLum = l;
        headerBottomY = p;
      }
    }
  }

  // Refine rowStep from regular consecutive peak intervals below headerBottomY
  const postHdrPeaks = rawPeaks.filter((p) => p > headerBottomY + approxRowH * 1.4);
  const diffs: number[] = [];
  for (let i = 1; i < postHdrPeaks.length; i++) {
    const d = postHdrPeaks[i] - postHdrPeaks[i - 1];
    if (d >= approxRowH * 0.74 && d <= approxRowH * 1.38) {
      diffs.push(d);
    }
  }
  const stepY = diffs.length >= 2 ? medianSorted([...diffs].sort((a, b) => a - b)) : approxRowH;

  // Row 1 bottom sits ~2.20 * stepY below header bottom (skipping subheader / PARENT PHONE band)
  const expectedRow1Bot = headerBottomY + stepY * 2.2;
  const nearR1 = rawPeaks.find((p) => Math.abs(p - expectedRow1Bot) <= stepY * 0.48);
  const row1BottomY = nearR1 ?? expectedRow1Bot;

  return {
    headerBottomY,
    row1BottomY,
    stepY,
    lines: rawPeaks
  };
}

/**
 * Snaps a clean sequential horizontal rule chain starting at Row 1 for one side (left or right) of the grid.
 */
function buildSingleSideLattice(
  info: { headerBottomY: number; row1BottomY: number; stepY: number; lines: number[] },
  maxRows: number
): Array<{ topY: number; botY: number }> {
  const { row1BottomY, stepY, lines } = info;
  const res: Array<{ topY: number; botY: number }> = [];

  let curBot = row1BottomY;
  const r1TopCand = lines.find((l) => Math.abs(l - (curBot - stepY)) <= stepY * 0.28);
  let curTop = r1TopCand ?? curBot - stepY;
  let localStep = curBot - curTop;
  if (localStep < stepY * 0.75 || localStep > stepY * 1.28) {
    localStep = stepY;
    curTop = curBot - localStep;
  }
  res.push({ topY: curTop, botY: curBot });

  for (let r = 2; r <= maxRows; r++) {
    const nextTop = curBot;
    const expectedBot = nextTop + localStep;
    const snapped = lines.find((l) => Math.abs(l - expectedBot) <= localStep * 0.28);
    const nextBot = snapped ?? expectedBot;
    if (snapped) {
      const obs = nextBot - nextTop;
      if (obs >= stepY * 0.78 && obs <= stepY * 1.32) {
        localStep = localStep * 0.55 + obs * 0.45;
      }
    }
    res.push({ topY: nextTop, botY: nextBot });
    curTop = nextTop;
    curBot = nextBot;
  }

  return res;
}

/**
 * Inspects a single weekday cell interior in O(W*H) zero-allocation CPU time:
 * - Uses a 256-bin histogram for exact 85th-percentile paper luminance.
 * - Masks continuous printed vertical gridlines (border + center divider).
 * - Measures interior ink density, vertical span, enclosed vertical holes (for '00' detection), and horizontal runs.
 */
function inspectCellPixels(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  xCenter: number,
  dayWidth: number,
  yTop: number,
  yBot: number
): CellPixelMetrics {
  const rowH = Math.max(10, yBot - yTop);
  const padY = Math.max(2, Math.round(rowH * 0.16));
  const iy0 = clampInt(Math.round(yTop + padY), 0, height - 1);
  const iy1 = clampInt(Math.round(yBot - padY), iy0 + 1, height - 1);

  const halfW = dayWidth * 0.43;
  const x0 = clampInt(Math.round(xCenter - halfW), 0, width - 1);
  const x1 = clampInt(Math.round(xCenter + halfW), x0 + 2, width - 1);

  const colCount = x1 - x0 + 1;
  const rowCount = iy1 - iy0 + 1;
  const totSamples = colCount * rowCount;

  if (totSamples < 16) {
    return {
      inkRatio: 0,
      inkCount: 0,
      redRatioAll: 0,
      multiRunFrac: 0,
      enclosedHoles: 0,
      spanYFrac: 0,
      leftHalfRuns: 0,
      rightHalfRuns: 0,
      bottomCenterFrac: 0
    };
  }

  // 256-bin histogram (zero array sort allocation) + unmasked red-ink count for holiday ruling detection
  const hist = new Uint16Array(256);
  const lums = new Float32Array(totSamples);
  let redAll = 0;
  let k = 0;

  for (let y = iy0; y <= iy1; y++) {
    const rowOff = y * width;
    for (let x = x0; x <= x1; x++) {
      const idx = (rowOff + x) << 2;
      const r = rgba[idx];
      const g = rgba[idx + 1];
      const b = rgba[idx + 2];
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      lums[k++] = l;
      hist[l < 0 ? 0 : l > 255 ? 255 : l | 0]++;
      if (r - b > 20 && r - g > 10 && r > 70) {
        redAll++;
      }
    }
  }

  let cum = 0;
  let paperLum = 200;
  const target85 = Math.floor(totSamples * 0.85);
  for (let b = 0; b < 256; b++) {
    cum += hist[b];
    if (cum >= target85) {
      paperLum = b;
      break;
    }
  }
  const inkThresh = Math.max(18, paperLum * 0.14);

  // Identify continuous printed vertical gridlines (tolerating +/-1px slight vertical camera slant)
  const extSpan = Math.max(4, Math.round(rowH * 0.65));
  const aboveY0 = clampInt(Math.round(yTop - extSpan), 0, height - 1);
  const aboveY1 = clampInt(Math.round(yTop - 3), aboveY0, height - 1);
  const belowY0 = clampInt(Math.round(yBot + 3), 0, height - 1);
  const belowY1 = clampInt(Math.round(yBot + extSpan), belowY0, height - 1);

  const isVGrid = new Uint8Array(colCount);
  const abSpan = Math.max(1, aboveY1 - aboveY0 + 1);
  const blSpan = Math.max(1, belowY1 - belowY0 + 1);
  const vThresh = inkThresh * 0.72;

  for (let c = 0; c < colCount; c++) {
    const x = x0 + c;
    let inDark = 0;
    for (let r = 0; r < rowCount; r++) {
      const base = r * colCount;
      const dMid = paperLum - lums[base + c] > vThresh;
      const dL = c > 0 && paperLum - lums[base + c - 1] > vThresh;
      const dR = c + 1 < colCount && paperLum - lums[base + c + 1] > vThresh;
      if (dMid || dL || dR) inDark++;
    }
    if (inDark / rowCount < 0.65) continue;

    let abDark = 0;
    for (let y = aboveY0; y <= aboveY1; y++) {
      if (
        paperLum - sampleLum(rgba, width, height, x, y) > vThresh ||
        paperLum - sampleLum(rgba, width, height, x - 1, y) > vThresh ||
        paperLum - sampleLum(rgba, width, height, x + 1, y) > vThresh
      ) {
        abDark++;
      }
    }
    let blDark = 0;
    for (let y = belowY0; y <= belowY1; y++) {
      if (
        paperLum - sampleLum(rgba, width, height, x, y) > vThresh ||
        paperLum - sampleLum(rgba, width, height, x - 1, y) > vThresh ||
        paperLum - sampleLum(rgba, width, height, x + 1, y) > vThresh
      ) {
        blDark++;
      }
    }

    // Require vertical continuity both into cell and across adjacent rows; also verify thin <=3px stroke locally
    if (abDark / abSpan >= 0.55 && blDark / blSpan >= 0.55) {
      let ownDark = 0;
      for (let r = 0; r < rowCount; r++) {
        if (paperLum - lums[r * colCount + c] > vThresh) ownDark++;
      }
      if (ownDark / rowCount >= 0.25) {
        isVGrid[c] = 1;
      }
    }
  }

  // Binary ink mask after excluding printed vertical dividers
  const mask = new Uint8Array(totSamples);
  let inkCount = 0;
  let totalValid = 0;
  let rowsWith3PlusRuns = 0;
  let activeRows = 0;
  let minInkR = rowCount;
  let maxInkR = -1;
  let bottomInk = 0;
  let bottomCenterInk = 0;
  const botStartRow = Math.floor(rowCount * 0.58);
  const centerTol = dayWidth * 0.22;

  for (let r = 0; r < rowCount; r++) {
    let rowInk = 0;
    let runs = 0;
    let inRun = false;
    const rowBase = r * colCount;

    for (let c = 0; c < colCount; c++) {
      if (isVGrid[c]) {
        inRun = false;
        continue;
      }
      totalValid++;
      const isDark = paperLum - lums[rowBase + c] > inkThresh;
      if (isDark) {
        mask[rowBase + c] = 1;
        inkCount++;
        rowInk++;
        if (r < minInkR) minInkR = r;
        if (r > maxInkR) maxInkR = r;
        if (r >= botStartRow) {
          bottomInk++;
          if (Math.abs(x0 + c - xCenter) <= centerTol) {
            bottomCenterInk++;
          }
        }
        if (!inRun) {
          runs++;
          inRun = true;
        }
      } else {
        inRun = false;
      }
    }
    if (rowInk > 0) {
      activeRows++;
      if (runs >= 3) rowsWith3PlusRuns++;
    }
  }

  // Count enclosed vertical dark->white->dark gaps ('00' closed ovals) and max horizontal ink presence
  let enclosedHoles = 0;
  let leftHalfRuns = 0;
  let rightHalfRuns = 0;
  for (let c = 0; c < colCount; c++) {
    if (isVGrid[c]) continue;
    let seenDark = false;
    let gap = 0;
    let colTransitions = 0;
    let inC = false;
    for (let r = 0; r < rowCount; r++) {
      const d = mask[r * colCount + c] === 1;
      if (d) {
        if (!inC) {
          colTransitions++;
          inC = true;
        }
        if (seenDark && gap >= 1 && gap <= Math.max(5, Math.round(rowCount * 0.72))) {
          enclosedHoles++;
        }
        seenDark = true;
        gap = 0;
      } else {
        inC = false;
        if (seenDark) gap++;
      }
    }
    if (colTransitions >= 2) {
      if (x0 + c < xCenter) leftHalfRuns++;
      else rightHalfRuns++;
    }
  }

  return {
    inkRatio: totalValid > 0 ? inkCount / totalValid : 0,
    inkCount,
    redRatioAll: totSamples > 0 ? redAll / totSamples : 0,
    multiRunFrac: activeRows > 0 ? rowsWith3PlusRuns / activeRows : 0,
    enclosedHoles,
    spanYFrac: maxInkR >= minInkR ? (maxInkR - minInkR + 1) / rowCount : 0,
    leftHalfRuns,
    rightHalfRuns,
    bottomCenterFrac: bottomInk > 0 ? bottomCenterInk / bottomInk : 0
  };
}

/**
 * Pure RGBA Stage 2 Grid & Tick/Ink Verifier for LEA registers.
 * Fast (~15-35ms on CPU):
 * 1. Detects Left-Half & Right-Half printed horizontal rules to handle both keystone tilt and spine curl.
 * 2. Caches per-cell RGBA inspection in O(W*H) zero-allocation time.
 * 3. Preserves & propagates OCR/Red-ruled Holiday columns across all rows.
 * 4. Recovers missing top V-tick rows on Right-Hand pages and trims trailing blank rows cleanly.
 * 5. Separates clear V-ticks (PRESENT) vs empty cells (BLANK) while flagging loop-like or faint marks (UNCERTAIN).
 */
export function verifyRegisterCellsFromRgba(input: RgbaVerificationInput): GeminiExtractionResult {
  const { rgba, width, height, extraction } = input;
  const geom: LeaGridGeometry | null | undefined = extraction.gridGeometry;
  if (!geom || !geom.weeks || geom.weeks.length === 0 || width <= 0 || height <= 0) {
    return extraction;
  }

  const sx = width / Math.max(1, geom.pageWidth);
  const sy = height / Math.max(1, geom.pageHeight);
  const slope = geom.rightSlope * (sy / sx);
  const scaledDayHdrY = geom.dayHeaderBaseY * sy;
  const scaledRowH = geom.rowHeight * sy;

  const scaledWeeks = geom.weeks.map((wk) => ({
    weekLabel: wk.weekLabel,
    days: wk.days.map((d) => ({
      day: d.day,
      xCenter: d.xCenter * sx,
      dayWidth: d.dayWidth * sx
    }))
  }));

  // Pick leftmost and rightmost clean weeks (skipping weeks mostly blocked by holiday banners if >=2 weeks exist)
  const ocrHolidayColsPre = new Set<string>();
  for (const row of extraction.rows) {
    for (const m of row.marks) {
      if (m.status === 'BLANK' && m.rawSymbol === 'HOLIDAY') {
        ocrHolidayColsPre.add(`${(m.week || 'Week 1').toLowerCase()}::${m.day.toLowerCase()}`);
      }
    }
  }
  const cleanWeekIndices: number[] = [];
  scaledWeeks.forEach((wk, idx) => {
    const holCount = wk.days.filter((d) =>
      ocrHolidayColsPre.has(`${wk.weekLabel.toLowerCase()}::${d.day.toLowerCase()}`)
    ).length;
    if (holCount <= 2) cleanWeekIndices.push(idx);
  });
  const leftAnchorIdx = cleanWeekIndices.length > 0 ? cleanWeekIndices[0] : 0;
  const rightAnchorIdx =
    cleanWeekIndices.length > 1 ? cleanWeekIndices[cleanWeekIndices.length - 1] : scaledWeeks.length - 1;

  const firstWk = scaledWeeks[leftAnchorIdx];
  const lastWk = scaledWeeks[rightAnchorIdx];
  const leftMinX = firstWk.days[0].xCenter - firstWk.days[0].dayWidth * 0.35;
  const leftMaxX = firstWk.days[4].xCenter + firstWk.days[4].dayWidth * 0.35;
  const leftMidX = (leftMinX + leftMaxX) * 0.5;

  const rightMinX = lastWk.days[0].xCenter - lastWk.days[0].dayWidth * 0.35;
  const rightMaxX = lastWk.days[4].xCenter + lastWk.days[4].dayWidth * 0.35;
  const rightMidX = (rightMinX + rightMaxX) * 0.5;

  const leftInfo = detectHalfGridlines(
    rgba,
    width,
    height,
    leftMinX,
    leftMaxX,
    slope,
    scaledDayHdrY,
    scaledRowH
  );
  const rightInfo =
    rightAnchorIdx !== leftAnchorIdx
      ? detectHalfGridlines(
          rgba,
          width,
          height,
          rightMinX,
          rightMaxX,
          slope,
          scaledDayHdrY,
          scaledRowH
        )
      : leftInfo;

  // Cross-validate Row 1 bottom Y between Left & Right halves so neither side locks onto a noisy peak
  const expectedR1FromLeft = leftInfo.row1BottomY + slope * (rightMidX - leftMidX);
  const expectedR1FromRight = rightInfo.row1BottomY - slope * (rightMidX - leftMidX);
  if (Math.abs(rightInfo.row1BottomY - expectedR1FromLeft) > scaledRowH * 0.55) {
    // Prefer the side whose stepY is closer to a clean 2.2 * stepY drop from headerBottomY
    const lRatio = (leftInfo.row1BottomY - leftInfo.headerBottomY) / Math.max(1, leftInfo.stepY);
    const rRatio = (rightInfo.row1BottomY - rightInfo.headerBottomY) / Math.max(1, rightInfo.stepY);
    if (Math.abs(lRatio - 2.2) <= Math.abs(rRatio - 2.2)) {
      rightInfo.row1BottomY = expectedR1FromLeft;
    } else {
      leftInfo.row1BottomY = expectedR1FromRight;
    }
  }

  const maxSlots = Math.max(24, (geom.rows?.length || 12) + 8);
  const leftLattice = buildSingleSideLattice(leftInfo, maxSlots);
  const rightLattice = buildSingleSideLattice(rightInfo, maxSlots);
  const spanX = Math.max(1, rightMidX - leftMidX);

  const sharedBands: HorizontalBand[] = [];
  for (let i = 0; i < maxSlots; i++) {
    const l = leftLattice[i];
    const r = rightLattice[i] || l;
    sharedBands.push({
      leftTopY: l.topY,
      leftBotY: l.botY,
      rightTopY: r.topY,
      rightBotY: r.botY
    });
  }

  const getCellYRange = (band: HorizontalBand, xCenter: number): { topY: number; botY: number } => {
    if (rightAnchorIdx === leftAnchorIdx || spanX < 20) {
      const off = slope * (xCenter - leftMidX);
      return { topY: band.leftTopY + off, botY: band.leftBotY + off };
    }
    const t = Math.max(-1.25, Math.min(1.25, (xCenter - leftMidX) / spanX));
    return {
      topY: band.leftTopY + (band.rightTopY - band.leftTopY) * t,
      botY: band.leftBotY + (band.rightBotY - band.leftBotY) * t
    };
  };

  // Cached per-cell pixel inspection (ensures each cell is only scanned ONCE)
  const cellCache = new Map<string, CellPixelMetrics>();
  const getMetrics = (wIdx: number, rIdx: number, dIdx: number): CellPixelMetrics => {
    const key = `${wIdx}:${rIdx}:${dIdx}`;
    const cached = cellCache.get(key);
    if (cached) return cached;
    const band = sharedBands[rIdx];
    const dc = scaledWeeks[wIdx].days[dIdx];
    if (!band || !dc) {
      return {
        inkRatio: 0,
        inkCount: 0,
        redRatioAll: 0,
        multiRunFrac: 0,
        enclosedHoles: 0,
        spanYFrac: 0,
        leftHalfRuns: 0,
        rightHalfRuns: 0,
        bottomCenterFrac: 0
      };
    }
    const { topY, botY } = getCellYRange(band, dc.xCenter);
    const m = inspectCellPixels(rgba, width, height, dc.xCenter, dc.dayWidth, topY, botY);
    cellCache.set(key, m);
    return m;
  };

  // 1. Collect OCR holiday columns across ALL existing rows (so newly recovered rows inherit column holidays!)
  const holidayColumns = new Set<string>();
  for (const row of extraction.rows) {
    for (const m of row.marks) {
      if (m.status === 'BLANK' && m.rawSymbol === 'HOLIDAY') {
        holidayColumns.add(`${(m.week || 'Week 1').toLowerCase()}::${m.day.toLowerCase()}`);
      }
    }
  }

  // 2. Detect Red-Ink Vertical Rulings (Strike / Eid / Holiday) across upper populated rows (rows 1..8)
  const redSampleRows = Math.min(8, sharedBands.length);
  for (let wIdx = 0; wIdx < scaledWeeks.length; wIdx++) {
    const wk = scaledWeeks[wIdx];
    for (let dIdx = 0; dIdx < wk.days.length; dIdx++) {
      const dc = wk.days[dIdx];
      let redHits = 0;
      let totalRed = 0;
      for (let rIdx = 0; rIdx < redSampleRows; rIdx++) {
        const m = getMetrics(wIdx, rIdx, dIdx);
        totalRed += m.redRatioAll;
        if (m.redRatioAll >= 0.05) redHits++;
      }
      const meanRed = redSampleRows > 0 ? totalRed / redSampleRows : 0;
      if (redHits >= Math.ceil(redSampleRows * 0.4) && meanRed >= 0.045) {
        holidayColumns.add(`${wk.weekLabel.toLowerCase()}::${dc.day.toLowerCase()}`);
      }
    }
  }

  // 3. Determine target row count & map existing OCR rows onto exact lattice indices 0..N-1
  let targetRowCount = extraction.rows.length;
  const existingRowByRowNum = new Map<number, GeminiExtractionRow>();

  if (geom.isLeftRosterPage) {
    for (const r of extraction.rows) {
      existingRowByRowNum.set(r.rowNumber, r);
    }
  } else {
    // Probe rows top-down on non-holiday columns to find true populated bottom boundary
    let lastActiveRowIdx = 0;
    let consecutiveEmpty = 0;
    const nonHolidayColCount = scaledWeeks.reduce(
      (acc, wk) =>
        acc +
        wk.days.filter(
          (d) => !holidayColumns.has(`${wk.weekLabel.toLowerCase()}::${d.day.toLowerCase()}`)
        ).length,
      0
    );

    const nonHolidayWeeksCount = scaledWeeks.filter((wk) =>
      wk.days.some((d) => !holidayColumns.has(`${wk.weekLabel.toLowerCase()}::${d.day.toLowerCase()}`))
    ).length;

    for (let rIdx = 0; rIdx < sharedBands.length; rIdx++) {
      let populatedCols = 0;
      let populatedWeeks = 0;
      for (let wIdx = 0; wIdx < scaledWeeks.length; wIdx++) {
        const wk = scaledWeeks[wIdx];
        let wkHits = 0;
        for (let dIdx = 0; dIdx < wk.days.length; dIdx++) {
          const d = wk.days[dIdx];
          if (holidayColumns.has(`${wk.weekLabel.toLowerCase()}::${d.day.toLowerCase()}`)) continue;
          const m = getMetrics(wIdx, rIdx, dIdx);
          if (m.inkRatio >= 0.055 && m.inkCount >= 8) {
            populatedCols++;
            wkHits++;
          }
        }
        if (wkHits > 0) populatedWeeks++;
      }
      const minColsNeeded = nonHolidayColCount >= 8 ? Math.max(4, Math.floor(nonHolidayColCount * 0.35)) : 2;
      const minWeeksNeeded =
        nonHolidayWeeksCount >= 3 ? Math.ceil(nonHolidayWeeksCount * 0.65) : Math.min(2, nonHolidayWeeksCount);
      if (populatedCols >= minColsNeeded && populatedWeeks >= Math.max(1, minWeeksNeeded)) {
        lastActiveRowIdx = rIdx + 1;
        consecutiveEmpty = 0;
      } else {
        consecutiveEmpty++;
        if (lastActiveRowIdx > 0 && consecutiveEmpty >= 2) break;
      }
    }

    // Snap existing right-page Vision OCR rows onto exact lattice indices
    for (let vIdx = 0; vIdx < geom.rows.length; vIdx++) {
      const gRow = geom.rows[vIdx];
      const ocrRow = extraction.rows[vIdx];
      if (!ocrRow) continue;
      const midX = (leftMidX + rightMidX) * 0.5;
      const targetMidY = gRow.yCenterAtZeroX * sy + slope * midX;

      let bestLatticeIdx = -1;
      let bestDist = Infinity;
      for (let rIdx = 0; rIdx < sharedBands.length; rIdx++) {
        const { topY, botY } = getCellYRange(sharedBands[rIdx], midX);
        const latCenter = (topY + botY) * 0.5;
        const dist = Math.abs(targetMidY - latCenter);
        if (dist < bestDist) {
          bestDist = dist;
          bestLatticeIdx = rIdx;
        }
      }
      if (bestLatticeIdx >= 0 && bestDist <= scaledRowH * 0.72) {
        const targetNum = bestLatticeIdx + 1;
        if (!existingRowByRowNum.has(targetNum)) {
          existingRowByRowNum.set(targetNum, { ...ocrRow, rowNumber: targetNum });
        }
      }
    }

    if (lastActiveRowIdx > 0) {
      targetRowCount = lastActiveRowIdx;
    }
  }

  targetRowCount = Math.max(1, targetRowCount);

  // Build row index map for Left pages: on Left pages, rowNum 1..N literally corresponds to lattice index rowNum - 1
  // whenever Row 1 aligns cleanly; verify against geom.rows offset to guarantee zero off-by-one shift
  let leftPageLatticeOffset = 0;
  if (geom.isLeftRosterPage && geom.rows.length > 0 && sharedBands.length > 0) {
    const firstG = geom.rows[0];
    const targetMidY = firstG.yCenterAtZeroX * sy + slope * leftMidX;
    const b0 = getCellYRange(sharedBands[0], leftMidX);
    const b1 = sharedBands[1] ? getCellYRange(sharedBands[1], leftMidX) : b0;
    const d0 = Math.abs(targetMidY - (b0.topY + b0.botY) * 0.5);
    const d1 = Math.abs(targetMidY - (b1.topY + b1.botY) * 0.5);
    if (d1 + scaledRowH * 0.25 < d0) {
      leftPageLatticeOffset = 1;
    }
  }

  let presentCount = 0;
  let absentCount = 0;
  let blankCount = 0;
  let uncertainCount = 0;
  let ticksVerifiedCount = 0;
  let blanksVerifiedCount = 0;

  const updatedRows: GeminiExtractionRow[] = [];

  for (let rowNum = 1; rowNum <= targetRowCount; rowNum++) {
    const existingRow = existingRowByRowNum.get(rowNum);
    const rIdx = geom.isLeftRosterPage
      ? Math.min(sharedBands.length - 1, Math.max(0, rowNum - 1 + leftPageLatticeOffset))
      : Math.min(sharedBands.length - 1, rowNum - 1);

    const newMarks: GeminiExtractionMark[] = [];

    for (let wIdx = 0; wIdx < scaledWeeks.length; wIdx++) {
      const wk = scaledWeeks[wIdx];

      for (let dIdx = 0; dIdx < wk.days.length; dIdx++) {
        const dc = wk.days[dIdx];
        const colKey = `${wk.weekLabel.toLowerCase()}::${dc.day.toLowerCase()}`;

        const existingMark = existingRow?.marks.find(
          (m) =>
            (m.week || 'Week 1').toLowerCase() === wk.weekLabel.toLowerCase() &&
            m.day.toLowerCase() === dc.day.toLowerCase()
        );

        // 1. Holiday / Strike column (OCR keyword OR red vertical pen ruling)
        if (holidayColumns.has(colKey)) {
          blankCount++;
          newMarks.push({
            week: wk.weekLabel,
            day: dc.day as DayOfWeek,
            status: 'BLANK',
            rawSymbol: 'HOLIDAY',
            notes: existingMark?.notes || 'Strike / Public Holiday ruling detected'
          });
          continue;
        }

        // 2. Preserve definitive ABSENT (00) detected by Cloud Vision OCR
        if (existingMark?.status === 'ABSENT') {
          absentCount++;
          newMarks.push({ ...existingMark });
          continue;
        }

        const m = getMetrics(wIdx, rIdx, dIdx);

        // 3. Confirm OCR PRESENT (V) against pixels
        if (existingMark?.status === 'PRESENT') {
          if (m.inkRatio >= 0.032) {
            presentCount++;
            newMarks.push({ ...existingMark });
          } else {
            uncertainCount++;
            newMarks.push({
              ...existingMark,
              status: 'UNCERTAIN',
              rawSymbol: '?',
              notes: 'OCR read tick but cell interior appears faint/empty — verify'
            });
          }
          continue;
        }

        // 4. Stage 2 classification on UNCERTAIN / recovered grid cells:
        let nextStatus: MarkStatus = 'UNCERTAIN';
        let nextSymbol = '?';
        let nextNotes: string | null = existingMark?.notes || null;

        if (m.inkRatio < 0.032 || m.inkCount <= 4) {
          nextStatus = 'BLANK';
          nextSymbol = '';
          nextNotes = null;
          blanksVerifiedCount++;
        } else if (
          // Detect oval/loop-heavy marks ('00' absent pairs missed by OCR) -> keep UNCERTAIN for safety
          (m.multiRunFrac >= 0.44 && m.enclosedHoles >= 10) ||
          (m.enclosedHoles >= 16 && m.leftHalfRuns >= 2 && m.rightHalfRuns >= 2) ||
          (m.inkRatio >= 0.31 && m.multiRunFrac >= 0.42)
        ) {
          nextStatus = 'UNCERTAIN';
          nextSymbol = '00?';
          nextNotes = 'Loop/oval-like ink strokes detected (possible missed 00 Absent) — verify';
        } else if (m.inkRatio >= 0.055 && m.inkCount >= 8 && m.spanYFrac >= 0.28) {
          nextStatus = 'PRESENT';
          nextSymbol = 'V';
          nextNotes = null;
          ticksVerifiedCount++;
        } else {
          nextStatus = 'UNCERTAIN';
          nextSymbol = '?';
          nextNotes = 'Faint or borderline stroke — human verification required';
        }

        if (nextStatus === 'PRESENT') presentCount++;
        else if (nextStatus === 'BLANK') blankCount++;
        else uncertainCount++;

        newMarks.push({
          week: wk.weekLabel,
          day: dc.day as DayOfWeek,
          status: nextStatus,
          rawSymbol: nextSymbol,
          notes: nextNotes
        });
      }
    }

    const hasRowUncertain = newMarks.some((mk) => mk.status === 'UNCERTAIN');
    updatedRows.push({
      rowNumber: rowNum,
      studentNameDetected: existingRow?.studentNameDetected ?? null,
      admissionNumberDetected: existingRow?.admissionNumberDetected ?? null,
      marks: newMarks,
      uncertaintyNotes: hasRowUncertain
        ? 'Some borderline or loop-like cells require quick visual confirmation.'
        : null
    });
  }

  return {
    ...extraction,
    processingStageUsed: 'staged-cell-verification',
    totalRowsDetected: updatedRows.length,
    rows: updatedRows,
    ambiguityDetected: uncertainCount > 0,
    layoutNotes: `${extraction.layoutNotes ? `${extraction.layoutNotes} ` : ''}Stage 2 Canvas Tick Verifier checked cell interiors (${ticksVerifiedCount} V-ticks confirmed, ${blanksVerifiedCount} empty cells marked Blank).`,
    summaryStatistics: {
      presentCount,
      absentCount,
      blankCount,
      uncertainCount
    },
    overallConfidence:
      uncertainCount <= Math.ceil((presentCount + absentCount + blankCount + uncertainCount) * 0.15)
        ? 'HIGH'
        : 'MEDIUM'
  };
}

/**
 * Browser wrapper: decodes an image data URL onto a single offscreen canvas in ~15-35ms,
 * reads ImageData once, and executes Stage 2 cell tick verification with zero extra network calls.
 */
export async function verifyRegisterCellsOnCanvas(
  imageDataUrl: string,
  extraction: GeminiExtractionResult
): Promise<GeminiExtractionResult> {
  if (!extraction?.gridGeometry || typeof document === 'undefined') {
    return extraction;
  }

  let width = 0;
  let height = 0;
  let rgba: Uint8ClampedArray | null = null;

  if (typeof createImageBitmap === 'function') {
    try {
      const resp = await fetch(imageDataUrl);
      const blob = await resp.blob();
      const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      try {
        width = bitmap.width;
        height = bitmap.height;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(bitmap, 0, 0, width, height);
          rgba = ctx.getImageData(0, 0, width, height).data;
        }
      } finally {
        bitmap.close();
      }
    } catch {
      rgba = null;
    }
  }

  if (!rgba) {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Failed to decode register image for Stage 2 canvas verification.'));
      img.src = imageDataUrl;
    });
    width = img.naturalWidth || img.width;
    height = img.naturalHeight || img.height;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return extraction;
    ctx.drawImage(img, 0, 0, width, height);
    rgba = ctx.getImageData(0, 0, width, height).data;
  }

  return verifyRegisterCellsFromRgba({ rgba, width, height, extraction });
}
