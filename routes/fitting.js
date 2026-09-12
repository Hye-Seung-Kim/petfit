// PawTry Together - fitting room page + JSON API.
//
// This router is additive: it does not touch the existing Vonage session /
// token routes in routes/index.js. Clients still call GET /room/:name (from
// routes/index.js) to get { applicationId, sessionId, token } for Vonage.
// Everything here is app-level state layered on top of that.

import express from 'express';
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { getState, addLook, setVote, finalizeLook, resetRoom } from '../services/roomState.js';
import { generateTryOn, isMockMode, currentModel } from '../services/gemini.js';
import { OUTFITS, getOutfit } from '../services/outfits.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const GENERATED_DIR = path.join(PUBLIC_DIR, 'generated');
const DEMO_VIDEO_PATH = path.join(PUBLIC_DIR, 'demo', 'dog-demo.mp4');

const MAX_ROOM_NAME_LENGTH = 64;
const MAX_FRAME_BYTES = 8 * 1024 * 1024; // 8MB decoded image, generous for a single JPEG frame
const FRAME_DATA_URL_RE = /^data:(image\/jpeg|image\/png);base64,([A-Za-z0-9+/=]+)$/;
const ROOM_NAME_RE = /^[A-Za-z0-9_-]+$/;

const router = express.Router();

function isValidRoomName(name) {
  return typeof name === 'string' && name.length > 0 && name.length <= MAX_ROOM_NAME_LENGTH && ROOM_NAME_RE.test(name);
}

function extensionForMimeType(mimeType) {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/svg+xml') return 'svg';
  return 'jpg';
}

// --- Page route -----------------------------------------------------------

router.get('/fitting/:room', (req, res) => {
  if (!isValidRoomName(req.params.room)) {
    return res.status(400).send('Invalid room name. Use letters, numbers, "-" and "_" only.');
  }
  res.sendFile(path.join(PUBLIC_DIR, 'fitting', 'index.html'));
});

// --- Config (outfit catalog + demo-mode flag for the UI badge) ------------

router.get('/api/config', async (req, res) => {
  let demoVideoAvailable = false;
  try {
    await fs.access(DEMO_VIDEO_PATH);
    demoVideoAvailable = true;
  } catch {
    demoVideoAvailable = false;
  }

  res.json({
    demoMock: isMockMode(),
    geminiModel: currentModel(),
    outfits: OUTFITS.map(({ id, name, thumbnail }) => ({ id, name, thumbnail })),
    demoVideoUrl: '/demo/dog-demo.mp4',
    demoVideoAvailable,
  });
});

// --- Room state -------------------------------------------------------------

router.get('/api/rooms/:room/state', (req, res) => {
  const { room } = req.params;
  if (!isValidRoomName(room)) {
    return res.status(400).json({ error: 'Invalid room name' });
  }
  res.json(getState(room));
});

router.post('/api/rooms/:room/generate', async (req, res) => {
  const { room } = req.params;
  if (!isValidRoomName(room)) {
    return res.status(400).json({ error: 'Invalid room name' });
  }

  const { frame, outfitId } = req.body || {};

  const outfit = getOutfit(outfitId);
  if (!outfit) {
    return res.status(400).json({ error: `Unknown outfitId. Expected one of: ${OUTFITS.map((o) => o.id).join(', ')}` });
  }
  if (typeof frame !== 'string' || frame.length === 0) {
    return res.status(400).json({ error: 'Missing captured frame' });
  }
  const match = frame.match(FRAME_DATA_URL_RE);
  if (!match) {
    return res.status(400).json({ error: 'Frame must be a base64 data URL (image/jpeg or image/png)' });
  }
  const [, frameMimeType, frameBase64] = match;
  const decodedSize = Buffer.byteLength(frameBase64, 'base64');
  if (decodedSize > MAX_FRAME_BYTES) {
    return res.status(400).json({ error: 'Captured frame is too large (max 8MB)' });
  }

  try {
    const result = await generateTryOn({
      frameBase64,
      frameMimeType,
      outfitName: outfit.name,
      outfitDescription: outfit.description,
    });

    const ext = extensionForMimeType(result.mimeType);
    const lookId = `look-${crypto.randomUUID()}`;
    await fs.mkdir(GENERATED_DIR, { recursive: true });
    await fs.writeFile(path.join(GENERATED_DIR, `${lookId}.${ext}`), result.buffer);

    const look = {
      id: lookId,
      outfitId: outfit.id,
      outfitName: outfit.name,
      imageUrl: `/generated/${lookId}.${ext}`,
      createdAt: new Date().toISOString(),
    };

    const updatedRoom = addLook(room, look);
    res.json(updatedRoom);
  } catch (error) {
    console.error(`Error generating try-on for room "${room}":`, error.message);
    res.status(502).json({ error: error.publicMessage || 'Failed to generate try-on image. Please try again.' });
  }
});

router.post('/api/rooms/:room/vote', (req, res) => {
  const { room } = req.params;
  if (!isValidRoomName(room)) {
    return res.status(400).json({ error: 'Invalid room name' });
  }
  const { voterId, lookId } = req.body || {};
  if (typeof voterId !== 'string' || voterId.length === 0) {
    return res.status(400).json({ error: 'Missing voterId' });
  }
  if (typeof lookId !== 'string' || lookId.length === 0) {
    return res.status(400).json({ error: 'Missing lookId' });
  }
  try {
    const updatedRoom = setVote(room, voterId, lookId);
    res.json(updatedRoom);
  } catch (error) {
    if (error.message === 'LOOK_NOT_FOUND') {
      return res.status(404).json({ error: 'That look no longer exists' });
    }
    console.error(`Error setting vote for room "${room}":`, error);
    res.status(500).json({ error: 'Failed to record vote' });
  }
});

router.post('/api/rooms/:room/finalize', (req, res) => {
  const { room } = req.params;
  if (!isValidRoomName(room)) {
    return res.status(400).json({ error: 'Invalid room name' });
  }
  const { lookId } = req.body || {};
  if (typeof lookId !== 'string' || lookId.length === 0) {
    return res.status(400).json({ error: 'Missing lookId' });
  }
  try {
    const updatedRoom = finalizeLook(room, lookId);
    res.json(updatedRoom);
  } catch (error) {
    if (error.message === 'LOOK_NOT_FOUND') {
      return res.status(404).json({ error: 'That look no longer exists' });
    }
    console.error(`Error finalizing look for room "${room}":`, error);
    res.status(500).json({ error: 'Failed to finalize look' });
  }
});

// Host-triggered reset: clears looks/votes/final pick so a new round can
// start without restarting the server. Not auth-gated server-side (see
// README on role handling) - the host-only button is a UI convention.
router.post('/api/rooms/:room/reset', async (req, res) => {
  const { room } = req.params;
  if (!isValidRoomName(room)) {
    return res.status(400).json({ error: 'Invalid room name' });
  }

  const { room: updatedRoom, removedLooks } = resetRoom(room);

  await Promise.all(removedLooks.map(async (look) => {
    const fileName = look.imageUrl.split('/').pop();
    try {
      await fs.unlink(path.join(GENERATED_DIR, fileName));
    } catch (error) {
      console.warn(`Could not remove old generated file "${fileName}":`, error.message);
    }
  }));

  res.json(updatedRoom);
});

export default router;
