/**
 * Tests where a call's audio is sent, against a fake device list.
 *
 * This module's job is to be honest about a thing the web is bad at. `setSinkId`
 * is the only lever a page has over audio output, and what it can reach varies
 * from "every output on the machine" (desktop Chrome) through "the earpiece and
 * the speaker, sometimes" (Android Chrome) to "nothing at all" (iOS Safari). A
 * speakerphone button that lights up without moving any sound is worse than one
 * that admits it cannot help, so the cases that matter are the negative ones:
 *
 *   - A call starts on the earpiece, never the speaker. That is the whole
 *     complaint this was written for.
 *   - `default` and `communications` are Chrome's own aliases, not hardware.
 *     Matching them would give a button that appears to work and changes
 *     nothing — the exact failure the module exists to avoid.
 *   - Nothing to switch to reports as not switchable, so the UI can say so.
 *   - A refused or impossible `setSinkId` reports failure rather than claiming
 *     the route it was asked for.
 *   - The cache is dropped when the devices change, or plugging in headphones
 *     would leave the call pointed at a device that is no longer there.
 *
 * Run: node scripts/audioroute.test.mjs   (from frontend/)
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/* ── a device list and an element, in as few lines as the module needs ── */

let devices = [];
let enumerateThrows = false;
let sinkIdSupported = true;
const sinkCalls = [];
let sinkRefusesWith = null;

const listeners = new Map();

const fakeMediaDevices = {
  enumerateDevices: async () => {
    if (enumerateThrows) throw new Error('refused');
    return devices;
  },
  addEventListener: (type, fn) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
  },
  removeEventListener: (type, fn) => listeners.get(type)?.delete(fn),
};

Object.defineProperty(globalThis, 'navigator', {
  value: { mediaDevices: fakeMediaDevices },
  writable: true,
  configurable: true,
});

const makeElement = () => {
  const el = { sinkId: '' };
  if (sinkIdSupported) {
    el.setSinkId = async (id) => {
      sinkCalls.push(id);
      if (sinkRefusesWith) throw new Error(sinkRefusesWith);
      el.sinkId = id;
    };
  }
  return el;
};

globalThis.document = {
  createElement: () => makeElement(),
};

const fireDeviceChange = () => [...(listeners.get('devicechange') || [])].forEach((fn) => fn());

const source = fs.readFileSync(path.resolve('src/lib/audioroute.js'), 'utf8');
const shim = path.resolve('src/lib/.audioroute.undertest.mjs');
fs.writeFileSync(shim, source);
const route = await import(pathToFileURL(shim).href);

/* ── cases ── */

const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(['PASS', name]);
  } catch (err) {
    results.push(['FAIL', name + ' — ' + err.message]);
  }
};
const assert = (cond, message) => {
  if (!cond) throw new Error(message);
};

/** A phone that exposes both, the case where this actually works. */
const BOTH = [
  { kind: 'audiooutput', deviceId: 'default', label: 'Default' },
  { kind: 'audiooutput', deviceId: 'communications', label: 'Communications' },
  { kind: 'audiooutput', deviceId: 'ear-1', label: 'Earpiece' },
  { kind: 'audiooutput', deviceId: 'spk-1', label: 'Speakerphone' },
  { kind: 'audioinput', deviceId: 'mic-1', label: 'Microphone' },
];

const reset = (list = BOTH) => {
  devices = list;
  enumerateThrows = false;
  sinkIdSupported = true;
  sinkRefusesWith = null;
  sinkCalls.length = 0;
  fireDeviceChange(); // clears the module's cache
};

await check('a call goes to the earpiece, not the speaker', async () => {
  reset();
  const el = makeElement();
  const got = await route.routeTo(el, 'earpiece');

  assert(got === 'earpiece', 'asking for the earpiece gave ' + got);
  assert(el.sinkId === 'ear-1', 'the sound went to ' + el.sinkId + ' instead of the earpiece');
});

await check('pressing speaker moves it, and pressing again moves it back', async () => {
  reset();
  const el = makeElement();

  assert((await route.routeTo(el, 'speaker')) === 'speaker', 'could not reach the speaker');
  assert(el.sinkId === 'spk-1', 'speaker went to ' + el.sinkId);

  assert((await route.routeTo(el, 'earpiece')) === 'earpiece', 'could not get back');
  assert(el.sinkId === 'ear-1', 'earpiece went to ' + el.sinkId);
});

await check("Chrome's own aliases are not mistaken for hardware", async () => {
  /* The list a device gives when it will not expose the real outputs. Treating
     `default` as an earpiece is how a speakerphone button comes to light up over
     audio that has not moved an inch. */
  reset([
    { kind: 'audiooutput', deviceId: 'default', label: 'Default' },
    { kind: 'audiooutput', deviceId: 'communications', label: 'Communications' },
  ]);

  const found = await route.outputs();
  assert(!found.earpiece, 'an alias was taken for an earpiece: ' + found.earpiece);
  assert(!found.speaker, 'an alias was taken for a speaker: ' + found.speaker);
  assert((await route.canSwitch()) === false, 'claimed to be switchable with no real outputs');

  const el = makeElement();
  assert((await route.routeTo(el, 'speaker')) === null, 'claimed a route it could not make');
  assert(el.sinkId === '', 'moved the sound to ' + el.sinkId + ' — there was nowhere to move it');
});

await check('an unlabelled list reports as not switchable', async () => {
  // What a browser gives before microphone permission: one entry, no label.
  reset([{ kind: 'audiooutput', deviceId: '', label: '' }]);
  assert((await route.canSwitch()) === false, 'claimed to be switchable with no labels');
});

await check('one output alone is not a toggle', async () => {
  reset([{ kind: 'audiooutput', deviceId: 'spk-1', label: 'Speakerphone' }]);

  assert((await route.canSwitch()) === false, 'a single output was offered as a toggle');

  // The one it does have is still reachable — it just cannot be switched away
  // from, which is a different statement.
  const el = makeElement();
  assert((await route.routeTo(el, 'speaker')) === 'speaker', 'could not reach the only output');
  assert((await route.routeTo(el, 'earpiece')) === null, 'invented an earpiece');
});

await check('a browser without setSinkId says so rather than failing quietly', async () => {
  reset();
  sinkIdSupported = false;

  assert(route.supported() === false, 'claimed support with no setSinkId');
  assert((await route.canSwitch()) === false, 'claimed to be switchable with no setSinkId');
  assert((await route.routeTo(makeElement(), 'speaker')) === null, 'claimed a route');
});

await check('a refused setSinkId is reported as a failure, not a success', async () => {
  reset();
  sinkRefusesWith = 'NotAllowedError';

  const el = makeElement();
  const got = await route.routeTo(el, 'speaker');

  assert(sinkCalls.includes('spk-1'), 'it never tried');
  assert(got === null, 'a refused switch reported ' + got);
});

await check('an enumeration that throws does not take the call down', async () => {
  reset();
  enumerateThrows = true;

  const found = await route.outputs({ refresh: true });
  assert(found.all.length === 0, 'invented devices out of a failure');
  assert((await route.canSwitch()) === false, 'claimed to be switchable after a failure');
});

await check('plugging in headphones re-reads the devices', async () => {
  reset();
  assert((await route.canSwitch()) === true, 'both outputs should be switchable to begin with');

  // Headphones arrive and the earpiece is no longer offered.
  devices = [
    { kind: 'audiooutput', deviceId: 'hp-1', label: 'Headphones' },
    { kind: 'audiooutput', deviceId: 'spk-1', label: 'Speakerphone' },
  ];

  /* Without the cache being dropped this still answers from the old list, and
     the call carries on pointing at a device that has gone. */
  let told = false;
  const unwatch = route.watchDevices(() => {
    told = true;
  });
  fireDeviceChange();
  unwatch();

  assert(told, 'nothing was told the devices had changed');

  const found = await route.outputs();
  assert(found.earpiece === null, 'still offering an earpiece that is no longer there');
  assert(
    found.all.some((d) => d.id === 'hp-1'),
    'the new device was not picked up'
  );
});

await check('unwatching actually stops the callbacks', async () => {
  reset();
  let count = 0;
  const unwatch = route.watchDevices(() => {
    count += 1;
  });
  fireDeviceChange();
  unwatch();
  fireDeviceChange();

  assert(count === 1, 'got ' + count + ' callbacks — a call screen would leak one per call');
});

/* ── report ── */

fs.unlinkSync(shim);

const failed = results.filter(([r]) => r === 'FAIL');
results.forEach(([r, name]) => console.log(r === 'PASS' ? '  ok  ' + name : '  FAIL  ' + name));
console.log(
  '\n' + (results.length - failed.length) + '/' + results.length + ' audio-route checks passed'
);
process.exit(failed.length ? 1 : 0);
