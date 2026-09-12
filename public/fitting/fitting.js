// PawTry Together - client app (vanilla JS, no build step).
//
// Architecture reminder: the server is the source of truth for room state.
// Vonage signals only ever mean "something changed, go re-fetch" - we never
// pack look data or full state into a signal payload.

const pathParts = location.pathname.split('/').filter(Boolean); // ['fitting', ':room']
let roomName = pathParts[1] ? decodeURIComponent(pathParts[1]) : '';
const params = new URLSearchParams(location.search);
const role = params.get('role') === 'friend' ? 'friend' : 'host';
const voterId = getOrCreateVoterId();

let session = null;
let publisher = null;
let roomState = null;
let outfitCatalog = [];
let selectedOutfitId = null;
let capturedFrameDataUrl = null;
let generating = false;

// --- DOM refs ---------------------------------------------------------------

const el = (id) => document.getElementById(id);
const appEl = el('app');
const bannerEl = el('banner');
const demoModeBadge = el('demoModeBadge');
const roomNameInput = el('roomNameInput');
const goToRoomBtn = el('goToRoomBtn');
const copyLinkBtn = el('copyLinkBtn');
const connectionStatus = el('connectionStatus');

const hostVideo = el('hostVideo');
const subscriberContainer = el('subscriberContainer');
const waitingForHost = el('waitingForHost');
const publisherContainer = el('publisherContainer');
const hostVideoControls = el('hostVideoControls');
const videoFileInput = el('videoFileInput');
const uploadBtn = el('uploadBtn');
const useDemoVideoBtn = el('useDemoVideoBtn');
const playBtn = el('playBtn');
const pauseBtn = el('pauseBtn');
const captureBtn = el('captureBtn');
const demoVideoMissingNotice = el('demoVideoMissingNotice');

const capturedSection = el('capturedSection');
const capturedFrameImg = el('capturedFrameImg');
const capturedFrameEmpty = el('capturedFrameEmpty');

const outfitSection = el('outfitSection');
const outfitList = el('outfitList');
const generateBtn = el('generateBtn');
const generateError = el('generateError');
const resetRoomBtn = el('resetRoomBtn');

const looksGallery = el('looksGallery');
const looksEmpty = el('looksEmpty');
const voteTally = el('voteTally');
const voteTallyEmpty = el('voteTallyEmpty');
const voteHint = el('voteHint');

const toastContainer = el('toastContainer');

document.body.setAttribute('data-role', role);

// --- Small helpers ------------------------------------------------------

function getOrCreateVoterId() {
  const key = 'pawtry_voter_id';
  let id = localStorage.getItem(key);
  if (!id) {
    id = `voter-${crypto.randomUUID()}`;
    localStorage.setItem(key, id);
  }
  return id;
}

function showToast(message, kind = 'notice') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${kind}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}

function showError(message) {
  console.error(message);
  showToast(message, 'error');
}

function showNotice(message) {
  showToast(message, 'notice');
}

function setConnectionStatus(status) {
  connectionStatus.classList.remove('status-connecting', 'status-connected', 'status-error');
  if (status === 'connected') {
    connectionStatus.classList.add('status-connected');
    connectionStatus.textContent = 'Connected';
  } else if (status === 'error') {
    connectionStatus.classList.add('status-error');
    connectionStatus.textContent = 'Connection failed';
  } else {
    connectionStatus.classList.add('status-connecting');
    connectionStatus.textContent = 'Connecting…';
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// --- Room name / navigation -------------------------------------------------

roomNameInput.value = roomName;

goToRoomBtn.addEventListener('click', () => {
  const target = roomNameInput.value.trim();
  if (!target) return showError('Enter a room name first.');
  if (!/^[A-Za-z0-9_-]+$/.test(target)) {
    return showError('Room names can only use letters, numbers, "-" and "_".');
  }
  location.href = `/fitting/${encodeURIComponent(target)}?role=${role}`;
});

if (roomName) {
  copyLinkBtn.hidden = false;
  copyLinkBtn.addEventListener('click', async () => {
    const link = `${location.origin}/fitting/${encodeURIComponent(roomName)}?role=friend`;
    try {
      await navigator.clipboard.writeText(link);
      showNotice('Friend link copied to clipboard!');
    } catch {
      window.prompt('Copy this link and send it to your friend:', link);
    }
  });
}

// --- Config (outfits + demo mode badge) -------------------------------------

async function loadConfig() {
  const res = await fetch('/api/config');
  if (!res.ok) throw new Error('Failed to load app config');
  const config = await res.json();
  outfitCatalog = config.outfits || [];
  demoModeBadge.hidden = !config.demoMock;

  if (role === 'host') {
    useDemoVideoBtn.hidden = !config.demoVideoAvailable;
    demoVideoMissingNotice.hidden = config.demoVideoAvailable;
  }

  renderOutfitOptions();
}

function renderOutfitOptions() {
  outfitList.innerHTML = '';
  outfitCatalog.forEach((outfit) => {
    const card = document.createElement('div');
    card.className = 'outfit-card';
    card.dataset.outfitId = outfit.id;
    card.innerHTML = `
      <img src="${outfit.thumbnail}" alt="${escapeHtml(outfit.name)} (demo asset)" />
      <div class="outfit-name">${escapeHtml(outfit.name)}</div>
    `;
    card.addEventListener('click', () => {
      selectedOutfitId = outfit.id;
      [...outfitList.children].forEach((c) => c.classList.toggle('selected', c === card));
      updateGenerateButtonState();
    });
    outfitList.appendChild(card);
  });
}

function updateGenerateButtonState() {
  generateBtn.disabled = !(capturedFrameDataUrl && selectedOutfitId && !generating);
}

// --- Vonage: connect, publish (host), subscribe (friend) --------------------

async function fetchRoomCredentials(name) {
  const res = await fetch(`/room/${encodeURIComponent(name)}`);
  if (!res.ok) {
    throw new Error(`Server returned ${res.status} while creating the Vonage session`);
  }
  return res.json(); // { applicationId, sessionId, token }
}

function connectToVonage(name) {
  return fetchRoomCredentials(name).then((creds) => {
    if (!creds.applicationId || !creds.sessionId || !creds.token) {
      throw new Error('Server response is missing Vonage session details');
    }

    const s = OT.initSession(creds.applicationId, creds.sessionId);

    s.on('streamCreated', (event) => {
      if (role === 'friend') {
        s.subscribe(event.stream, subscriberContainer, { insertMode: 'append', width: '100%', height: '100%' }, (err) => {
          if (err) {
            showError('Failed to subscribe to the host stream: ' + err.message);
          } else {
            waitingForHost.hidden = true;
          }
        });
      }
    });

    s.on('streamDestroyed', () => {
      showNotice('The host stream ended.');
      if (role === 'friend') waitingForHost.hidden = false;
    });

    s.on('sessionDisconnected', (event) => {
      setConnectionStatus('error');
      showError('Disconnected from the video session' + (event.reason ? ` (${event.reason})` : ''));
    });

    s.on('signal:update', () => {
      refreshRoomState();
    });

    return new Promise((resolve, reject) => {
      s.connect(creds.token, (err) => {
        if (err) reject(err);
        else resolve(s);
      });
    });
  });
}

function notifyStateChanged() {
  if (!session) return;
  session.signal({ type: 'update', data: String(roomState ? roomState.version : '') }, (err) => {
    if (err) console.warn('Signal failed (state was still saved server-side):', err.message);
  });
}

// --- Host: video upload / playback / publishing ------------------------------

function loadVideoFile(file) {
  if (!file) {
    showError('No file selected. Please choose a video file.');
    return;
  }
  if (!file.type.startsWith('video/')) {
    showError('Unsupported file type. Please choose a video file (MP4 recommended).');
    return;
  }
  loadVideoUrl(URL.createObjectURL(file));
}

function loadVideoUrl(url) {
  hostVideo.src = url;
  hostVideo.loop = true;
  hostVideo.muted = true;

  hostVideo.onerror = () => showError('Video cannot play. Try a different MP4 file.');

  hostVideo.oncanplay = async () => {
    playBtn.disabled = false;
    pauseBtn.disabled = false;
    captureBtn.disabled = false;
    try {
      await hostVideo.play();
      publishVideoTrack();
    } catch (err) {
      showError('Video cannot play: ' + err.message);
    }
  };
}

function canvasFallbackTrack(video) {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;
  const ctx = canvas.getContext('2d');
  function draw() {
    if (!video.paused && !video.ended) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    }
    requestAnimationFrame(draw);
  }
  draw();
  return canvas.captureStream(25).getVideoTracks()[0];
}

function publishVideoTrack() {
  if (!session) return;

  let track;
  try {
    if (typeof hostVideo.captureStream === 'function') {
      track = hostVideo.captureStream().getVideoTracks()[0];
    } else {
      track = canvasFallbackTrack(hostVideo);
    }
  } catch (err) {
    console.warn('captureStream failed, falling back to canvas capture:', err);
    track = canvasFallbackTrack(hostVideo);
  }

  if (!track) {
    showError('Could not capture a video track to publish.');
    return;
  }

  if (publisher) {
    try { session.unpublish(publisher); } catch { /* ignore */ }
    publisher.destroy();
    publisher = null;
  }

  publisherContainer.hidden = false;
  publisher = OT.initPublisher(publisherContainer, {
    videoSource: track,
    audioSource: null,
    publishAudio: false,
    mirror: false,
    width: '100%',
    height: '100%',
  }, (err) => {
    if (err) showError('Publishing failed: ' + err.message);
  });

  session.publish(publisher, (err) => {
    if (err) showError('Publishing failed: ' + err.message);
    else showNotice('Publishing dog video to the room.');
  });
}

function captureFrame() {
  if (!hostVideo.videoWidth) {
    showError('Video is not ready yet.');
    return;
  }
  const canvas = document.createElement('canvas');
  canvas.width = hostVideo.videoWidth;
  canvas.height = hostVideo.videoHeight;
  canvas.getContext('2d').drawImage(hostVideo, 0, 0);
  capturedFrameDataUrl = canvas.toDataURL('image/jpeg', 0.9);
  capturedFrameImg.src = capturedFrameDataUrl;
  capturedFrameImg.hidden = false;
  capturedFrameEmpty.hidden = true;
  updateGenerateButtonState();
}

if (role === 'host') {
  hostVideoControls.hidden = false;
  capturedSection.hidden = false;
  outfitSection.hidden = false;

  uploadBtn.addEventListener('click', () => videoFileInput.click());
  videoFileInput.addEventListener('change', (e) => loadVideoFile(e.target.files[0]));
  useDemoVideoBtn.addEventListener('click', () => loadVideoUrl('/demo/dog-demo.mp4'));
  playBtn.addEventListener('click', () => hostVideo.play().catch((err) => showError('Video cannot play: ' + err.message)));
  pauseBtn.addEventListener('click', () => hostVideo.pause());
  captureBtn.addEventListener('click', captureFrame);
  generateBtn.addEventListener('click', generateLook);
  resetRoomBtn.addEventListener('click', resetRoom);
} else {
  voteHint.hidden = false;
}

// --- Generate / vote / finalize ---------------------------------------------

async function generateLook() {
  if (generating) return; // guards against duplicate clicks
  if (!capturedFrameDataUrl || !selectedOutfitId) return;

  generating = true;
  generateError.hidden = true;
  generateBtn.disabled = true;
  generateBtn.textContent = 'Generating…';

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45000); // Gemini calls normally take ~5-10s

  try {
    const res = await fetch(`/api/rooms/${encodeURIComponent(roomName)}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ frame: capturedFrameDataUrl, outfitId: selectedOutfitId }),
      signal: controller.signal,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Generation failed');
    applyRoomState(data);
    notifyStateChanged();
    showNotice('New look generated!');
  } catch (err) {
    const message = err.name === 'AbortError'
      ? 'The AI request timed out after 45s. Please try again.'
      : err.message;
    generateError.textContent = message;
    generateError.hidden = false;
    showError('Could not generate try-on: ' + message);
  } finally {
    clearTimeout(timeoutId);
    generating = false;
    generateBtn.textContent = 'Generate AI Try-On';
    updateGenerateButtonState();
  }
}

async function voteForLook(lookId) {
  try {
    const res = await fetch(`/api/rooms/${encodeURIComponent(roomName)}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voterId, lookId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Vote failed');
    applyRoomState(data);
    notifyStateChanged();
  } catch (err) {
    showError('Could not vote: ' + err.message);
  }
}

async function finalizeLook(lookId) {
  try {
    const res = await fetch(`/api/rooms/${encodeURIComponent(roomName)}/finalize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lookId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Finalize failed');
    applyRoomState(data);
    notifyStateChanged();
    showNotice('Final look locked in!');
  } catch (err) {
    showError('Could not finalize look: ' + err.message);
  }
}

async function resetRoom() {
  const confirmed = window.confirm('Reset this room? This clears all generated looks, votes, and the final pick for everyone.');
  if (!confirmed) return;

  try {
    const res = await fetch(`/api/rooms/${encodeURIComponent(roomName)}/reset`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Reset failed');

    // Clear local capture/selection state too, so the host starts a clean cycle.
    capturedFrameDataUrl = null;
    capturedFrameImg.hidden = true;
    capturedFrameEmpty.hidden = false;
    selectedOutfitId = null;
    [...outfitList.children].forEach((c) => c.classList.remove('selected'));
    updateGenerateButtonState();

    applyRoomState(data);
    notifyStateChanged();
    showNotice('Room reset - ready for a new round.');
  } catch (err) {
    showError('Could not reset room: ' + err.message);
  }
}

// --- Rendering ----------------------------------------------------------

async function refreshRoomState() {
  try {
    const res = await fetch(`/api/rooms/${encodeURIComponent(roomName)}/state`);
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    applyRoomState(await res.json());
  } catch (err) {
    showError('Could not refresh room state: ' + err.message);
  }
}

function applyRoomState(state) {
  roomState = state;
  renderLooks();
  renderVoteTally();
}

function renderLooks() {
  const looks = roomState?.looks || [];
  looksEmpty.hidden = looks.length > 0;
  looksGallery.querySelectorAll('.look-card').forEach((n) => n.remove());

  looks.forEach((look) => {
    const isFinal = roomState.finalLookId === look.id;
    const card = document.createElement('div');
    card.className = 'look-card' + (isFinal ? ' is-final' : '');
    card.innerHTML = `
      <img src="${look.imageUrl}" alt="Generated look: ${escapeHtml(look.outfitName)}" />
      <div class="look-card-body">
        <div class="look-card-title">${escapeHtml(look.outfitName)}</div>
        <div class="look-card-meta">${new Date(look.createdAt).toLocaleTimeString()}</div>
        ${isFinal ? '<div class="final-flag">✓ FINAL PICK</div>' : ''}
        <div class="look-card-actions"></div>
      </div>
    `;
    const actions = card.querySelector('.look-card-actions');

    if (role === 'friend') {
      const voteBtn = document.createElement('button');
      voteBtn.className = 'btn btn-small';
      const isMyVote = roomState.votes[voterId] === look.id;
      voteBtn.textContent = isMyVote ? '✓ Your vote' : 'Vote for this look';
      voteBtn.disabled = isMyVote;
      voteBtn.addEventListener('click', () => voteForLook(look.id));
      actions.appendChild(voteBtn);
    }

    if (role === 'host') {
      const finalizeBtn = document.createElement('button');
      finalizeBtn.className = 'btn btn-small';
      finalizeBtn.textContent = isFinal ? '✓ Finalized' : 'Finalize this look';
      finalizeBtn.disabled = isFinal;
      finalizeBtn.addEventListener('click', () => finalizeLook(look.id));
      actions.appendChild(finalizeBtn);
    }

    looksGallery.appendChild(card);
  });
}

function renderVoteTally() {
  const votes = roomState?.votes || {};
  const looks = roomState?.looks || [];
  const counts = {};
  Object.values(votes).forEach((lookId) => { counts[lookId] = (counts[lookId] || 0) + 1; });
  const totalVotes = Object.values(counts).reduce((a, b) => a + b, 0);

  voteTally.querySelectorAll('.vote-row').forEach((n) => n.remove());
  voteTallyEmpty.hidden = totalVotes > 0;

  looks.forEach((look) => {
    const count = counts[look.id] || 0;
    if (count === 0 && totalVotes === 0) return;
    const pct = totalVotes ? Math.round((count / totalVotes) * 100) : 0;
    const row = document.createElement('div');
    row.className = 'vote-row';
    row.innerHTML = `
      <span>${escapeHtml(look.outfitName)}</span>
      <span class="vote-bar-track"><span class="vote-bar-fill" style="width:${pct}%"></span></span>
      <span>${count}</span>
    `;
    voteTally.appendChild(row);
  });
}

// --- Boot -----------------------------------------------------------------

async function boot() {
  if (!roomName) {
    appEl.hidden = true;
    showError('No room specified. Enter a room name above and click "Go".');
    setConnectionStatus('error');
    return;
  }

  appEl.hidden = false;

  try {
    await loadConfig();
  } catch (err) {
    showError('Could not load app config: ' + err.message);
  }

  // Show any existing looks/votes immediately, even before Vonage connects,
  // so a late joiner never has to wait on the video session to see results.
  await refreshRoomState();

  try {
    session = await connectToVonage(roomName);
    setConnectionStatus('connected');
    await refreshRoomState();
  } catch (err) {
    setConnectionStatus('error');
    showError('Vonage connection failed: ' + err.message);
  }
}

boot();
