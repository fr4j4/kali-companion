/** Camera-shutter click synthesized with WebAudio: no asset to ship and about 90 ms of audio. */
let context: AudioContext | null = null;

export function playShutter(): void {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    context ??= new Ctor();
    const ctx = context;
    if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
    const now = ctx.currentTime;
    // Two short noise bursts (shutter opening and closing) through a high-pass filter.
    const length = Math.floor(ctx.sampleRate * 0.03);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    for (const [offset, level] of [[0, 0.35], [0.055, 0.25]] as const) {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = "highpass";
      filter.frequency.value = 1800;
      const gain = ctx.createGain();
      gain.gain.value = level;
      source.connect(filter).connect(gain).connect(ctx.destination);
      source.start(now + offset);
    }
  } catch {
    /* No audio device or autoplay policy: the thumbnail still confirms the capture. */
  }
}
