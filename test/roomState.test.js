import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getState,
  addLook,
  setVote,
  finalizeLook,
  _resetAllRoomsForTests,
} from '../services/roomState.js';

test.beforeEach(() => {
  _resetAllRoomsForTests();
});

test('getState creates a fresh room with expected defaults', () => {
  const state = getState('demo-room');
  assert.equal(state.roomName, 'demo-room');
  assert.equal(state.status, 'ready');
  assert.deepEqual(state.looks, []);
  assert.deepEqual(state.votes, {});
  assert.equal(state.finalLookId, null);
  assert.equal(state.version, 1);
});

test('getState returns the same room object on repeated calls (in-memory identity)', () => {
  const first = getState('demo-room');
  const second = getState('demo-room');
  assert.strictEqual(first, second);
});

test('addLook appends a look and increments version', () => {
  const look = { id: 'look-1', outfitId: 'red-hoodie', outfitName: 'Red Hoodie', imageUrl: '/generated/look-1.png', createdAt: new Date().toISOString() };
  const room = addLook('demo-room', look);
  assert.equal(room.looks.length, 1);
  assert.deepEqual(room.looks[0], look);
  assert.equal(room.version, 2);
});

test('setVote records a vote for an existing look and increments version', () => {
  const look = { id: 'look-1', outfitId: 'red-hoodie', outfitName: 'Red Hoodie', imageUrl: '/generated/look-1.png', createdAt: new Date().toISOString() };
  addLook('demo-room', look);
  const room = setVote('demo-room', 'friend-1', 'look-1');
  assert.equal(room.votes['friend-1'], 'look-1');
  assert.equal(room.version, 3);
});

test('setVote lets a voter replace their previous vote', () => {
  addLook('demo-room', { id: 'look-1', outfitId: 'red-hoodie', outfitName: 'Red Hoodie', imageUrl: '/generated/look-1.png', createdAt: new Date().toISOString() });
  addLook('demo-room', { id: 'look-2', outfitId: 'tuxedo', outfitName: 'Formal Tuxedo', imageUrl: '/generated/look-2.png', createdAt: new Date().toISOString() });
  setVote('demo-room', 'friend-1', 'look-1');
  const room = setVote('demo-room', 'friend-1', 'look-2');
  assert.equal(room.votes['friend-1'], 'look-2');
  assert.equal(Object.keys(room.votes).length, 1);
});

test('setVote throws LOOK_NOT_FOUND for an unknown look id', () => {
  assert.throws(() => setVote('demo-room', 'friend-1', 'nope'), /LOOK_NOT_FOUND/);
});

test('finalizeLook sets finalLookId for an existing look and increments version', () => {
  addLook('demo-room', { id: 'look-1', outfitId: 'red-hoodie', outfitName: 'Red Hoodie', imageUrl: '/generated/look-1.png', createdAt: new Date().toISOString() });
  const room = finalizeLook('demo-room', 'look-1');
  assert.equal(room.finalLookId, 'look-1');
  assert.equal(room.version, 3);
});

test('finalizeLook throws LOOK_NOT_FOUND for an unknown look id', () => {
  assert.throws(() => finalizeLook('demo-room', 'nope'), /LOOK_NOT_FOUND/);
});

test('rooms are isolated from each other', () => {
  addLook('room-a', { id: 'look-1', outfitId: 'red-hoodie', outfitName: 'Red Hoodie', imageUrl: '/generated/look-1.png', createdAt: new Date().toISOString() });
  const roomB = getState('room-b');
  assert.deepEqual(roomB.looks, []);
  assert.equal(roomB.version, 1);
});

test('a late joiner reading state sees existing looks and votes', () => {
  addLook('demo-room', { id: 'look-1', outfitId: 'red-hoodie', outfitName: 'Red Hoodie', imageUrl: '/generated/look-1.png', createdAt: new Date().toISOString() });
  setVote('demo-room', 'friend-1', 'look-1');
  finalizeLook('demo-room', 'look-1');

  const lateJoinerView = getState('demo-room');
  assert.equal(lateJoinerView.looks.length, 1);
  assert.equal(lateJoinerView.votes['friend-1'], 'look-1');
  assert.equal(lateJoinerView.finalLookId, 'look-1');
});
