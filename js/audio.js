(function () {
  "use strict";

  var ctx = null;
  var master = null;
  var ambientGain = null;
  var ambientNodes = [];
  var heatNodes = null;
  var muted = false;
  var unlocked = false;

  function AC() {
    return window.AudioContext || window.webkitAudioContext;
  }

  function now() {
    return ctx ? ctx.currentTime : 0;
  }

  function ensure() {
    if (ctx) return ctx;
    var Ctor = AC();
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.85;
    master.connect(ctx.destination);
    return ctx;
  }

  function resume() {
    ensure();
    if (ctx && ctx.state === "suspended" && ctx.resume) {
      ctx.resume().catch(function () {});
    }
    unlocked = true;
    return ctx;
  }

  function env(gain, t, peak, attack, hold, release) {
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    gain.gain.setValueAtTime(Math.max(0.0002, peak), t + attack + hold);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
  }

  function osc(type, freq, t) {
    var o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    return o;
  }

  function noise(dur) {
    var rate = ctx.sampleRate;
    var n = Math.max(1, Math.floor(rate * dur));
    var buf = ctx.createBuffer(1, n, rate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
    var src = ctx.createBufferSource();
    src.buffer = buf;
    return src;
  }

  function connectOut(node, peak, attack, hold, release) {
    var g = ctx.createGain();
    node.connect(g);
    g.connect(master);
    var t = now();
    env(g, t, peak, attack, hold, release);
    return { gain: g, t: t };
  }

  function tone(opts) {
    if (!ensure() || muted) return;
    var t = now();
    var o = osc(opts.type || "sine", opts.freq || 440, t);
    if (opts.freqEnd) o.frequency.exponentialRampToValueAtTime(Math.max(20, opts.freqEnd), t + (opts.dur || 0.2));
    var g = ctx.createGain();
    if (opts.filter) {
      var f = ctx.createBiquadFilter();
      f.type = opts.filter;
      f.frequency.setValueAtTime(opts.cutoff || 1200, t);
      o.connect(f);
      f.connect(g);
    } else {
      o.connect(g);
    }
    g.connect(master);
    env(g, t, opts.gain || 0.12, opts.attack || 0.01, opts.hold || 0.03, opts.release || 0.12);
    o.start(t);
    o.stop(t + (opts.dur || 0.25) + 0.05);
  }

  function burst(opts) {
    if (!ensure() || muted) return;
    var t = now();
    var src = noise(opts.dur || 0.18);
    var f = ctx.createBiquadFilter();
    f.type = opts.filter || "bandpass";
    f.frequency.setValueAtTime(opts.cutoff || 800, t);
    if (opts.cutoffEnd) f.frequency.exponentialRampToValueAtTime(opts.cutoffEnd, t + (opts.dur || 0.18));
    f.Q.value = opts.q || 1.2;
    var g = ctx.createGain();
    src.connect(f);
    f.connect(g);
    g.connect(master);
    env(g, t, opts.gain || 0.16, 0.004, opts.hold || 0.02, opts.release || 0.12);
    src.start(t);
    src.stop(t + (opts.dur || 0.18) + 0.04);
  }

  function pad(n) {
    var freqs = [261.63, 329.63, 392.0, 523.25];
    var f = freqs[((n % 4) + 4) % 4];
    tone({ type: "triangle", freq: f, freqEnd: f * 1.01, dur: 0.28, gain: 0.11, attack: 0.01, hold: 0.08, release: 0.18 });
    tone({ type: "sine", freq: f * 2, dur: 0.18, gain: 0.04, attack: 0.01, hold: 0.04, release: 0.12 });
  }

  function startAmbient() {
    if (!ensure() || ambientNodes.length) return;
    var t = now();
    ambientGain = ctx.createGain();
    ambientGain.gain.setValueAtTime(0.0001, t);
    ambientGain.gain.linearRampToValueAtTime(muted ? 0 : 0.045, t + 1.2);
    ambientGain.connect(master);

    function drone(freq, type, detune) {
      var o = osc(type, freq, t);
      if (detune) o.detune.setValueAtTime(detune, t);
      o.connect(ambientGain);
      o.start(t);
      ambientNodes.push(o);
    }
    drone(55, "sine", 0);
    drone(82.4, "sine", 6);
    drone(110, "triangle", -4);

    var hiss = noise(4);
    hiss.loop = true;
    var hf = ctx.createBiquadFilter();
    hf.type = "lowpass";
    hf.frequency.value = 420;
    var hg = ctx.createGain();
    hg.gain.value = 0.22;
    hiss.connect(hf);
    hf.connect(hg);
    hg.connect(ambientGain);
    hiss.start(t);
    ambientNodes.push(hiss);
  }

  function setAmbientLevel(level) {
    if (!ambientGain || !ctx) return;
    var t = now();
    ambientGain.gain.cancelScheduledValues(t);
    ambientGain.gain.linearRampToValueAtTime(muted ? 0 : level, t + 0.25);
  }

  function stopHeat() {
    if (!heatNodes) return;
    try {
      heatNodes.osc.stop();
    } catch (e) {
      void e;
    }
    try {
      heatNodes.noise.stop();
    } catch (e2) {
      void e2;
    }
    heatNodes = null;
  }

  function setHeat(on, temp) {
    if (!ensure() || muted) {
      if (!on) stopHeat();
      return;
    }
    if (on && !heatNodes) {
      var t = now();
      var o = osc("sawtooth", 90, t);
      var ng = ctx.createGain();
      ng.gain.value = 0.02;
      var f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = 400;
      o.connect(f);
      f.connect(ng);
      ng.connect(master);
      var src = noise(2);
      src.loop = true;
      var nf = ctx.createBiquadFilter();
      nf.type = "highpass";
      nf.frequency.value = 600;
      var nGain = ctx.createGain();
      nGain.gain.value = 0.03;
      src.connect(nf);
      nf.connect(nGain);
      nGain.connect(master);
      o.start(t);
      src.start(t);
      heatNodes = { osc: o, noise: src, toneGain: ng, noiseGain: nGain, filter: f };
    }
    if (!on) {
      stopHeat();
      return;
    }
    if (heatNodes) {
      var tt = now();
      heatNodes.osc.frequency.setTargetAtTime(70 + temp * 260, tt, 0.08);
      heatNodes.filter.frequency.setTargetAtTime(280 + temp * 1400, tt, 0.08);
      heatNodes.toneGain.gain.setTargetAtTime(0.015 + temp * 0.05, tt, 0.08);
      heatNodes.noiseGain.gain.setTargetAtTime(0.02 + temp * 0.06, tt, 0.08);
    }
  }

  function setMuted(next) {
    muted = !!next;
    if (master && ctx) {
      master.gain.setTargetAtTime(muted ? 0 : 0.85, now(), 0.04);
    }
    if (muted) stopHeat();
    try {
      window.localStorage.setItem("starship-muted", muted ? "1" : "0");
    } catch (e) {
      void e;
    }
    return muted;
  }

  function isMuted() {
    return muted;
  }

  try {
    muted = window.localStorage && window.localStorage.getItem("starship-muted") === "1";
  } catch (e) {
    muted = false;
  }

  function play(name) {
    if (!name) return;
    if (name.indexOf("pad:") === 0) {
      if (!ensure() || muted) return;
      pad(parseInt(name.slice(4), 10) || 0);
      return;
    }
    var table = {
      ui: function () {
        tone({ type: "triangle", freq: 720, freqEnd: 980, dur: 0.09, gain: 0.08 });
      },
      focus: function () {
        tone({ type: "sine", freq: 523, dur: 0.12, gain: 0.07, hold: 0.04, release: 0.1 });
        tone({ type: "sine", freq: 784, dur: 0.16, gain: 0.05, attack: 0.02, hold: 0.04, release: 0.12 });
      },
      enter: function () {
        burst({ cutoff: 400, cutoffEnd: 1800, dur: 0.22, gain: 0.14, filter: "lowpass" });
        tone({ type: "sine", freq: 180, freqEnd: 520, dur: 0.28, gain: 0.1 });
      },
      exit: function () {
        tone({ type: "sine", freq: 420, freqEnd: 160, dur: 0.22, gain: 0.08 });
        burst({ cutoff: 900, cutoffEnd: 200, dur: 0.16, gain: 0.08, filter: "lowpass" });
      },
      step: function () {
        burst({ cutoff: 180, cutoffEnd: 90, dur: 0.07, gain: 0.09, filter: "lowpass", q: 0.7, hold: 0.01, release: 0.05 });
      },
      rotate: function () {
        burst({ cutoff: 2400, dur: 0.05, gain: 0.08, filter: "highpass" });
        tone({ type: "square", freq: 210, freqEnd: 140, dur: 0.07, gain: 0.04, filter: "lowpass", cutoff: 800 });
      },
      water: function () {
        tone({ type: "sine", freq: 660, freqEnd: 880, dur: 0.16, gain: 0.07 });
      },
      launch: function () {
        burst({ cutoff: 300, cutoffEnd: 1600, dur: 0.32, gain: 0.18, filter: "bandpass", q: 0.8 });
        tone({ type: "sawtooth", freq: 90, freqEnd: 240, dur: 0.3, gain: 0.07, filter: "lowpass", cutoff: 600 });
      },
      collect: function () {
        tone({ type: "sine", freq: 880, freqEnd: 1320, dur: 0.14, gain: 0.09 });
        tone({ type: "triangle", freq: 1760, dur: 0.1, gain: 0.03, attack: 0.005, hold: 0.02, release: 0.08 });
      },
      sting: function () {
        burst({ cutoff: 140, dur: 0.16, gain: 0.16, filter: "lowpass" });
        tone({ type: "square", freq: 90, freqEnd: 50, dur: 0.18, gain: 0.06, filter: "lowpass", cutoff: 300 });
      },
      fire: function () {
        burst({ cutoff: 1400, cutoffEnd: 400, dur: 0.1, gain: 0.14, filter: "bandpass", q: 1.6 });
      },
      shatter: function () {
        burst({ cutoff: 900, cutoffEnd: 2200, dur: 0.16, gain: 0.16, filter: "highpass", q: 0.8 });
        tone({ type: "triangle", freq: 620, freqEnd: 180, dur: 0.14, gain: 0.06 });
      },
      hit: function () {
        tone({ type: "triangle", freq: 980, freqEnd: 1320, dur: 0.1, gain: 0.09 });
      },
      miss: function () {
        tone({ type: "sine", freq: 220, freqEnd: 110, dur: 0.16, gain: 0.08 });
      },
      deny: function () {
        tone({ type: "square", freq: 160, freqEnd: 110, dur: 0.1, gain: 0.05, filter: "lowpass", cutoff: 500 });
      },
      lock: function () {
        tone({ type: "sine", freq: 440, freqEnd: 660, dur: 0.14, gain: 0.08 });
      },
      win: function () {
        tone({ type: "triangle", freq: 523, dur: 0.18, gain: 0.1, hold: 0.06, release: 0.12 });
        setTimeout(function () {
          tone({ type: "triangle", freq: 659, dur: 0.18, gain: 0.1, hold: 0.06, release: 0.12 });
        }, 90);
        setTimeout(function () {
          tone({ type: "triangle", freq: 784, dur: 0.22, gain: 0.11, hold: 0.08, release: 0.18 });
        }, 180);
        setTimeout(function () {
          tone({ type: "sine", freq: 1046, dur: 0.32, gain: 0.08, hold: 0.1, release: 0.22 });
        }, 280);
      },
      lose: function () {
        tone({ type: "sawtooth", freq: 220, freqEnd: 90, dur: 0.42, gain: 0.07, filter: "lowpass", cutoff: 700 });
        burst({ cutoff: 180, dur: 0.28, gain: 0.1, filter: "lowpass" });
      },
    };
    if (!ensure() || muted) return;
    if (table[name]) table[name]();
  }

  window.StarshipAudio = {
    unlock: resume,
    play: play,
    startAmbient: startAmbient,
    setAmbientLevel: setAmbientLevel,
    setHeat: setHeat,
    setMuted: setMuted,
    isMuted: isMuted,
    muted: isMuted,
  };
})();
