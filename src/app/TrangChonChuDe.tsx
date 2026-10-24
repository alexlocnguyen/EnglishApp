import { StatusBar } from 'expo-status-bar';
import { Link, router } from 'expo-router';
import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const COLORS = {
  background: '#142052',
  card: '#A8D65A',
  cardSelected: '#8ABF26',
  white: '#FFFFFF',
  mutedWhite: '#D9DEEC',
  navyText: '#17234E',
};

const TOPICS = [
  { id: 'introduction', vi: 'Giới thiệu bản thân', en: 'Introduce yourself' },
  { id: 'daily-routine', vi: 'Thói quen hằng ngày', en: 'Daily routine' },
  { id: 'coworkers', vi: 'Chào hỏi đồng nghiệp', en: 'Greet a coworker' },
  { id: 'job', vi: 'Nói về công việc', en: 'Talk about your job' },
  { id: 'tasks', vi: 'Mô tả công việc', en: 'Describe your tasks' },
  { id: 'update', vi: 'Cập nhật tiến độ', en: 'Give a work update' },
  { id: 'help', vi: 'Nhờ giúp đỡ', en: 'Ask for help' },
  { id: 'repeat', vi: 'Nhờ nhắc lại', en: 'Ask someone to repeat' },
  { id: 'meeting', vi: 'Sắp xếp cuộc họp', en: 'Schedule a meeting' },
  { id: 'custom', vi: 'Tự chọn chủ đề', en: 'Choose your own topic' },
];

export default function TopicSelectionScreen() {
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const selectedTopic = TOPICS.find((topic) => topic.id === selectedTopicId);

  function handleContinue() {
    if (!selectedTopic) return;
    router.push({
      pathname: '/TrangLuyenNoi',
      params: { topic: selectedTopic.vi, prompt: selectedTopic.en },
    });
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />

      <View style={styles.page}>
        <View style={styles.header}>
          <Link href="/" asChild>
            <Pressable accessibilityRole="button" accessibilityLabel="Quay lại" style={styles.backButton}>
              <Text style={styles.backArrow}>‹</Text>
            </Pressable>
          </Link>

          <View style={styles.headerTitles}>
            <Text style={styles.brand}>Elevate</Text>
            <Text style={styles.englishHeading}>Choose a topic</Text>
          </View>
        </View>

        <View style={styles.intro}>
          <Text style={styles.title}>Chọn chủ đề</Text>
          <Text style={styles.description}>
            Chọn một tình huống để luyện nói trong 15 phút hôm nay.
          </Text>
        </View>

        <ScrollView
          style={styles.topicList}
          contentContainerStyle={styles.topicListContent}
          showsVerticalScrollIndicator={false}>
          {TOPICS.map((topic, index) => {
            const isSelected = topic.id === selectedTopicId;

            return (
              <Pressable
                key={topic.id}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                onPress={() => setSelectedTopicId(topic.id)}
                style={({ pressed }) => [
                  styles.topicCard,
                  { backgroundColor: isSelected ? COLORS.cardSelected : COLORS.card },
                  isSelected && styles.topicCardSelected,
                  pressed && styles.topicCardPressed,
                ]}>
                <Text style={styles.topicNumber}>{String(index + 1).padStart(2, '0')}</Text>
                <View style={styles.topicCopy}>
                  <Text style={styles.topicVietnamese}>{topic.vi}</Text>
                  <Text style={styles.topicEnglish}>{topic.en}</Text>
                </View>
                <Text style={styles.topicChevron}>›</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.footer}>
          <Text style={styles.selectionHint}>
            {selectedTopic ? `Đã chọn: ${selectedTopic.vi}` : 'Chọn một chủ đề để tiếp tục'}
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={!selectedTopic}
            onPress={handleContinue}
            style={({ pressed }) => [
              styles.continueButton,
              !selectedTopic && styles.continueButtonDisabled,
              pressed && selectedTopic && styles.continueButtonPressed,
            ]}>
            <Text style={styles.continueButtonText}>Bắt đầu luyện nói</Text>
            <Text style={styles.continueArrow}>→</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: COLORS.background,
    flex: 1,
  },
  page: {
    alignSelf: 'center',
    flex: 1,
    maxWidth: 480,
    paddingHorizontal: 22,
    width: '100%',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    paddingTop: 10,
  },
  backButton: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    width: 34,
  },
  backArrow: {
    color: COLORS.white,
    fontFamily: 'serif',
    fontSize: 38,
    lineHeight: 42,
  },
  headerTitles: {
    alignItems: 'flex-start',
  },
  brand: {
    color: COLORS.white,
    fontFamily: 'serif',
    fontSize: 31,
    fontStyle: 'italic',
    letterSpacing: -2,
  },
  englishHeading: {
    color: COLORS.mutedWhite,
    fontSize: 12,
    letterSpacing: 0.5,
    marginTop: 1,
  },
  intro: {
    marginBottom: 18,
    marginTop: 20,
  },
  title: {
    color: COLORS.white,
    fontFamily: 'serif',
    fontSize: 25,
    fontWeight: '700',
  },
  description: {
    color: COLORS.mutedWhite,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 5,
  },
  topicList: {
    flex: 1,
  },
  topicListContent: {
    gap: 11,
    paddingBottom: 16,
    paddingTop: 2,
  },
  topicCard: {
    alignItems: 'center',
    borderColor: 'transparent',
    borderRadius: 10,
    borderWidth: 2,
    flexDirection: 'row',
    minHeight: 66,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  topicCardSelected: {
    borderColor: COLORS.white,
  },
  topicCardPressed: {
    opacity: 0.82,
  },
  topicNumber: {
    color: COLORS.navyText,
    fontSize: 12,
    fontWeight: '700',
    marginRight: 13,
    opacity: 0.7,
  },
  topicCopy: {
    flex: 1,
  },
  topicVietnamese: {
    color: COLORS.navyText,
    fontFamily: 'serif',
    fontSize: 16,
    fontWeight: '700',
  },
  topicEnglish: {
    color: COLORS.navyText,
    fontSize: 12,
    marginTop: 2,
    opacity: 0.78,
  },
  topicChevron: {
    color: COLORS.navyText,
    fontSize: 26,
    lineHeight: 28,
    marginLeft: 8,
  },
  footer: {
    backgroundColor: COLORS.background,
    paddingBottom: 10,
    paddingTop: 10,
  },
  selectionHint: {
    color: COLORS.mutedWhite,
    fontSize: 12,
    marginBottom: 8,
    minHeight: 16,
  },
  continueButton: {
    alignItems: 'center',
    backgroundColor: COLORS.cardSelected,
    borderRadius: 14,
    flexDirection: 'row',
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: 20,
  },
  continueButtonDisabled: {
    opacity: 0.48,
  },
  continueButtonPressed: {
    opacity: 0.82,
  },
  continueButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '700',
  },
  continueArrow: {
    color: COLORS.white,
    fontSize: 22,
    marginLeft: 10,
  },
});
