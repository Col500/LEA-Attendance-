import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import {
  extractRosterWithGoogleCloudVision,
  getGoogleCloudVisionInfo,
  processWithGoogleCloudVision
} from './src/server/googleCloudVisionService.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp'
]);

export function validateImageDataPayload(image: unknown):
  | { ok: true; mimeType: string; base64Data: string }
  | { ok: false; code: string; error: string } {
  if (typeof image !== 'string' || image.trim().length === 0) {
    return {
      ok: false,
      code: 'INVALID_REQUEST',
      error: 'No register image data provided in the request payload.'
    };
  }

  const trimmed = image.trim();
  const dataUriMatch = trimmed.match(/^data:([^;]+);base64,(.+)$/i);
  if (dataUriMatch) {
    const mimeType = dataUriMatch[1].toLowerCase();
    const base64Data = dataUriMatch[2].trim();
    if (!ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) {
      return {
        ok: false,
        code: 'UNSUPPORTED_IMAGE_TYPE',
        error: `Unsupported image type "${mimeType}". Please upload a JPEG, PNG, or WebP photograph.`
      };
    }
    if (!base64Data || !/^[A-Za-z0-9+/=\s]+$/.test(base64Data)) {
      return {
        ok: false,
        code: 'INVALID_IMAGE_DATA',
        error: 'The uploaded register image data is corrupted or not valid base64.'
      };
    }
    return { ok: true, mimeType, base64Data };
  }

  if (trimmed.startsWith('data:')) {
    return {
      ok: false,
      code: 'UNSUPPORTED_IMAGE_TYPE',
      error: 'Invalid or non-base64 data URI. Please upload a valid JPEG, PNG, or WebP photograph.'
    };
  }

  if (!/^[A-Za-z0-9+/=\s]+$/.test(trimmed) || trimmed.length < 16) {
    return {
      ok: false,
      code: 'INVALID_IMAGE_DATA',
      error: 'The uploaded register image payload is not a valid image encoding.'
    };
  }

  return { ok: true, mimeType: 'image/jpeg', base64Data: trimmed };
}

async function startServer() {
  const app = express();
  const port = Number(process.env.PORT) || 3000;

  // JSON payload parser for base64 image data
  app.use(express.json({ limit: '25mb' }));

  // Prevent serving any sensitive credentials or keys over HTTP
  app.use((req, res, next) => {
    if (req.path.includes('google-vision-key') || req.path.includes('credentials') || req.path.endsWith('.json') && req.path.includes('project-')) {
      return res.status(403).json({ error: 'Access forbidden.' });
    }
    next();
  });

  // API Status & Configuration Check Endpoint
  app.get('/api/status', (req, res) => {
    const cloudVision = getGoogleCloudVisionInfo();

    res.json({
      ok: true,
      service: 'LEA Attendance Vision Engine',
      model: 'google-cloud-vision',
      provider: 'Google Cloud Vision API',
      cloudVision: {
        configured: cloudVision.configured,
        authMethod: cloudVision.authMethod,
        projectId: cloudVision.projectId,
        clientEmail: cloudVision.clientEmail,
        billingUrl: cloudVision.billingUrl,
        serviceAccount: cloudVision.clientEmail
      },
      availableModels: ['google-cloud-vision']
    });
  });

  // GET /api/test-cloud-vision: Test Google Cloud Vision connection in real time
  app.get('/api/test-cloud-vision', async (req, res) => {
    const info = getGoogleCloudVisionInfo();
    if (!info.configured) {
      return res.json({
        ok: false,
        code: 'NOT_CONFIGURED',
        message: 'No Google Cloud Vision API key or service account key is configured.'
      });
    }

    // Test with a 1x1 test image
    const sampleBuffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    const result = await processWithGoogleCloudVision(sampleBuffer);

    if (result.ok) {
      return res.json({
        ok: true,
        code: 'AUTHENTICATED_AND_ACTIVE',
        message:
          info.authMethod === 'api-key'
            ? 'Google Cloud Vision API is connected and active via your configured API key.'
            : `Google Cloud Vision API is authenticated and active for project "${info.projectId}".`,
        projectId: info.projectId,
        clientEmail: info.clientEmail,
        authMethod: info.authMethod
      });
    }

    return res.json({
      ok: false,
      code: result.code,
      message: result.error,
      billingUrl: result.billingUrl,
      projectId: info.projectId,
      clientEmail: info.clientEmail,
      authMethod: info.authMethod
    });
  });

  // GET /api/models: List active Vision OCR engine (Google Cloud Vision only)
  app.get('/api/models', (req, res) => {
    const cloudVision = getGoogleCloudVisionInfo();

    res.json({
      ok: true,
      defaultModel: 'google-cloud-vision',
      cloudVisionConfigured: cloudVision.configured,
      models: [
        {
          id: 'google-cloud-vision',
          name: 'Google Cloud Vision API',
          description: 'Document Text Detection and OCR powered by Google Cloud Vision.',
          provider: 'Google Cloud Vision',
          isCloudVision: true,
          configured: cloudVision.configured,
          default: true
        }
      ]
    });
  });

  // POST /api/analyze-register: Analyze Physical Register Sheet exclusively via Google Cloud Vision
  app.post('/api/analyze-register', async (req, res) => {
    try {
      const { image, className, period, date } = req.body;

      const parsedImage = validateImageDataPayload(image);
      if (parsedImage.ok === false) {
        return res.status(400).json({
          ok: false,
          code: parsedImage.code,
          error: parsedImage.error
        });
      }

      const imageBuffer = Buffer.from(parsedImage.base64Data, 'base64');
      const visionResult = await processWithGoogleCloudVision(imageBuffer, className, date, period);

      if (visionResult.ok && visionResult.data) {
        return res.json({
          ok: true,
          data: visionResult.data,
          rawText: visionResult.rawText,
          modelUsed: 'Google Cloud Vision API',
          provider: 'Google Cloud Vision API',
          timestamp: new Date().toISOString()
        });
      }

      if (visionResult.code === 'GCP_BILLING_REQUIRED') {
        return res.status(403).json({
          ok: false,
          code: 'GCP_BILLING_REQUIRED',
          error: visionResult.error,
          billingUrl: visionResult.billingUrl,
          modelUsed: 'Google Cloud Vision API'
        });
      }

      return res.status(visionResult.code === 'NO_CREDENTIALS' ? 503 : 400).json({
        ok: false,
        code: visionResult.code || 'GCP_VISION_ERROR',
        error: visionResult.error || 'Google Cloud Vision could not process this image.'
      });
    } catch (err: any) {
      console.error('Google Cloud Vision register error:', err?.message || 'unknown error');
      return res.status(500).json({
        ok: false,
        code: 'GCP_VISION_ERROR',
        error: err?.message || 'An error occurred while communicating with Google Cloud Vision.'
      });
    }
  });

  // POST /api/extract-roster: Extract full student roster (S/N, Name, Admission No.) exclusively via Google Cloud Vision
  app.post('/api/extract-roster', async (req, res) => {
    try {
      const { image } = req.body;
      const parsedImage = validateImageDataPayload(image);
      if (parsedImage.ok === false) {
        return res.status(400).json({
          ok: false,
          code: parsedImage.code,
          error: parsedImage.error
        });
      }

      const visionRes = await extractRosterWithGoogleCloudVision(
        Buffer.from(parsedImage.base64Data, 'base64')
      );
      if (visionRes.ok) {
        return res.json({
          ok: true,
          classDetected: visionRes.classDetected || null,
          students: visionRes.students || [],
          rawText: visionRes.rawText,
          modelUsed: 'google-cloud-vision',
          timestamp: new Date().toISOString()
        });
      }

      return res.status(visionRes.code === 'NO_CREDENTIALS' ? 503 : 400).json({
        ok: false,
        code: visionRes.code || 'GCP_VISION_ERROR',
        error: visionRes.error || 'Google Cloud Vision could not extract the student roster.'
      });
    } catch (err: any) {
      console.error('Google Cloud Vision roster error:', err?.message || 'unknown error');
      return res.status(500).json({
        ok: false,
        code: 'GCP_VISION_ERROR',
        error: err?.message || 'Failed to extract student roster via Google Cloud Vision.'
      });
    }
  });

  // POST /api/analyze-register-cells: Stage 2 cell-level strip OCR verification via Google Cloud Vision
  app.post('/api/analyze-register-cells', async (req, res) => {
    try {
      const { image, className, targetSlots = [] } = req.body;
      if (!image || !Array.isArray(targetSlots) || targetSlots.length === 0) {
        return res.status(400).json({
          ok: false,
          code: 'INVALID_REQUEST',
          error: 'Strip image and targetSlots are required for cell verification.'
        });
      }

      const parsedImage = validateImageDataPayload(image);
      if (parsedImage.ok === false) {
        return res.status(400).json({
          ok: false,
          code: parsedImage.code,
          error: parsedImage.error
        });
      }

      const visionResult = await processWithGoogleCloudVision(
        Buffer.from(parsedImage.base64Data, 'base64'),
        className
      );
      if (!visionResult.ok || !visionResult.data) {
        return res.status(400).json({
          ok: false,
          code: visionResult.code || 'GCP_VISION_ERROR',
          error: visionResult.error || 'Cell verification failed via Google Cloud Vision.'
        });
      }

      const verifiedCells = (visionResult.data.rows || []).flatMap((row) =>
        (row.marks || []).map((mark) => ({
          rowNumber: row.rowNumber,
          week: mark.week,
          day: mark.day,
          status: mark.status,
          rawSymbol: mark.rawSymbol || ''
        }))
      );

      return res.json({
        ok: true,
        verifiedCells,
        modelUsed: 'Google Cloud Vision API',
        timestamp: new Date().toISOString()
      });
    } catch (err: any) {
      console.error('Cell verification error:', err?.message || 'unknown error');
      return res.status(500).json({
        ok: false,
        code: 'GCP_VISION_ERROR',
        error: err?.message || 'Cell-level verification failed via Google Cloud Vision.'
      });
    }
  });

  // Mount Vite middleware in development mode or serve static files in production
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`LEA Attendance Assistant server running on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
