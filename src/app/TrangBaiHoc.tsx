import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { router, useFocusEffect, type Href } from 'expo-router';
import { PageFrame, pageStyles, palette } from '../components/PageFrame';
import { completeLesson, getLearningApiErrorMessage, getLearningCatalog, getLessonProgress, saveVocabulary, type LearningCatalog } from '../services/learning-api';

export default function LessonsScreen() {
  const [catalog, setCatalog] = useState<LearningCatalog | null>(null);
  const [completed, setCompleted] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  const [savedWords, setSavedWords] = useState<number[]>([]);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    void Promise.all([getLearningCatalog(), getLessonProgress()])
      .then(([nextCatalog, lessonProgress]) => { setCatalog(nextCatalog); setCompleted(lessonProgress.filter((item) => item.status === 'completed').map((item) => item.lesson_id)); })
      .catch((cause: unknown) => setError(getLearningApiErrorMessage(cause, 'Chưa tải được chương trình học. Hãy kiểm tra backend và thử lại.')))
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function markComplete(lessonId: number) {
    setBusy(lessonId);
    try {
      await completeLesson(lessonId);
      setCompleted((current) => current.includes(lessonId) ? current : [...current, lessonId]);
    } catch {
      setError('Không lưu được tiến độ bài học. Hãy đăng nhập và thử lại.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <PageFrame title="Chương trình học" subtitle="Chủ đề, bài học và mục tiêu luyện tập">
      <Text style={pageStyles.heading}>Lộ trình tiếng Anh</Text>
      <Text style={pageStyles.paragraph}>Chọn một bài học, luyện hội thoại theo mục tiêu rồi đánh dấu hoàn thành.</Text>
      {loading ? (
        <View style={[pageStyles.card, { alignItems: 'center' }]}><ActivityIndicator color={palette.green} /><Text style={pageStyles.secondaryText}>Đang tải bài học…</Text></View>
      ) : error ? (
        <View accessibilityRole="alert" style={pageStyles.card}>
          <Text style={pageStyles.bodyText}>{error}</Text>
          <Pressable accessibilityRole="button" onPress={load} style={pageStyles.action}><Text style={pageStyles.actionText}>Thử tải lại</Text></Pressable>
        </View>
      ) : catalog?.topics.map((topic) => {
        const lessons = catalog.lessons.filter((lesson) => lesson.topic_id === topic.topic_id);
        return (
          <View key={topic.topic_id} style={pageStyles.card}>
            <Text style={pageStyles.cardTitle}>{topic.topic_name.toLocaleUpperCase()} · {topic.level}</Text>
            <Text style={pageStyles.secondaryText}>{topic.description}</Text>
            {lessons.map((lesson) => (
              <View key={lesson.lesson_id} style={{ borderTopColor: '#FFFFFF20', borderTopWidth: 1, marginTop: 12, paddingTop: 12 }}>
                <Text style={pageStyles.bodyText}>{lesson.lesson_title}{completed.includes(lesson.lesson_id) ? '  ✓' : ''}</Text>
                <Text style={pageStyles.secondaryText}>{lesson.objectives || lesson.content}</Text>
                {catalog.vocabulary.filter((item) => item.lesson_id === lesson.lesson_id).map((item) => (
                  <View key={item.vocabulary_id} style={{ backgroundColor: '#FFFFFF0A', borderRadius: 10, marginTop: 8, padding: 10 }}>
                    <Text style={pageStyles.bodyText}>{item.word}</Text>
                    <Text style={pageStyles.secondaryText}>{item.definition}{item.example ? ` · “${item.example}”` : ''}</Text>
                    <Pressable accessibilityRole="button" onPress={() => void saveVocabulary({ word: item.word, definition: item.definition, example: item.example, lesson_id: lesson.lesson_id }).then(() => setSavedWords((current) => current.includes(item.vocabulary_id) ? current : [...current, item.vocabulary_id]))} style={[pageStyles.action, { marginTop: 8 }]}>
                      <Text style={pageStyles.actionText}>{savedWords.includes(item.vocabulary_id) ? 'Đã lưu từ này' : 'Lưu vào từ vựng của tôi'}</Text>
                    </Pressable>
                  </View>
                ))}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => router.push({ pathname: '/TrangChonChuDe', params: { topic: topic.topic_name, prompt: lesson.objectives || lesson.content, lessonId: String(lesson.lesson_id) } })}
                    style={[pageStyles.action, { flexGrow: 1, marginTop: 0 }]}
                  ><Text style={pageStyles.actionText}>Luyện bài này</Text></Pressable>
                  <Pressable accessibilityRole="button" disabled={busy === lesson.lesson_id} onPress={() => void markComplete(lesson.lesson_id)} style={[pageStyles.action, { backgroundColor: '#26345D', flexGrow: 1, marginTop: 0 }]}>
                    <Text style={pageStyles.actionText}>{busy === lesson.lesson_id ? 'Đang lưu…' : 'Đánh dấu hoàn thành'}</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        );
      })}
      <Pressable accessibilityRole="button" onPress={() => router.push('/TrangThongBao' as Href)} style={[pageStyles.card, { marginTop: 4 }]}>
        <Text style={pageStyles.bodyText}>Thông báo học tập</Text>
        <Text style={pageStyles.secondaryText}>Xem nhắc học và hoạt động gần đây</Text>
      </Pressable>
    </PageFrame>
  );
}
