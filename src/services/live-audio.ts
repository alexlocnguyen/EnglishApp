function encodeBase64(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const encodedParts: string[] = [];
  const chunkSize = 12 * 1024;
  for (let chunkStart = 0; chunkStart < bytes.length; chunkStart += chunkSize) {
    const chunkEnd = Math.min(chunkStart + chunkSize, bytes.length);
    const characters: string[] = [];
    for (let index = chunkStart; index < chunkEnd; index += 3) {
      const first = bytes[index];
      const hasSecond = index + 1 < chunkEnd;
      const hasThird = index + 2 < chunkEnd;
      const second = hasSecond ? bytes[index + 1] : 0;
      const third = hasThird ? bytes[index + 2] : 0;
      characters.push(alphabet[first >> 2], alphabet[((first & 3) << 4) | (second >> 4)],
        hasSecond ? alphabet[((second & 15) << 2) | (third >> 6)] : '=', hasThird ? alphabet[third & 63] : '=');
    }
    encodedParts.push(characters.join(''));
  }
  return encodedParts.join('');
}

/** Combine signed 16-bit PCM chunks into a WAV base64 payload for the voice-turn API. */
export function pcmChunksToWavBase64(chunks: Uint8Array[], sampleRate: number, channels = 1): string {
  const pcmLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const wav = new ArrayBuffer(44 + pcmLength);
  const view = new DataView(wav);
  const writeText = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeText(0, 'RIFF');
  view.setUint32(4, 36 + pcmLength, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  writeText(36, 'data');
  view.setUint32(40, pcmLength, true);

  const bytes = new Uint8Array(wav);
  let offset = 44;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return encodeBase64(bytes);
}
