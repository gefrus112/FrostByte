/*!
 * ███████╗██████╗  ██████╗ ███████╗████████╗██████╗ ██╗   ██╗████████╗███████╗
 * ██╔════╝██╔══██╗██╔════╝ ██╔════╝╚══██╔══╝██╔══██╗╚██╗ ██╔╝╚══██╔══╝██╔════╝
 * █████╗  ██████╔╝██║  ███╗█████╗     ██║   ██████╔╝ ╚████╔╝    ██║   ███████╗
 * ██╔══╝  ██╔══██╗██║   ██║██╔══╝     ██║   ██╔══██╗  ╚██╔╝     ██║   ╚════██║
 * ██║     ██████╔╝╚██████╔╝███████╗   ██║   ██║  ██║   ██║      ██║   ███████║
 * ╚═╝     ╚═════╝  ╚═════╝ ╚══════╝   ╚═╝   ╚═╝  ╚═╝   ╚═╝      ╚═╝   ╚══════╝
 *
 * FrostByte play.js v2.0.0 — free multiplayer for the open web.
 * One <script> tag. Zero backend. Live matchmaking included.
 * NEW IN v2:
 *   • API key management — Play.keys.create()/list()/revoke(), the
 *     `apiKey` option, and usage tracking that records THE URL/SITE
 *     each key is being used from (see keys.html dashboard).
 *   • Lua multiplayer — pair with play-lua.js to drive this whole
 *     API from Lua code (Fengari VM in the browser).
 *
 *   <script src="https://gefrus112.github.io/FrostByte/play.js"></script>
 *   <script>
 *     const game = new Play({ game: 'my-game', apiKey: 'fbk_live_…' });
 *     game.quickMatch();                       // auto-find a player nearby
 *     game.onPlayerJoin = p => say(p.name + ' joined!');
 *     game.broadcast({ type: 'move', x: 12 }); // send data to everyone
 *   </script>
 *
 * HOW IT WORKS
 *   • WebRTC data channels carry game data peer-to-peer (fast + free).
 *   • The public PeerJS cloud broker is used ONLY to find the other
 *     player's IP (signaling). No game data ever touches a server.
 *   • The room host acts as a tiny relay for 3+ players (star topology).
 *
 * MATCHMAKING ORDER (quickMatch)
 *   1. same network  (same public IP — same house / same cafe Wi-Fi)
 *   2. same country  (IP geolocation, best effort)
 *   3. worldwide     (fallback so you always find someone)
 *
 * MIT License — build games, not backends.
 */
(function (global) {
  'use strict';

  /* ═════════════════════════ constants ═════════════════════════ */

  var VERSION = '2.0.0';
  var ID_TAG = 'fbx1';                       // namespace so we never clash on the broker
  var PEERJS_CDNS = [
    'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js',
    'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js'
  ];
  var GEO_SOURCES = [                        // free IP geolocation, CORS-friendly
    'https://get.geojs.io/v1/ip/country.json',
    'https://ipwho.is/',
    'https://ipapi.co/json/'
  ];
  var JOIN_TIMEOUT = 8000;    // joining a private room
  var SCAN_TIMEOUT = 1400;    // probing one matchmaking slot
  var PEER_OPEN_TIMEOUT = 15000;
  var HEARTBEAT_MS = 3000;
  var PRUNE_MS = 11000;
  var SCAN_SLOTS = 5;         // matchmaking slot ids per scope

  /* ═════════════════════════ tiny utils ═════════════════════════ */

  var ROOM_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // no 0/O/1/I/L confusion

  function makeCode(n) {
    n = n || 4; var s = '';
    for (var i = 0; i < n; i++) s += ROOM_CHARS[(Math.random() * ROOM_CHARS.length) | 0];
    return s;
  }

  function randId(n) {
    var c = 'abcdefghijklmnopqrstuvwxyz0123456789', s = '';
    for (var i = 0; i < (n || 10); i++) s += c[(Math.random() * c.length) | 0];
    return s;
  }

  function hash36(str) {                    // djb2 → base36 (used to fingerprint public IPs)
    var h = 5381; str = String(str);
    for (var i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  function sanitizeName(name) {
    return String(name || 'app').toLowerCase()
      .replace(/[^a-z0-9_-]/g, '').slice(0, 24) || 'app';
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function fetchJSON(url, ms) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, ms || 5000);
    return fetch(url, { signal: ctrl.signal, cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .finally(function () { clearTimeout(timer); });
  }

  function safeSend(conn, msg) {
    try { if (conn && conn.open) conn.send(msg); } catch (e) { /* dying connection */ }
  }

  function offPeer(peer, ev, fn) {
    if (typeof peer.off === 'function') peer.off(ev, fn);
    else if (typeof peer.removeListener === 'function') peer.removeListener(ev, fn);
  }

  /* Map raw PeerJS errors to friendly, game-developer-readable ones. */
  function friendly(err) {
    var e = (err instanceof Error) ? err : new Error(String(err && err.message || err || 'unknown error'));
    e.type = err && err.type;
    switch (e.type) {
      case 'peer-unavailable':     e.message = 'Room not found — double-check the code.'; break;
      case 'unavailable-id':       e.message = 'That room slot was just taken.'; break;
      case 'browser-incompatible': e.message = 'This browser does not support WebRTC.'; break;
      case 'webrtc':               e.message = 'WebRTC connection failed (strict NAT or firewall).'; break;
      case 'network': case 'socket-error': case 'socket-closed':
      case 'server-error': case 'ssl-unavailable':
        e.message = 'Lost contact with the matchmaking broker. Try again in a moment.'; break;
      case 'disconnected':         e.message = 'Disconnected from the signaling broker.'; break;
    }
    return e;
  }

  /* ═══════════════════ engine loader (PeerJS from CDN) ═════════ */

  var enginePromise = null;

  function loadEngine() {
    if (typeof Peer !== 'undefined') return Promise.resolve();
    if (enginePromise) return enginePromise;
    enginePromise = (async function () {
      var lastErr = null;
      for (var i = 0; i < PEERJS_CDNS.length; i++) {
        try {
          await new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = PEERJS_CDNS[i]; s.async = true;
            s.onload = resolve;
            s.onerror = function () { reject(new Error('cdn miss')); };
            document.head.appendChild(s);
          });
          if (typeof Peer !== 'undefined') return;   // loaded!
        } catch (e) { lastErr = e; }
      }
      throw new Error('FrostByte: could not load the WebRTC engine (peerjs). Check your internet connection.');
    })();
    return enginePromise;
  }

  /* ═══════════════ region detection (country + network) ════════ */
  /*
   * network  = fingerprint of your PUBLIC IP. Two players behind the same
   *            router share it → "same network" matchmaking.
   * country  = ISO-3166 alpha-2 code, e.g. "US", "BR", "DE".
   *            "XX" means detection failed → worldwide scope only.
   */

  var regionPromise = null;

  function region() {
    if (!regionPromise) {
      regionPromise = (async function () {
        for (var i = 0; i < GEO_SOURCES.length; i++) {
          try {
            var d = await fetchJSON(GEO_SOURCES[i], 4500);
            var ip = d.ip || null;
            var cc = (d.country || d.country_code || 'XX');
            if (cc && cc !== 'XX') {
              return { ip: ip, country: String(cc).toUpperCase(), network: ip ? hash36(ip) : null };
            }
          } catch (e) { /* try next source */ }
        }
        return { ip: null, country: 'XX', network: null };
      })();
    }
    return regionPromise;
  }

  /* ═══════════════════════ peer-id helpers ═════════════════════ */

  function hostId(game, code)   { return ID_TAG + '-' + game + '-' + code + '-h'; }
  function guestId(game)        { return ID_TAG + '-' + game + '-g-' + randId(10); }
  function scanGuestId(game)    { return ID_TAG + '-' + game + '-q-' + randId(10); }
  function qmHostId(game, s, i) { return ID_TAG + '-qm-' + game + '-' + s + '-' + i; }

  /* ══════════════════════════ emitter ══════════════════════════ */

  function Emitter() { this._l = new Map(); }
  Emitter.prototype.on = function (ev, fn) {
    if (!this._l.has(ev)) this._l.set(ev, []);
    this._l.get(ev).push(fn); return this;
  };
  Emitter.prototype.off = function (ev, fn) {
    var a = this._l.get(ev); if (a) { var i = a.indexOf(fn); if (i > -1) a.splice(i, 1); }
    return this;
  };
  Emitter.prototype.emit = function (ev, a, b) {
    var list = (this._l.get(ev) || []).slice();
    for (var i = 0; i < list.length; i++) {
      try { list[i](a, b); } catch (e) { console.error('[FrostByte] listener error:', e); }
    }
    return this;
  };

  /* ═══════════════ connect with timeout (+ peer errors) ════════ */
  /*
   * PeerJS reports "peer-unavailable" on the PEER (not the connection),
   * so we listen there and reject fast when a slot is empty.
   */
  function tryConnect(peer, target, ms) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var conn = peer.connect(target, { reliable: true });

      function finish(fn, arg) {
        if (done) return; done = true;
        clearTimeout(timer); offPeer(peer, 'error', onPeerErr);
        fn(arg);
      }
      function onPeerErr(err) {
        if (err && err.type === 'peer-unavailable' && String(err.message || '').indexOf(target) > -1) {
          finish(reject, new Error('no-host'));
        }
      }
      var timer = setTimeout(function () {
        finish(reject, new Error('timeout'));
        try { conn.close(); } catch (e) {}
      }, ms);

      peer.on('error', onPeerErr);
      conn.on('open', function () { finish(resolve, conn); });
      conn.on('error', function () {
        finish(reject, new Error('conn-error'));
        try { conn.close(); } catch (e) {}
      });
    });
  }

  /* ═══════════════ API key manager (v2, client-side) ════════════ */
  /*
   * Keys let you gate and monitor who uses your FrostByte integration.
   * Every key records THE SITE URL IT IS USED FROM (origin + page), how
   * many times it connected, and when — visible on the keys.html dashboard.
   *
   *   Play.keys.create({ name: 'My Game', origins: ['*'] })
   *   Play.keys.list() / get(key) / revoke(key) / del(key)
   *   Play.keys.usage() / clearUsage()
   *
   * Then connect with the key:
   *   new Play({ game: 'my-game', apiKey: 'fbk_live_…' })
   *
   * Keys are stored in this browser's localStorage (FrostByte is fully
   * serverless — there is no database to leak). Validation enforces the
   * origin allow-list you set, right inside the library.
   */

  var LS_KEYS  = 'frostbyte.keys';
  var LS_USAGE = 'frostbyte.usage';
  var USAGE_CAP = 250;

  function lsGet(k, fb) {
    try { var v = global.localStorage.getItem(k); return v ? JSON.parse(v) : fb; }
    catch (e) { return fb; }
  }
  function lsSet(k, v) {
    try { global.localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ }
  }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  function makeApiKey() {
    var c = 'abcdefghijklmnopqrstuvwxyz0123456789', s = '';
    for (var i = 0; i < 24; i++) s += c[(Math.random() * c.length) | 0];
    return 'fbk_live_' + s;
  }

  function pageOrigin() { return (global.location && global.location.origin) || 'file://'; }
  function pageURL()    { return (global.location && global.location.href)  || 'file://'; }

  function originAllowed(rec, origin) {
    if (!rec.origins || !rec.origins.length) return true;
    return rec.origins.some(function (o) {
      if (o === '*' || o === 'all') return true;
      o = String(o).replace(/\/+$/, '');
      if (o === origin) return true;
      /* suffix wildcard: https://*.example.com */
      var m = /^[a-z]+:\/\/\*\.(.+)$/.exec(o);
      if (m) {
        var suffix = '.' + m[1].replace(/\/+$/, '');
        return origin.slice(-suffix.length) === suffix;
      }
      return false;
    });
  }

  var Keys = {
    /** Create a key: { name, origins } → key record. origins: array or
     *  newline/comma string; '*' allows every site. */
    create: function (opts) {
      opts = opts || {};
      var raw = opts.origins == null ? '*' : opts.origins;
      var origins = (Array.isArray(raw) ? raw : String(raw).split(/[\n,]+/))
        .map(function (s) { return s.trim(); }).filter(Boolean);
      if (!origins.length) origins = ['*'];
      var rec = {
        key:       makeApiKey(),
        name:      String(opts.name || 'unnamed key').slice(0, 40),
        origins:   origins,
        status:    'active',
        createdAt: new Date().toISOString(),
        lastUsed:  null,
        usedFrom:  null,      // full URL of the page using the API
        usedOn:    null,      // origin of the site using the API
        uses:      0
      };
      var list = lsGet(LS_KEYS, []);
      list.push(rec);
      lsSet(LS_KEYS, list);
      return clone(rec);
    },
    /** All key records. */
    list: function () { return lsGet(LS_KEYS, []).map(clone); },
    /** One key record (or null). */
    get: function (key) {
      var found = null;
      lsGet(LS_KEYS, []).forEach(function (r) { if (r.key === key) found = clone(r); });
      return found;
    },
    /** Disable a key — connections using it will fail validation. */
    revoke: function (key) { return Keys._setStatus(key, 'revoked'); },
    /** Re-enable a revoked key. */
    restore: function (key) { return Keys._setStatus(key, 'active'); },
    /** Delete a key record entirely. */
    del: function (key) {
      var list = lsGet(LS_KEYS, []).filter(function (r) { return r.key !== key; });
      lsSet(LS_KEYS, list);
      return true;
    },
    /** Recent usage log: [{ at, event, game, origin, page, key, name }] */
    usage: function (n) {
      var log = lsGet(LS_USAGE, []);
      return n ? log.slice(-n).reverse() : log.slice().reverse();
    },
    /** Wipe the usage log. */
    clearUsage: function () { lsSet(LS_USAGE, []); return true; },

    _setStatus: function (key, status) {
      var list = lsGet(LS_KEYS, []), hit = null;
      list.forEach(function (r) { if (r.key === key) { r.status = status; hit = clone(r); } });
      lsSet(LS_KEYS, list);
      return hit;
    },
    /** { ok, rec?, message? } — format, registry, status and origin checks. */
    _validate: function (key) {
      if (typeof key !== 'string' || !/^fbk_live_[a-z0-9]{16,32}$/.test(key)) {
        return { ok: false, message: 'Malformed API key — expected fbk_live_… (generate one on the API Keys page).' };
      }
      var rec = Keys.get(key);
      if (!rec)            return { ok: false, message: 'Unknown API key. Create one on the API Keys page (keys.html).' };
      if (rec.status !== 'active') return { ok: false, message: 'API key "' + rec.name + '" has been revoked.' };
      if (!originAllowed(rec, pageOrigin())) {
        return { ok: false, message: 'API key "' + rec.name + '" is not allowed on ' + pageOrigin() + ' — add this site URL to the key on the API Keys page.' };
      }
      return { ok: true, rec: rec };
    },
    /** Record a successful use: updates the key + appends to the usage log. */
    _record: function (key, gameName, event) {
      var list = lsGet(LS_KEYS, []);
      list.forEach(function (r) {
        if (r.key === key) {
          r.lastUsed = new Date().toISOString();
          r.usedFrom = pageURL();
          r.usedOn   = pageOrigin();
          r.uses     = (r.uses || 0) + 1;
        }
      });
      lsSet(LS_KEYS, list);
      var log = lsGet(LS_USAGE, []);
      log.push({
        at: new Date().toISOString(), event: event || 'connect',
        game: gameName || null, key: key,
        name: (Keys.get(key) || {}).name || null,
        origin: pageOrigin(), page: pageURL()
      });
      if (log.length > USAGE_CAP) log = log.slice(-USAGE_CAP);
      lsSet(LS_USAGE, log);
    }
  };

  /* ═══════════════════════════ Game ════════════════════════════ */
  /**
   * new Play({ game, playerName?, apiKey?, debug?, peerConfig?, on*? })
   *
   *  game        — namespace string, e.g. 'pong'. Rooms of different
   *                games can never collide with each other.
   *  playerName  — optional nickname shown to other players.
   *  apiKey      — optional FrostByte key (fbk_live_…). Validated against
   *                the local key registry + its site allow-list; usage is
   *                recorded with the URL/site it is used from. See keys.html.
   *  peerConfig  — optional self-hosted broker config:
   *                { host:'my-broker', port:443, path:'/', secure:true }
   *  on*         — shortcut event handlers (also available via .on()).
   *
   * Events: ready · status · playerjoin · playerleave · data · error
   */
  function Game(opts) {
    Emitter.call(this);
    opts = opts || {};
    this.opts = opts;
    this.gameName = sanitizeName(opts.game);
    this.version = VERSION;
    this.apiKey = opts.apiKey || null;
    this._keyRec = null;
    this._keyError = null;

    if (this.apiKey) {
      var v = Keys._validate(this.apiKey);
      if (!v.ok) {
        this._keyError = new Error('FrostByte: ' + v.message);
        this._keyError.type = 'key';
        var kf = this;
        setTimeout(function () {
          kf._status('disconnected', kf._keyError.message);
          kf.emit('error', kf._keyError);
        }, 0);
      } else {
        this._keyRec = v.rec;
      }
    }

    this.peer = null;          // underlying PeerJS peer
    this.code = null;          // 4-char room code (null in quick match)
    this.isHost = false;
    this.me = null;            // { id, isHost }
    this.players_map = new Map();  // host: live roster
    this.rosterSnap = [];      // guest: last roster broadcast
    this.conns = new Map();    // host: guestId → DataConnection
    this._hostConn = null;     // guest: connection to host
    this._timers = [];
    this._closed = false;
    this._busy = false;
    this._scopeLabel = null;

    var self = this;
    var shortcuts = {
      ready: 'onReady', status: 'onStatus', playerjoin: 'onPlayerJoin',
      playerleave: 'onPlayerLeave', data: 'onData', error: 'onError'
    };
    Object.keys(shortcuts).forEach(function (ev) {
      if (typeof opts[shortcuts[ev]] === 'function') self.on(ev, opts[shortcuts[ev]]);
    });
  }

  Game.prototype = Object.create(Emitter.prototype);
  Game.prototype.constructor = Game;

  /* ── status helper ──────────────────────────────────────────── */
  Game.prototype._status = function (state, detail) {
    this.emit('status', state, detail || '');
    if (this.opts.debug) console.log('[FrostByte]', state, detail || '');
  };

  /* ── key guard + usage recorder (v2) ────────────────────────── */
  Game.prototype._guard = function () {
    if (this._keyError) throw this._keyError;
  };
  Game.prototype._recordUse = function () {
    if (this._keyRec) Keys._record(this.apiKey, this.gameName, 'connect');
  };

  /* ── create a peer and wait for its broker id ───────────────── */
  Game.prototype._newPeer = function (id) {
    var self = this;
    var peer = this.opts.peerConfig
      ? new Peer(id, JSON.parse(JSON.stringify(this.opts.peerConfig)))
      : new Peer(id);

    return new Promise(function (resolve, reject) {
      function cleanup() { clearTimeout(timer); peer.off('open', onOpen); peer.off('error', onErr); }
      var timer = setTimeout(function () {
        cleanup(); try { peer.destroy(); } catch (e) {}
        reject(new Error('FrostByte: signaling broker timeout — a firewall may be blocking WebRTC.'));
      }, PEER_OPEN_TIMEOUT);
      function onOpen() { cleanup(); resolve(peer); }
      function onErr(err) {
        cleanup(); try { peer.destroy(); } catch (e) {}
        reject(friendly(err));
      }
      peer.on('open', onOpen);
      peer.on('error', onErr);
    }).then(function (p) {
      /* persistent error handler for the lifetime of the peer */
      p.on('error', function (err) {
        if (err && err.type === 'peer-unavailable') return;   // handled by tryConnect
        var e = friendly(err);
        self._status('disconnected', e.message);
        self.emit('error', e);
      });
      p.on('disconnected', function () {
        try { if (!p.destroyed) p.reconnect(); } catch (e) {}
      });
      return p;
    });
  };

  /* ═════════════════════ HOST side (star topology) ═════════════ */

  /**
   * Open a private room. Resolves { code } once the room is live.
   * Share the code — guests join with game.join(code).
   */
  Game.prototype.host = async function () {
    this._guard();
    if (this._busy) throw new Error('FrostByte: this Game instance is already connecting.');
    this._busy = true;
    await loadEngine();
    this._status('hosting', 'claiming a room…');

    var self = this, lastErr = null;
    for (var attempt = 0; attempt < 5; attempt++) {
      var code = makeCode(4);
      try {
        this.peer = await this._newPeer(hostId(this.gameName, code));
        this.code = code;
        this.isHost = true;
        this.me = { id: this.peer.id, isHost: true, name: this.opts.playerName || 'Host' };
        this.players_map.set('me', this.me);
        this._wireHost();
        this._startHeartbeat();
        this._status('hosting', 'room open — code ' + code);
        this._recordUse();
        this.emit('ready', { isHost: true, code: code, me: this.me, scope: 'private' });
        return { code: code };
      } catch (e) {
        lastErr = e;
        if (e.type !== 'unavailable-id') { this._busy = false; throw e; }
      }
    }
    this._busy = false;
    throw lastErr || new Error('FrostByte: could not open a room.');
  };

  /* Wire events for a hosting peer. */
  Game.prototype._wireHost = function () {
    var self = this;
    this.peer.on('connection', function (conn) { self._attachHostConn(conn); });
  };

  Game.prototype._attachHostConn = function (conn) {
    var self = this;

    conn.on('open', function () {
      self.conns.set(conn.peer, conn);
      safeSend(conn, { t: 'welcome', you: conn.peer, code: self.code });
    });
    conn.on('data', function (raw) { self._hostOnData(conn, raw); });
    conn.on('close', function () { self._dropGuest(conn.peer); });
    conn.on('error', function () { self._dropGuest(conn.peer); });
  };

  Game.prototype._hostOnData = function (conn, raw) {
    if (!raw || typeof raw !== 'object') return;
    var self = this;

    switch (raw.t) {
      case 'hello': {
        if (!this.players_map.has(conn.peer)) {
          var p = { id: conn.peer, isHost: false, name: String(raw.name || 'Player').slice(0, 16) };
          this.players_map.set(conn.peer, { player: p, lastSeen: Date.now() });
          this._broadcastRoster();
          this._status('connected', p.name + ' joined');
          this.emit('playerjoin', p);
        }
        break;
      }
      case 'd': {          // guest broadcast → deliver locally + forward to others
        var from = { id: conn.peer, isHost: false };
        this.emit('data', raw.d, from);
        this.conns.forEach(function (c, id) {
          if (id !== conn.peer) safeSend(c, { t: 'b', d: raw.d, from: conn.peer });
        });
        break;
      }
      case 'relay': {      // guest → guest private message
        var target = this.conns.get(raw.to);
        if (target) safeSend(target, { t: 'to', d: raw.d, from: conn.peer });
        break;
      }
      case 'ping': safeSend(conn, { t: 'pong' }); break;
      case 'pong': {
        var r = this.players_map.get(conn.peer);
        if (r) r.lastSeen = Date.now();
        break;
      }
    }
  };

  Game.prototype._dropGuest = function (id) {
    var entry = this.players_map.get(id);
    if (this.conns.has(id)) {
      try { this.conns.get(id).close(); } catch (e) {}
      this.conns.delete(id);
    }
    if (entry) {
      this.players_map.delete(id);
      this._broadcastRoster();
      this._status('connected', (entry.player.name || id) + ' left');
      this.emit('playerleave', entry.player);
    }
  };

  Game.prototype._broadcastRoster = function () {
    var players = this.players();
    this.conns.forEach(function (c) { safeSend(c, { t: 'roster', players: players }); });
  };

  /* ── heartbeat: prune silently-dead guests ──────────────────── */
  Game.prototype._startHeartbeat = function () {
    var self = this;
    this._timers.push(setInterval(function () {
      var now = Date.now();
      self.conns.forEach(function (c, id) {
        safeSend(c, { t: 'ping' });
        var r = self.players_map.get(id);
        if (r && now - r.lastSeen > PRUNE_MS) self._dropGuest(id);
      });
    }, HEARTBEAT_MS));
  };

  /* ═════════════════════ GUEST side ════════════════════════════ */

  /**
   * Join a private room by its 4-char code.
   * Resolves { code } once connected to the host.
   */
  Game.prototype.join = async function (code) {
    this._guard();
    if (this._busy) throw new Error('FrostByte: this Game instance is already connecting.');
    this._busy = true;
    await loadEngine();

    var roomCode = String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!roomCode) { this._busy = false; throw new Error('FrostByte: join() needs a room code.'); }

    this.code = roomCode;
    this.isHost = false;
    this._status('joining', 'connecting to room ' + roomCode + '…');

    this.peer = await this._newPeer(guestId(this.gameName));
    this.me = { id: this.peer.id, isHost: false, name: this.opts.playerName || 'Player' };

    var conn;
    try {
      conn = await tryConnect(this.peer, hostId(this.gameName, roomCode), JOIN_TIMEOUT);
    } catch (e) {
      this._busy = false;
      var err = new Error('Room "' + roomCode + '" not found — is the host online?');
      err.type = 'peer-unavailable';
      this.emit('error', err);
      throw err;
    }

    this._attachGuestConn(conn);
    this._startGuestWatch();
    this._recordUse();
    this._status('connected', 'joined room ' + roomCode);
    this.emit('ready', { isHost: false, code: roomCode, me: this.me, scope: 'private' });
    this._busy = false;
    return { code: roomCode };
  };

  Game.prototype._attachGuestConn = function (conn) {
    var self = this;
    this._hostConn = conn;

    conn.on('data', function (raw) { self._guestOnData(conn, raw); });
    conn.on('close', function () { self._hostLost(); });
    conn.on('error', function () { self._hostLost(); });
  };

  Game.prototype._guestOnData = function (conn, raw) {
    if (!raw || typeof raw !== 'object') return;
    var self = this;

    switch (raw.t) {
      case 'welcome':
        this.me = { id: raw.you, isHost: false, name: this.opts.playerName || 'Player' };
        safeSend(conn, { t: 'hello', name: this.opts.playerName || 'Player' });
        break;
      case 'roster':
        this.rosterSnap = raw.players || [];
        break;
      case 'evt':
        if (raw.kind === 'join')  this.emit('playerjoin', raw.p);
        if (raw.kind === 'leave') this.emit('playerleave', raw.p);
        break;
      case 'b': case 'to':
        this.emit('data', raw.d, { id: raw.from || 'host', isHost: raw.from === 'host' });
        break;
      case 'ping':
        this._lastPing = Date.now();
        safeSend(conn, { t: 'pong' });
        break;
    }
  };

  /* Watch host liveness from the guest side. */
  Game.prototype._startGuestWatch = function () {
    var self = this;
    var joinedAt = Date.now();
    this._lastPing = 0;
    this._timers.push(setInterval(function () {
      if (!self._hostConn) return;
      var silentFor = Date.now() - Math.max(self._lastPing, joinedAt);
      if (silentFor > PRUNE_MS + 4000) self._hostLost();
    }, HEARTBEAT_MS));
  };

  Game.prototype._hostLost = function () {
    if (this._closed) return;
    this._hostConn = null;
    var e = new Error('Lost connection to the host.');
    e.type = 'network';
    this._status('disconnected', e.message);
    this.emit('error', e);
  };

  /* ═════════════════════ MATCHMAKING ═══════════════════════════ */
  /**
   * quickMatch() — find a live opponent automatically.
   *
   * Search order (serverless! we just probe deterministic room ids):
   *   1. "same network" slots   → players behind YOUR router right now
   *   2. "same country" slots   → players in your country
   *   3. "worldwide" slots      → anyone, anywhere
   *
   * If nobody is waiting, you become the host of the first free slot
   * and the next searcher finds you. Resolves { isHost, scope }.
   */
  Game.prototype.quickMatch = async function () {
    this._guard();
    if (this._busy) throw new Error('FrostByte: this Game instance is already connecting.');
    this._busy = true;

    await loadEngine();
    this._status('region', 'checking your region…');
    var reg = await region();

    var scopes = [];
    if (reg.network)                          scopes.push({ key: 'n' + reg.network, label: 'same network' });
    if (reg.country && reg.country !== 'XX')  scopes.push({ key: 'c' + reg.country, label: reg.country });
    scopes.push({ key: 'w', label: 'worldwide' });

    var self = this;
    var game = this.gameName;

    /* Phase 1 — scan for an already-waiting host (fast misses: the
       broker answers "peer-unavailable" in ~100ms for empty slots).  */
    this.peer = await this._newPeer(scanGuestId(game));
    this.me = { id: this.peer.id, isHost: false, name: this.opts.playerName || 'Player' };

    for (var s = 0; s < scopes.length; s++) {
      var scope = scopes[s];
      this._status('searching', 'looking for players · ' + scope.label);
      for (var i = 0; i < SCAN_SLOTS; i++) {
        try {
          var conn = await tryConnect(this.peer, qmHostId(game, scope.key, i), SCAN_TIMEOUT);
          /* ── MATCHED! we are the guest ── */
          this.code = null;
          this._scopeLabel = scope.label;
          this._attachGuestConn(conn);
          this._startGuestWatch();
          this._status('connected', 'matched · ' + scope.label);
          this._recordUse();
          this.emit('ready', { isHost: false, code: null, me: this.me, scope: scope.label });
          this._busy = false;
          return { isHost: false, scope: scope.label };
        } catch (e) { /* empty slot → next */ }
      }
    }

    /* Phase 2 — nobody out there: claim the first free hosting slot. */
    try { this.peer.destroy(); } catch (e) {}
    this.peer = null;

    for (var s2 = 0; s2 < scopes.length; s2++) {
      var sc = scopes[s2];
      this._status('waiting', 'no players yet · hosting a ' + sc.label + ' match…');
      for (var j = 0; j < SCAN_SLOTS; j++) {
        try {
          this.peer = await this._newPeer(qmHostId(game, sc.key, j));
          /* ── we are now the match host ── */
          this.code = null;
          this.isHost = true;
          this._scopeLabel = sc.label;
          this.me = { id: this.peer.id, isHost: true, name: this.opts.playerName || 'Host' };
          this.players_map.set('me', this.me);
          this._wireHost();
          this._startHeartbeat();
          this._status('waiting', 'waiting for a challenger · ' + sc.label);
          this._recordUse();
          this.emit('ready', { isHost: true, code: null, me: this.me, scope: sc.label });
          this._busy = false;
          return { isHost: true, scope: sc.label };
        } catch (e) { /* slot taken → next */ }
      }
    }

    this._busy = false;
    throw new Error('FrostByte: matchmaking failed — check your connection and try again.');
  };

  /* ═════════════════════ data + info API ═══════════════════════ */

  /**
   * send(data, toId?) — send any JSON-serializable data.
   *   host  : omit toId → broadcast to all guests; toId → one guest.
   *   guest : omit toId → to host (and relayed to everyone);
   *           toId → private message to that player (via host relay).
   */
  Game.prototype.send = function (data, toId) {
    if (this.isHost) {
      var self = this;
      if (toId) {
        var c = this.conns.get(toId);
        if (c) safeSend(c, { t: 'to', d: data, from: 'host' });
      } else {
        this.conns.forEach(function (c2) { safeSend(c2, { t: 'b', d: data, from: 'host' }); });
      }
    } else if (this._hostConn) {
      if (toId) safeSend(this._hostConn, { t: 'relay', to: toId, d: data });
      else      safeSend(this._hostConn, { t: 'd', d: data });
    }
  };

  /** Alias of send() without a target — host→all, guest→everyone. */
  Game.prototype.broadcast = function (data) { this.send(data); };

  /** Current player list: [{ id, isHost, name }] */
  Game.prototype.players = function () {
    if (this.isHost) {
      var out = [];
      this.players_map.forEach(function (r) {
        out.push(r.player || r);
      });
      return out;
    }
    return this.rosterSnap.length ? this.rosterSnap : (this.me ? [this.me] : []);
  };

  /** Tear everything down. */
  Game.prototype.close = function () {
    this._closed = true;
    this._timers.forEach(clearInterval);
    this._timers = [];
    try { if (this.peer) this.peer.destroy(); } catch (e) {}
    this.peer = null; this._hostConn = null;
    this._status('closed', 'game closed');
    this.emit('close');
  };

  /* ═════════════════════════ exports ═══════════════════════════ */

  function Play(opts) { return new Game(opts); }   // callable without `new`
  Play.Game      = Game;
  Play.region    = region;          // Play.region() → Promise<{ ip, country, network }>
  Play.version   = VERSION;
  Play.keys      = Keys;            // v2 — API key management (see keys.html)
  Play.isSupported = function () {
    return typeof global.RTCPeerConnection !== 'undefined' ||
           typeof global.webkitRTCPeerConnection !== 'undefined';
  };

  global.Play = Play;
  global.FrostByte = Play;          // brand alias

  if (typeof module !== 'undefined' && module.exports) module.exports = Play;

})(typeof window !== 'undefined' ? window : this);

