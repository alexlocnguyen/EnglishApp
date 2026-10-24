import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { PageFrame, pageStyles, palette } from '../components/PageFrame';
import { getTopicVocabulary, type TopicVocabulary } from '../services/backend-ai';
import { getPracticeSessions } from '../services/practice-history';
import { saveVocabulary } from '../services/learning-api';

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

export default function NewVocabularyScreen() {
  const params = useLocalSearchParams<{ topic?: string | string[]; transcript?: string | string[]; sessionId?: string | string[] }>();
  const topic = firstParam(params.topic) || 'Luyện nói tiếng Anh';
  const sessionId = firstParam(params.sessionId);
  const initialTranscript = firstParam(params.transcript);
  const [vocabulary, setVocabulary] = useState<TopicVocabulary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savedWords, setSavedWords] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      let transcript = initialTranscript;
      if (sessionId) {
        const session = (await getPracticeSessions()).find((item) => item.id === sessionId);
        transcript = session?.transcript || transcript;
      }
      if (!transcript.trim()) throw new Error('Chưa tìm thấy nội dung buổi luyện để chọn từ phù hợp.');
      setVocabulary(await getTopicVocabulary(topic, transcript));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Chưa tải được từ vựng.');
    } finally {
      setLoading(false);
    }
  }, [initialTranscript, sessionId, topic]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  return (
    <PageFrame title="Từ mới sau buổi học" subtitle={`Chủ đề: ${topic}`}>
      <Text style={pageStyles.heading}>Mang từ mới vào hội thoại</Text>
      <Text style={pageStyles.paragraph}>Elevate chọn từ theo chủ đề và mức tiếng Anh ước lượng từ câu trả lời của bạn.</Text>

      {loading ? (
        <View accessibilityRole="progressbar" style={[pageStyles.card, { alignItems: 'center', paddingVertical: 24 }]}>
          <ActivityIndicator color={palette.green} size="large" />
          <Text style={[pageStyles.secondaryText, { marginTop: 12 }]}>Đang đối chiếu từ điển…</Text>
        </View>
      ) : error ? (
        <View accessibilityRole="alert" style={pageStyles.card}>
          <Text style={[pageStyles.bodyText, { color: '#FFB6B6' }]}>{error}</Text>
          <Pressable accessibilityRole="button" onPress={() => void load()} style={pageStyles.action}>
            <Text style={pageStyles.actionText}>Thử tải lại</Text>
          </Pressable>
        </View>
      ) : vocabulary ? (
        <>
          <View style={[pageStyles.card, { backgroundColor: '#A8D65A16' }]}>
            <Text style={pageStyles.cardTitle}>MỨC ĐỘ ƯỚC LƯỢNG · {vocabulary.level}</Text>
            <Text style={pageStyles.secondaryText}>Gợi ý được chọn theo chủ đề và nội dung bạn vừa luyện.</Text>
          </View>

          {vocabulary.verbs.map((item, index) => (
            <View key={`${item.word}-${index}`} style={pageStyles.card}>
              <Text style={pageStyles.cardTitle}>ĐỘNG TỪ {index + 1} · {item.word.toLocaleUpperCase()}</Text>
              <Text style={pageStyles.bodyText}>{item.definition}</Text>
              {item.example ? <Text style={pageStyles.secondaryText}>Ví dụ từ điển: “{item.example}”</Text> : null}
              {item.sourceUrl ? <Pressable onPress={() => void Linking.openURL(item.sourceUrl!)}><Text style={[pageStyles.secondaryText, { color: palette.green, marginTop: 8 }]}>Nguồn từ điển minhqnd ↗</Text></Pressable> : null}
              <Pressable accessibilityRole="button" onPress={() => void saveVocabulary({ word: item.word, definition: item.definition, example: item.example }).then(() => setSavedWords((current) => [...current, item.word]))} style={pageStyles.action}>
                <Text style={pageStyles.actionText}>{savedWords.includes(item.word) ? 'Đã lưu vào từ vựng của tôi' : 'Lưu vào từ vựng của tôi'}</Text>
              </Pressable>
            </View>
          ))}

          <View style={pageStyles.card}>
            <Text style={pageStyles.cardTitle}>CỤM TỪ · {vocabulary.phrase.phrase.toLocaleUpperCase()}</Text>
            <Text style={pageStyles.bodyText}>{vocabulary.phrase.definition}</Text>
            {vocabulary.phrase.example ? <Text style={pageStyles.secondaryText}>Ví dụ từ điển: “{vocabulary.phrase.example}”</Text> : null}
            {vocabulary.phrase.sourceUrl ? <Pressable onPress={() => void Linking.openURL(vocabulary.phrase.sourceUrl!)}><Text style={[pageStyles.secondaryText, { color: palette.green, marginTop: 8 }]}>Nguồn từ điển minhqnd ↗</Text></Pressable> : null}
            <Pressable accessibilityRole="button" onPress={() => void saveVocabulary({ word: vocabulary.phrase.phrase, definition: vocabulary.phrase.definition, example: vocabulary.phrase.example }).then(() => setSavedWords((current) => [...current, vocabulary.phrase.phrase]))} style={pageStyles.action}>
              <Text style={pageStyles.actionText}>{savedWords.includes(vocabulary.phrase.phrase) ? 'Đã lưu vào từ vựng của tôi' : 'Lưu vào từ vựng của tôi'}</Text>
            </Pressable>
          </View>

          <Text style={[pageStyles.secondaryText, { marginBottom: 10 }]}>
            Nguồn dữ liệu: minhqnd/dictionary (CC BY-SA 4.0). Dữ liệu được lọc theo chủ đề và trình độ ước lượng; các mục không có nghĩa tiếng Việt sẽ bị loại bỏ.
          </Text>
        </>
      ) : null}
    </PageFrame>
  );
}
