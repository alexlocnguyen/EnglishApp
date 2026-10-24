import { pcmChunksToWavBase64 } from '../live-audio';

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

describe('PCM WAV encoding', () => {
  test('writes a valid WAV header and preserves PCM bytes across chunks', () => {
    const result = decodeBase64(pcmChunksToWavBase64([
      new Uint8Array([0, 0, 255]),
      new Uint8Array([127, 1]),
    ], 16000));
    const view = new DataView(result.buffer, result.byteOffset, result.byteLength);

    expect(String.fromCharCode(...result.slice(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...result.slice(8, 12))).toBe('WAVE');
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint32(40, true)).toBe(5);
    expect(Array.from(result.slice(44))).toEqual([0, 0, 255, 127, 1]);
  });

  test('base64 output remains valid when audio crosses an encoder chunk boundary', () => {
    const pcm = Uint8Array.from({ length: 12291 }, (_, index) => index % 256);
    const result = decodeBase64(pcmChunksToWavBase64([pcm], 16000));

    expect(result.byteLength).toBe(44 + pcm.byteLength);
    expect(Array.from(result.slice(44))).toEqual(Array.from(pcm));
  });
});
