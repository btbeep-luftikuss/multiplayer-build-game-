// A local MQTT broker over WebSocket, for testing the backup route without the internet:
// `node tests/relay-server.mjs [port]`, then open the TV with ?relay=ws://localhost:PORT
import { Aedes } from 'aedes';
import { WebSocketServer, createWebSocketStream } from 'ws';

const port = Number(process.argv[2] || 1884);
const broker = await Aedes.createBroker();
const wss = new WebSocketServer({ port, handleProtocols: () => 'mqtt' });
wss.on('connection', (ws) => broker.handle(createWebSocketStream(ws)));
console.log(`MQTT over WebSocket on ws://localhost:${port}`);
