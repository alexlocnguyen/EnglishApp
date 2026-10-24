import { useCallback, useState } from 'react';
import { useFocusEffect, router } from 'expo-router';
import { ActivityIndicator, Modal, Pressable, Text, View } from 'react-native';
import { PageFrame, pageStyles, palette } from '../components/PageFrame';
import { getReviewCards, markReviewCardDone, type ReviewCard } from '../services/practice-history';

export default function ReviewScreen() {
  const [cards, setCards] = useState<ReviewCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCard, setSelectedCard] = useState<ReviewCard | null>(null);
  const [error, setError] = useState('');

  const refresh = useCallback(() => {
    setLoading(true);
    void getReviewCards()
      .then(setCards)
      .catch(() => setError('Chưa tải được nội dung ôn tập.'))
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(useCallback(() => {
    refresh();
  }, [refresh]));

  const pendingCards = cards.filter((card) => !card.reviewed);
  const doneCount = cards.length - pendingCards.length;

  async function openCard(card: ReviewCard) {
    setSelectedCard(card);
    if (card.reviewed) return;
    try {
      await markReviewCardDone(card.id);
      setCards((current) => current.map((item) => item.id === card.id ? { ...item, reviewed: true } : item));
    } catch {
      setError('Không lưu được tiến độ ôn tập. Hãy thử lại.');
    }
  }

  return (
    <PageFrame title="Ôn tập thông minh" subtitle="Bài luyện từ các buổi hội thoại">
      <Text style={pageStyles.heading}>Ôn lại điều bạn vừa học</Text>
      <Text style={pageStyles.paragraph}>Elevate gom các nhận xét và câu gợi ý từ AI thành thẻ luyện tập cá nhân.</Text>

      <View style={[pageStyles.card, { backgroundColor: '#A8D65A16' }]}>
        <Text style={pageStyles.cardTitle}>TIẾN ĐỘ ÔN TẬP</Text>
        <Text style={pageStyles.bodyText}>{doneCount} / {cards.length} thẻ đã xem</Text>
      </View>

      {loading ? (
        <View style={[pageStyles.card, { alignItems: 'center' }]}>
          <ActivityIndicator color={palette.green} />
          <Text style={pageStyles.secondaryText}>Đang chọn nội dung cần ôn…</Text>
        </View>
      ) : error ? (
        <View accessibilityRole="alert" style={pageStyles.card}><Text style={pageStyles.bodyText}>{error}</Text></View>
      ) : cards.length === 0 ? (
        <View style={pageStyles.card}>
          <Text style={pageStyles.cardTitle}>CHƯA CÓ THẺ ÔN TẬP</Text>
          <Text style={pageStyles.bodyText}>Sau buổi nói đầu tiên, các gợi ý câu trả lời và nhận xét của AI sẽ được chuyển thành bài ôn ở đây.</Text>
          <Pressable accessibilityRole="button" onPress={() => router.push('/TrangChonChuDe')} style={pageStyles.action}>
            <Text style={pageStyles.actionText}>Bắt đầu luyện nói</Text>
          </Pressable>
        </View>
      ) : pendingCards.length === 0 ? (
        <View style={pageStyles.card}>
          <Text style={pageStyles.cardTitle}>BẠN ĐÃ ÔN XONG 🎉</Text>
          <Text style={pageStyles.bodyText}>Những câu quan trọng đã được xem lại. Luyện thêm chủ đề mới để tạo bài ôn tiếp theo nhé.</Text>
          <Pressable accessibilityRole="button" onPress={() => router.push('/TrangChonChuDe')} style={pageStyles.action}>
            <Text style={pageStyles.actionText}>Luyện chủ đề mới</Text>
          </Pressable>
        </View>
      ) : pendingCards.map((card) => {
        return (
          <View key={card.id} style={pageStyles.card}>
            <Text style={pageStyles.cardTitle}>{card.kind === 'phrase' ? 'CÂU GỢI Ý · ' : 'ĐIỂM CẦN CẢI THIỆN · '}{card.topic.toUpperCase()}</Text>
            <Text style={pageStyles.bodyText}>{card.prompt}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void openCard(card)}
              style={pageStyles.action}>
              <Text style={pageStyles.actionText}>Xem gợi ý</Text>
            </Pressable>
          </View>
        );
      })}
      <Modal
        animationType="fade"
        onRequestClose={() => setSelectedCard(null)}
        transparent
        visible={selectedCard !== null}>
        <View style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#080D20B8' }}>
          <View style={{ backgroundColor: palette.background, borderColor: '#FFFFFF30', borderRadius: 20, borderWidth: 1, padding: 20 }}>
            <Text style={pageStyles.cardTitle}>
              {selectedCard?.kind === 'phrase' ? 'CÂU GỢI Ý · ' : 'ĐIỂM CẦN CẢI THIỆN · '}{selectedCard?.topic.toUpperCase()}
            </Text>
            <Text style={[pageStyles.bodyText, { marginTop: 8 }]}>{selectedCard?.prompt}</Text>
            <View style={{ backgroundColor: '#A8D65A18', borderRadius: 12, marginTop: 16, padding: 14 }}>
              <Text style={[pageStyles.bodyText, { color: palette.green }]}>{selectedCard?.answer}</Text>
            </View>
            <Pressable accessibilityRole="button" onPress={() => setSelectedCard(null)} style={pageStyles.action}>
              <Text style={pageStyles.actionText}>Đóng</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </PageFrame>
  );
}
