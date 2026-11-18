import assert from 'node:assert/strict';
import { verifyRegisterCellsFromRgba } from './tickStrokeVerifier';
import type { DayOfWeek, GeminiExtractionResult } from '../types/attendance';

const DAYS: DayOfWeek[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

function createCanvasBuffer(width: number, height: number, bg = [240, 238, 232]): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = bg[0];
    rgba[i + 1] = bg[1];
    rgba[i + 2] = bg[2];
    rgba[i + 3] = 255;
  }
  return rgba;
}

function setPixel(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number
) {
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (ix < 0 || ix >= width || iy < 0 || iy >= height) return;
  const idx = (iy * width + ix) << 2;
  rgba[idx] = r;
  rgba[idx + 1] = g;
  rgba[idx + 2] = b;
  rgba[idx + 3] = 255;
}

function drawLine(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rgb: [number, number, number],
  thickness = 1
) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    for (let dy = -Math.floor(thickness / 2); dy <= Math.floor(thickness / 2); dy++) {
      for (let dx = -Math.floor(thickness / 2); dx <= Math.floor(thickness / 2); dx++) {
        setPixel(rgba, width, height, x + dx, y + dy, rgb[0], rgb[1], rgb[2]);
      }
    }
  }
}

function drawVTick(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  xc: number,
  dayW: number,
  yTop: number,
  yBot: number
) {
  const pen: [number, number, number] = [30, 42, 118];
  const leftX = xc - dayW * 0.28;
  const rightX = xc + dayW * 0.3;
  const topY = yTop + (yBot - yTop) * 0.22;
  const botY = yBot - (yBot - yTop) * 0.18;
  drawLine(rgba, width, height, leftX, topY, xc, botY, pen, 2);
  drawLine(rgba, width, height, xc, botY, rightX, topY - 2, pen, 2);
}

function drawDoubleZero(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  xc: number,
  dayW: number,
  yTop: number,
  yBot: number
) {
  const pen: [number, number, number] = [28, 36, 104];
  const cy = (yTop + yBot) * 0.5;
  const rx = Math.max(4, dayW * 0.14);
  const ry = Math.max(5, (yBot - yTop) * 0.26);
  for (const cx of [xc - dayW * 0.21, xc + dayW * 0.21]) {
    for (let deg = 0; deg < 360; deg += 5) {
      const rad = (deg * Math.PI) / 180;
      const px = cx + Math.cos(rad) * rx;
      const py = cy + Math.sin(rad) * ry;
      setPixel(rgba, width, height, px, py, pen[0], pen[1], pen[2]);
      setPixel(rgba, width, height, px + 1, py, pen[0], pen[1], pen[2]);
    }
  }
}

function drawRedHolidayRulings(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  xc: number,
  dayW: number,
  yTop: number,
  yBot: number
) {
  const red: [number, number, number] = [205, 42, 42];
  for (const offset of [-0.25, -0.05, 0.15, 0.32]) {
    drawLine(rgba, width, height, xc + dayW * offset, yTop, xc + dayW * offset, yBot, red, 2);
  }
}

function makeGridScaffold(opts: {
  width: number;
  height: number;
  isLeftRosterPage: boolean;
  weekCount: number;
  rowCount: number;
}) {
  const { width, height, isLeftRosterPage, weekCount, rowCount } = opts;
  const rgba = createCanvasBuffer(width, height);
  const dayWidth = 36;
  const rowHeight = 40;
  const headerTopY = 120;
  const dayHeaderBaseY = 175;
  const headerBotY = 195;
  const subHeaderBotY = Math.round(headerBotY + rowHeight * 1.2); // 243
  const row1BotY = Math.round(headerBotY + rowHeight * 2.2); // 283 (exact 2.2x stepY drop)
  const firstRowTopY = subHeaderBotY;

  const startX = 120;
  const weekGap = 18;
  const weeks = [];
  for (let w = 0; w < weekCount; w++) {
    const wkStart = startX + w * (dayWidth * 5 + weekGap);
    const days = DAYS.map((day, dIdx) => ({
      day,
      xCenter: wkStart + dIdx * dayWidth + dayWidth * 0.5,
      dayWidth
    }));
    weeks.push({
      weekLabel: `Week ${isLeftRosterPage ? w + 1 : w + 4}`,
      days
    });
  }

  const gridLeftX = weeks[0].days[0].xCenter - dayWidth * 0.5;
  const gridRightX = weeks[weeks.length - 1].days[4].xCenter + dayWidth * 0.5;
  const gridBotY = row1BotY + (rowCount + 3) * rowHeight;

  // Printed blue horizontal rules (header bottom + subheader + rows)
  const ruleBlue: [number, number, number] = [65, 90, 145];
  drawLine(rgba, width, height, gridLeftX, headerTopY, gridRightX, headerTopY, ruleBlue, 2);
  drawLine(rgba, width, height, gridLeftX, headerBotY, gridRightX, headerBotY, ruleBlue, 2);
  drawLine(rgba, width, height, gridLeftX, firstRowTopY, gridRightX, firstRowTopY, ruleBlue, 1);
  for (let r = 0; r <= rowCount + 3; r++) {
    const y = row1BotY + r * rowHeight;
    drawLine(rgba, width, height, gridLeftX, y, gridRightX, y, ruleBlue, 2);
  }

  // Printed vertical column borders + thin morning/afternoon center dividers
  for (const wk of weeks) {
    for (const d of wk.days) {
      drawLine(rgba, width, height, d.xCenter - dayWidth * 0.5, headerTopY, d.xCenter - dayWidth * 0.5, gridBotY, ruleBlue, 2);
      drawLine(rgba, width, height, d.xCenter, headerBotY, d.xCenter, gridBotY, [110, 130, 175], 1);
    }
    const lastD = wk.days[4];
    drawLine(rgba, width, height, lastD.xCenter + dayWidth * 0.5, headerTopY, lastD.xCenter + dayWidth * 0.5, gridBotY, ruleBlue, 2);
  }

  const rowBox = (rowIdx0: number) => ({
    yTop: firstRowTopY + rowIdx0 * rowHeight,
    yBot: firstRowTopY + (rowIdx0 + 1) * rowHeight
  });

  return {
    rgba,
    weeks,
    dayHeaderBaseY,
    headerBotY,
    rowHeight,
    firstRowTopY,
    gridBotY,
    rowBox
  };
}

// Test 1: Left Roster Page - Empty cells with printed gridlines stay BLANK, V ticks become PRESENT, missed 00 flagged UNCERTAIN (00?), Red lines become HOLIDAY
{
  const width = 900;
  const height = 900;
  const scaffold = makeGridScaffold({
    width,
    height,
    isLeftRosterPage: true,
    weekCount: 2,
    rowCount: 4
  });

  // Row 1 (index 0): W1 M..Thu = V ticks, Fri = BLANK; W2 M..F = V ticks
  for (let d = 0; d < 4; d++) {
    const { yTop, yBot } = scaffold.rowBox(0);
    drawVTick(scaffold.rgba, width, height, scaffold.weeks[0].days[d].xCenter, 36, yTop, yBot);
  }
  for (let d = 0; d < 5; d++) {
    const { yTop, yBot } = scaffold.rowBox(0);
    drawVTick(scaffold.rgba, width, height, scaffold.weeks[1].days[d].xCenter, 36, yTop, yBot);
  }

  // Row 2 (index 1): W1 Mon = dense '00' missed by OCR, Tue..Fri = BLANK
  {
    const { yTop, yBot } = scaffold.rowBox(1);
    drawDoubleZero(scaffold.rgba, width, height, scaffold.weeks[0].days[0].xCenter, 36, yTop, yBot);
  }

  // Row 3 (index 2): W1 M..Thu = V ticks; W2 M..F = BLANK
  for (let d = 0; d < 4; d++) {
    const { yTop, yBot } = scaffold.rowBox(2);
    drawVTick(scaffold.rgba, width, height, scaffold.weeks[0].days[d].xCenter, 36, yTop, yBot);
  }

  // Red vertical holiday lines down Week 2 Wednesday across rows 1..6
  drawRedHolidayRulings(
    scaffold.rgba,
    width,
    height,
    scaffold.weeks[1].days[2].xCenter,
    36,
    scaffold.firstRowTopY,
    scaffold.gridBotY
  );

  // Build OCR Stage 1 extraction (all uncertain '?' except Row 3 Tue read by OCR as '00')
  const stage1: GeminiExtractionResult = {
    schoolIdentified: 'L.E.A Primary School',
    classIdentified: 'Primary 5',
    periodIdentified: '2nd Term',
    layoutNotes: 'Stage 1 OCR',
    totalRowsDetected: 3,
    detectedDays: DAYS,
    rows: [1, 2, 3].map((rowNumber) => ({
      rowNumber,
      studentNameDetected: `PUPIL ${rowNumber}`,
      admissionNumberDetected: `900${rowNumber}`,
      marks: scaffold.weeks.flatMap((wk) =>
        wk.days.map((d) => ({
          week: wk.weekLabel,
          day: d.day,
          status:
            rowNumber === 3 && wk.weekLabel === 'Week 1' && d.day === 'Friday'
              ? ('ABSENT' as const)
              : ('UNCERTAIN' as const),
          rawSymbol:
            rowNumber === 3 && wk.weekLabel === 'Week 1' && d.day === 'Friday' ? '00' : '?'
        }))
      )
    })),
    ambiguityDetected: true,
    summaryStatistics: { presentCount: 0, absentCount: 1, blankCount: 0, uncertainCount: 29 },
    overallConfidence: 'MEDIUM',
    disclaimer: 'Test',
    gridGeometry: {
      pageWidth: width,
      pageHeight: height,
      rightSlope: 0,
      rowHeight: scaffold.rowHeight,
      dayHeaderBaseY: scaffold.dayHeaderBaseY,
      bodyTopY: scaffold.firstRowTopY,
      isLeftRosterPage: true,
      rows: [1, 2, 3].map((rowNumber) => {
        const { yTop, yBot } = scaffold.rowBox(rowNumber - 1);
        return { rowNumber, yCenterAtZeroX: (yTop + yBot) * 0.5 };
      }),
      weeks: scaffold.weeks
    }
  };

  const verified = verifyRegisterCellsFromRgba({
    rgba: scaffold.rgba,
    width,
    height,
    extraction: stage1
  });

  assert.equal(verified.processingStageUsed, 'staged-cell-verification');
  assert.equal(verified.rows.length, 3);

  const r1 = verified.rows[0];
  assert.equal(r1.marks[0].status, 'PRESENT', 'Row 1 W1 Mon V tick should be PRESENT');
  assert.equal(r1.marks[3].status, 'PRESENT', 'Row 1 W1 Thu V tick should be PRESENT');
  assert.equal(r1.marks[4].status, 'BLANK', 'Row 1 W1 Fri empty grid cell must be BLANK despite dividers');
  assert.equal(r1.marks[7].status, 'BLANK', 'Row 1 W2 Wed red holiday rulings must be BLANK (HOLIDAY)');
  assert.equal(r1.marks[7].rawSymbol, 'HOLIDAY');

  const r2 = verified.rows[1];
  assert.equal(r2.marks[0].status, 'UNCERTAIN', 'Missed 00 ovals must NOT become PRESENT');
  assert.equal(r2.marks[0].rawSymbol, '00?');
  assert.equal(r2.marks[1].status, 'BLANK', 'Row 2 W1 Tue empty cell must be BLANK');

  const r3 = verified.rows[2];
  assert.equal(r3.marks[4].status, 'ABSENT', 'OCR ABSENT mark on Row 3 W1 Fri must stay ABSENT');
}

// Test 2: Right Multi-Week Page missing top Rows 1-2 in OCR -> recovers Rows 1-2 V-ticks and aligns Row 3 (00)
{
  const width = 1000;
  const height = 900;
  const scaffold = makeGridScaffold({
    width,
    height,
    isLeftRosterPage: false,
    weekCount: 3,
    rowCount: 4
  });

  // Draw V ticks on Rows 1 & 2 across all 3 weeks (suppressed by Cloud Vision OCR!)
  for (let r = 0; r < 2; r++) {
    const { yTop, yBot } = scaffold.rowBox(r);
    for (const wk of scaffold.weeks) {
      for (const d of wk.days) {
        drawVTick(scaffold.rgba, width, height, d.xCenter, 36, yTop, yBot);
      }
    }
  }
  // Draw '00' on Row 3 across all 3 weeks (detected by Cloud Vision OCR)
  {
    const { yTop, yBot } = scaffold.rowBox(2);
    for (const wk of scaffold.weeks) {
      for (const d of wk.days) {
        drawDoubleZero(scaffold.rgba, width, height, d.xCenter, 36, yTop, yBot);
      }
    }
  }

  const r3Box = scaffold.rowBox(2);
  const stage1Right: GeminiExtractionResult = {
    schoolIdentified: null,
    classIdentified: 'Primary 5',
    periodIdentified: 'Weeks 4-6',
    layoutNotes: 'Stage 1 OCR missed top V rows',
    totalRowsDetected: 1,
    detectedDays: DAYS,
    rows: [
      {
        rowNumber: 1, // OCR mistakenly numbered Row 3 as Row 1 because Rows 1-2 were only V ticks
        studentNameDetected: null,
        admissionNumberDetected: null,
        marks: scaffold.weeks.flatMap((wk) =>
          wk.days.map((d) => ({
            week: wk.weekLabel,
            day: d.day,
            status: 'ABSENT' as const,
            rawSymbol: '00'
          }))
        )
      }
    ],
    ambiguityDetected: false,
    summaryStatistics: { presentCount: 0, absentCount: 15, blankCount: 0, uncertainCount: 0 },
    overallConfidence: 'MEDIUM',
    disclaimer: 'Test',
    gridGeometry: {
      pageWidth: width,
      pageHeight: height,
      rightSlope: 0,
      rowHeight: scaffold.rowHeight,
      dayHeaderBaseY: scaffold.dayHeaderBaseY,
      bodyTopY: scaffold.firstRowTopY,
      isLeftRosterPage: false,
      rows: [{ rowNumber: 1, yCenterAtZeroX: (r3Box.yTop + r3Box.yBot) * 0.5 }],
      weeks: scaffold.weeks
    }
  };

  const t0 = performance.now();
  const verifiedRight = verifyRegisterCellsFromRgba({
    rgba: scaffold.rgba,
    width,
    height,
    extraction: stage1Right
  });
  const elapsedMs = performance.now() - t0;

  assert.equal(verifiedRight.rows.length, 3, 'Should recover Rows 1-2 and align Row 3 cleanly');
  assert.equal(
    verifiedRight.rows[0].marks.every((m) => m.status === 'PRESENT'),
    true,
    'Recovered Row 1 V-ticks should all be PRESENT'
  );
  assert.equal(
    verifiedRight.rows[1].marks.every((m) => m.status === 'PRESENT'),
    true,
    'Recovered Row 2 V-ticks should all be PRESENT'
  );
  assert.equal(
    verifiedRight.rows[2].marks.every((m) => m.status === 'ABSENT'),
    true,
    'Row 3 OCR ABSENT marks must align onto rowNumber 3'
  );
  assert.ok(elapsedMs < 150, `Expected fast verification <150ms, got ${elapsedMs.toFixed(2)}ms`);
}

console.log('tickStrokeVerifier.test.ts: ALL PASSED');
