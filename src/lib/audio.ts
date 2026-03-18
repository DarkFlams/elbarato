"use client";

/**
 * @file audio.ts
 * @description Utilidades de Web Audio API para feedback sonoro sin archivos MP3.
 */

type AudioContextConstructor = typeof AudioContext;

interface WindowWithWebkitAudio extends Window {
  webkitAudioContext?: AudioContextConstructor;
  AudioContext?: AudioContextConstructor;
}

function createAudioContext() {
  const browserWindow = window as WindowWithWebkitAudio;
  const Ctx = browserWindow.AudioContext || browserWindow.webkitAudioContext;

  if (!Ctx) {
    throw new Error("Web Audio API no disponible");
  }

  return new Ctx();
}

export function playSuccessSound() {
  try {
    const audioCtx = createAudioContext();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(800, audioCtx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(
      1200,
      audioCtx.currentTime + 0.1
    );

    gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.1, audioCtx.currentTime + 0.02);
    gainNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.1);

    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 0.1);
  } catch (e) {
    console.error("Audio playback failed", e);
  }
}

export function playErrorSound() {
  try {
    const audioCtx = createAudioContext();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    oscillator.type = "sawtooth";
    oscillator.frequency.setValueAtTime(300, audioCtx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(
      150,
      audioCtx.currentTime + 0.2
    );

    gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.1, audioCtx.currentTime + 0.05);
    gainNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.25);

    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 0.25);
  } catch (e) {
    console.error("Audio playback failed", e);
  }
}

export function playCheckoutSound() {
  try {
    const audioCtx = createAudioContext();
    const osc1 = audioCtx.createOscillator();
    const osc2 = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    osc1.connect(gainNode);
    osc2.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    osc1.type = "sine";
    osc2.type = "triangle";

    osc1.frequency.setValueAtTime(523.25, audioCtx.currentTime);
    osc1.frequency.setValueAtTime(659.25, audioCtx.currentTime + 0.1);
    osc1.frequency.setValueAtTime(783.99, audioCtx.currentTime + 0.2);

    osc2.frequency.setValueAtTime(523.25, audioCtx.currentTime);
    osc2.frequency.setValueAtTime(659.25, audioCtx.currentTime + 0.1);
    osc2.frequency.setValueAtTime(1046.5, audioCtx.currentTime + 0.2);

    gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.1, audioCtx.currentTime + 0.05);
    gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime + 0.25);
    gainNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.4);

    osc1.start();
    osc2.start();
    osc1.stop(audioCtx.currentTime + 0.4);
    osc2.stop(audioCtx.currentTime + 0.4);
  } catch (e) {
    console.error("Audio playback failed", e);
  }
}
