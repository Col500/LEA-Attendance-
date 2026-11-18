import type { NormalizedBoundingBox, NormalizedCropBox } from '../types/attendance';

export const DEFAULT_MAX_REGISTER_DIMENSION = 1800;
export const MIN_RECOMMENDED_SHORT_SIDE_PX = 650;
export const MIN_UPSCALE_TARGET_SHORT_SIDE_PX = 1150;
export const MAX_CONDITIONAL_UPSCALE_FACTOR = 2;
export const DEFAULT_PREPROCESS_JPEG_QUALITY = 0.86;

export interface PreprocessedImageResult {
  dataUrl: string;
  mimeType: string;
  originalWidth: number;
  originalHeight: number;
  outputWidth: number;
  outputHeight: number;
  rotationApplied: number;
  wasCropped: boolean;
  wasResized: boolean;
  isLowResolution: boolean;
  estimatedBytes: number;
}

/**
 * Computes resized dimensions that preserve the exact aspect ratio without exceeding maxDimension.
 * Never upscales smaller images.
 */
export function computeAspectPreservingSize(
  width: number,
  height: number,
  maxDimension: number = DEFAULT_MAX_REGISTER_DIMENSION
): { width: number; height: number; wasResized: boolean } {
  const safeW = Math.max(1, Math.round(width));
  const safeH = Math.max(1, Math.round(height));
  const longest = Math.max(safeW, safeH);

  if (longest <= maxDimension) {
    return { width: safeW, height: safeH, wasResized: false };
  }

  const scale = maxDimension / longest;
  return {
    width: Math.max(1, Math.round(safeW * scale)),
    height: Math.max(1, Math.round(safeH * scale)),
    wasResized: true
  };
}

/**
 * Conditionally upscales tight crops or low-resolution captures (up to 2x toward ~1150px short side)
 * while still clamping oversized photos down to maxDimension.
 * Preserves aspect ratio and never bloats already-sharp photos.
 */
export function computeConditionalUpscaleSize(
  width: number,
  height: number,
  maxDimension: number = DEFAULT_MAX_REGISTER_DIMENSION
): { width: number; height: number; wasResized: boolean; wasUpscaled: boolean } {
  const safeW = Math.max(1, Math.round(width));
  const safeH = Math.max(1, Math.round(height));
  const longest = Math.max(safeW, safeH);
  const shortest = Math.min(safeW, safeH);

  if (longest > maxDimension) {
    const down = computeAspectPreservingSize(safeW, safeH, maxDimension);
    return { ...down, wasUpscaled: false };
  }

  if (shortest < MIN_UPSCALE_TARGET_SHORT_SIDE_PX && longest < maxDimension) {
    const targetByShort = MIN_UPSCALE_TARGET_SHORT_SIDE_PX / shortest;
    const maxAllowedByLong = maxDimension / longest;
    const scale = Math.min(MAX_CONDITIONAL_UPSCALE_FACTOR, targetByShort, maxAllowedByLong);
    if (scale > 1.05) {
      return {
        width: Math.max(1, Math.round(safeW * scale)),
        height: Math.max(1, Math.round(safeH * scale)),
        wasResized: true,
        wasUpscaled: true
      };
    }
  }

  return { width: safeW, height: safeH, wasResized: false, wasUpscaled: false };
}

/**
 * Applies a fast, thresholded 3x3 luminance unsharp mask on a canvas so small printed digits
 * and faint ink strokes stay crisp without adding flat-paper speckles or altering red ink hues.
 */
function sharpenRegisterCanvas(canvas: HTMLCanvasElement, amount = 0.28, threshold = 7): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width: w, height: h } = canvas;
  if (w < 8 || h < 8 || w * h > 4_000_000) return;

  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;
  const total = w * h;
  const lum = new Float32Array(total);

  for (let i = 0; i < total; i++) {
    const idx = i << 2;
    lum[i] = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
  }

  for (let y = 1; y < h - 1; y++) {
    const rowOff = y * w;
    for (let x = 1; x < w - 1; x++) {
      const p = rowOff + x;
      const center = lum[p];
      const blur =
        (lum[p - w - 1] +
          lum[p - w] +
          lum[p - w + 1] +
          lum[p - 1] +
          center +
          lum[p + 1] +
          lum[p + w - 1] +
          lum[p + w] +
          lum[p + w + 1]) /
        9;
      const diff = center - blur;
      if (Math.abs(diff) <= threshold) continue;

      const delta = diff * amount;
      const idx = p << 2;
      data[idx] = Math.min(255, Math.max(0, Math.round(data[idx] + delta)));
      data[idx + 1] = Math.min(255, Math.max(0, Math.round(data[idx + 1] + delta)));
      data[idx + 2] = Math.min(255, Math.max(0, Math.round(data[idx + 2] + delta)));
    }
  }

  ctx.putImageData(imgData, 0, 0);
}

/**
 * Clamps normalized crop coordinates (0..1) to a valid non-empty rectangle.
 */
export function clampCropBox(crop?: NormalizedCropBox | null): NormalizedCropBox | null {
  if (!crop) return null;
  const x = Math.min(0.95, Math.max(0, crop.x));
  const y = Math.min(0.95, Math.max(0, crop.y));
  const width = Math.min(1 - x, Math.max(0.05, crop.width));
  const height = Math.min(1 - y, Math.max(0.05, crop.height));

  // Treat near-full frame as uncropped to avoid redundant re-encoding
  if (x <= 0.005 && y <= 0.005 && width >= 0.99 && height >= 0.99) {
    return null;
  }

  return { x, y, width, height };
}

/**
 * Normalizes any integer degree angle to 0 | 90 | 180 | 270.
 */
export function normalizeQuarterRotation(degrees: number): 0 | 90 | 180 | 270 {
  const mod = ((Math.round(degrees / 90) * 90) % 360 + 360) % 360;
  if (mod === 90 || mod === 180 || mod === 270) return mod;
  return 0;
}

/**
 * Computes canvas dimensions after a quarter-turn rotation.
 */
export function computeRotatedDimensions(
  width: number,
  height: number,
  rotation: number
): { width: number; height: number } {
  const norm = normalizeQuarterRotation(rotation);
  if (norm === 90 || norm === 270) {
    return { width: height, height: width };
  }
  return { width, height };
}

/**
 * Splits a detected attendance-table bounding box (0..1000 coordinates) into overlapping
 * horizontal row-group strips so Stage 2 cell-level verification can inspect dense marks clearly.
 */
export function computeTableRowStrips(
  tableBox?: NormalizedBoundingBox | null,
  stripCount: number = 2
): NormalizedBoundingBox[] {
  const clampedBox: NormalizedBoundingBox = tableBox
    ? {
        ymin: Math.max(0, Math.min(950, tableBox.ymin)),
        xmin: Math.max(0, Math.min(950, tableBox.xmin)),
        ymax: Math.min(1000, Math.max(50, tableBox.ymax)),
        xmax: Math.min(1000, Math.max(50, tableBox.xmax))
      }
    : { ymin: 50, xmin: 0, ymax: 980, xmax: 1000 };

  const count = Math.max(1, Math.min(4, stripCount));
  if (count === 1) return [clampedBox];

  const totalHeight = Math.max(100, clampedBox.ymax - clampedBox.ymin);
  const overlap = Math.round(totalHeight * 0.08);
  const step = Math.round(totalHeight / count);

  const strips: NormalizedBoundingBox[] = [];
  for (let i = 0; i < count; i++) {
    const startY = i === 0 ? clampedBox.ymin : Math.max(clampedBox.ymin, clampedBox.ymin + i * step - overlap);
    const endY =
      i === count - 1
        ? clampedBox.ymax
        : Math.min(clampedBox.ymax, clampedBox.ymin + (i + 1) * step + overlap);

    strips.push({
      ymin: startY,
      xmin: clampedBox.xmin,
      ymax: endY,
      xmax: clampedBox.xmax
    });
  }

  return strips;
}

async function decodeSourceBitmapOrImage(
  source: string | Blob
): Promise<{
  drawable: CanvasImageSource;
  width: number;
  height: number;
  cleanup: () => void;
}> {
  if (typeof createImageBitmap === 'function') {
    try {
      const blob =
        typeof source === 'string' ? await (await fetch(source)).blob() : source;
      const bitmap = await createImageBitmap(blob, {
        imageOrientation: 'from-image'
      });
      return {
        drawable: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        cleanup: () => bitmap.close()
      };
    } catch {
      // Fall back to HTMLImageElement below
    }
  }

  const dataUrl =
    typeof source === 'string'
      ? source
      : await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error('Failed to decode image file.'));
          reader.readAsDataURL(source);
        });

  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('The selected file could not be decoded as an image.'));
    img.src = dataUrl;
  });

  return {
    drawable: img,
    width: img.naturalWidth || img.width,
    height: img.naturalHeight || img.height,
    cleanup: () => {}
  };
}

/**
 * Performs practical browser-side preprocessing on an HTML5 Canvas:
 * 1. Bakes EXIF orientation from camera photos.
 * 2. Physically applies administrator quarter-turn rotation (0/90/180/270).
 * 3. Physically crops to the attendance-table region if specified.
 * 4. Downscales only when exceeding maxDimension while preserving aspect ratio.
 * 5. Avoids aggressive compression (uses PNG for PNG inputs or JPEG 0.94).
 *
 * NOTE: Does NOT perform geometric perspective correction / deskewing.
 */
export async function preprocessRegisterImage(params: {
  source: string | Blob;
  rotation?: number;
  cropBox?: NormalizedCropBox | null;
  maxDimension?: number;
  preferredMimeType?: string;
}): Promise<PreprocessedImageResult> {
  const {
    source,
    rotation = 0,
    cropBox,
    maxDimension = DEFAULT_MAX_REGISTER_DIMENSION,
    preferredMimeType
  } = params;

  const decoded = await decodeSourceBitmapOrImage(source);
  try {
    const normRotation = normalizeQuarterRotation(rotation);
    const validCrop = clampCropBox(cropBox);

    const rotDims = computeRotatedDimensions(decoded.width, decoded.height, normRotation);

    // Compute pixel crop rectangle in rotated coordinate space
    const cropX = validCrop ? Math.round(validCrop.x * rotDims.width) : 0;
    const cropY = validCrop ? Math.round(validCrop.y * rotDims.height) : 0;
    const cropW = validCrop
      ? Math.max(1, Math.round(validCrop.width * rotDims.width))
      : rotDims.width;
    const cropH = validCrop
      ? Math.max(1, Math.round(validCrop.height * rotDims.height))
      : rotDims.height;

    const sized = computeConditionalUpscaleSize(cropW, cropH, maxDimension);

    const outCanvas = document.createElement('canvas');
    outCanvas.width = sized.width;
    outCanvas.height = sized.height;
    const outCtx = outCanvas.getContext('2d');
    if (!outCtx) {
      throw new Error('Browser canvas context unavailable for output encoding.');
    }

    outCtx.imageSmoothingEnabled = true;
    outCtx.imageSmoothingQuality = 'high';

    if (normRotation === 0 && !validCrop) {
      // Fast path: draw directly without allocating an intermediate full-resolution rotated canvas
      outCtx.drawImage(decoded.drawable, 0, 0, sized.width, sized.height);
    } else {
      // Apply quarter-turn rotation + crop onto intermediate canvas, then scale onto outCanvas
      const rotatedCanvas = document.createElement('canvas');
      rotatedCanvas.width = rotDims.width;
      rotatedCanvas.height = rotDims.height;
      const rCtx = rotatedCanvas.getContext('2d');
      if (!rCtx) {
        throw new Error('Browser canvas context unavailable for image preprocessing.');
      }

      rCtx.save();
      if (normRotation === 90) {
        rCtx.translate(rotDims.width, 0);
        rCtx.rotate(Math.PI / 2);
      } else if (normRotation === 180) {
        rCtx.translate(rotDims.width, rotDims.height);
        rCtx.rotate(Math.PI);
      } else if (normRotation === 270) {
        rCtx.translate(0, rotDims.height);
        rCtx.rotate(-Math.PI / 2);
      }
      rCtx.drawImage(decoded.drawable, 0, 0, decoded.width, decoded.height);
      rCtx.restore();

      outCtx.drawImage(
        rotatedCanvas,
        cropX,
        cropY,
        cropW,
        cropH,
        0,
        0,
        sized.width,
        sized.height
      );
    }

    if (sized.wasUpscaled || validCrop) {
      sharpenRegisterCanvas(outCanvas);
    }

    const isPngSource =
      preferredMimeType === 'image/png' ||
      (typeof source === 'string' && source.startsWith('data:image/png'));
    const outputMime = isPngSource ? 'image/png' : 'image/jpeg';
    const dataUrl =
      outputMime === 'image/png'
        ? outCanvas.toDataURL('image/png')
        : outCanvas.toDataURL('image/jpeg', DEFAULT_PREPROCESS_JPEG_QUALITY);

    const estimatedBytes = Math.round((dataUrl.length * 3) / 4);
    const isLowResolution = Math.min(sized.width, sized.height) < MIN_RECOMMENDED_SHORT_SIDE_PX;

    return {
      dataUrl,
      mimeType: outputMime,
      originalWidth: decoded.width,
      originalHeight: decoded.height,
      outputWidth: sized.width,
      outputHeight: sized.height,
      rotationApplied: normRotation,
      wasCropped: Boolean(validCrop),
      wasResized: sized.wasResized,
      isLowResolution,
      estimatedBytes
    };
  } finally {
    decoded.cleanup();
  }
}

/**
 * Extracts a zoomed image strip from a preprocessed register image using 0..1000 bounding coordinates.
 */
export async function extractNormalizedRegionDataUrl(
  sourceDataUrl: string,
  box: NormalizedBoundingBox
): Promise<string> {
  const decoded = await decodeSourceBitmapOrImage(sourceDataUrl);
  try {
    const x = Math.max(0, Math.round((box.xmin / 1000) * decoded.width));
    const y = Math.max(0, Math.round((box.ymin / 1000) * decoded.height));
    const w = Math.max(
      40,
      Math.min(decoded.width - x, Math.round(((box.xmax - box.xmin) / 1000) * decoded.width))
    );
    const h = Math.max(
      40,
      Math.min(decoded.height - y, Math.round(((box.ymax - box.ymin) / 1000) * decoded.height))
    );

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return sourceDataUrl;

    ctx.drawImage(decoded.drawable, x, y, w, h, 0, 0, w, h);
    return sourceDataUrl.startsWith('data:image/png')
      ? canvas.toDataURL('image/png')
      : canvas.toDataURL('image/jpeg', DEFAULT_PREPROCESS_JPEG_QUALITY);
  } finally {
    decoded.cleanup();
  }
}
