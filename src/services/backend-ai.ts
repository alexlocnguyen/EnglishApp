import Constants from 'expo-constants';
import { Platform } from 'react-native';

export type BackendAnalyzeResult = {
  filename: string;
  target_sentence: string;
  transcribed_text: string;
  score: number;
  feedback: string;
  words_analysis: { word: string; status: string; suggestion?: string }[];
};

export type LiveVoiceTurn = {
  transcript: string;
  translation: string;
  reply: string;
  suggestions: string[];
  feedback: string;
  pronunciationFeedback?: string;
  hasAudio?: boolean;
};

export type TopicVocabulary = {
  level: string;
  verbs: { word: string; definition: string; example: string; sourceUrl?: string }[];
  phrase: { phrase: string; definition: string; example: string; sourceUrl?: string };
};

const configuredApiBaseUrl = process.env.EXPO_PUBLIC_API_URL?.trim().replace(/\/$/, '');

function getConfiguredApiHost(): string {
  if (!configuredApiBaseUrl) return '';
  try {
    return new URL(configuredApiBaseUrl).hostname;
  } catch {
    return '';
  }
}

function getExpoLanApiBaseUrl(): string | null {
  if (Platform.OS === 'web' || !__DEV__) return null;

  const configuredHost = getConfiguredApiHost();
  const isLoopback = !configuredHost || configuredHost === 'localhost' || configuredHost === '127.0.0.1' || configuredHost === '[::1]';
  if (!isLoopback) return null;

  const hostUri = Constants.expoConfig?.hostUri;
  if (!hostUri) return null;

  try {
    const host = new URL(`http://${hostUri}`).hostname;
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('127.')) return null;
    return `http://${host}:8000`;
  } catch {
    return null;
  }
}

const API_BASE_URL = getExpoLanApiBaseUrl() ?? configuredApiBaseUrl;
const ANALYZE_PATH = process.env.EXPO_PUBLIC_AI_ANALYZE_PATH?.trim() || '/api/analyze';
const SPEECH_PATH = process.env.EXPO_PUBLIC_AI_SPEECH_PATH?.trim() || '/api/speech';
const TRANSLATE_PATH = process.env.EXPO_PUBLIC_AI_TRANSLATE_PATH?.trim() || '/api/translate';
const VOICE_TURN_PATH = process.env.EXPO_PUBLIC_AI_VOICE_TURN_PATH?.trim() || '/api/voice-turn';
const CHAT_TURN_PATH = process.env.EXPO_PUBLIC_AI_CHAT_TURN_PATH?.trim() || '/api/chat-turn';

function apiUrl(path: string): string {
  if (Platform.OS !== 'web' && configuredApiBaseUrl) {
    const host = getConfiguredApiHost();
    if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') {
      if (!getExpoLanApiBaseUrl()) {
        throw new Error('Điện thoại không thể kết nối backend qua localhost. Hãy mở Expo trên mạng Wi-Fi và chạy backend trên máy tính với host 0.0.0.0.');
      }
    }
  }
  if (!API_BASE_URL) throw new Error('Chưa cấu hình EXPO_PUBLIC_API_URL để kết nối backend AI.');
  return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

export async function analyzeSpeakingAudio(uri: string, targetSentence: string): Promise<BackendAnalyzeResult> {
  const form = new FormData();
  form.append('target_sentence', targetSentence);
  if (typeof window !== 'undefined' && uri.startsWith('blob:')) {
    const audio = await fetch(uri).then((response) => response.blob());
    const mimeType = audio.type || 'audio/webm';
    const extension = mimeType.includes('mp4') ? 'm4a' : mimeType.includes('ogg') ? 'ogg' : 'webm';
    form.append('file', audio, `speaking.${extension}`);
  } else {
    form.append('file', { uri, name: 'speaking.m4a', type: 'audio/mp4' } as unknown as Blob);
  }

  let response: Response;
  try {
    response = await fetch(apiUrl(ANALYZE_PATH), { method: 'POST', headers: { Accept: 'application/json' }, body: form });
  } catch {
    throw new Error('Không thể kết nối backend. Hãy kiểm tra backend đang chạy và địa chỉ API.');
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = typeof payload === 'object' && payload !== null && 'detail' in payload && typeof payload.detail === 'string'
      ? payload.detail
      : `Backend phân tích audio bị lỗi (${response.status}).`;
    throw new Error(detail);
  }
  if (typeof payload !== 'object' || payload === null || !('transcribed_text' in payload)) {
    throw new Error('Backend trả về kết quả phân tích không đúng định dạng.');
  }
  return payload as BackendAnalyzeResult;
}

function parseVoiceTurn(payload: unknown): LiveVoiceTurn {
  if (typeof payload !== 'object' || payload === null || !('transcript' in payload)) {
    throw new Error('Backend trả về lượt nói không đúng định dạng.');
  }
  const data = payload as Record<string, unknown>;
  return {
    transcript: typeof data.transcript === 'string' ? data.transcript : '',
    translation: typeof data.translation === 'string' ? data.translation : '',
    reply: typeof data.reply === 'string' ? data.reply : '',
    suggestions: Array.isArray(data.suggestions) ? data.suggestions.filter((item): item is string => typeof item === 'string') : [],
    feedback: typeof data.feedback === 'string' ? data.feedback : '',
    pronunciationFeedback: typeof data.pronunciation_feedback === 'string' ? data.pronunciation_feedback : '',
  };
}

export async function processLiveVoiceTurn(audioBase64: string, topic: string, mimeType = 'audio/wav'): Promise<LiveVoiceTurn> {
  let response: Response;
  try {
    response = await fetch(apiUrl(VOICE_TURN_PATH), {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio_base64: audioBase64, mime_type: mimeType.split(';')[0], topic }),
    });
  } catch {
    throw new Error('Không thể gửi câu vừa nói tới backend. Kiểm tra backend và mạng Wi-Fi.');
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = typeof payload === 'object' && payload !== null && 'detail' in payload && typeof payload.detail === 'string'
      ? payload.detail
      : `Backend xử lý lượt nói bị lỗi (${response.status}).`;
    throw new Error(detail);
  }
  return { ...parseVoiceTurn(payload), hasAudio: true };
}

export async function processTextVoiceTurn(message: string, topic: string): Promise<LiveVoiceTurn> {
  let response: Response;
  try {
    response = await fetch(apiUrl(CHAT_TURN_PATH), {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, topic }),
    });
  } catch {
    throw new Error('Không thể kết nối backend. Hãy kiểm tra mạng và địa chỉ API.');
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = typeof payload === 'object' && payload !== null && 'detail' in payload && typeof payload.detail === 'string'
      ? payload.detail
      : `Backend xử lý tin nhắn bị lỗi (${response.status}).`;
    throw new Error(detail);
  }
  return { ...parseVoiceTurn(payload), hasAudio: false };
}

export async function processWebAudioTurn(uri: string, topic: string): Promise<LiveVoiceTurn> {
  const blob = await fetch(uri).then((response) => response.blob());
  const mimeType = blob.type || 'audio/webm';
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Không đọc được bản ghi âm.'));
    reader.onerror = () => reject(new Error('Không đọc được bản ghi âm.'));
    reader.readAsDataURL(blob);
  });
  return processLiveVoiceTurn(dataUrl, topic, mimeType);
}

export function getAiSpeechUrl(text: string): string {
  return `${apiUrl(SPEECH_PATH)}?text=${encodeURIComponent(text.slice(0, 200))}`;
}

export async function translateAiSpeech(text: string, signal?: AbortSignal): Promise<string> {
  let response: Response;
  try {
    response = await fetch(apiUrl(TRANSLATE_PATH), {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new Error('Không thể kết nối backend để dịch câu AI.');
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = typeof payload === 'object' && payload !== null && 'detail' in payload && typeof payload.detail === 'string'
      ? payload.detail
      : `Backend dịch trả về lỗi (${response.status}).`;
    throw new Error(detail);
  }
  if (typeof payload !== 'object' || payload === null || !('translation' in payload) || typeof payload.translation !== 'string') {
    throw new Error('Backend trả về bản dịch không đúng định dạng.');
  }
  return payload.translation;
}

export async function getTopicVocabulary(topic: string, transcript: string): Promise<TopicVocabulary> {
  let response: Response;
  try {
    response = await fetch(apiUrl('/api/ai/topic-vocabulary'), {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, transcript }),
    });
  } catch {
    throw new Error('Không thể kết nối backend để lấy từ vựng.');
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = typeof payload === 'object' && payload !== null && 'detail' in payload && typeof payload.detail === 'string'
      ? payload.detail
      : `Backend lấy từ vựng bị lỗi (${response.status}).`;
    throw new Error(detail);
  }
  if (typeof payload !== 'object' || payload === null || !('verbs' in payload) || !('phrase' in payload)) {
    throw new Error('Backend trả về từ vựng không đúng định dạng.');
  }
  return payload as TopicVocabulary;
}
