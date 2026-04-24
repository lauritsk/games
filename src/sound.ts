export type SoundCue =
  | "dashboardMove"
  | "dashboardSelect"
  | "gameMove"
  | "gameGood"
  | "gameBad"
  | "gameMajor"
  | "gameWin"
  | "gameLose"
  | "uiToggle"
  | "uiReset";

type Wave = OscillatorType;
type Note = { frequency: number; start: number; duration: number; gain: number; wave?: Wave };

let context: AudioContext | null = null;
let master: GainNode | null = null;
let unlocked = false;
let lastCueAt = 0;

const cueNotes: Record<SoundCue, Note[]> = {
  dashboardMove: [
    { frequency: 880, start: 0, duration: 0.035, gain: 0.08, wave: "square" },
    { frequency: 1320, start: 0.035, duration: 0.045, gain: 0.07, wave: "square" },
  ],
  dashboardSelect: [
    { frequency: 523.25, start: 0, duration: 0.06, gain: 0.1, wave: "square" },
    { frequency: 783.99, start: 0.055, duration: 0.07, gain: 0.1, wave: "square" },
    { frequency: 1046.5, start: 0.12, duration: 0.1, gain: 0.09, wave: "square" },
  ],
  gameMove: [{ frequency: 420, start: 0, duration: 0.04, gain: 0.035, wave: "triangle" }],
  gameGood: [
    { frequency: 659.25, start: 0, duration: 0.055, gain: 0.065, wave: "square" },
    { frequency: 987.77, start: 0.055, duration: 0.08, gain: 0.06, wave: "square" },
  ],
  gameBad: [
    { frequency: 196, start: 0, duration: 0.09, gain: 0.06, wave: "sawtooth" },
    { frequency: 146.83, start: 0.08, duration: 0.12, gain: 0.055, wave: "sawtooth" },
  ],
  gameMajor: [
    { frequency: 392, start: 0, duration: 0.08, gain: 0.09, wave: "square" },
    { frequency: 523.25, start: 0.075, duration: 0.08, gain: 0.09, wave: "square" },
    { frequency: 783.99, start: 0.15, duration: 0.12, gain: 0.085, wave: "square" },
  ],
  gameWin: [
    { frequency: 523.25, start: 0, duration: 0.08, gain: 0.09, wave: "square" },
    { frequency: 659.25, start: 0.08, duration: 0.08, gain: 0.09, wave: "square" },
    { frequency: 783.99, start: 0.16, duration: 0.08, gain: 0.09, wave: "square" },
    { frequency: 1046.5, start: 0.24, duration: 0.16, gain: 0.1, wave: "square" },
  ],
  gameLose: [
    { frequency: 220, start: 0, duration: 0.1, gain: 0.09, wave: "sawtooth" },
    { frequency: 185, start: 0.09, duration: 0.12, gain: 0.08, wave: "sawtooth" },
    { frequency: 146.83, start: 0.2, duration: 0.2, gain: 0.075, wave: "sawtooth" },
  ],
  uiToggle: [
    { frequency: 622.25, start: 0, duration: 0.045, gain: 0.055, wave: "square" },
    { frequency: 466.16, start: 0.045, duration: 0.045, gain: 0.05, wave: "square" },
  ],
  uiReset: [
    { frequency: 330, start: 0, duration: 0.05, gain: 0.065, wave: "triangle" },
    { frequency: 247, start: 0.055, duration: 0.07, gain: 0.055, wave: "triangle" },
  ],
};

export function playSound(cue: SoundCue): void {
  const audio = audioContext();
  if (!audio) return;
  if (audio.state === "suspended") {
    void audio
      .resume()
      .then(() => {
        unlocked = audio.state === "running";
        playCue(audio, cue);
      })
      .catch(() => undefined);
    return;
  }
  unlocked = audio.state === "running";
  playCue(audio, cue);
}

export function unlockSound(): void {
  const audio = audioContext();
  if (!audio || unlocked) return;
  void audio
    .resume()
    .then(() => {
      unlocked = audio.state === "running";
    })
    .catch(() => undefined);
}

function playCue(audio: AudioContext, cue: SoundCue): void {
  if (audio.state !== "running") return;

  const nowMs = performance.now();
  if (cue === "gameMove" && nowMs - lastCueAt < 35) return;
  lastCueAt = nowMs;

  const start = audio.currentTime + 0.004;
  for (const note of cueNotes[cue]) playNote(audio, note, start);
}

function audioContext(): AudioContext | null {
  if (context) return context;
  const Audio = window.AudioContext ?? window.webkitAudioContext;
  if (!Audio) return null;
  context = new Audio();
  master = context.createGain();
  master.gain.value = 0.7;
  master.connect(context.destination);
  return context;
}

function playNote(audio: AudioContext, note: Note, baseStart: number): void {
  if (!master) return;
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  const start = baseStart + note.start;
  const end = start + note.duration;

  oscillator.type = note.wave ?? "square";
  oscillator.frequency.setValueAtTime(note.frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(note.gain, start + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);

  oscillator.connect(gain);
  gain.connect(master);
  oscillator.start(start);
  oscillator.stop(end + 0.01);
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
