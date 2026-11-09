// Phones talk to the TV over WebRTC data channels (PeerJS). PeerJS's free public server only
// introduces a phone to the TV; after that, messages go straight between them on the home network
// (or through a relay when a network won't allow a direct line). The TV claims the room's id
// ("clawstruction-v1-<code>"), and each phone connects to it.
//
// For testing on one computer there is also a "local" transport (BroadcastChannel between tabs),
// used when the page has ?local in its address. Both transports call the same callbacks.
import { Peer } from 'peerjs';
import { Mqtt } from './mqtt.js';

// The backup route (when the phone and the TV can't get a WebRTC line): free public MQTT brokers pass
// the messages along. The TV listens on all of them; a phone tries them one after another.
export const RELAYS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081'];
const topicFor = (code) => `clawstruction/v1/${String(code).toLowerCase()}`;
const uid = () => Math.random().toString(36).slice(2, 10);

const PREFIX = 'clawstruction-v1-';
export const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O (they look like 1 and 0)
export const PROTOCOL = 1;
const ICE = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
  // a second free relay, also over the web's own ports (80 and 443, TCP too) for networks that block the rest
  { urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' },
];
const BACKLOG = 64 * 1024; // bytes waiting on a line before droppable messages are skipped

export function randomCode() {
  let s = '';
  for (let i = 0; i < 4; i++) s += CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)];
  return s;
}
export const cleanCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
const peerIdFor = (code) => PREFIX + code.toLowerCase();

// ---------- the TV ----------

// handlers: onReady(code), onJoin(cid, hello), onMessage(cid, msg), onLeave(cid), onStatus(text)
// keep: the code was this TV's before a reload, so phones may still be using it; try hard to get it back
export function createHost({ code, local, keep = false, relays = RELAYS, ...h }) {
  return local ? localHost(code, h) : comboHost(code, keep, relays, h);
}

// the TV on both routes at once: each phone is answered on the route it last spoke on
function comboHost(code, keep, relays, h) {
  const via = new Map(); // cid -> 'peer' | 'relay'
  let peerState = 'connecting', relayUp = false;
  const status = () => h.onStatus?.(peerState === 'ready' || relayUp ? 'ready' : peerState);
  let relay = null;
  const peer = peerHost(code, keep, {
    onReady: (c) => { relay?.setCode(c); h.onReady?.(c); },
    onJoin: (cid, m) => { via.set(cid, 'peer'); h.onJoin?.(cid, m); },
    onMessage: (cid, m) => { via.set(cid, 'peer'); h.onMessage?.(cid, m); },
    onLeave: (cid) => { if (via.get(cid) === 'peer') { via.delete(cid); h.onLeave?.(cid); } },
    onStatus: (s) => { peerState = s; status(); },
  });
  relay = relayHost(peer.code, relays, {
    onReady: () => { if (!relayUp) { relayUp = true; h.onReady?.(peer.code); status(); } },
    onJoin: (cid, m) => { via.set(cid, 'relay'); h.onJoin?.(cid, m); },
    onMessage: (cid, m) => { via.set(cid, 'relay'); h.onMessage?.(cid, m); },
    onLeave: (cid) => { if (via.get(cid) === 'relay') { via.delete(cid); h.onLeave?.(cid); } },
  });
  return {
    get code() { return peer.code; },
    send(cid, msg, droppable = false) { (via.get(cid) === 'relay' ? relay : peer).send(cid, msg, droppable); },
    drop(cid) { peer.drop(cid); },
    close() { peer.close(); relay.close(); },
  };
}

function relayHost(code, relays, h) {
  const route = new Map(); // cid -> { m: the broker it's on, seen }
  const subscribeAll = () => { for (const m of brokers) m.subscribe(topicFor(code) + '/h'); };
  const brokers = relays.map((url) => {
    const m = new Mqtt(url, {
      clientId: 'claw-tv-' + uid(),
      onReady: () => h.onReady?.(),
      onMessage: (topic, text) => {
        if (topic !== topicFor(code) + '/h' || text.length > 4000) return;
        let p;
        try { p = JSON.parse(text); } catch { return; }
        if (!p || typeof p.cid !== 'string' || p.cid.length > 40 || !p.msg || typeof p.msg !== 'object') return;
        const known = route.get(p.cid);
        if (p.msg.t === 'hello') { route.set(p.cid, { m, seen: Date.now() }); h.onJoin?.(p.cid, p.msg); return; }
        if (!known) return;
        known.m = m; known.seen = Date.now();
        h.onMessage?.(p.cid, p.msg);
      },
    });
    return m;
  });
  subscribeAll();
  // phones ping every second: a silent one has gone
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [cid, r] of route) if (now - r.seen > 6000) { route.delete(cid); h.onLeave?.(cid); }
  }, 1000);
  return {
    setCode(c) {
      if (c === code) return;
      for (const m of brokers) m.unsubscribe(topicFor(code) + '/h');
      code = c;
      subscribeAll();
    },
    send(cid, msg, droppable = false) {
      const r = route.get(cid);
      if (!r || (droppable && r.m.backlog > BACKLOG)) return;
      r.m.publish(`${topicFor(code)}/c/${cid}`, JSON.stringify(msg));
    },
    close() { clearInterval(timer); for (const m of brokers) m.close(); },
  };
}

function peerHost(code, keep, h) {
  const links = new Map(); // cid -> DataConnection
  let peer = null;
  let closed = false;
  let retry = 0;
  let taken = 0;

  const start = () => {
    peer = new Peer(peerIdFor(code), { config: { iceServers: ICE }, debug: 1 });
    peer.on('open', () => { retry = 0; h.onReady?.(code); h.onStatus?.('ready'); });
    peer.on('connection', (conn) => {
      let cid = null;
      conn.on('data', (msg) => {
        if (!msg || typeof msg !== 'object') return;
        if (!cid) {
          if (msg.t !== 'hello' || typeof msg.cid !== 'string' || msg.cid.length > 40) { conn.close(); return; }
          cid = msg.cid;
          const old = links.get(cid);
          links.set(cid, conn);
          if (old && old !== conn) old.close();
          h.onJoin?.(cid, msg);
          return;
        }
        h.onMessage?.(cid, msg);
      });
      conn.on('close', () => {
        if (cid && links.get(cid) === conn) { links.delete(cid); h.onLeave?.(cid); }
      });
      conn.on('error', () => {});
    });
    peer.on('disconnected', () => {
      // lost the introduction server (phones already connected keep working); get it back for new ones
      if (!closed) setTimeout(() => { if (!closed && peer && !peer.destroyed) peer.reconnect(); }, 1500);
    });
    peer.on('error', (err) => {
      if (closed) return;
      if (err.type === 'unavailable-id') {
        // the code is in use: after a reload that's usually our own old page, still being let go of
        peer.destroy();
        taken++;
        if (!keep || taken > 4) { code = randomCode(); taken = 0; keep = false; start(); }
        else setTimeout(() => { if (!closed) start(); }, 2000);
      } else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) {
        h.onStatus?.('offline');
        if (peer.destroyed || !peer.open) {
          retry++;
          setTimeout(() => { if (!closed) { try { peer.destroy(); } catch { /* gone */ } start(); } }, Math.min(10000, 1500 * retry));
        }
      }
    });
  };
  start();

  return {
    get code() { return code; },
    send(cid, msg, droppable = false) {
      const c = links.get(cid);
      if (!c || !c.open) return;
      if (droppable && (c.dataChannel?.bufferedAmount || 0) > BACKLOG) return;
      try { c.send(msg); } catch { /* the line went away */ }
    },
    drop(cid) { const c = links.get(cid); if (c) c.close(); },
    close() { closed = true; for (const c of links.values()) c.close(); peer?.destroy(); },
  };
}

function localHost(code, h) {
  const bc = new BroadcastChannel('clawstruction-' + code);
  const seen = new Map(); // cid -> last heard
  bc.onmessage = ({ data }) => {
    if (!data || data.k !== 'c2h' || typeof data.cid !== 'string') return;
    const { cid, msg } = data;
    if (msg?.t === 'hello') { seen.set(cid, Date.now()); h.onJoin?.(cid, msg); return; }
    if (msg?.t === 'bye') { if (seen.delete(cid)) h.onLeave?.(cid); return; }
    if (!seen.has(cid)) return;
    seen.set(cid, Date.now());
    h.onMessage?.(cid, msg);
  };
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [cid, t] of seen) if (now - t > 5000) { seen.delete(cid); h.onLeave?.(cid); }
  }, 1000);
  setTimeout(() => { h.onReady?.(code); h.onStatus?.('ready'); }, 0);
  return {
    get code() { return code; },
    send(cid, msg) { bc.postMessage({ k: 'h2c', cid, msg }); },
    drop(cid) { seen.delete(cid); },
    close() { clearInterval(timer); bc.close(); },
  };
}

// ---------- a phone ----------

// handlers: onOpen(), onMessage(msg), onClose(), onStatus(state, detail)
// state: 'connecting' | 'open' | 'reconnecting' | 'noroom' | 'offline'
export function joinRoom({ code, local, hello, relays = RELAYS, ...h }) {
  return local ? localClient(code, hello, h) : comboClient(code, hello, relays, h);
}

// a phone: WebRTC first; if the TV hasn't answered within 8 s (or that route can't work), the backup
// route too. Whichever route the TV last answered on is the one the phone talks on.
function comboClient(code, hello, relays, h) {
  let active = null, relay = null, closed = false;
  const fromPeer = (msg) => { active = peer; h.onMessage?.(msg); };
  const startRelay = () => {
    if (relay || closed || !relays.length) return;
    h.onStatus?.('connecting', 'relay');
    relay = relayClient(code, hello, relays, {
      onMessage: (msg) => { active = relay; h.onMessage?.(msg); },
      onStatus: (s, d) => { if (active !== peer) h.onStatus?.(s, d); },
      onClose: () => { if (active === relay) { active = null; h.onClose?.(); } },
    });
  };
  const peer = peerClient(code, hello, {
    onMessage: fromPeer,
    onOpen: () => h.onOpen?.(),
    onClose: () => { if (active === peer) { active = null; h.onClose?.(); } },
    onStatus: (s, d) => {
      if (s === 'noroom' || s === 'offline') startRelay();
      // once the backup route is trying, its news is what matters (unless this line works)
      if (!relay || s === 'open' || active === peer) h.onStatus?.(s, d);
    },
  });
  const fallback = setTimeout(() => { if (!active) startRelay(); }, 8000);
  return {
    send(msg) { (active || peer).send(msg); },
    get open() { return !!active; },
    close() { closed = true; clearTimeout(fallback); peer.close(); relay?.close(); },
  };
}

function relayClient(code, hello, relays, h) {
  const cid = hello.cid;
  let i = -1, m = null, heard = 0, tried = 0, closed = false, open = false;
  const base = topicFor(code);
  const post = (msg) => m && m.publish(base + '/h', JSON.stringify({ cid, msg }));
  const next = () => {
    if (closed) return;
    m?.close();
    i = (i + 1) % relays.length;
    tried = Date.now();
    m = new Mqtt(relays[i], {
      clientId: 'claw-pad-' + uid(),
      onReady: () => { m.subscribe(`${base}/c/${cid}`); post({ ...hello, t: 'hello', v: PROTOCOL }); },
      onMessage: (topic, text) => {
        let msg;
        try { msg = JSON.parse(text); } catch { return; }
        if (!msg || typeof msg !== 'object') return;
        heard = Date.now();
        if (!open) { open = true; h.onStatus?.('open'); }
        h.onMessage?.(msg);
      },
    });
  };
  next();
  const timer = setInterval(() => {
    if (closed) return;
    const now = Date.now();
    if (open && now - heard > 6000) { open = false; h.onClose?.(); h.onStatus?.('reconnecting', 'relay'); }
    if (!open) {
      // no answer on this broker: say hello again, and after a while try the next one
      if (m && m.ready) post({ ...hello, t: 'hello', v: PROTOCOL });
      if (now - Math.max(tried, heard) > 9000) next();
    } else post({ t: 'ping' });
  }, 1000);
  return {
    send(msg) { if (open) post(msg); },
    close() { closed = true; clearInterval(timer); if (m) { post({ t: 'bye' }); m.close(); } },
  };
}

function peerClient(code, hello, h) {
  let peer = null, conn = null, closed = false;
  let lastHeard = 0, misses = 0, timer = null, connectTimer = null, failed = 0, linkTimer = null;

  const connect = () => {
    if (closed || !peer || peer.destroyed) return;
    if (peer.disconnected) { peer.reconnect(); return; }
    clearTimeout(connectTimer);
    const c = peer.connect(peerIdFor(code), { reliable: true, serialization: 'json' });
    conn = c;
    // a connection that never opens (the TV is gone, or the network blocks it). A line through a relay
    // can take a while, so give it time; after a few failures start again from scratch.
    connectTimer = setTimeout(() => {
      if (conn !== c || c.open) return;
      c.close();
      failed++;
      if (failed >= 3) { failed = 0; restart(); } else scheduleRetry();
    }, 15000);
    // say how the line itself is doing (checking, connected, failed), for the "connecting" screen
    clearInterval(linkTimer);
    linkTimer = setInterval(() => {
      if (conn !== c || c.open) { clearInterval(linkTimer); return; }
      const st = c.peerConnection && c.peerConnection.iceConnectionState;
      if (st) h.onStatus?.('connecting', 'link:' + st);
    }, 1000);
    c.on('open', () => {
      if (conn !== c) return;
      clearTimeout(connectTimer);
      clearInterval(linkTimer);
      misses = 0;
      failed = 0;
      lastHeard = Date.now();
      c.send({ ...hello, t: 'hello', v: PROTOCOL });
      h.onStatus?.('open');
      h.onOpen?.();
    });
    c.on('data', (msg) => {
      if (conn !== c || !msg || typeof msg !== 'object') return;
      lastHeard = Date.now();
      h.onMessage?.(msg);
    });
    c.on('close', () => {
      if (conn !== c) return;
      conn = null;
      h.onClose?.();
      scheduleRetry();
    });
    c.on('error', () => {});
  };

  const scheduleRetry = () => {
    if (closed) return;
    h.onStatus?.('reconnecting');
    clearTimeout(connectTimer);
    connectTimer = setTimeout(connect, 1500);
  };

  const restart = () => {
    if (closed) return;
    try { peer.destroy(); } catch { /* already */ }
    start();
  };

  const start = () => {
    h.onStatus?.('connecting', 'server');
    peer = new Peer({ config: { iceServers: ICE }, debug: 1 });
    peer.on('open', () => { h.onStatus?.('connecting', 'tv'); connect(); });
    peer.on('disconnected', () => { if (!closed) setTimeout(() => { if (!closed && !peer.destroyed) peer.reconnect(); }, 1000); });
    peer.on('error', (err) => {
      if (closed) return;
      if (err.type === 'peer-unavailable') {
        // no TV with that code (yet): it may be reloading, so keep trying for a bit
        misses++;
        h.onStatus?.(misses >= 4 ? 'noroom' : 'reconnecting');
        clearTimeout(connectTimer);
        connectTimer = setTimeout(connect, misses >= 4 ? 4000 : 1500);
      } else if (['network', 'server-error', 'socket-error', 'socket-closed', 'browser-incompatible'].includes(err.type)) {
        h.onStatus?.('offline', err.type);
        if (peer.destroyed) setTimeout(() => { if (!closed) start(); }, 3000);
      }
    });
  };
  start();

  // the TV sends something several times a second: silence means the line is dead
  timer = setInterval(() => {
    if (!conn || !conn.open) return;
    try { conn.send({ t: 'ping' }); } catch { /* closed */ }
    if (Date.now() - lastHeard > 6000) { conn.close(); }
  }, 1000);

  return {
    send(msg) { if (conn && conn.open) { try { conn.send(msg); } catch { /* closed */ } } },
    get open() { return !!conn && conn.open; },
    close() { closed = true; clearInterval(timer); clearInterval(linkTimer); clearTimeout(connectTimer); conn?.close(); peer?.destroy(); },
  };
}

function localClient(code, hello, h) {
  const bc = new BroadcastChannel('clawstruction-' + code);
  const cid = hello.cid;
  let open = false, lastHeard = 0;
  const post = (msg) => bc.postMessage({ k: 'c2h', cid, msg });
  bc.onmessage = ({ data }) => {
    if (!data || data.k !== 'h2c' || data.cid !== cid) return;
    lastHeard = Date.now();
    if (!open) { open = true; h.onStatus?.('open'); h.onOpen?.(); }
    h.onMessage?.(data.msg);
  };
  h.onStatus?.('connecting');
  const timer = setInterval(() => {
    if (!open || Date.now() - lastHeard > 4000) {
      if (open) { open = false; h.onClose?.(); h.onStatus?.('reconnecting'); }
      post({ ...hello, t: 'hello', v: PROTOCOL });
    } else post({ t: 'ping' });
  }, 1000);
  post({ ...hello, t: 'hello', v: PROTOCOL });
  addEventListener('pagehide', () => post({ t: 'bye' }));
  return {
    send(msg) { if (open) post(msg); },
    get open() { return open; },
    close() { post({ t: 'bye' }); clearInterval(timer); bc.close(); },
  };
}
