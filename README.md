# ❄ FrostByte — `play.js` v2

> **Free multiplayer for the open web.** One `<script>` tag. Zero servers. Live matchmaking included.
> **New in v2:** multiplayer in **Lua** (Fengari bridge) + **API key management** with usage tracking.

FrostByte turns any HTML/CSS/JS game into a live multiplayer experience. It connects players
**browser-to-browser over WebRTC**, so there is nothing to rent and no usage bills —
your page effectively *becomes* the live server. With v2 you can now write your networking
**in Lua** and manage **API keys** that track the exact site URLs they are used from.

**📄 Full docs & live demos:** <https://gefrus112.github.io/FrostByte/>

---

## ✨ Features

| | |
|---|---|
| 🆓 **Free forever** | Game data flows P2P (WebRTC data channels). The free public broker only does introductions. |
| ⚡ **One script** | Drop in `play.js` — works on GitHub Pages, itch.io, Neocities, anywhere. |
| 🌍 **Smart matchmaking** | `quickMatch()` finds players on your **network** first, then your **country**, then **worldwide**. |
| 🕹 **Game-ready API** | `host()` / `join(code)` / `send()` / `broadcast()` / join-leave events / heartbeats. |
| 🌙 **Multiplayer in Lua** | **v2.** Add `play-lua.js` and drive the whole API from Lua code (`net.host()`, `net.broadcast()`, `net.on('data', …)`) on the in-browser Fengari VM. |
| 🔑 **API keys & usage tracking** | **v2.** Generate keys, allow-list site URLs, and see **the exact page URL each key is used from** in the [API Keys dashboard](https://gefrus112.github.io/FrostByte/keys.html). |
| 🔐 **Room codes** | 4-char codes (no confusing `0/O/1/I/L`) for private games with friends. |
| 🔁 **Host relay** | Star topology — 2–8 players per room, guest→guest messages relayed by the host. |
| 🧩 **Templates** | Multiplayer **Pong**, lobby **chat**, a **Lua**-powered room, and a commented **starter kit**. |
| 🛠 **Hackable** | Zero dependencies, MIT. Self-host signaling with `peerConfig`. |

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

## 🌙 Multiplayer in Lua (v2)

Add the bridge, get a full `net.*` table inside the Fengari Lua VM — running in the browser,
riding the same P2P WebRTC mesh:

```html
<script src="https://gefrus112.github.io/FrostByte/play.js"></script>
<script src="https://gefrus112.github.io/FrostByte/play-lua.js"></script>

<script type="text/lua">
  net.init({ game = 'my-lua-game', player = 'mo' })

  net.on('data', function (d, from)
    print('got', d.text, 'from', from.id)
  end)

  net.quickmatch()
  net.broadcast({ text = 'hello from Lua!' })

  -- touch the DOM from Lua:
  js.run('document.title = "lua-powered"')
</script>
```

From JavaScript you can run Lua strings and call Lua functions back:

```js
const res = await FrostByte.lua(`…lua code…`, { globals: { ROOM: 'K7XF' } });
res.api.call('on_button_pressed', 42);   // → Lua function, result comes back
```

Data crosses the bridge both ways as plain JSON-able tables. Full reference in the
[docs](https://gefrus112.github.io/FrostByte/docs.html#lua) — and a complete working
game in [`templates/lua.html`](templates/lua.html).

## 🔑 API keys (v2)

Generate keys, allow-list the sites that may use them, and see **where the API is being used** —
the exact site origin and page URL of every connection:

```js
// on the API Keys dashboard (keys.html) or anywhere:
const key = Play.keys.create({
  name: 'Neon Pong — production',
  origins: ['https://neonpong.pages.dev', 'https://*.mysite.org']   // or '*'
});

// then in your game:
const game = new Play({ game: 'neon-pong', apiKey: key.key });

// oversight:
Play.keys.list();    // records + lastUsed / usedOn / usedFrom / uses
Play.keys.usage();   // recent usage log — the URLs your API is used from
Play.keys.revoke(key.key);
```

Keys live in the browser's localStorage (FrostByte is fully serverless — nothing to leak),
validation and the site allow-list are enforced inside `play.js`, and **keys are optional** —
`new Play({ game })` still works exactly like v1. Open the
[API Keys dashboard](https://gefrus112.github.io/FrostByte/keys.html) to manage everything visually.

## 🧪 Templates

Open in **two tabs** and press *Quick Match* in both:

| Template | Path | What you get |
|---|---|---|
| 🏓 Pong | [`templates/pong.html`](templates/pong.html) | Complete game: matchmaking, room codes, authoritative host physics, 30 Hz snapshots, interpolation, particles, sounds |
| 🌙 Lua Chat | [`templates/lua.html`](templates/lua.html) | **v2.** A chat room whose entire networking layer is written in **Lua** — `net.*` on the Fengari VM |
| 💬 Chat | [`templates/chat.html`](templates/chat.html) | Lobby chat with live roster — the hello-world of P2P |
| 🧪 Starter | [`templates/starter.html`](templates/starter.html) | Blank canvas + connection overlay + event log + echo-RTT test |

## 📚 API in one screen

```js
const game = new Play({ game: 'name', playerName: 'ace', apiKey: 'fbk_live_…', debug: true });

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
Play.keys.create({ name, origins });          // v2 — API key management
Play.keys.list() / revoke() / usage();
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
Everything else (matchmaking, codes, events, keys) works unchanged.

## ❓ FAQ

- **Is it really free?** Yes — P2P data, free public signaling. No meter, no bills.
- **Are API keys required?** No — they're optional. Without a key, everything works like v1. With a key, you get origin gating and per-URL usage tracking.
- **Player limits?** Comfortably 2–8 per room in star topology.
- **Where does it run?** Any modern browser, desktop or mobile, from any static host.
- **Lua? Really?** Really — `play-lua.js` embeds [Fengari](https://fengari.io), a Lua 5.3 VM written in JavaScript. Your Lua runs at native JS speed inside the page.
- **Is game data private?** Yes — payloads travel on a direct DTLS-encrypted WebRTC channel; the broker never sees them.

See the [full docs](https://gefrus112.github.io/FrostByte/) for limits & troubleshooting.

## 🤝 Contributing

Fork it, improve it, PR it. Good first issues: TURN support for strict NATs, matchmaking slot widening, more game templates (a Lua Pong would be 🔥).

## 📄 License

MIT — build games, not backends. ❄
