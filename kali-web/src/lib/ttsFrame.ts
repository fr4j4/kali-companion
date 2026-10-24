// Binary TTS PCM frames from the core (kali_core/voice/streaming.py).
//
// Layout, little endian, 16-byte header then s16le mono PCM:
//   u8 kind (1 = TTS PCM chunk), u8 flags (bit0 = final), u16 seq,
//   u32 block_id, u32 segment, u32 sample_rate.

import type { TtsAudioChunkEvent } from "./protocol";

export const FRAME_KIND_TTS_PCM = 1;
export const FRAME_HEADER_SIZE = 16;

export function decodeTtsFrame(buf: ArrayBuffer): TtsAudioChunkEvent | null {
  if (buf.byteLength < FRAME_HEADER_SIZE) return null;
  const view = new DataView(buf);
  if (view.getUint8(0) !== FRAME_KIND_TTS_PCM) return null;
  const sampleRate = view.getUint32(12, true);
  const samples = Math.floor((buf.byteLength - FRAME_HEADER_SIZE) / 2);
  const pcm = new Int16Array(buf, FRAME_HEADER_SIZE, samples);
  return {
    event: "tts_audio_chunk",
    final: (view.getUint8(1) & 1) === 1,
    seq: view.getUint16(2, true),
    block_id: view.getUint32(4, true),
    segment: view.getUint32(8, true),
    sample_rate: sampleRate,
    pcm,
    duration: sampleRate > 0 ? samples / sampleRate : 0,
  };
}
