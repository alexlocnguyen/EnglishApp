import { StatusBar } from 'expo-status-bar';
import { router, useLocalSearchParams } from 'expo-router';
import { AudioModule, setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus, useAudioStream, type AudioStreamBuffer } from 'expo-audio';
import * as Speech from 'expo-speech';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Eye, EyeOff, Languages, Mic, MicOff, Pause, PhoneOff, Play, Send, Sparkles, Volume2 } from 'lucide';
import { MorphIcon } from 'morphicons/react-native';
import {
  Linking,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getAiSpeechUrl, processLiveVoiceTurn, processTextVoiceTurn, processWebAudioTurn, translateAiSpeech, type LiveVoiceTurn } from '../services/backend-ai';
import { pcmChunksToWavBase64 } from '../services/live-audio';
import { savePracticeSession } from '../services/practice-history';

const COLORS = {
  background: '#142052',
  purple: '#8ABF26',
  purpleDark: '#719D1F',
  white: '#FFFFFF',
  text: '#17234E',
  muted: '#D9DEEC',
  red: '#D94D5D',
};

type LiveTurnItem = LiveVoiceTurn & { id: string; status: 'done' | 'error'; displayText?: string; error?: string };

function createPracticeSessionId(): string {
  return `practice-${Date.now()}`;
}

export default function SpeakingScreen() {
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const patternColumns = Math.max(8, Math.ceil(Math.min(viewportWidth, 650) / 34));
  const patternRows = Math.ceil(viewportHeight / 34);
  const params = useLocalSearchParams<{ topic?: string; prompt?: string; lessonId?: string }>();
  const topic = Array.isArray(params.topic) ? params.topic[0] : params.topic;
  const prompt = Array.isArray(params.prompt) ? params.prompt[0] : params.prompt;
  const preRollChunks = useRef<Uint8Array[]>([]);
  const utteranceChunks = useRef<Uint8Array[]>([]);
  const utteranceActive = useRef(false);
  const utteranceSilenceMs = useRef(0);
  const utteranceSpeechMs = useRef(0);
  const utteranceSampleRate = useRef(16000);
  const utteranceChannels = useRef(1);
  const turnId = useRef(0);
  const audioSegments = useRef<Record<string, string>>({});
  const turnsRef = useRef<LiveTurnItem[]>([]);
  const processingQueue = useRef<Promise<void>>(Promise.resolve());
  const submitSegment = useRef<(chunks: Uint8Array[], sampleRate: number, channels: number) => void>(() => undefined);
  const playSuggestedSentenceRef = useRef<(text: string) => Promise<void>>(async () => undefined);
  const webRecorder = useRef<MediaRecorder | null>(null);
  const webStream = useRef<MediaStream | null>(null);
  const webChunks = useRef<Blob[]>([]);
  const webAudioUri = useRef<string | null>(null);
  const mounted = useRef(true);
  const micStartInProgress = useRef(false);
  const [listening, setListening] = useState(false);
  const [micStarting, setMicStarting] = useState(false);
  const [micPermissionDenied, setMicPermissionDenied] = useState(false);
  const [liveTurns, setLiveTurns] = useState<LiveTurnItem[]>([]);
  const [speechError, setSpeechError] = useState('');
  const [speechAudioUri, setSpeechAudioUri] = useState<string | null>(null);
  const [systemSpeaking, setSystemSpeaking] = useState(false);
  const pendingSpeechFallback = useRef<string | null>(null);
  const webSpeechObjectUrl = useRef<string | null>(null);
  const speechPlayer = useAudioPlayer(null);
  const speechStatus = useAudioPlayerStatus(speechPlayer);
  const [finishing, setFinishing] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [translationOn, setTranslationOn] = useState(true);
  const [tipsVisible, setTipsVisible] = useState(true);
  const [translation, setTranslation] = useState('');
  const [translationLoading, setTranslationLoading] = useState(false);
  const [translationError, setTranslationError] = useState('');
  const [endConfirmationVisible, setEndConfirmationVisible] = useState(false);
  const [messageDraft, setMessageDraft] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);

  const handleAudioBuffer = useCallback((buffer: AudioStreamBuffer) => {
    if (Platform.OS === 'web') return;
    const bytes = new Uint8Array(buffer.data.slice(0));
    const sampleCount = bytes.byteLength / 2;
    if (sampleCount === 0) return;
    const pcmView = new DataView(buffer.data);
    let sumSquares = 0;
    for (let offset = 0; offset < buffer.data.byteLength; offset += 2) {
      const sample = pcmView.getInt16(offset, true) / 32768;
      sumSquares += sample * sample;
    }
    const rms = Math.sqrt(sumSquares / sampleCount);
    const durationMs = sampleCount / (buffer.sampleRate * buffer.channels) * 1000;
    const hasSpeech = rms > 0.014;
    utteranceSampleRate.current = buffer.sampleRate;
    utteranceChannels.current = buffer.channels;

    if (!utteranceActive.current) {
      if (hasSpeech) {
        utteranceActive.current = true;
        utteranceChunks.current = [...preRollChunks.current, bytes];
        utteranceSpeechMs.current = durationMs;
        utteranceSilenceMs.current = 0;
        preRollChunks.current = [];
      } else {
        preRollChunks.current.push(bytes);
        if (preRollChunks.current.length > 8) preRollChunks.current.shift();
      }
      return;
    }

    utteranceChunks.current.push(bytes);
    if (hasSpeech) {
      utteranceSpeechMs.current += durationMs;
      utteranceSilenceMs.current = 0;
    } else {
      utteranceSilenceMs.current += durationMs;
    }

    if (utteranceSilenceMs.current >= 850 || utteranceSpeechMs.current >= 20000) {
      const chunks = utteranceChunks.current;
      const speechMs = utteranceSpeechMs.current;
      const sampleRate = utteranceSampleRate.current;
      const channels = utteranceChannels.current;
      utteranceChunks.current = [];
      utteranceActive.current = false;
      utteranceSilenceMs.current = 0;
      utteranceSpeechMs.current = 0;
      if (speechMs >= 350) submitSegment.current(chunks, sampleRate, channels);
    }
  }, []);
  const { stream: liveAudioStream } = useAudioStream({
    sampleRate: 16000,
    channels: 1,
    encoding: 'int16',
    onBuffer: handleAudioBuffer,
  });

  useEffect(() => {
    const timer = setInterval(() => setElapsedSeconds((elapsed) => elapsed + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const startWebRecording = useCallback(async () => {
    if (typeof window === 'undefined' || !window.isSecureContext) {
      throw new Error('Trình duyệt chỉ cho phép ghi âm trên HTTPS hoặc localhost.');
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      throw new Error('Trình duyệt này chưa hỗ trợ ghi âm. Hãy thử Chrome hoặc Edge mới nhất.');
    }
    const existingRecorder = webRecorder.current;
    if (existingRecorder?.state === 'paused') {
      existingRecorder.resume();
      setListening(true);
      setSpeechError('Đang ghi âm… hãy nói tiếng Anh theo chủ đề nhé.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (!mounted.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      webStream.current = stream;
      webChunks.current = [];
      webAudioUri.current = null;
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : undefined;
      const mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) webChunks.current.push(event.data);
      });
      mediaRecorder.addEventListener('stop', () => {
        const audio = new Blob(webChunks.current, { type: mediaRecorder.mimeType || 'audio/webm' });
        if (audio.size > 0) webAudioUri.current = URL.createObjectURL(audio);
        webStream.current?.getTracks().forEach((track) => track.stop());
        webStream.current = null;
      });
      webRecorder.current = mediaRecorder;
      mediaRecorder.start(1000);
      setListening(true);
      setSpeechError('Đang ghi âm… hãy nói tiếng Anh theo chủ đề nhé.');
    } catch (error: unknown) {
      if (!mounted.current) return;
      const name = typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : '';
      setListening(false);
      setSpeechError(name === 'NotAllowedError' || name === 'SecurityError'
        ? 'Trình duyệt chưa cấp quyền Microphone. Hãy cấp quyền cho trang rồi nhấn Mic để thử lại.'
        : name === 'NotFoundError'
          ? 'Không tìm thấy microphone trên máy tính.'
          : name === 'NotReadableError'
            ? 'Microphone đang được ứng dụng khác sử dụng. Hãy đóng ứng dụng đó rồi thử lại.'
            : error instanceof Error ? error.message : 'Không thể mở microphone trên trình duyệt.');
    }
  }, []);

  function finishWebRecording(): Promise<string | null> {
    const mediaRecorder = webRecorder.current;
    if (!mediaRecorder || mediaRecorder.state === 'inactive') return Promise.resolve(webAudioUri.current);
    return new Promise((resolve) => {
      mediaRecorder.addEventListener('stop', () => resolve(webAudioUri.current), { once: true });
      mediaRecorder.stop();
    });
  }

  async function submitWebRecording() {
    const uri = await finishWebRecording();
    setListening(false);
    if (!uri) {
      setSpeechError('Chưa có bản ghi âm. Nhấn mic rồi nói một câu tiếng Anh nhé.');
      return;
    }
    setSpeechError('Đang nghe và trả lời…');
    try {
      const result = await processWebAudioTurn(uri, topic ?? 'Luyện nói tự do');
      if (!result.transcript) {
        setSpeechError('AI chưa nghe rõ câu vừa rồi. Hãy thử nói chậm hơn nhé.');
        return;
      }
      const item: LiveTurnItem = { id: String(++turnId.current), ...result, displayText: result.transcript, status: 'done' };
      turnsRef.current = [...turnsRef.current, item];
      setLiveTurns(turnsRef.current);
      setSpeechError('AI đã phản hồi. Bạn có thể tiếp tục trò chuyện.');
      if (result.reply) void playSuggestedSentence(result.reply);
    } catch (error) {
      setSpeechError(error instanceof Error ? error.message : 'AI chưa xử lý được câu vừa nói.');
    } finally {
      URL.revokeObjectURL(uri);
      webAudioUri.current = null;
    }
  }

  async function sendTextMessage(text = messageDraft) {
    const message = text.trim();
    if (!message || sendingMessage) return;
    setSendingMessage(true);
    setMessageDraft('');
    setSpeechError('AI đang soạn câu trả lời…');
    try {
      const result = await processTextVoiceTurn(message, topic ?? 'Luyện nói tự do');
      const item: LiveTurnItem = { id: String(++turnId.current), ...result, displayText: message, status: 'done' };
      turnsRef.current = [...turnsRef.current, item];
      setLiveTurns(turnsRef.current);
      setSpeechError('AI đã phản hồi. Hãy thử trả lời bằng tiếng Anh nhé.');
      if (result.reply) void playSuggestedSentence(result.reply);
    } catch (error) {
      setMessageDraft(message);
      setSpeechError(error instanceof Error ? error.message : 'AI chưa xử lý được tin nhắn này.');
    } finally {
      setSendingMessage(false);
    }
  }

  const processVoiceSegment = useCallback((chunks: Uint8Array[], sampleRate: number, channels: number) => {
    if (Platform.OS === 'web' || chunks.length === 0) return;
    const id = String(++turnId.current);
    processingQueue.current = processingQueue.current
      .then(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))
      .then(async () => {
        if (!mounted.current) return;
        try {
          const audioBase64 = pcmChunksToWavBase64(chunks, sampleRate, channels);
          audioSegments.current[id] = audioBase64;
          const result = await processLiveVoiceTurn(audioBase64, topic ?? 'Luyện nói tự do');
          if (!mounted.current) return;
          if (!result.transcript) return;
          turnsRef.current = [...turnsRef.current, { id, ...result, status: 'done' }];
          setLiveTurns(turnsRef.current);
          if (result.reply) void playSuggestedSentenceRef.current(result.reply);
        } catch (error) {
          if (!mounted.current) return;
          turnsRef.current = [...turnsRef.current, { id, status: 'error', transcript: '', translation: '', reply: '', suggestions: [], feedback: '', error: error instanceof Error ? error.message : 'AI chưa xử lý được câu này.' }];
          setLiveTurns(turnsRef.current);
        }
      });
  }, [topic]);
  useEffect(() => {
    submitSegment.current = processVoiceSegment;
  }, [processVoiceSegment]);

  function flushCurrentUtterance() {
    if (!utteranceActive.current) return;
    const chunks = utteranceChunks.current;
    const speechMs = utteranceSpeechMs.current;
    const sampleRate = utteranceSampleRate.current;
    const channels = utteranceChannels.current;
    utteranceChunks.current = [];
    utteranceActive.current = false;
    utteranceSilenceMs.current = 0;
    utteranceSpeechMs.current = 0;
    preRollChunks.current = [];
    if (speechMs >= 350) submitSegment.current(chunks, sampleRate, channels);
  }

  const timerMinutes = Math.floor(elapsedSeconds / 60);
  const timerSeconds = elapsedSeconds % 60;
  const timerLabel = `${timerMinutes}:${String(timerSeconds).padStart(2, '0')}`;

  const conversationContext = `${topic ?? ''} ${prompt ?? ''}`.toLowerCase();
  const phrase = /interview|position|phỏng vấn/.test(conversationContext)
    ? 'Hi! Please have a seat. Can I get you a coffee or water?'
    : /introduce yourself|giới thiệu bản thân/.test(conversationContext)
      ? "Hi! It's nice to meet you. Could you tell me a little about yourself?"
      : /daily routine|thói quen/.test(conversationContext)
        ? 'What does a typical day look like for you?'
        : /coworker|colleague|đồng nghiệp/.test(conversationContext)
          ? "Good morning! How's your week going so far?"
          : /update|tiến độ/.test(conversationContext)
            ? 'Could you give me a quick update on your project?'
            : /help|giúp đỡ/.test(conversationContext)
              ? 'Could you give me a hand with this task?'
              : /repeat|nhắc lại/.test(conversationContext)
                ? 'Sorry, could you say that again a little more slowly?'
                : /meeting|cuộc họp/.test(conversationContext)
                  ? 'Would you be available to schedule a meeting this week?'
                  : /job|work|công việc/.test(conversationContext)
                    ? 'How has work been going? What are you working on this week?'
                    : 'Hello! What would you like to talk about today?';

  useEffect(() => {
    if (!translationOn) return;
    const controller = new AbortController();
    setTranslation('');
    setTranslationError('');
    setTranslationLoading(true);
    void translateAiSpeech(phrase, controller.signal)
      .then((translated) => setTranslation(translated))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setTranslationError(error instanceof Error ? error.message : 'Chưa dịch được câu AI.');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setTranslationLoading(false);
      });
    return () => controller.abort();
  }, [phrase, translationOn]);

  const startListening = useCallback(async () => {
    const alreadyRecording = Platform.OS === 'web'
      ? webRecorder.current?.state === 'recording'
      : Boolean(liveAudioStream?.isStreaming);
    if (micStartInProgress.current || alreadyRecording || !mounted.current) return;
    micStartInProgress.current = true;
    setMicStarting(true);
    setSpeechError('Đang bật microphone…');
    try {
      if (Platform.OS === 'web') {
        await startWebRecording();
        return;
      }

      if (!liveAudioStream) {
        throw new Error('Thiết bị này chưa hỗ trợ thu âm trực tiếp.');
      }
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!mounted.current) return;
      if (!permission.granted) {
        setMicPermissionDenied(true);
        setSpeechError('Bạn cần cấp quyền Microphone để bắt đầu luyện nói.');
        return;
      }
      setMicPermissionDenied(false);
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      if (!mounted.current) return;
      await liveAudioStream.start();
      setListening(true);
      setSpeechError('AI sẽ tự nhận câu khi bạn ngừng nói trong giây lát.');
    } catch (error) {
      setListening(false);
      setSpeechError(error instanceof Error ? error.message : 'Không thể bắt đầu ghi âm. Hãy kiểm tra quyền truy cập micro.');
    } finally {
      micStartInProgress.current = false;
      if (mounted.current) setMicStarting(false);
    }
  }, [liveAudioStream, startWebRecording]);

  async function toggleListening() {
    if (micStartInProgress.current) return;
    if (Platform.OS === 'web') {
      const activeRecorder = webRecorder.current;
      if (activeRecorder?.state === 'recording') {
        await submitWebRecording();
      } else {
        await startListening();
      }
      return;
    }

    if (liveAudioStream?.isStreaming) {
      liveAudioStream.stop();
      flushCurrentUtterance();
      setListening(false);
      setSpeechError('Đã tạm dừng. Nhấn mic để tiếp tục.');
    } else {
      await startListening();
    }
  }

  useEffect(() => {
    mounted.current = true;
    void startListening();
    return () => {
      mounted.current = false;
      const activeRecorder = webRecorder.current;
      if (activeRecorder && activeRecorder.state !== 'inactive') activeRecorder.stop();
      webStream.current?.getTracks().forEach((track) => track.stop());
      webStream.current = null;
      if (liveAudioStream?.isStreaming) liveAudioStream.stop();
      if (webSpeechObjectUrl.current) URL.revokeObjectURL(webSpeechObjectUrl.current);
      webSpeechObjectUrl.current = null;
    };
  }, [liveAudioStream, startListening]);

  function endSession() {
    setEndConfirmationVisible(true);
  }

  async function confirmEndSession() {
    setEndConfirmationVisible(false);
    setFinishing(true);
    try {
      let audioUri: string | null = null;
      let transcript = turnsRef.current
        .filter((turn) => turn.status === 'done' && turn.transcript)
        .map((turn) => turn.transcript)
        .join(' ');
      if (Platform.OS === 'web') {
        audioUri = await finishWebRecording();
      } else {
        if (liveAudioStream?.isStreaming) liveAudioStream.stop();
        flushCurrentUtterance();
        await processingQueue.current;
        transcript = turnsRef.current.map((turn) => turn.transcript).filter(Boolean).join(' ');
        if (!transcript) {
          setFinishing(false);
          setSpeechError('Chưa nhận được câu nói nào. Hãy bật mic và nói một câu trước khi kết thúc.');
          return;
        }
      }
      const sessionId = createPracticeSessionId();
      await savePracticeSession({
        id: sessionId,
        topic: topic ?? 'Luyện nói tự do',
        ...(params.lessonId ? { lessonId: Number(params.lessonId) } : {}),
        createdAt: new Date().toISOString(),
        durationSeconds: elapsedSeconds,
        transcript,
        turns: turnsRef.current
          .filter((turn) => turn.status === 'done' && turn.transcript)
          .map(({ id, transcript: userText, translation: userTranslation, reply, suggestions, feedback, pronunciationFeedback, hasAudio }) => ({
            transcript: userText,
            translation: userTranslation,
            reply,
            suggestions,
            feedback,
            pronunciationFeedback,
            hasAudio,
            ...(audioSegments.current[id] ? { audioBase64: audioSegments.current[id] } : {}),
          })),
      });
      router.replace({
        pathname: '/TrangPhanHoi',
        params: {
          topic: topic ?? 'Luyện nói tự do',
          targetSentence: phrase,
          ...(audioUri ? { audioUri } : {}),
          ...(transcript ? { transcript } : {}),
          insufficientData: Platform.OS === 'web' && elapsedSeconds < 2 * 60 ? 'true' : 'false',
          durationSeconds: String(elapsedSeconds),
          sessionId,
        },
      });
    } catch (error) {
      setFinishing(false);
      setSpeechError(error instanceof Error ? `Không thể lưu buổi học: ${error.message}` : 'Không thể lưu buổi học. Hãy thử lại.');
    }
  }

  async function getSpeechAudioSource(text: string): Promise<string> {
    const uri = getAiSpeechUrl(text);
    if (Platform.OS !== 'web') return uri;

    let response: Response;
    try {
      response = await fetch(uri);
    } catch {
      throw new Error('Không kết nối được backend Kokoro. Hãy kiểm tra backend đang chạy tại cổng 8000.');
    }
    if (!response.ok) {
      const payload: unknown = await response.json().catch(() => null);
      const detail = typeof payload === 'object' && payload !== null && 'detail' in payload && typeof payload.detail === 'string'
        ? payload.detail
        : `Backend Kokoro trả lỗi HTTP ${response.status}.`;
      throw new Error(detail);
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().startsWith('audio/')) {
      throw new Error(`Backend không trả audio hợp lệ (Content-Type: ${contentType || 'không xác định'}).`);
    }
    const audioBlob = await response.blob();
    if (audioBlob.size < 44) throw new Error('Backend Kokoro trả về tệp WAV rỗng hoặc không hợp lệ.');

    const objectUrl = URL.createObjectURL(audioBlob);
    if (webSpeechObjectUrl.current) URL.revokeObjectURL(webSpeechObjectUrl.current);
    webSpeechObjectUrl.current = objectUrl;
    return objectUrl;
  }

  async function playAiSpeech(text: string) {
    try {
      const uri = await getSpeechAudioSource(text);
      pendingSpeechFallback.current = text;
      if (speechAudioUri !== uri) {
        speechPlayer.replace({ uri });
        setSpeechAudioUri(uri);
      } else {
        await speechPlayer.seekTo(0);
      }
      speechPlayer.play();
    } catch (error) {
      speakWithDeviceVoice(text, error instanceof Error ? `${error.message} Đang dùng giọng đọc trên thiết bị.` : 'Đang dùng giọng đọc trên thiết bị.');
    }
  }

  async function playSample() {
    if (speechStatus.playing || systemSpeaking) {
      pendingSpeechFallback.current = null;
      speechPlayer.pause();
      void Speech.stop();
      setSystemSpeaking(false);
      return;
    }
    await playAiSpeech(phrase);
  }

  async function playSuggestedSentence(text: string) {
    await playAiSpeech(text);
  }
  useEffect(() => {
    playSuggestedSentenceRef.current = playSuggestedSentence;
  });

  function speakWithDeviceVoice(text: string, status: string) {
    pendingSpeechFallback.current = null;
    setSpeechError(status);
    Speech.speak(text, {
      language: 'en-US',
      rate: 0.86,
      onStart: () => setSystemSpeaking(true),
      onDone: () => setSystemSpeaking(false),
      onStopped: () => setSystemSpeaking(false),
      onError: () => {
        setSystemSpeaking(false);
        setSpeechError('Trình duyệt không hỗ trợ giọng đọc. Hãy dùng Chrome hoặc Edge mới nhất.');
      },
    });
  }

  useEffect(() => {
    if (speechStatus.playing) {
      pendingSpeechFallback.current = null;
      return;
    }
    if (!speechStatus.error || !pendingSpeechFallback.current) return;
    speakWithDeviceVoice(
      pendingSpeechFallback.current,
      'Không tải được giọng Kokoro. Đang phát bằng giọng đọc trên thiết bị.',
    );
  }, [speechStatus.error, speechStatus.playing]);

  const starterReplies = /interview|position|phỏng vấn/.test(conversationContext)
    ? [
        "I'm applying for the marketing position. I have two years of experience.",
        'I am applying for the sales job. I have strong communication skills.',
        'I am here for the graphic design role. What are the main duties?',
      ]
    : /introduce yourself|giới thiệu bản thân/.test(conversationContext)
      ? ['My name is Alex, and I work in technology.', 'I enjoy learning new skills and working with a team.', 'Would you like to hear about my experience?']
      : /job|work|công việc/.test(conversationContext)
        ? ['I work as a software developer.', 'This week, I am working on a new project.', 'My main responsibility is helping customers.']
        : ['Could you tell me more about that?', 'That sounds interesting. What happened next?', 'I would be happy to help.'];
  const suggestedReplies = [...liveTurns].reverse().find((turn) => turn.status === 'done' && turn.suggestions.length > 0)?.suggestions ?? starterReplies;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.keyboardFrame}>
        <View style={styles.page}>
          <View style={styles.header}>
            <Pressable accessibilityRole="button" accessibilityLabel="Quay lại" onPress={() => router.back()} style={styles.backButton}>
              <Text style={styles.backArrow}>‹</Text>
            </Pressable>
            <Image accessibilityLabel="Elevate AI" source={require('@/assets/images/elevate-mascot.png')} style={styles.brandAvatar} />
            <View style={styles.headerCopy}>
              <Text style={styles.brand}>Elevate</Text>
              <Text numberOfLines={1} style={styles.topic}>{topic ?? 'Practice conversation'}</Text>
            </View>
            <View style={styles.headerActions}>
              <View style={styles.timerPill}><Text style={styles.timerText}>{timerLabel}</Text></View>
              <Pressable accessibilityRole="button" accessibilityLabel={tipsVisible ? 'Tắt tip góp ý' : 'Bật tip góp ý'} onPress={() => setTipsVisible((value) => !value)} style={styles.headerIconButton}>
                <MorphIcon icon={tipsVisible ? EyeOff : Eye} size={18} color={COLORS.white} strokeWidth={2} spring="snappy" />
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={translationOn ? 'Tắt bản dịch' : 'Bật bản dịch'} onPress={() => setTranslationOn((value) => !value)} style={styles.headerIconButton}>
                <MorphIcon icon={Languages} size={18} color={COLORS.white} strokeWidth={2} spring="snappy" />
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Kết thúc buổi học" onPress={endSession} style={styles.headerIconButton}>
                <MorphIcon icon={PhoneOff} size={18} color={COLORS.white} strokeWidth={2} spring="snappy" />
              </Pressable>
            </View>
          </View>

          <View pointerEvents="none" style={styles.dotsLayer}>
            {Array.from({ length: patternColumns * patternRows }, (_, index) => (
              <View key={index} style={[styles.dot, { left: 14 + (index % patternColumns) * 34, top: 10 + Math.floor(index / patternColumns) * 34 }]} />
            ))}
          </View>

          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} style={styles.chatScroll}>
            <View style={styles.missionCard}>
              <View style={styles.missionIcon}>
                <MorphIcon icon={Sparkles} size={21} color={COLORS.white} strokeWidth={2} spring="snappy" />
              </View>
              <View style={styles.missionCopy}>
                <Text style={styles.missionLabel}>YOUR MISSION</Text>
                <Text style={styles.missionText}>{prompt || `Practice a conversation about ${topic ?? 'everyday life'}.`}</Text>
              </View>
            </View>

            <View style={styles.aiMessage}>
              <Text style={styles.messageName}>ELEVATE · ENGLISH</Text>
              <Text style={styles.englishText}>{phrase}</Text>
              {translationOn ? (
                <Text accessibilityLiveRegion="polite" style={styles.vietnameseText}>
                  {translation || (translationLoading ? 'Đang dịch…' : translationError || 'Bản dịch sẽ hiện ở đây.')}
                </Text>
              ) : null}
              <View style={styles.messageActions}>
                <Pressable accessibilityRole="button" onPress={() => void playSample()} style={styles.messageAction}>
                  <MorphIcon icon={speechStatus.playing || systemSpeaking ? Pause : Play} size={14} color={COLORS.purple} strokeWidth={2} spring="snappy" />
                  <Text style={styles.messageActionText}>{speechStatus.playing || systemSpeaking ? 'Stop' : 'Play'}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" onPress={() => setTranslationOn((value) => !value)} style={styles.messageAction}>
                  <MorphIcon icon={Languages} size={14} color={COLORS.purple} strokeWidth={2} spring="snappy" />
                  <Text style={styles.messageActionText}>{translationOn ? 'Ẩn dịch' : 'Dịch'}</Text>
                </Pressable>
              </View>
            </View>

            {liveTurns.map((turn) => (
              <View key={turn.id} style={styles.turnGroup}>
                {turn.displayText || turn.transcript ? (
                  <View style={styles.userMessage}>
                    <Text style={styles.messageNameUser}>YOU</Text>
                    <Text style={styles.userMessageText}>{turn.displayText || turn.transcript}</Text>
                    {turn.displayText && turn.displayText !== turn.transcript ? <Text style={styles.userEnglishVersion}>In English: {turn.transcript}</Text> : null}
                    {translationOn && turn.translation ? <Text style={styles.userTranslation}>{turn.translation}</Text> : null}
                  </View>
                ) : null}
                {turn.reply ? (
                  <View style={styles.aiMessage}>
                    <Text style={styles.messageName}>ELEVATE · ENGLISH</Text>
                    <Text style={styles.englishText}>{turn.reply}</Text>
                    {tipsVisible && turn.feedback ? <Text style={styles.feedbackText}>Tip: {turn.feedback}</Text> : null}
                    <View style={styles.messageActions}>
                      <Pressable accessibilityRole="button" onPress={() => void playSuggestedSentence(turn.reply)} style={styles.messageAction}>
                        <MorphIcon icon={Volume2} size={14} color={COLORS.purple} strokeWidth={2} spring="snappy" />
                        <Text style={styles.messageActionText}>Play</Text>
                      </Pressable>
                      {translationOn && turn.translation ? <Text style={styles.messageActionText}>{turn.translation}</Text> : null}
                    </View>
                  </View>
                ) : turn.error ? <Text style={styles.errorMessage}>{turn.error}</Text> : null}
              </View>
            ))}

            {sendingMessage ? <Text style={styles.thinkingMessage}>Elevate đang trả lời…</Text> : null}
            {micPermissionDenied && Platform.OS !== 'web' ? (
              <Pressable accessibilityRole="button" onPress={() => void Linking.openSettings()} style={styles.permissionSettingsButton}>
                <Text style={styles.permissionSettingsText}>Mở cài đặt quyền microphone</Text>
              </Pressable>
            ) : null}
          </ScrollView>

          <View style={styles.composerPanel}>
            <View style={styles.suggestionsHeading}>
              <View style={styles.suggestionsTitleRow}>
                <MorphIcon icon={Sparkles} size={14} color={COLORS.muted} strokeWidth={2} spring="snappy" />
                <Text style={styles.suggestionsTitle}>SUGGESTIONS</Text>
              </View>
              <Text style={styles.suggestionsHint}>Chạm mũi tên để trả lời</Text>
            </View>
            <View style={styles.suggestionList}>
              {suggestedReplies.slice(0, 3).map((suggestion, index) => (
                <View key={`${index}-${suggestion}`} style={styles.suggestionRow}>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Nghe gợi ý: ${suggestion}`} onPress={() => void playSuggestedSentence(suggestion)} style={styles.suggestionTextButton}>
                    <Text numberOfLines={2} style={styles.suggestionText}>{suggestion}</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Gửi câu trả lời: ${suggestion}`} disabled={sendingMessage} onPress={() => void sendTextMessage(suggestion)} style={styles.suggestionSend}>
                    <MorphIcon icon={ArrowRight} size={17} color={COLORS.purple} strokeWidth={2} spring="snappy" />
                  </Pressable>
                </View>
              ))}
            </View>

            <View style={styles.composerRow}>
              <TextInput
                accessibilityLabel="Nhập câu trả lời"
                editable={!sendingMessage}
                multiline
                onChangeText={setMessageDraft}
                onSubmitEditing={() => void sendTextMessage()}
                placeholder="How do I say...? Type in your language."
                placeholderTextColor="#9AA1B9"
                returnKeyType="send"
                style={styles.messageInput}
                value={messageDraft}
              />
              <Pressable accessibilityRole="button" accessibilityLabel="Gửi tin nhắn" disabled={!messageDraft.trim() || sendingMessage} onPress={() => void sendTextMessage()} style={[styles.sendButton, (!messageDraft.trim() || sendingMessage) && styles.sendButtonDisabled]}>
                <MorphIcon icon={Send} size={17} color={COLORS.white} strokeWidth={2} spring="snappy" />
              </Pressable>
            </View>

            <View style={styles.bottomActions}>
              <Text style={styles.micHint}>{micStarting ? 'Đang bật microphone…' : listening ? 'Đang nghe · chạm mic để gửi' : 'Trả lời bằng giọng nói'}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={listening || micStarting ? 'Dừng và gửi câu vừa nói' : 'Bắt đầu ghi âm'} disabled={micStarting || sendingMessage} onPress={() => void toggleListening()} style={[styles.micButton, listening && styles.micButtonActive, (micStarting || sendingMessage) && styles.micButtonDisabled]}>
                <MorphIcon icon={listening || micStarting ? MicOff : Mic} size={21} color={COLORS.white} strokeWidth={2} spring="snappy" />
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Kết thúc buổi luyện" onPress={endSession} style={styles.endButton}>
                <MorphIcon icon={PhoneOff} size={17} color={COLORS.muted} strokeWidth={2} spring="snappy" />
              </Pressable>
            </View>
            {speechError ? <Text accessibilityLiveRegion="polite" numberOfLines={1} style={styles.statusText}>{speechError}</Text> : null}
          </View>
        </View>

        <Modal animationType="fade" onRequestClose={() => setEndConfirmationVisible(false)} transparent visible={endConfirmationVisible}>
          <View style={styles.confirmationOverlay}>
            <View accessibilityRole="alert" style={styles.confirmationCard}>
              <Text style={styles.confirmationTitle}>Kết thúc luyện nói?</Text>
              <Text style={styles.confirmationMessage}>Bạn có muốn kết thúc phiên luyện tập này không?</Text>
              <View style={styles.confirmationActions}>
                <Pressable accessibilityRole="button" onPress={() => setEndConfirmationVisible(false)} style={({ pressed }) => [styles.confirmationButton, styles.cancelButton, pressed && styles.confirmationPressed]}>
                  <Text style={styles.cancelButtonText}>Tiếp tục</Text>
                </Pressable>
                <Pressable accessibilityRole="button" onPress={() => void confirmEndSession()} disabled={finishing} style={({ pressed }) => [styles.confirmationButton, styles.finishButton, pressed && styles.confirmationPressed]}>
                  <Text style={styles.finishButtonText}>{finishing ? 'Đang lưu…' : 'Kết thúc'}</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: COLORS.background, flex: 1 },
  keyboardFrame: { flex: 1 },
  page: { alignSelf: 'center', backgroundColor: COLORS.background, flex: 1, maxWidth: 680, overflow: 'hidden', width: '100%' },
  header: { alignItems: 'center', backgroundColor: COLORS.background, flexDirection: 'row', gap: 9, minHeight: 66, paddingHorizontal: 14, paddingVertical: 8, zIndex: 2 },
  backButton: { alignItems: 'center', height: 42, justifyContent: 'center', width: 28 },
  backArrow: { color: COLORS.white, fontFamily: 'serif', fontSize: 36, lineHeight: 40 },
  brandAvatar: { backgroundColor: '#FFFFFF22', borderRadius: 19, height: 38, marginRight: 1, width: 38 },
  headerCopy: { flex: 1 },
  brand: { color: COLORS.white, fontFamily: 'serif', fontSize: 27, fontStyle: 'italic', letterSpacing: -1.6 },
  topic: { color: '#D9DEEC', fontSize: 11, marginTop: -1 },
  headerActions: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  timerPill: { backgroundColor: '#FFFFFF22', borderRadius: 16, paddingHorizontal: 9, paddingVertical: 6 },
  timerText: { color: COLORS.white, fontSize: 11, fontWeight: '700' },
  headerIconButton: { alignItems: 'center', borderRadius: 16, height: 34, justifyContent: 'center', width: 34 },
  dotsLayer: { bottom: 0, left: 0, overflow: 'hidden', position: 'absolute', right: 0, top: 66 },
  dot: { backgroundColor: '#A8D65A', borderRadius: 4, height: 7, opacity: 0.14, position: 'absolute', width: 7 },
  chatScroll: { flex: 1, zIndex: 1 },
  content: { alignSelf: 'center', gap: 14, maxWidth: 620, paddingHorizontal: 17, paddingBottom: 18, paddingTop: 18, width: '100%' },
  missionCard: { alignItems: 'stretch', backgroundColor: COLORS.white, borderRadius: 12, flexDirection: 'row', overflow: 'hidden' },
  missionIcon: { alignItems: 'center', backgroundColor: COLORS.purple, justifyContent: 'center', minHeight: 74, width: 58 },
  missionCopy: { flex: 1, justifyContent: 'center', paddingHorizontal: 13, paddingVertical: 11 },
  missionLabel: { color: COLORS.text, fontSize: 10, fontWeight: '800', letterSpacing: 0.65 },
  missionText: { color: '#39415A', fontSize: 13, lineHeight: 19, marginTop: 5 },
  aiMessage: { alignSelf: 'flex-start', backgroundColor: COLORS.white, borderRadius: 12, elevation: 1, maxWidth: '94%', padding: 14, shadowColor: '#6473B4', shadowOpacity: 0.08, shadowRadius: 8, width: '100%' },
  messageName: { color: '#667085', fontSize: 9, fontWeight: '800', letterSpacing: 0.8, marginBottom: 4 },
  englishText: { color: '#17234E', fontSize: 15, lineHeight: 23 },
  vietnameseText: { color: '#667085', fontSize: 13, lineHeight: 19, marginTop: 7 },
  messageActions: { alignItems: 'center', borderTopColor: '#17234E18', borderTopWidth: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginTop: 11, paddingTop: 8 },
  messageAction: { alignItems: 'center', flexDirection: 'row', gap: 5, minHeight: 24 },
  messageActionText: { color: COLORS.purpleDark, fontSize: 11 },
  turnGroup: { alignItems: 'stretch', gap: 10, width: '100%' },
  userMessage: { alignSelf: 'flex-end', backgroundColor: '#A8D65A', borderRadius: 12, maxWidth: '92%', padding: 13, width: '90%' },
  messageNameUser: { color: '#354919', fontSize: 9, fontWeight: '800', letterSpacing: 0.8, marginBottom: 4 },
  userMessageText: { color: '#17234E', fontSize: 15, fontWeight: '600', lineHeight: 22 },
  userEnglishVersion: { color: '#354919', fontSize: 12, lineHeight: 18, marginTop: 6 },
  userTranslation: { borderTopColor: '#17234E35', borderTopWidth: 1, color: '#354919', fontSize: 12, lineHeight: 18, marginTop: 7, paddingTop: 6 },
  feedbackText: { color: '#667085', fontSize: 12, lineHeight: 18, marginTop: 8 },
  errorMessage: { alignSelf: 'flex-start', color: '#FFC2CB', fontSize: 12, marginLeft: 8 },
  thinkingMessage: { alignSelf: 'flex-start', backgroundColor: '#FFFFFF', borderRadius: 12, color: '#667085', fontSize: 13, paddingHorizontal: 13, paddingVertical: 9 },
  permissionSettingsButton: { alignSelf: 'center', padding: 8 },
  permissionSettingsText: { color: '#A8D65A', fontSize: 12, fontWeight: '700', textDecorationLine: 'underline' },
  composerPanel: { backgroundColor: '#1B2858', borderTopColor: '#FFFFFF24', borderTopWidth: 1, paddingBottom: 5, paddingHorizontal: 13, paddingTop: 8, zIndex: 2 },
  suggestionsHeading: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 },
  suggestionsTitleRow: { alignItems: 'center', flexDirection: 'row', gap: 5 },
  suggestionsTitle: { color: '#A8D65A', fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  suggestionsHint: { color: '#D9DEEC', fontSize: 9 },
  suggestionList: { gap: 5, paddingBottom: 7 },
  suggestionRow: { alignItems: 'center', backgroundColor: '#A8D65A', borderColor: '#A8D65A', borderRadius: 9, borderWidth: 1, flexDirection: 'row', minHeight: 35, paddingLeft: 10, width: '100%' },
  suggestionTextButton: { flex: 1, justifyContent: 'center', minHeight: 37 },
  suggestionText: { color: '#17234E', fontSize: 11, lineHeight: 16 },
  suggestionSend: { alignItems: 'center', height: 36, justifyContent: 'center', width: 36 },
  composerRow: { alignItems: 'center', backgroundColor: COLORS.white, borderColor: '#DFE3F3', borderRadius: 12, borderWidth: 1, flexDirection: 'row', minHeight: 45, paddingLeft: 12, paddingRight: 5 },
  messageInput: { color: COLORS.text, flex: 1, fontSize: 13, maxHeight: 78, minHeight: 40, paddingBottom: 8, paddingTop: 9 },
  sendButton: { alignItems: 'center', backgroundColor: COLORS.purple, borderRadius: 10, height: 34, justifyContent: 'center', width: 38 },
  sendButtonDisabled: { backgroundColor: '#52618A' },
  bottomActions: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', minHeight: 56, paddingHorizontal: 2 },
  micHint: { color: COLORS.muted, flex: 1, fontSize: 11 },
  micButton: { alignItems: 'center', backgroundColor: COLORS.purple, borderRadius: 24, height: 46, justifyContent: 'center', width: 46 },
  micButtonActive: { backgroundColor: COLORS.red },
  micButtonDisabled: { opacity: 0.55 },
  endButton: { alignItems: 'center', height: 42, justifyContent: 'center', width: 48 },
  statusText: { color: COLORS.muted, fontSize: 10, minHeight: 14, textAlign: 'center' },
  confirmationOverlay: { alignItems: 'center', backgroundColor: '#080D20B8', flex: 1, justifyContent: 'center', padding: 24 },
  confirmationCard: { backgroundColor: COLORS.white, borderRadius: 20, maxWidth: 360, padding: 22, width: '100%' },
  confirmationTitle: { color: COLORS.text, fontSize: 20, fontWeight: '700' },
  confirmationMessage: { color: '#68708D', fontSize: 15, lineHeight: 22, marginTop: 9 },
  confirmationActions: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end', marginTop: 22 },
  confirmationButton: { alignItems: 'center', borderRadius: 12, justifyContent: 'center', minHeight: 44, paddingHorizontal: 16 },
  cancelButton: { backgroundColor: '#EEF0F8' },
  finishButton: { backgroundColor: COLORS.purple },
  cancelButtonText: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  finishButtonText: { color: COLORS.white, fontSize: 14, fontWeight: '700' },
  confirmationPressed: { opacity: 0.78 },
});
