// A local PeerJS server for the multiplayer tests (the game uses it with ?peer=127.0.0.1:9000). Usage: node tests/peerserver.cjs
// (PEER_PORT=9001 for another port, so two test runs can go side by side)
const express = require('express'); const { ExpressPeerServer } = require('peer');
const PORT = +process.env.PEER_PORT || 9000;
const app = express(); const server = app.listen(PORT, '127.0.0.1', () => console.log('peer server on 127.0.0.1:' + PORT));
const ps = ExpressPeerServer(server, { path: '/', allow_discovery: false });
ps.on('connection', c => console.log('connect', c.getId())); ps.on('disconnect', c => console.log('disconnect', c.getId()));
app.use('/', ps);
