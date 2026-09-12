// Gemini image-editing integration for PawTry Together.
//
// The Gemini API key never leaves the server. The client only ever sends a
// captured video frame (base64 JPEG/PNG) and an outfitId; this module turns
// that into an image-editing request against Gemini and returns raw image
// bytes for the caller to persist.
//
// DEMO_MOCK_GEMINI=true skips the real API call entirely and returns a
// locally generated placeholder image instead, so the whole app flow can be
// demoed/tested without a Gemini API key or network access. Mock mode is
// never entered silently - routes/fitting.js surfaces it via /api/config so
// the UI can show a visible "Demo Mode" badge.

import crypto from 'crypto';

const MOCK_MODE = process.env.DEMO_MOCK_GEMINI === 'true';
const MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';

let genAIClientPromise;

async function getClient() {
  if (!process.env.GEMINI_API_KEY) {
    const err = new Error('GEMINI_API_KEY is not configured on the server');
    err.publicMessage = 'Gemini is not configured on the server (missing GEMINI_API_KEY).';
    throw err;
  }
  if (!genAIClientPromise) {
    genAIClientPromise = import('@google/genai').then(
      ({ GoogleGenAI }) => new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
    );
  }
  return genAIClientPromise;
}

function buildPrompt(outfitName, outfitDescription) {
  return [
    `Edit the provided dog image by adding ${outfitDescription || `the selected pet outfit (${outfitName})`}.`,
    '',
    "Preserve the dog's exact face, breed appearance, fur color, fur markings,",
    'ears, eyes, body position, anatomy, camera angle, background, and lighting.',
    '',
    "Add only the selected outfit. Make it fit naturally around the dog's torso",
    'without covering the eyes, nose, mouth, paws, or tail.',
    '',
    "Do not change the dog's identity.",
    'Do not add extra limbs.',
    'Do not change the dog into a different breed.',
    'Do not add text or logos.',
    'Produce one photorealistic virtual pet fashion preview.',
  ].join('\n');
}

function escapeXml(value) {
  return String(value).replace(/[<>&'"]/g, (char) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;',
  }[char]));
}

/** Builds a clearly-labeled placeholder "generated look" for demo mode. */
function buildMockImage(outfitName) {
  const safeName = escapeXml(outfitName);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640" viewBox="0 0 640 640">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff3e0"/>
      <stop offset="1" stop-color="#ffe0b2"/>
    </linearGradient>
  </defs>
  <rect width="640" height="640" fill="url(#bg)"/>
  <text x="320" y="270" font-size="150" text-anchor="middle">&#128054;</text>
  <text x="320" y="360" font-size="28" font-family="'Segoe UI', sans-serif" text-anchor="middle" fill="#5d4037">wearing the</text>
  <text x="320" y="410" font-size="38" font-family="'Segoe UI', sans-serif" font-weight="700" text-anchor="middle" fill="#d84315">${safeName}</text>
  <rect x="180" y="460" width="280" height="46" rx="23" fill="#212121"/>
  <text x="320" y="490" font-size="18" font-family="'Segoe UI', sans-serif" text-anchor="middle" fill="#ffffff" letter-spacing="1">DEMO MODE PREVIEW</text>
</svg>`;
  return { buffer: Buffer.from(svg, 'utf8'), mimeType: 'image/svg+xml' };
}

/**
 * Generates a virtual pet try-on image.
 * @param {object} params
 * @param {string} params.frameBase64 - base64-encoded captured video frame (no data: prefix)
 * @param {string} params.frameMimeType - e.g. 'image/jpeg'
 * @param {string} params.outfitName
 * @param {string} params.outfitDescription
 * @returns {Promise<{buffer: Buffer, mimeType: string}>}
 */
export async function generateTryOn({ frameBase64, frameMimeType, outfitName, outfitDescription }) {
  if (MOCK_MODE) {
    return buildMockImage(outfitName);
  }

  const ai = await getClient();
  const prompt = buildPrompt(outfitName, outfitDescription);

  let response;
  try {
    response = await ai.models.generateContent({
      model: MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            { inlineData: { mimeType: frameMimeType, data: frameBase64 } },
          ],
        },
      ],
    });
  } catch (error) {
    console.error('Gemini API request failed:', error.message);
    const err = new Error('Gemini request failed');
    err.publicMessage = 'The AI image service failed to respond. Please try again.';
    throw err;
  }

  const parts = response?.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find((part) => part.inlineData && part.inlineData.data);

  if (!imagePart) {
    const textPart = parts.find((part) => part.text);
    console.error('Gemini did not return an image.', textPart ? `Response text: ${textPart.text.slice(0, 200)}` : '');
    const err = new Error('Gemini did not return an image');
    err.publicMessage = 'The AI did not return an image for this frame. Try a clearer capture.';
    throw err;
  }

  return {
    buffer: Buffer.from(imagePart.inlineData.data, 'base64'),
    mimeType: imagePart.inlineData.mimeType || 'image/png',
  };
}

/** Generates a URL-safe unique id for a look/generated file. */
export function newLookId() {
  return `look-${crypto.randomUUID()}`;
}

export const isMockMode = () => MOCK_MODE;
export const currentModel = () => MODEL;
