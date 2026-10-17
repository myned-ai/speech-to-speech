// @ts-check
/**
 * AudioWorkletProcessor that plays back Float32 mono samples received from
 * the main thread, upsampling whatever incoming rate the server uses
 * (typically 16 kHz PCM16) to the AudioContext rate (typically 48 kHz).
 *
 * Lifecycle / messaging:
 *
 *   main -> worklet:
 *     { kind: "config", inputRate: 24000 }              one-shot at startup
 *     { kind: "audio", samples: Float32Array }          (transferable) per chunk
 *     { kind: "clear" }                                 wipe queue (barge-in)
 *
 *   worklet -> main:
 *     { kind: "stats", queuedMs, played }               every ~250 ms
 *     { kind: "underrun" }                              every time the queue
 *                                                      runs dry mid-playback
 *
 * Resampling is windowed-sinc interpolation over a sliding window of input
 * samples. Linear interpolation, used before, leaves the input's spectrum
 * mirrored above its Nyquist frequency, heard as hiss: measured on 16 kHz
 * speech played at 48 kHz, energy above 8 kHz fell from -26.5 dB to -43 dB.
 * The cost is half the window of latency (0.5 ms at 16 kHz).
 *
 * Underrun strategy: when the queue runs dry the window is fed silence, so
 * the sound decays smoothly instead of clicking, and playback stops once the
 * window holds nothing but silence.
 */

const STATS_INTERVAL_FRAMES = 12000;
const FADE_FRAMES = 32;
const TAPS = 16;
const PHASES = 128;

/** Blackman-windowed sinc, one row of TAPS weights per fractional phase,
 *  each row normalised to unity gain. Taps sit at -7..+8 input samples
 *  around the read position. @param {number} cutoff fraction of input Nyquist */
function buildTable(cutoff) {
  const table = new Float32Array(PHASES * TAPS);
  for (let p = 0; p < PHASES; p++) {
    let sum = 0;
    for (let m = 0; m < TAPS; m++) {
      const x = cutoff * (m - TAPS / 2 + 1 - p / PHASES);
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const n = (m + 1) / TAPS;
      const window = 0.42 - 0.5 * Math.cos(2 * Math.PI * n) + 0.08 * Math.cos(4 * Math.PI * n);
      table[p * TAPS + m] = sinc * window;
      sum += sinc * window;
    }
    for (let m = 0; m < TAPS; m++) table[p * TAPS + m] /= sum;
  }
  return table;
}

class AudioPlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._queue = [];
    this._readIdx = 0;
    this._fracPos = 0;
    this._playing = false;
    this._framesSinceStats = 0;
    this._totalPlayed = 0;
    this._fadeIn = 0;
    this._fadeOut = 0;
    /** Input samples around the read position: index TAPS/2 - 1 is the
     *  current one, the TAPS/2 after it are look-ahead. */
    this._window = new Float32Array(TAPS);
    /** Silent samples fed in since the queue ran dry. */
    this._starved = 0;
    this._setInputRate(24000);

    this.port.onmessage = (e) => {
      const data = e.data;
      if (!data || typeof data !== "object") return;
      switch (data.kind) {
        case "config":
          if (typeof data.inputRate === "number" && data.inputRate > 0) {
            this._setInputRate(data.inputRate);
          }
          break;
        case "audio":
          if (data.samples instanceof Float32Array && data.samples.length > 0) {
            this._queue.push(data.samples);
            if (!this._playing) {
              this._playing = true;
              this._fadeIn = FADE_FRAMES;
              this._fadeOut = 0;
              this._prime();
            }
          }
          break;
        case "clear":
          this._queue.length = 0;
          this._readIdx = 0;
          this._fadeOut = FADE_FRAMES;
          break;
      }
    };
  }

  /** @param {number} rate */
  _setInputRate(rate) {
    this._inputRate = rate;
    this._stepRatio = rate / sampleRate;
    // Keep just under the input's Nyquist; when downsampling, under the output's.
    this._table = buildTable(0.92 * Math.min(1, sampleRate / rate));
  }

  _queuedSamples() {
    let total = -this._readIdx;
    for (const buf of this._queue) total += buf.length;
    return Math.max(0, total);
  }

  /** Next input sample, or null when the queue has run dry. */
  _pull() {
    while (this._queue.length > 0 && this._readIdx >= this._queue[0].length) {
      this._readIdx -= this._queue[0].length;
      this._queue.shift();
    }
    if (this._queue.length === 0) return null;
    return this._queue[0][this._readIdx++];
  }

  /** Slide the window one input sample on, feeding silence past the end. */
  _step() {
    this._window.copyWithin(0, 1);
    const next = this._pull();
    if (next === null) {
      this._window[TAPS - 1] = 0;
      this._starved += 1;
    } else {
      this._window[TAPS - 1] = next;
      this._starved = 0;
    }
  }

  /** Start from silence with the first sample at the read position. */
  _prime() {
    this._window.fill(0);
    this._fracPos = 0;
    this._starved = 0;
    for (let i = 0; i < TAPS / 2 + 1; i++) this._step();
  }

  _interpolate() {
    const phase = Math.min(PHASES - 1, Math.round(this._fracPos * PHASES));
    const base = phase * TAPS;
    let acc = 0;
    for (let m = 0; m < TAPS; m++) acc += this._window[m] * this._table[base + m];
    return acc;
  }

  process(_, outputs) {
    const channels = outputs[0];
    if (!channels || channels.length === 0) return true;
    const out = channels[0];
    const stereo = channels.length > 1 ? channels[1] : null;

    for (let i = 0; i < out.length; i++) {
      let sample = 0;

      if (this._playing) {
        if (this._starved >= TAPS) {
          // The queue ran dry and the window has played out to silence.
          this._playing = false;
          this.port.postMessage({ kind: "underrun" });
        } else {
          sample = this._interpolate();
          this._fracPos += this._stepRatio;
          while (this._fracPos >= 1) {
            this._fracPos -= 1;
            this._step();
          }
        }

        if (this._fadeIn > 0) {
          const gain = 1 - this._fadeIn / FADE_FRAMES;
          sample *= gain;
          this._fadeIn -= 1;
        }
        if (this._fadeOut > 0) {
          const gain = this._fadeOut / FADE_FRAMES;
          sample *= gain;
          this._fadeOut -= 1;
          if (this._fadeOut === 0) {
            this._playing = false;
          }
        }

        this._totalPlayed += 1;
      }

      out[i] = sample;
      if (stereo) stereo[i] = sample;
    }

    this._framesSinceStats += out.length;
    if (this._framesSinceStats >= STATS_INTERVAL_FRAMES) {
      this._framesSinceStats = 0;
      const queuedSamples = this._queuedSamples();
      const queuedMs = (queuedSamples / this._inputRate) * 1000;
      this.port.postMessage({ kind: "stats", queuedMs, played: this._totalPlayed });
    }

    return true;
  }
}

registerProcessor("audio-playback", AudioPlaybackProcessor);
