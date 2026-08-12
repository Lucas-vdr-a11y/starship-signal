(function () {
  "use strict";

  var state = window.StarshipSim.createState();
  var obstacles = window.StarshipSim.cabinObstacles();
  var keys = Object.create(null);
  var lookX = 0;
  var lookY = 0;
  var running = false;
  var last = 0;
  var ledger = null;
  var gameBind = null;
  var gameState = null;
  var gameCanvas = null;
  var gameCtx = null;
  var lastFocusId = null;
  var stepAcc = 0;
  var resultArmed = false;
  var wasHolding = false;

  function $(id) {
    return document.getElementById(id);
  }

  function fileHint() {
    var el = $("file-hint");
    if (!el) return;
    if (location.protocol === "file:") {
      el.hidden = false;
      el.textContent =
        "file:// is fine for stills. For video plates, serve this folder:  python3 -m http.server 8765";
    } else {
      el.hidden = true;
    }
  }

  function inputFromKeys() {
    return {
      forward: !!(keys.KeyW || keys.ArrowUp),
      back: !!(keys.KeyS || keys.ArrowDown),
      left: !!(keys.KeyA || keys.ArrowLeft),
      right: !!(keys.KeyD || keys.ArrowRight),
      sprint: !!(keys.ShiftLeft || keys.ShiftRight),
      lookX: lookX,
      lookY: lookY,
    };
  }

  function audio() {
    return window.StarshipAudio;
  }

  function playFx(name) {
    if (audio() && audio().play) audio().play(name);
  }

  function drainGameFx() {
    if (!gameState || !window.StarshipGames.takeFx) return;
    var list = window.StarshipGames.takeFx(gameState);
    for (var i = 0; i < list.length; i++) playFx(list[i]);
  }

  function setLookPrompt(focused) {
    var reticle = $("reticle");
    var prompt = $("look-prompt");
    var world = $("look-prompt-world");
    var inCabin = running && !gameState;
    if (reticle) {
      reticle.hidden = !inCabin;
      reticle.classList.toggle("is-ready", !!(inCabin && focused));
    }
    if (!prompt) return;
    if (!inCabin || !focused) {
      prompt.hidden = true;
      return;
    }
    if (world) world.textContent = focused.label || focused.world || "Window";
    prompt.hidden = false;
  }

  function pointerLocked() {
    return !!(document.pointerLockElement || document.webkitPointerLockElement);
  }

  function hoverTarget(el) {
    while (el && el !== document && el !== document.documentElement) {
      if (el.tagName === "BUTTON" || el.tagName === "A" || el.getAttribute && el.getAttribute("role") === "button") {
        return true;
      }
      el = el.parentElement;
    }
    return false;
  }

  function moveCursor(x, y, target) {
    var el = $("cursor");
    if (!el) return;
    if (pointerLocked()) {
      el.hidden = true;
      return;
    }
    el.style.setProperty("--cx", Math.round(x) + "px");
    el.style.setProperty("--cy", Math.round(y) + "px");
    el.classList.toggle("is-hover", hoverTarget(target));
    el.hidden = false;
  }

  function bindCursor() {
    var el = $("cursor");
    if (!el) return;
    document.addEventListener("mousemove", function (e) {
      moveCursor(e.clientX, e.clientY, e.target);
    });
    document.addEventListener("mousedown", function (e) {
      if (el && !pointerLocked()) el.classList.add("is-down");
      void e;
    });
    document.addEventListener("mouseup", function () {
      if (el) el.classList.remove("is-down");
    });
    document.documentElement.addEventListener("mouseleave", function () {
      if (el && !pointerLocked()) el.hidden = true;
    });
    document.addEventListener("pointerlockchange", function () {
      if (el) {
        el.hidden = pointerLocked();
        el.classList.remove("is-down", "is-hover");
      }
    });
  }

  function setFocusedWindow(focused) {
    var id = focused && focused.id;
    if (window.StarshipCabin && window.StarshipCabin.setFocusedWindow) {
      window.StarshipCabin.setFocusedWindow(id || null);
    }
    if (id && id !== lastFocusId) playFx("focus");
    lastFocusId = id || null;
  }

  function setHud() {
    var hud = $("hud-readout");
    if (gameState) {
      if (hud) hud.textContent = (gameBind && gameBind.title) || gameState.gameId;
      setLookPrompt(null);
      return;
    }
    var focused = running ? window.StarshipSim.pickWindow(state, ledger) : null;
    if (hud) {
      hud.textContent = focused
        ? "LOOK  " + focused.label + "   ·   press E"
        : "DECK 4  ·  walk the ring  ·  look at a pane";
    }
    setLookPrompt(focused);
    if (running) setFocusedWindow(focused);
  }

  function paintGame() {
    if (!gameCtx || !gameState || !gameBind) return;
    window.StarshipGameView.draw(gameCtx, gameBind, gameState);
    syncResult();
  }

  function hideResult() {
    var el = $("game-result");
    if (el) el.hidden = true;
  }

  function syncResult() {
    var el = $("game-result");
    if (!el) return;
    if (!gameState || !gameState.over) {
      el.hidden = true;
      el.classList.remove("is-win", "is-lose");
      return;
    }
    var copy = window.StarshipGameView.resultCopy(gameState, gameBind);
    var kicker = $("game-result-kicker");
    var title = $("game-result-title");
    var body = $("game-result-body");
    if (kicker) kicker.textContent = copy.kicker;
    if (title) title.textContent = copy.title;
    if (body) body.textContent = copy.body;
    el.classList.toggle("is-win", !!copy.won);
    el.classList.toggle("is-lose", !copy.won);
    el.hidden = false;
  }

  function retryGame() {
    if (!gameBind) return false;
    if (audio() && audio().setHeat) audio().setHeat(false, 0);
    gameState = window.StarshipGames.start(gameBind.gameId, { windowId: gameBind.windowId });
    resultArmed = true;
    wasHolding = false;
    hideResult();
    playFx("ui");
    paintGame();
    setHud();
    return true;
  }

  function enterGame(windowId) {
    if (!ledger) return false;
    var bind = window.StarshipGames.activateWindow(ledger, windowId);
    if (!bind) return false;
    gameBind = bind;
    gameState = window.StarshipGames.start(bind.gameId, { windowId: windowId });
    resultArmed = true;
    wasHolding = false;
    var layer = $("game-layer");
    if (layer) layer.hidden = false;
    var leave = $("game-exit");
    if (leave) leave.hidden = false;
    hideResult();
    setLookPrompt(null);
    if (window.StarshipCabin && window.StarshipCabin.setFocusedWindow) {
      window.StarshipCabin.setFocusedWindow(null);
    }
    if (audio()) {
      audio().unlock();
      audio().setAmbientLevel(0.012);
    }
    playFx("enter");
    if (document.exitPointerLock) {
      try {
        document.exitPointerLock();
      } catch (e) {
        void e;
      }
    }
    paintGame();
    setHud();
    return true;
  }

  function exitGame() {
    if (audio() && audio().setHeat) audio().setHeat(false, 0);
    if (gameState) playFx("exit");
    gameBind = null;
    gameState = null;
    resultArmed = false;
    hideResult();
    var layer = $("game-layer");
    if (layer) layer.hidden = true;
    var leave = $("game-exit");
    if (leave) leave.hidden = true;
    if (audio()) audio().setAmbientLevel(0.045);
    var canvas = window.StarshipCabin.getCanvas && window.StarshipCabin.getCanvas();
    if (canvas && canvas.requestPointerLock) {
      try {
        canvas.requestPointerLock();
      } catch (e) {
        void e;
      }
    }
    setHud();
  }

  function tick(now) {
    requestAnimationFrame(tick);
    if (!running) {
      if (window.StarshipCabin.frame) window.StarshipCabin.frame();
      return;
    }
    var dt = last ? (now - last) / 1000 : 0.016;
    last = now;
    if (gameState) {
      if (gameState.gameId === "drift") {
        if (keys.KeyA || keys.ArrowLeft) window.StarshipGames.input(gameState, { type: "nudge", dx: -0.9 * dt });
        if (keys.KeyD || keys.ArrowRight) window.StarshipGames.input(gameState, { type: "nudge", dx: 0.9 * dt });
      }
      if (gameState.gameId === "slingshot" && !gameState.launched) {
        if (keys.KeyA) window.StarshipGames.input(gameState, { type: "aimDelta", da: -1.6 * dt });
        if (keys.KeyD) window.StarshipGames.input(gameState, { type: "aimDelta", da: 1.6 * dt });
        if (keys.KeyW) window.StarshipGames.input(gameState, { type: "powerDelta", dp: 0.7 * dt });
        if (keys.KeyS) window.StarshipGames.input(gameState, { type: "powerDelta", dp: -0.7 * dt });
      }
      window.StarshipGames.step(gameState, dt);
      drainGameFx();
      if (resultArmed && gameState.over) {
        playFx(gameState.won ? "win" : "lose");
        resultArmed = false;
        if (audio() && audio().setHeat) audio().setHeat(false, 0);
      }
      if (gameState.gameId === "heatband" && audio() && audio().setHeat) {
        audio().setHeat(!!gameState.holding && !gameState.over, gameState.temp || 0);
        wasHolding = !!gameState.holding;
      } else if (wasHolding && audio() && audio().setHeat) {
        audio().setHeat(false, 0);
        wasHolding = false;
      }
      paintGame();
      setHud();
      return;
    }
    var input = inputFromKeys();
    window.StarshipSim.step(state, input, dt, obstacles);
    lookX = 0;
    lookY = 0;
    if (input.forward || input.back || input.left || input.right) {
      stepAcc += dt;
      var gap = input.sprint ? 0.3 : 0.42;
      if (stepAcc >= gap) {
        stepAcc = 0;
        playFx("step");
      }
    } else {
      stepAcc = 0;
    }
    window.StarshipCabin.applyState(state);
    window.StarshipCabin.frame();
    setHud();
  }

  function begin() {
    var boot = $("boot");
    if (boot) boot.hidden = true;
    running = true;
    last = 0;
    if (audio()) {
      audio().unlock();
      audio().startAmbient();
      audio().setAmbientLevel(0.045);
    }
    playFx("ui");
    var canvas = window.StarshipCabin.getCanvas();
    if (canvas && canvas.requestPointerLock) {
      try {
        canvas.requestPointerLock();
      } catch (err) {
        void err;
      }
    }
    window.StarshipCabin.tryPlayVideos();
    setHud();
  }

  function isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }

  function toggleFullscreen() {
    var root = document.documentElement;
    playFx("ui");
    if (!isFullscreen()) {
      var req = root.requestFullscreen || root.webkitRequestFullscreen;
      if (req) {
        try {
          var out = req.call(root);
          if (out && out.catch) out.catch(function () {});
        } catch (err) {
          void err;
        }
      }
    } else {
      var exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) {
        try {
          exit.call(document);
        } catch (err2) {
          void err2;
        }
      }
    }
  }

  function syncFullscreenLabel() {
    var btn = $("fs-btn");
    if (btn) btn.textContent = isFullscreen() ? "Exit full" : "Fullscreen";
  }

  function syncMuteLabel() {
    var btn = $("mute-btn");
    if (!btn || !audio()) return;
    var off = audio().isMuted();
    btn.textContent = off ? "Muted" : "Sound";
    btn.setAttribute("aria-pressed", off ? "true" : "false");
  }

  function toggleMute() {
    if (!audio()) return;
    audio().unlock();
    audio().setMuted(!audio().isMuted());
    if (!audio().isMuted()) audio().startAmbient();
    syncMuteLabel();
  }

  function onKey(e, down) {
    keys[e.code] = down;
    if (!down) {
      if (gameState && gameState.gameId === "heatband" && e.code === "Space") {
        window.StarshipGames.input(gameState, { type: "release" });
      }
      return;
    }
    if (e.code === "Escape" && gameState) {
      e.preventDefault();
      exitGame();
      return;
    }
    if (gameState && gameState.over) {
      if (e.code === "KeyR" || e.code === "Enter" || e.code === "NumpadEnter") {
        e.preventDefault();
        retryGame();
      }
      return;
    }
    if (gameState) {
      if (e.code === "Space") {
        e.preventDefault();
        if (gameState.gameId === "slingshot") window.StarshipGames.input(gameState, { type: "launch" });
        else if (gameState.gameId === "phaseskip") window.StarshipGames.input(gameState, { type: "tap" });
        else if (gameState.gameId === "heatband") window.StarshipGames.input(gameState, { type: "hold" });
        else if (gameState.gameId === "orefall") window.StarshipGames.input(gameState, { type: "fire" });
        else if (gameState.gameId === "pipebloom") window.StarshipGames.input(gameState, { type: "rotate" });
      }
      if (e.code === "KeyE" && gameState.gameId === "pipebloom") {
        window.StarshipGames.input(gameState, { type: "rotate" });
      }
      drainGameFx();
      return;
    }
    if (e.code === "KeyE" && running) {
      var focused = window.StarshipSim.pickWindow(state, ledger);
      if (focused) enterGame(focused.id);
    }
    if (down && (e.code === "KeyW" || e.code === "KeyA" || e.code === "KeyS" || e.code === "KeyD")) {
      e.preventDefault();
    }
  }

  function onGamePointer(ev) {
    if (!gameState || !gameCanvas || gameState.over) return;
    var rect = gameCanvas.getBoundingClientRect();
    var nx = (ev.clientX - rect.left) / rect.width;
    var ny = (ev.clientY - rect.top) / rect.height;
    if (gameState.gameId === "orefall") {
      window.StarshipGames.input(gameState, { type: "aim", x: nx, y: ny });
    }
    if (ev.type === "mousedown") {
      var hit = window.StarshipGameView.hitTest(gameBind, gameState, nx, ny, gameCanvas);
      if (hit) window.StarshipGames.input(gameState, hit);
    }
    if (ev.type === "mouseup" && gameState.gameId === "heatband") {
      window.StarshipGames.input(gameState, { type: "release" });
    }
    drainGameFx();
    paintGame();
  }

  function boot() {
    fileHint();
    ledger = window.STARSHIP_LEDGER;
    var start = function (data) {
      ledger = data;
      var host = $("viewport");
      window.StarshipCabin.init(host, data);
      window.StarshipGameView.prepare(data);
      window.StarshipCabin.applyState(state);
      window.StarshipCabin.frame();
      window.addEventListener("resize", function () {
        window.StarshipCabin.resize();
        if (gameState) paintGame();
      });
      requestAnimationFrame(tick);
      bindCursor();
      $("boot-btn").addEventListener("click", function (e) {
        e.stopPropagation();
        begin();
      });
      host.addEventListener("click", function () {
        if (!running) begin();
        else if (gameState) return;
        else if (document.pointerLockElement !== window.StarshipCabin.getCanvas()) {
          try {
            window.StarshipCabin.getCanvas().requestPointerLock();
          } catch (err) {
            void err;
          }
        }
      });
      gameCanvas = $("game-canvas");
      if (gameCanvas) {
        gameCtx = gameCanvas.getContext("2d");
        gameCanvas.addEventListener("mousedown", onGamePointer);
        gameCanvas.addEventListener("mousemove", onGamePointer);
        gameCanvas.addEventListener("mouseup", onGamePointer);
      }
      var leave = $("game-exit");
      if (leave) leave.addEventListener("click", exitGame);
      var resultLeave = $("game-result-leave");
      if (resultLeave) resultLeave.addEventListener("click", exitGame);
      var retry = $("game-retry");
      if (retry) retry.addEventListener("click", function (e) {
        e.preventDefault();
        retryGame();
      });
      var fsBtn = $("fs-btn");
      if (fsBtn) fsBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        toggleFullscreen();
      });
      var muteBtn = $("mute-btn");
      if (muteBtn) muteBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        toggleMute();
      });
      document.addEventListener("fullscreenchange", function () {
        syncFullscreenLabel();
        window.StarshipCabin.resize();
        if (gameState) paintGame();
      });
      document.addEventListener("webkitfullscreenchange", function () {
        syncFullscreenLabel();
        window.StarshipCabin.resize();
        if (gameState) paintGame();
      });
      syncMuteLabel();
      syncFullscreenLabel();
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(function () {
          if (gameState) paintGame();
        });
      }
    };
    if (ledger) {
      start(ledger);
    } else {
      fetch("assets/ledger.json")
        .then(function (r) {
          return r.json();
        })
        .then(start)
        .catch(function (err) {
          var bootEl = $("boot");
          if (bootEl) {
            bootEl.querySelector("p").textContent =
              "Could not load assets/ledger.json. Serve with python3 -m http.server 8765 — " + String(err);
          }
        });
    }

    window.addEventListener("keydown", function (e) {
      onKey(e, true);
    });
    window.addEventListener("keyup", function (e) {
      onKey(e, false);
    });
    document.addEventListener("mousemove", function (e) {
      if (!gameState && document.pointerLockElement) {
        lookX += e.movementX || 0;
        lookY += e.movementY || 0;
      }
    });
  }

  window.StarshipApp = {
    getState: function () {
      return state;
    },
    getGameState: function () {
      return gameState;
    },
    getGameBind: function () {
      return gameBind;
    },
    begin: begin,
    boot: boot,
    enterGame: enterGame,
    exitGame: exitGame,
    retryGame: retryGame,
    toggleFullscreen: toggleFullscreen,
  };

  if (!window.__STARSHIP_NO_BOOT) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", boot);
    } else {
      boot();
    }
  }
})();
