"use strict";

var fs = require("fs");
var path = require("path");
var vm = require("vm");
var assert = require("assert");

var ROOT = path.resolve(__dirname, "..");
var scripts = [
  "js/vendor/three.min.js",
  "js/sim.js",
  "js/games.js",
  "js/game-view.js",
  "js/ledger-data.js",
  "js/render.js",
  "js/audio.js",
  "js/app.js",
];

function stubEl() {
  return {
    hidden: true,
    textContent: "",
    style: {},
    clientWidth: 1280,
    clientHeight: 720,
    appendChild: function () {},
    addEventListener: function () {},
    querySelector: function () {
      return { textContent: "" };
    },
    getContext: function () {
      return {
        fillRect: function () {},
        fillText: function () {},
        strokeRect: function () {},
        fillStyle: "",
        strokeStyle: "",
        font: "",
        lineWidth: 1,
      };
    },
  };
}

var document = {
  readyState: "complete",
  body: stubEl(),
  documentElement: stubEl(),
  getElementById: function () {
    return stubEl();
  },
  createElement: function () {
    return stubEl();
  },
  addEventListener: function () {},
  querySelector: function () {
    return stubEl();
  },
};

var windowObj = {
  __STARSHIP_NO_BOOT: true,
  innerWidth: 1280,
  innerHeight: 720,
  devicePixelRatio: 1,
  addEventListener: function () {},
  requestAnimationFrame: function () {
    return 0;
  },
  console: console,
  location: { protocol: "http:" },
  document: document,
};

document.defaultView = windowObj;
windowObj.window = windowObj;
windowObj.self = windowObj;
windowObj.HTMLCanvasElement = function () {};
windowObj.Image = function () {};

var sandbox = windowObj;
vm.createContext(sandbox);

scripts.forEach(function (rel) {
  var abs = path.join(ROOT, rel);
  var src = fs.readFileSync(abs, "utf8");
  assert.ok(!/\brequire\s*\(/.test(src) || rel.indexOf("vendor") !== -1, rel + " must not use require");
  assert.ok(typeof sandbox.module === "undefined", "module must stay undefined");
  assert.ok(typeof sandbox.require === "undefined", "require must stay undefined");
  vm.runInContext(src, sandbox, { filename: rel });
  console.log("loaded " + rel);
});

assert.ok(sandbox.THREE, "THREE global installed");
assert.ok(sandbox.StarshipSim, "StarshipSim global installed");
assert.ok(sandbox.STARSHIP_LEDGER, "STARSHIP_LEDGER global installed");
assert.ok(sandbox.StarshipCabin, "StarshipCabin global installed");
assert.ok(sandbox.StarshipApp, "StarshipApp global installed");
assert.ok(sandbox.StarshipGames, "StarshipGames global installed");
assert.ok(sandbox.StarshipGameView, "StarshipGameView global installed");
assert.ok(sandbox.StarshipAudio, "StarshipAudio global installed");
assert.strictEqual(typeof sandbox.module, "undefined");
assert.strictEqual(typeof sandbox.require, "undefined");
console.log("browser-load ok — globals installed, no module/require");
