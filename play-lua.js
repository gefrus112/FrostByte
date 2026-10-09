/*!
 * ███╗   ██╗███████╗████████╗    ██╗     ██╗   ██╗ █████╗ 
 * ████╗  ██║██╔════╝╚══██╔══╝    ██║     ██║   ██║██╔══██╗
 * ██╔██╗ ██║█████╗     ██║       ██║     ██║   ██║███████║
 * ██║╚██╗██║██╔══╝     ██║       ██║     ██║   ██║██╔══██║
 * ██║ ╚████║███████╗   ██║       ███████╗╚██████╔╝██║  ██║
 * ╚═╝  ╚═══╝╚══════╝   ╚═╝       ╚══════╝ ╚═════╝ ╚═╝  ╚═╝
 *
 * FrostByte play-lua.js v2.0.0 — multiplayer in LUA, powered by JavaScript.
 *
 * Load this AFTER play.js. It embeds the Fengari Lua VM (from CDN) and
 * exposes the whole FrostByte API to Lua through a `net` table — so you
 * can create a multiplayer game entirely in Lua, from any web page.
 *
 *   <script src="https://gefrus112.github.io/FrostByte/play.js"></script>
 *   <script src="https://gefrus112.github.io/FrostByte/play-lua.js"></script>
 *
 * FROM JAVASCRIPT:
 *   const res = await FrostByte.lua(`
 *     net.init({ game = 'my-lua-game', player = 'mo' })
 *     net.quickmatch()
 *     net.on('data', function (d, from) print('got', d.text) end)
 *     net.broadcast({ text = 'hello from Lua!' })
 *   `);
 *   res.api.call('on_button');          // call Lua functions from JS
 *   FrostByte.luaRun(luaString, opts);  // alias
 *
 * FROM LUA (all networking runs on the same P2P WebRTC mesh):
 *   net.init({ game = 'my-lua-game', player = 'mo' })
 *   net.quickmatch() / net.host(cb) / net.join('K7XF', cb)
 *   net.broadcast({ any = 'json-able table' })
 *   net.send({ x = 1 }, toPlayerId)
 *   net.players()  net.me()  net.code()  net.ishost()
 *   net.on('data'|'status'|'ready'|'playerjoin'|'playerleave'|'error', fn)
 *   js.run('document.title = "hi"')      -- touch the DOM from Lua
 *
 * Lua scripts written in <script type="text/lua"> tags are executed
 * automatically once the page loads.
 *
 * MIT License — build games, not backends. ❄
 */
(function (global) {
  'use strict';

  var VERSION = '2.0.0';

  var FENGARI_CDNS = [
    'https://cdn.jsdelivr.net/npm/fengari-web@0.1.4/dist/fengari-web.js',
    'https://unpkg.com/fengari-web@0.1.4/dist/fengari-web.js'
  ];

  /* ───────────────────────── fengari loader ───────────────────────── */

  var fengariPromise = null;

  function loadFengari() {
    if (global.fengari) return Promise.resolve(global.fengari);
    if (fengariPromise) return fengariPromise;
    fengariPromise = new Promise(function (resolve, reject) {
      var i = 0;
      function next() {
        if (i >= FENGARI_CDNS.length) {
          reject(new Error('FrostByte Lua: could not load the Lua VM (fengari). Check your internet connection.'));
          return;
        }
        var s = document.createElement('script');
        s.src = FENGARI_CDNS[i++];
        s.async = true;
        s.onload = function () {
          if (global.fengari) resolve(global.fengari); else next();
        };
        s.onerror = next;
        document.head.appendChild(s);
      }
      next();
    });
    return fengariPromise;
  }

  /* ───────────────────── lua ↔ js value converters ────────────────── */
  /* Raw C-API converters (no interop magic) — plain JSON-able data only. */

  function absIndex(L, idx) {
    if (idx >= 0 || idx <= -1001000 /* LUA_REGISTRYINDEX */) return idx;
    return fengari.lua.lua_gettop(L) + idx + 1;
  }

  function pushJs(L, v, depth) {
    var lua = fengari.lua, tu = fengari.to_luastring;
    depth = depth || 0;
    if (v == null)               return lua.lua_pushnil(L);
    switch (typeof v) {
      case 'boolean': return lua.lua_pushboolean(L, v);
      case 'number':  return lua.lua_pushnumber(L, v);
      case 'string':  return lua.lua_pushstring(L, tu(v));
    }
    if (depth > 10) return lua.lua_pushnil(L);
    var keys, k;
    if (Array.isArray(v)) {
      lua.lua_createtable(L, v.length, 0);
      for (var i = 0; i < v.length; i++) {
        lua.lua_pushnumber(L, i + 1);
        pushJs(L, v[i], depth + 1);
        lua.lua_settable(L, -3);
      }
      return 1;
    }
    if (typeof v === 'object') {
      keys = Object.keys(v);
      lua.lua_createtable(L, 0, keys.length);
      for (var j = 0; j < keys.length; j++) {
        k = keys[j];
        lua.lua_pushstring(L, tu(String(k)));
        pushJs(L, v[k], depth + 1);
        lua.lua_settable(L, -3);
      }
      return 1;
    }
    /* functions / symbols / anything else → nil */
    return lua.lua_pushnil(L);
  }

  function toJs(L, idx, depth) {
    var lua = fengari.lua, tjs = fengari.to_jsstring;
    depth = depth || 0;
    idx = absIndex(L, idx);
    var t = lua.lua_type(L, idx);
    switch (t) {
      case lua.LUA_TNIL:      return null;
      case lua.LUA_TBOOLEAN:  return lua.lua_toboolean(L, idx);
      case lua.LUA_TNUMBER:   return lua.lua_tonumber(L, idx);
      case lua.LUA_TSTRING:   return tjs(lua.lua_tostring(L, idx));
      case lua.LUA_TTABLE:
        if (depth > 10) return null;
        var pairs = [], isArr = true;
        lua.lua_pushnil(L);
        while (lua.lua_next(L, idx) !== 0) {
          /* key at -2, value at -1 */
          var k = toJs(L, -2, depth + 1);
          var v = toJs(L, -1, depth + 1);
          if (typeof k === 'number' && k === Math.floor(k) && k >= 1 && k === pairs.length + 1) {
            /* still array-ish */
          } else {
            isArr = false;
          }
          pairs.push([k, v]);
          lua.lua_settop(L, -2);          /* pop value, keep key for lua_next */
        }
        if (isArr) return pairs.map(function (p) { return p[1]; });
        var obj = {};
        pairs.forEach(function (p) { obj[String(p[0])] = p[1]; });
        return obj;
      default:
        return null;
    }
  }

  /* ───────────────────────── lua error helper ─────────────────────── */

  function popError(L) {
    var msg = fengari.lua.lua_tostring(L, -1);
    var out = msg ? fengari.to_jsstring(msg) : 'unknown lua error';
    fengari.lua.lua_settop(L, -2);   /* pop the error */
    return out;
  }

  /* ─────────────────────────── the bridge ─────────────────────────── */

  function createBridge(opts) {
    var feng = global.fengari;
    var lua = feng.lua, lauxlib = feng.lauxlib, lualib = feng.lualib;
    var tu = feng.to_luastring, tjs = feng.to_jsstring;

    var L = lauxlib.luaL_newstate();
    lualib.luaL_openlibs(L);

    var bridge = {
      L: L,
      game: null,          // the Play instance
      handlers: {},        // event name → [luaL_ref, …]
      callbacks: 0,
      closed: false
    };

    /* friendlier print → console */
    lua.lua_pushcfunction(L, function (L2) {
      var n = lua.lua_gettop(L2), parts = [];
      for (var i = 1; i <= n; i++) {
        var v = toJs(L2, i, 0);
        parts.push(typeof v === 'string' ? v : JSON.stringify(v));
      }
      console.log.apply(console, ['[lua]'].concat(parts));
      return 0;
    });
    lua.lua_setglobal(L, tu('print'));

    /* ── event dispatch: JS → Lua ── */
    function dispatch(ev, a, b) {
      if (bridge.closed) return;
      var refs = (bridge.handlers[ev] || []).slice();
      refs.forEach(function (ref) {
        lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, ref);
        pushJs(L, a == null ? null : a, 0);
        pushJs(L, b == null ? null : b, 0);
        if (lua.lua_pcall(L, 2, 0, 0) !== 0) {
          console.error('[FrostByte Lua] error in "' + ev + '" handler:', popError(L));
        }
      });
    }
    bridge.dispatch = dispatch;

    function callCallback(ref, args) {
      if (!ref) return;
      lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, ref);
      lauxlib.luaL_unref(L, lua.LUA_REGISTRYINDEX, ref);
      (args || []).forEach(function (x) { pushJs(L, x, 0); });
      if (lua.lua_pcall(L, (args || []).length, 0, 0) !== 0) {
        console.error('[FrostByte Lua] error in callback:', popError(L));
      }
    }

    function needGame(L2) {
      if (!bridge.game) {
        lua.lua_pushstring(L2, tu('no game yet — call net.init({ game = "name" }) first'));
        return lua.lua_error(L2);
      }
      return false;
    }

    /* ── the `net` table ── */
    var net = {};

    /** net.init({ game = 'name', player = 'mo', apiKey = 'fbk_live_…' }) */
    net.init = function (L2) {
      var cfg = toJs(L2, 1, 0) || {};
      if (typeof global.Play === 'undefined') {
        lua.lua_pushstring(L2, tu('play.js is not loaded — include it BEFORE play-lua.js'));
        return lua.lua_error(L2);
      }
      if (bridge.game) { try { bridge.game.close(); } catch (e) {} }
      bridge.game = global.Play({
        game:       cfg.game || 'lua-game',
        playerName: cfg.player || 'lua-player',
        apiKey:     cfg.apiKey || undefined,
        debug:      !!cfg.debug
      });
      var g = bridge.game;
      g.on('status',       function (state, detail) { dispatch('status', state, detail); });
      g.on('data',         function (d, from)       { dispatch('data', d, from); });
      g.on('playerjoin',   function (p)             { dispatch('playerjoin', p, null); });
      g.on('playerleave',  function (p)             { dispatch('playerleave', p, null); });
      g.on('error',        function (err)           { dispatch('error', { message: err && err.message }, null); });
      g.on('ready',        function (r)             { dispatch('ready', r, null); });
      return 0;
    };

    /** net.quickmatch(cb?) — auto matchmaking */
    net.quickmatch = function (L2) {
      if (needGame(L2)) return 1;
      var cb = 0;
      if (lua.lua_type(L2, 1) === lua.LUA_TFUNCTION) {
        lua.lua_pushvalue(L2, 1);
        cb = lauxlib.luaL_ref(L2, lua.LUA_REGISTRYINDEX);
      }
      bridge.game.quickMatch()
        .then(function (r)    { callCallback(cb, [r.isHost, r.scope]); })
        .catch(function (err) { callCallback(cb, [null, err && err.message]); });
      return 0;
    };

    /** net.host(cb?) — host a private room; cb(code) */
    net.host = function (L2) {
      if (needGame(L2)) return 1;
      var cb = 0;
      if (lua.lua_type(L2, 1) === lua.LUA_TFUNCTION) {
        lua.lua_pushvalue(L2, 1);
        cb = lauxlib.luaL_ref(L2, lua.LUA_REGISTRYINDEX);
      }
      bridge.game.host()
        .then(function (r)    { callCallback(cb, [r.code]); })
        .catch(function (err) { callCallback(cb, [null, err && err.message]); });
      return 0;
    };

    /** net.join(code, cb?) — join a room; cb(code, err) */
    net.join = function (L2) {
      if (needGame(L2)) return 1;
      var code = tjs(lua.lua_tostring(L2, 1) || tu(''));
      var cb = 0;
      if (lua.lua_type(L2, 2) === lua.LUA_TFUNCTION) {
        lua.lua_pushvalue(L2, 2);
        cb = lauxlib.luaL_ref(L2, lua.LUA_REGISTRYINDEX);
      }
      bridge.game.join(code)
        .then(function (r)    { callCallback(cb, [r.code]); })
        .catch(function (err) { callCallback(cb, [null, err && err.message]); });
      return 0;
    };

    /** net.on(event, fn) — subscribe to network events from Lua */
    net.on = function (L2) {
      var ev = tjs(lua.lua_tostring(L2, 1) || tu(''));
      if (!ev || lua.lua_type(L2, 2) !== lua.LUA_TFUNCTION) {
        lua.lua_pushstring(L2, tu('net.on needs (eventName, function)'));
        return lua.lua_error(L2);
      }
      lua.lua_pushvalue(L2, 2);
      var ref = lauxlib.luaL_ref(L2, lua.LUA_REGISTRYINDEX);
      if (!bridge.handlers[ev]) bridge.handlers[ev] = [];
      bridge.handlers[ev].push(ref);
      return 0;
    };

    /** net.broadcast(value) — send to everyone */
    net.broadcast = function (L2) {
      if (needGame(L2)) return 1;
      bridge.game.broadcast(toJs(L2, 1, 0));
      return 0;
    };

    /** net.send(value, toPlayerId) — private message */
    net.send = function (L2) {
      if (needGame(L2)) return 1;
      var to = lua.lua_type(L2, 2) === lua.LUA_TSTRING ? tjs(lua.lua_tostring(L2, 2)) : undefined;
      bridge.game.send(toJs(L2, 1, 0), to);
      return 0;
    };

    /** net.players() → table of { id, isHost, name } */
    net.players = function (L2) {
      if (needGame(L2)) return 1;
      pushJs(L2, bridge.game.players(), 0);
      return 1;
    };

    /** net.me() → { id, isHost, name } or nil */
    net.me = function (L2) {
      if (needGame(L2)) return 1;
      pushJs(L2, bridge.game.me || null, 0);
      return 1;
    };

    /** net.code() → room code or nil */
    net.code = function (L2) {
      if (needGame(L2)) return 1;
      var c = bridge.game.code;
      if (c) lua.lua_pushstring(L2, tu(c)); else lua.lua_pushnil(L2);
      return 1;
    };

    /** net.ishost() → boolean */
    net.ishost = function (L2) {
      if (needGame(L2)) return 1;
      lua.lua_pushboolean(L2, !!bridge.game.isHost);
      return 1;
    };

    /** net.close() */
    net.close = function (L2) {
      if (bridge.game) { try { bridge.game.close(); } catch (e) {} }
      return 0;
    };

    /** net.version() → string */
    net.version = function (L2) {
      lua.lua_pushstring(L2, tu('play-lua ' + VERSION + (global.Play ? ' · play.js ' + global.Play.version : '')));
      return 1;
    };

    /* ── the `js` table: reach the page from Lua ── */
    var js = {};

    /** js.run('document.title = …') — execute JavaScript from Lua */
    js.run = function (L2) {
      var code = tjs(lua.lua_tostring(L2, 1) || '');
      try {
        new Function(code)();
      } catch (e) {
        lua.lua_pushstring(L2, tu('js.run: ' + (e && e.message || e)));
        return lua.lua_error(L2);
      }
      return 0;
    };

    /** js.stringify(value) → JSON text (handy for DOM injection) */
    js.stringify = function (L2) {
      var v = toJs(L2, 1, 0);
      lua.lua_pushstring(L2, tu(JSON.stringify(v == null ? null : v)));
      return 1;
    };

    /* install net + js as globals */
    function install(name, table) {
      var keys = Object.keys(table);
      lua.lua_createtable(L, 0, keys.length);
      keys.forEach(function (k) {
        lua.lua_pushcfunction(L, table[k]);
        lua.lua_setfield(L, -2, tu(k));
      });
      lua.lua_setglobal(L, tu(name));
    }
    install('net', {
      init: net.init, quickmatch: net.quickmatch, host: net.host, join: net.join,
      broadcast: net.broadcast, send: net.send, players: net.players, me: net.me,
      code: net.code, ishost: net.ishost, close: net.close, version: net.version,
      on: net.on
    });
    install('js', { run: js.run, stringify: js.stringify });

    /* pre-seed globals from opts.globals (PLAYER_NAME, ROOM, …) */
    var globals = (opts && opts.globals) || {};
    Object.keys(globals).forEach(function (k) {
      pushJs(L, globals[k], 0);
      lua.lua_setglobal(L, tu(k));
    });

    /* auto net.init when opts preconfigure a game */
    if (opts && (opts.game || opts.playerName || opts.apiKey) && global.Play) {
      pushJs(L, {
        game: opts.game, player: opts.playerName, apiKey: opts.apiKey
      }, 0);
      net.init(L);
      lua.lua_settop(L, 0);
    }

    bridge.api = {
      /** Call a Lua global function from JavaScript: api.call('fn', a, b) */
      call: function (name) {
        var args = Array.prototype.slice.call(arguments, 1);
        if (bridge.closed) throw new Error('FrostByte Lua: state closed');
        lua.lua_getglobal(L, tu(String(name)));
        if (lua.lua_type(L, -1) !== lua.LUA_TFUNCTION) {
          lua.lua_settop(L, -2);
          throw new Error('FrostByte Lua: no global function "' + name + '"');
        }
        args.forEach(function (x) { pushJs(L, x, 0); });
        if (lua.lua_pcall(L, args.length, 1, 0) !== 0) {
          var em = popError(L);
          throw new Error('FrostByte Lua: ' + name + '() failed: ' + em);
        }
        var res = toJs(L, -1, 0);
        lua.lua_settop(L, -2);
        return res;
      },
      /** Read a Lua global: api.get('myvar') */
      get: function (name) {
        lua.lua_getglobal(L, tu(String(name)));
        var v = toJs(L, -1, 0);
        lua.lua_settop(L, -2);
        return v;
      },
      /** Set a Lua global: api.set('score', 12) */
      set: function (name, value) {
        pushJs(L, value, 0);
        lua.lua_setglobal(L, tu(String(name)));
      },
      /** Fire a Lua handler without a function call round-trip */
      dispatch: dispatch,
      close: function () {
        if (bridge.closed) return;
        bridge.closed = true;
        if (bridge.game) { try { bridge.game.close(); } catch (e) {} }
      },
      state: function () { return L; }
    };

    return bridge;
  }

  /* ───────────────────────── public JS API ────────────────────────── */

  /**
   * FrostByte.lua(source, opts) → Promise<{ ok, error?, api }>
   *
   * opts = {
   *   game:       'namespace',        // pre-configures net.init for you
   *   playerName: 'mo',
   *   apiKey:     'fbk_live_…',
   *   globals:    { ROOM: 'K7XF' }    // injected as Lua globals
   * }
   */
  function runLua(source, opts) {
    return loadFengari().then(function () {
      var bridge;
      try {
        bridge = createBridge(opts || {});
      } catch (e) {
        return { ok: false, error: 'FrostByte Lua: failed to start the Lua VM — ' + (e && e.message || e), api: null };
      }
      var lauxlib = global.fengari.lauxlib, lua = global.fengari.lua;
      var tu = global.fengari.to_luastring;

      if (lauxlib.luaL_loadstring(bridge.L, tu(String(source))) !== 0) {
        return { ok: false, error: 'FrostByte Lua (load): ' + popError(bridge.L), api: bridge.api };
      }
      if (lua.lua_pcall(bridge.L, 0, lua.LUA_MULTRET, 0) !== 0) {
        return { ok: false, error: 'FrostByte Lua: ' + popError(bridge.L), api: bridge.api };
      }
      return { ok: true, error: null, api: bridge.api };
    });
  }

  /** Auto-run every <script type="text/lua"> on the page. */
  function autoRun() {
    var tags = document.querySelectorAll('script[type="text/lua"]');
    Array.prototype.forEach.call(tags, function (t) {
      runLua(t.textContent, {
        game:       t.getAttribute('data-game') || undefined,
        playerName: t.getAttribute('data-player') || undefined,
        globals:    window.FROSTBYTE_LUA_GLOBALS || undefined
      }).then(function (res) {
        if (!res.ok) console.error(res.error);
        window.__lastLuaResult = res;   // handy for debugging in devtools
      });
    });
  }

  /* exports — attach to FrostByte and to our own namespace */
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', autoRun);
    } else {
      autoRun();
    }
  }

  var FrostByteLua = {
    run: runLua,
    version: VERSION,
    /** Promise that resolves once the Lua VM is ready. */
    ready: function () { return loadFengari(); }
  };

  global.FrostByteLua = FrostByteLua;
  function attach() {
    if (global.Play) {
      if (!global.Play.lua)      global.Play.lua = runLua;
      if (!global.FrostByte.lua) global.FrostByte.lua = runLua;
      return true;
    }
    return false;
  }
  if (!attach()) {
    /* play.js not loaded yet — retry shortly, then give up quietly */
    var tries = 0;
    var t = setInterval(function () {
      if (attach() || ++tries > 200) clearInterval(t);
    }, 50);
  }

})(typeof window !== 'undefined' ? window : this);
