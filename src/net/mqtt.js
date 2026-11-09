// A very small MQTT 3.1.1 client over WebSocket: connect, subscribe, publish (QoS 0), keep alive.
// It's the backup route between the phones and the TV when the WebRTC route can't be set up: a free
// public MQTT broker passes the game's messages along. Messages are short JSON strings.

const enc = new TextEncoder();
const dec = new TextDecoder();

function varint(n) {
  const out = [];
  do { let b = n % 128; n = Math.floor(n / 128); if (n > 0) b |= 128; out.push(b); } while (n > 0);
  return out;
}
const str = (s) => { const b = enc.encode(s); return [b.length >> 8, b.length & 255, ...b]; };
const packet = (type, body) => new Uint8Array([type, ...varint(body.length), ...body]);

export class Mqtt {
  // handlers: onReady(), onMessage(topic, text), onDown()
  constructor(url, { clientId, ...h }) {
    this.url = url;
    this.clientId = clientId;
    this.h = h;
    this.subs = new Set();
    this.ready = false;
    this.closed = false;
    this.nextId = 1;
    this.buf = new Uint8Array(0);
    this.retry = 0;
    this.open();
  }

  open() {
    if (this.closed) return;
    let ws;
    try { ws = new WebSocket(this.url, 'mqtt'); } catch { this.down(); return; }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      // CONNECT: protocol "MQTT" level 4, clean session, keep alive 30 s
      ws.send(packet(0x10, [...str('MQTT'), 4, 0x02, 0, 30, ...str(this.clientId)]));
    };
    ws.onmessage = (e) => this.read(new Uint8Array(e.data));
    ws.onclose = () => { if (this.ws === ws) this.down(); };
    ws.onerror = () => { try { ws.close(); } catch { /* gone */ } };
  }

  down() {
    const was = this.ready;
    this.ready = false;
    clearInterval(this.ping);
    if (was) this.h.onDown?.();
    if (this.closed) return;
    this.retry++;
    setTimeout(() => this.open(), Math.min(15000, 1000 * this.retry));
  }

  read(chunk) {
    const all = new Uint8Array(this.buf.length + chunk.length);
    all.set(this.buf); all.set(chunk, this.buf.length);
    let i = 0;
    while (i < all.length) {
      // fixed header: type byte, remaining length
      let len = 0, mul = 1, j = i + 1, b;
      do {
        if (j >= all.length) { this.buf = all.slice(i); return; }
        b = all[j++]; len += (b & 127) * mul; mul *= 128;
      } while (b & 128);
      if (j + len > all.length) { this.buf = all.slice(i); return; }
      this.handle(all[i], all.subarray(j, j + len));
      i = j + len;
    }
    this.buf = new Uint8Array(0);
  }

  handle(type, body) {
    const kind = type >> 4;
    if (kind === 2) { // CONNACK
      if (body[1] !== 0) { try { this.ws.close(); } catch { /* gone */ } return; }
      this.ready = true;
      this.retry = 0;
      for (const t of this.subs) this.sendSubscribe(t);
      clearInterval(this.ping);
      this.ping = setInterval(() => this.raw(new Uint8Array([0xc0, 0])), 20000); // PINGREQ
      this.h.onReady?.();
    } else if (kind === 3) { // PUBLISH
      const tlen = (body[0] << 8) | body[1];
      const topic = dec.decode(body.subarray(2, 2 + tlen));
      const qos = (type >> 1) & 3;
      const start = 2 + tlen + (qos ? 2 : 0);
      this.h.onMessage?.(topic, dec.decode(body.subarray(start)));
    }
  }

  raw(bytes) {
    if (this.ws && this.ws.readyState === 1) { try { this.ws.send(bytes); } catch { /* closing */ } }
  }

  sendSubscribe(topic) {
    const id = this.nextId++ & 0xffff || 1;
    this.raw(packet(0x82, [id >> 8, id & 255, ...str(topic), 0]));
  }

  subscribe(topic) {
    this.subs.add(topic);
    if (this.ready) this.sendSubscribe(topic);
  }

  unsubscribe(topic) {
    if (!this.subs.delete(topic) || !this.ready) return;
    const id = this.nextId++ & 0xffff || 1;
    this.raw(packet(0xa2, [id >> 8, id & 255, ...str(topic)]));
  }

  publish(topic, text) {
    if (!this.ready) return false;
    this.raw(packet(0x30, [...str(topic), ...enc.encode(text)]));
    return true;
  }

  // bytes waiting to go out (for skipping updates on a busy line)
  get backlog() { return this.ws ? this.ws.bufferedAmount : 0; }

  close() {
    this.closed = true;
    clearInterval(this.ping);
    if (this.ws) { this.raw(new Uint8Array([0xe0, 0])); try { this.ws.close(); } catch { /* gone */ } }
  }
}
