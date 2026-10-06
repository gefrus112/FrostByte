# ❄ FrostByte — `play.js`

> **Free multiplayer for the open web.** One `<script>` tag. Zero servers. Live matchmaking included.

FrostByte turns any HTML/CSS/JS game into a live multiplayer experience. It connects players
**browser-to-browser over WebRTC**, so there is nothing to rent, no API keys, and no usage bills —
your page effectively *becomes* the live server.

**📄 Full docs & live demos:** <https://gefrus112.github.io/FrostByte/>

---

## ✨ Features

| | |
|---|---|
| 🆓 **Free forever** | Game data flows P2P (WebRTC data channels). The free public broker only does introductions. |
| ⚡ **One script** | Drop in `play.js` — works on GitHub Pages, itch.io, Neocities, anywhere. |
| 🌍 **Smart matchmaking** | `quickMatch()` finds players on your **network** first, then your **country**, then **worldwide**. |
| 🕹 **Game-ready API** | `host()` / `join(code)` / `send()` / `broadcast()` / join-leave events / heartbeats. |
| 🔐 **Room codes** | 4-char codes (no confusing `0/O/1/I/L`) for private games with friends. |
| 🔁 **Host relay** | Star topology — 2–8 players per room, guest→guest messages relayed by the host. |
| 🧩 **Templates** | Full multiplayer **Pong**, lobby **chat**, and a commented **starter kit**. |
| 🛠 **Hackable** | Single file, zero dependencies, MIT. Self-host signaling with `peerConfig`. |

## 🚀 Quick start

```html
<script src="https://gefrus112.github.io/FrostByte/play.js"></script>
<script>
  const game = new Play({ game: 'my-unique-game' });

  // find a live opponent — same network → same country → worldwide
  game.quickMatch();

  game.onPlayerJoin = p => console.log(p.name + ' joined!');

  // sync your game state
  game.onData = (data, from) => console.log('got', data);
  game.broadcast({ type: 'move', x: 128 });
</script>
```

That's the whole integration. Open the page in two tabs and quick match both — multiplayer. ❄

### Private rooms

```js
const { code } = await game.host();   // "K7XF" — share it anywhere
await game.join('K7XF');              // friend joins from any network
```

## 🧪 Templates

Open in **two tabs** and press *Quick Match* in both:

| Template | Path | What you get |
|---|---|---|
| 🏓 Pong | [`templates/pong.html`](templates/pong.html) | Complete game: matchmaking, room codes, authoritative host physics, 30 Hz snapshots, interpolation, particles, sounds |
| 💬 Chat | [`templates/chat.html`](templates/chat.html) | Lobby chat with live roster — the hello-world of P2P |
| 🧪 Starter | [`templates/starter.html`](templates/starter.html) | Blank canvas + connection overlay + event log + echo-RTT test |

## 📚 API in one screen

```js
const game = new Play({ game: 'name', playerName: 'ace', debug: true });

await game.quickMatch();          // auto matchmaking → { isHost, scope }
await game.host();                // private room      → { code }
await game.join('K7XF');          // join by code

game.broadcast(data);             // everyone (guest→all via host relay)
game.send(data, toId);            // one player (private)
game.players();                   // [{ id, isHost, name }]

game.on('ready',    ({ isHost, code, scope }) => {});
game.on('status',   (state, detail) => {});   // searching · waiting · connected…
game.on('playerjoin',  p => {});
game.on('playerleave', p => {});
game.on('data',     (data, from) => {});      // from = { id, isHost }
game.on('error',    err => {});               // err.message is human-readable

await Play.region();  // { ip, country, network } — your region fingerprint
Play.isSupported();   // WebRTC support check
game.close();         // leave cleanly
```

## 🌍 How matchmaking works (no server!)

`quickMatch()` probes short deterministic room ids on the free broker, in this order:

1. **same network** — players sharing your public IP (same router ≈ zero lag)
2. **same country** — IP geolocation keeps matches local
3. **worldwide** — so you always eventually find someone

If nobody is waiting, **you become the host** of the first free slot and the next searcher finds you.
All of this is ~100 lines of logic in `play.js` — read it, it's commented.

## 🏠 Self-hosting signaling

```js
const game = new Play({
  game: 'my-game',
  peerConfig: { host: 'my-broker.fly.dev', port: 443, path: '/', secure: true }
});
```

Run the open-source [peerjs-server](https://github.com/peers/peerjs-server) on any free tier.
Everything else (matchmaking, codes, events) works unchanged.

## ❓ FAQ

- **Is it really free?** Yes — P2P data, free public signaling. No meter, no keys.
- **Player limits?** Comfortably 2–8 per room in star topology.
- **Where does it run?** Any modern browser, desktop or mobile, from any static host.
- **Is game data private?** Yes — payloads travel on a direct DTLS-encrypted WebRTC channel; the broker never sees them.

See the [full docs](https://gefrus112.github.io/FrostByte/) for limits & troubleshooting.

## 🤝 Contributing

Fork it, improve it, PR it. Good first issues: TURN support for strict NATs, matchmaking slot widening, more game templates.

## 📄 License

MIT — build games, not backends. ❄
