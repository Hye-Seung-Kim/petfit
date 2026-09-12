// In-memory room state for PawTry Together.
//
// IMPORTANT: This is intentionally NOT persisted anywhere. A server restart
// clears all rooms, looks, and votes. That's an accepted tradeoff for the
// hackathon MVP (see README). The server is the single source of truth;
// clients never mutate this state directly, they always go through the
// /api/rooms/:room/* endpoints and re-fetch /api/rooms/:room/state.

const rooms = new Map();

function freshRoom(roomName) {
  return {
    roomName,
    status: 'ready',
    looks: [],
    votes: {},
    finalLookId: null,
    version: 1,
  };
}

function getOrCreateRoom(roomName) {
  if (!rooms.has(roomName)) {
    rooms.set(roomName, freshRoom(roomName));
  }
  return rooms.get(roomName);
}

/** Returns the current state for a room, creating it if it doesn't exist yet. */
export function getState(roomName) {
  return getOrCreateRoom(roomName);
}

/** Appends a generated look to a room and bumps the version. */
export function addLook(roomName, look) {
  const room = getOrCreateRoom(roomName);
  room.looks.push(look);
  room.version += 1;
  return room;
}

/** Records (or replaces) one participant's vote. Throws Error('LOOK_NOT_FOUND') if invalid. */
export function setVote(roomName, voterId, lookId) {
  const room = getOrCreateRoom(roomName);
  if (!room.looks.some((look) => look.id === lookId)) {
    throw new Error('LOOK_NOT_FOUND');
  }
  room.votes[voterId] = lookId;
  room.version += 1;
  return room;
}

/** Sets the host-chosen final look. Throws Error('LOOK_NOT_FOUND') if invalid. */
export function finalizeLook(roomName, lookId) {
  const room = getOrCreateRoom(roomName);
  if (!room.looks.some((look) => look.id === lookId)) {
    throw new Error('LOOK_NOT_FOUND');
  }
  room.finalLookId = lookId;
  room.version += 1;
  return room;
}

/** Test-only helper to reset all in-memory rooms between test cases. */
export function _resetAllRoomsForTests() {
  rooms.clear();
}
