import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronDown } from 'lucide';
import { MorphIcon } from 'morphicons/react-native';
import { getAiSpeakingFeedback, type AiSpeakingFeedback } from '../services/ai-feedback';
import { analyzeSpeakingAudio } from '../services/backend-ai';
import { getPracticeSessions, updatePracticeSession } from '../services/practice-history';
import { savePronunciationFeedback, uploadPracticeRecording } from '../services/learning-api';
import { PageFrame, pageStyles, palette } from '../components/PageFrame';

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

export default function FeedbackScreen() {
  const params = useLocalSearchParams<{
    topic?: string | string[];
    transcript?: string | string[];
    audioUri?: string | string[];
    targetSentence?: string | string[];
    insufficientData?: string | string[];
    durationSeconds?: string | string[];
    sessionId?: string | string[];
  }>();
  const topic = firstParam(params.topic) || 'Luyện nói tự do';
  const initialTranscript = firstParam(params.transcript).trim();
  const [transcript, setTranscript] = useState(initialTranscript);
  const [userAnswers, setUserAnswers] = useState<string[]>(initialTranscript ? [initialTranscript] : []);
  const [answersModalVisible, setAnswersModalVisible] = useState(false);
  const audioUri = firstParam(params.audioUri);
  const [hasRecording, setHasRecording] = useState(Boolean(audioUri));
  const targetSentence = firstParam(params.targetSentence) || topic;
  const insufficientData = firstParam(params.insufficientData) === 'true';
  const durationSeconds = Number(firstParam(params.durationSeconds)) || 0;
  const sessionId = firstParam(params.sessionId);
  const durationLabel = `${Math.floor(durationSeconds / 60)}:${String(durationSeconds % 60).padStart(2, '0')}`;
  const [result, setResult] = useState<AiSpeakingFeedback | null>(null);
  const [pronunciation, setPronunciation] = useState<{ score?: number; detail: string } | null>(null);
  const [pronunciationError, setPronunciationError] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const orderedFeedback = [...(result?.feedback ?? [])].sort((left, right) => {
    const order = (title: string) => title.toLocaleLowerCase().includes('ngữ pháp') ? 0 : 1;
    return order(left.title) - order(right.title);
  });

  const loadFeedback = useCallback(async () => {
    let sessionTranscript = initialTranscript;
    let savedPronunciation = '';
    if (sessionId) {
      try {
        const savedSession = (await getPracticeSessions()).find((session) => session.id === sessionId);
        if (savedSession) {
          sessionTranscript = savedSession.transcript || savedSession.turns
            .map((turn) => turn.transcript)
            .filter(Boolean)
            .join(' ');
          const savedAnswers = savedSession.turns.map((turn) => turn.transcript.trim()).filter(Boolean);
          setUserAnswers(savedAnswers.length > 0 ? savedAnswers : sessionTranscript ? [sessionTranscript] : []);
          setHasRecording(Boolean(audioUri) || savedSession.turns.some((turn) => turn.hasAudio));
          savedPronunciation = savedSession.turns
            .map((turn) => turn.pronunciationFeedback?.trim() ?? '')
            .filter(Boolean)
            .join(' ');
          if (sessionTranscript) setTranscript(sessionTranscript);
        }
      } catch {
        // Continue to the backend if local history cannot be read.
      }
    }
    if (insufficientData) {
      setError(`Buổi luyện nói mới kéo dài ${durationLabel}. Cần luyện tập ít nhất 2 phút để có đủ dữ liệu phân tích và đánh giá.`);
      setResult(null);
      return;
    }

    if (!audioUri && !sessionTranscript) {
      setError('Chưa có nội dung hội thoại để AI phân tích. Hãy quay lại và nói một câu tiếng Anh trước khi kết thúc.');
      setResult(null);
      return;
    }

    setLoading(true);
    setError('');
    setPronunciationError('');
    setPronunciation(savedPronunciation ? { detail: savedPronunciation } : null);
    try {
      let analyzedTranscript = sessionTranscript;
      let audioAnalysis: Awaited<ReturnType<typeof analyzeSpeakingAudio>> | null = null;
      if (audioUri) {
        try {
          audioAnalysis = await analyzeSpeakingAudio(audioUri, targetSentence);
          setPronunciation({ score: audioAnalysis.score, detail: audioAnalysis.feedback });
          if (!analyzedTranscript) analyzedTranscript = audioAnalysis.transcribed_text;
        } catch (audioError) {
          setPronunciationError(audioError instanceof Error ? audioError.message : 'Chưa phân tích được bản thu âm.');
        }
      }
      if (sessionId && audioUri) {
        await uploadPracticeRecording(sessionId, audioUri).catch(() => undefined);
        if (audioAnalysis) {
          await savePronunciationFeedback(sessionId, audioAnalysis.feedback, audioAnalysis.score).catch(() => undefined);
        }
      }
      const feedbackTranscript = analyzedTranscript || audioAnalysis?.transcribed_text || '';
      if (!feedbackTranscript) throw new Error('Chưa có nội dung hội thoại để đánh giá ngữ pháp.');
      const feedback = await getAiSpeakingFeedback(topic, feedbackTranscript);
      setResult(feedback);
      if (analyzedTranscript) setTranscript(analyzedTranscript);
      if (sessionId) {
        try {
          await updatePracticeSession(sessionId, {
            transcript: analyzedTranscript,
            summary: feedback.summary,
            feedback: feedback.feedback,
          });
        } catch {
          // Showing feedback should not depend on local history storage being writable.
        }
      }
      if (feedback.feedback.length === 0 && !feedback.summary) {
        setError('AI đã phản hồi nhưng chưa có nội dung nhận xét hiển thị được. Hãy kiểm tra định dạng dữ liệu API.');
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Không tải được phản hồi AI. Hãy thử lại.');
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [audioUri, durationLabel, initialTranscript, insufficientData, sessionId, targetSentence, topic]);

  useEffect(() => {
    void Promise.resolve().then(loadFeedback);
  }, [loadFeedback]);

  return (
    <PageFrame title="Phản hồi sau buổi học" subtitle={`Chủ đề: ${topic}`}>
      <Text style={pageStyles.heading}>{insufficientData ? 'Chưa đủ dữ liệu để phân tích' : 'Phân tích buổi luyện nói'}</Text>
      <Text style={pageStyles.paragraph}>
        {insufficientData
          ? 'Hãy luyện nói ít nhất 2 phút rồi kết thúc buổi học để nhận đánh giá từ AI.'
          : 'AI sẽ nhận xét dựa trên nội dung bạn vừa nói.'}
      </Text>

      {transcript ? (
        <View style={pageStyles.card}>
          <View style={styles.answersSummaryHeader}>
            <Text style={[pageStyles.cardTitle, styles.answersSummaryTitle]}>CÂU TRẢ LỜI CỦA BẠN</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Xem ${userAnswers.length} câu trả lời đã luyện tập`}
              disabled={userAnswers.length === 0}
              onPress={() => setAnswersModalVisible(true)}
              style={[styles.answersToggle, userAnswers.length === 0 && styles.answersToggleDisabled]}
            >
              <Text style={styles.answersCount}>{userAnswers.length}</Text>
              <MorphIcon icon={ChevronDown} size={18} color={palette.green} strokeWidth={2} spring="snappy" />
            </Pressable>
          </View>
          <Text style={pageStyles.secondaryText}>Đã thu gọn {userAnswers.length} câu trả lời. Nhấn mũi tên để xem.</Text>
        </View>
      ) : null}

      {loading ? (
        <View accessibilityRole="progressbar" style={[pageStyles.card, { alignItems: 'center', paddingVertical: 24 }]}>
          <ActivityIndicator color={palette.green} size="large" />
          <Text style={[pageStyles.secondaryText, { marginTop: 12 }]}>AI đang phân tích câu trả lời…</Text>
        </View>
      ) : null}

      {error ? (
        <View accessibilityRole="alert" style={pageStyles.card}>
          <Text style={[pageStyles.bodyText, { color: '#FFB6B6' }]}>{error}</Text>
          {(audioUri || transcript) && !insufficientData ? (
            <Pressable accessibilityRole="button" onPress={() => void loadFeedback()} style={pageStyles.action}>
              <Text style={pageStyles.actionText}>Thử tải lại</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {hasRecording || pronunciation ? (
        <View style={pageStyles.card}>
          <Text style={pageStyles.cardTitle}>ĐÁNH GIÁ CHUNG VỀ PHÁT ÂM</Text>
          {pronunciation ? (
            <>
              {typeof pronunciation.score === 'number' ? (
                <Text style={[pageStyles.bodyText, { color: palette.green, fontWeight: '700', marginBottom: 6 }]}>
                  Độ rõ: {pronunciation.score}/100
                </Text>
              ) : null}
              <Text style={pageStyles.bodyText}>{pronunciation.detail}</Text>
            </>
          ) : pronunciationError ? (
            <Text style={[pageStyles.bodyText, { color: '#FFB6B6' }]}>{pronunciationError}</Text>
          ) : (
            <Text style={pageStyles.secondaryText}>AI chưa nhận diện đủ tiếng Anh trong bản thu để đưa ra nhận xét phát âm.</Text>
          )}
        </View>
      ) : null}

      {orderedFeedback.map((item, index) => (
        <View key={`${item.title}-${index}`} style={pageStyles.card}>
          <Text style={pageStyles.cardTitle}>{item.title.toUpperCase()}{item.score ? `  ·  ${item.score}` : ''}</Text>
          <Text style={pageStyles.bodyText}>{item.detail}</Text>
        </View>
      ))}

      {result?.summary ? (
        <View style={pageStyles.card}>
          <Text style={pageStyles.cardTitle}>TÓM TẮT BUỔI HỌC</Text>
          <Text style={pageStyles.bodyText}>{result.summary}</Text>
        </View>
      ) : null}

      {result ? (
        <Pressable accessibilityRole="button" onPress={() => router.push({
          pathname: '/TrangTuMoi',
          params: { topic, ...(sessionId ? { sessionId } : transcript ? { transcript } : {}) },
        })} style={pageStyles.action}>
          <Text style={pageStyles.actionText}>Tiếp tục học từ mới</Text>
        </Pressable>
      ) : null}
      <Pressable accessibilityRole="button" onPress={() => router.replace('/')} style={{ alignItems: 'center', padding: 15 }}>
        <Text style={{ color: palette.muted, fontSize: 14 }}>Về trang chủ</Text>
      </Pressable>
      <Modal animationType="fade" onRequestClose={() => setAnswersModalVisible(false)} transparent visible={answersModalVisible}>
        <View style={styles.answersOverlay}>
          <View style={styles.answersModalCard}>
            <View style={styles.answersModalHeader}>
              <Text style={styles.answersModalTitle}>Câu trả lời của bạn</Text>
              <Pressable accessibilityRole="button" onPress={() => setAnswersModalVisible(false)} style={styles.answersCloseButton}>
                <Text style={styles.answersCloseText}>Đóng</Text>
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.answersList} showsVerticalScrollIndicator>
              {userAnswers.map((answer, index) => (
                <View key={`${index}-${answer.slice(0, 24)}`} style={styles.answerCard}>
                  <Text style={styles.answerLabel}>CÂU TRẢ LỜI {index + 1}</Text>
                  <Text style={styles.answerText}>{answer}</Text>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </PageFrame>
  );
}

const styles = StyleSheet.create({
  answersSummaryHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  answersSummaryTitle: { marginBottom: 0 },
  answersToggle: { alignItems: 'center', flexDirection: 'row', gap: 3, justifyContent: 'center', minHeight: 34, minWidth: 40, paddingHorizontal: 5 },
  answersToggleDisabled: { opacity: 0.45 },
  answersCount: { color: palette.green, fontSize: 12, fontWeight: '700' },
  answersOverlay: { alignItems: 'center', backgroundColor: '#080D20B8', flex: 1, justifyContent: 'center', padding: 20 },
  answersModalCard: { backgroundColor: '#FFFFFF', borderRadius: 18, maxHeight: '82%', maxWidth: 520, padding: 18, width: '100%' },
  answersModalHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  answersModalTitle: { color: palette.ink, fontSize: 18, fontWeight: '700' },
  answersCloseButton: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  answersCloseText: { color: palette.green, fontSize: 13, fontWeight: '700' },
  answersList: { gap: 10, paddingBottom: 2 },
  answerCard: { backgroundColor: '#F0F5E6', borderColor: '#A8D65A66', borderRadius: 12, borderWidth: 1, padding: 13 },
  answerLabel: { color: palette.greenDark, fontSize: 10, fontWeight: '800', letterSpacing: 0.7, marginBottom: 6 },
  answerText: { color: palette.ink, fontSize: 15, lineHeight: 22 },
});
