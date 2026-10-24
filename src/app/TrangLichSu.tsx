import { useCallback, useState } from 'react';
import { useFocusEffect, router } from 'expo-router';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { PageFrame, pageStyles, palette } from '../components/PageFrame';
import { getPracticeSessions, type PracticeSession } from '../services/practice-history';

function sessionDate(value: string): string {
  return new Intl.DateTimeFormat('vi-VN', {
    weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
}

function durationLabel(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return remaining > 0 ? `${minutes} phút ${remaining} giây` : `${minutes} phút`;
}

export default function HistoryScreen() {
  const [sessions, setSessions] = useState<PracticeSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  useFocusEffect(useCallback(() => {
    let active = true;
    setLoading(true);
    void getPracticeSessions()
      .then((items) => { if (active) setSessions(items); })
      .catch(() => { if (active) setLoadError('Chưa tải được lịch sử. Hãy thử mở lại trang.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []));

  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const thisWeek = sessions.filter((session) => new Date(session.createdAt).getTime() >= weekAgo);
  const totalMinutes = thisWeek.reduce((total, session) => total + Math.round(session.durationSeconds / 60), 0);

  return (
    <PageFrame title="Lịch sử luyện tập" subtitle="Những cuộc hội thoại của bạn">
      <Text style={pageStyles.heading}>Tiến trình của bạn</Text>
      <Text style={pageStyles.paragraph}>Mỗi buổi luyện được lưu trên thiết bị để bạn xem lại và ôn đúng phần cần cải thiện.</Text>

      <View style={[pageStyles.card, { backgroundColor: '#A8D65A16', flexDirection: 'row', gap: 24 }]}>
        <View>
          <Text style={pageStyles.cardTitle}>7 NGÀY QUA</Text>
          <Text style={pageStyles.bodyText}>{thisWeek.length} buổi · {totalMinutes} phút</Text>
        </View>
        <View>
          <Text style={pageStyles.cardTitle}>TỔNG SỐ BUỔI</Text>
          <Text style={pageStyles.bodyText}>{sessions.length}</Text>
        </View>
      </View>

      {loading ? (
        <View style={[pageStyles.card, { alignItems: 'center' }]}>
          <ActivityIndicator color={palette.green} />
          <Text style={pageStyles.secondaryText}>Đang tải lịch sử…</Text>
        </View>
      ) : loadError ? (
        <View accessibilityRole="alert" style={pageStyles.card}><Text style={pageStyles.bodyText}>{loadError}</Text></View>
      ) : sessions.length === 0 ? (
        <View style={pageStyles.card}>
          <Text style={pageStyles.cardTitle}>BUỔI HỌC ĐẦU TIÊN ĐANG CHỜ BẠN</Text>
          <Text style={pageStyles.bodyText}>Sau khi kết thúc một cuộc trò chuyện, nội dung và gợi ý của AI sẽ xuất hiện ở đây.</Text>
          <Pressable accessibilityRole="button" onPress={() => router.push('/TrangChonChuDe')} style={pageStyles.action}>
            <Text style={pageStyles.actionText}>Chọn chủ đề luyện nói</Text>
          </Pressable>
        </View>
      ) : sessions.map((session) => {
        const insightCount = (session.feedback?.length ?? 0) + session.turns.reduce((count, turn) => count + (turn.suggestions?.length ?? 0), 0);
        return (
          <Pressable
            key={session.id}
            accessibilityRole="button"
            onPress={() => router.push({
              pathname: '/TrangPhanHoi',
              params: { topic: session.topic, transcript: session.transcript, sessionId: session.id },
            })}
            style={({ pressed }) => [pageStyles.card, pressed && { opacity: 0.76 }]}>
            <Text style={{ color: palette.green, fontSize: 11, fontWeight: '700', marginBottom: 7 }}>{sessionDate(session.createdAt).toUpperCase()}</Text>
            <Text style={pageStyles.bodyText}>{session.topic}</Text>
            <Text style={pageStyles.secondaryText}>{durationLabel(session.durationSeconds)} · {session.turns.length} lượt nói · {insightCount} gợi ý ôn tập</Text>
            <Text style={{ color: palette.green, fontSize: 13, fontWeight: '700', marginTop: 10 }}>Xem cuộc trò chuyện  ›</Text>
          </Pressable>
        );
      })}
    </PageFrame>
  );
}
