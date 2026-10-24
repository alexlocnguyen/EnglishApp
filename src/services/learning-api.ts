import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { requestLearningApi } from './bff-auth';

const REMINDER_KEY = 'elevate.reminder.settings.v1';
const REMINDER_TAG = 'elevate-daily-practice';

export type Lesson = { lesson_id: number; topic_id: number; lesson_title: string; content: string; objectives: string; sort_order: number };
export type Topic = { topic_id: number; topic_name: string; level: string; description: string };
export type CatalogVocabulary = { vocabulary_id: number; lesson_id: number; word: string; definition: string; example: string; audio_pronunciation_url?: string | null };
export type LearningCatalog = { topics: Topic[]; lessons: Lesson[]; vocabulary: CatalogVocabulary[] };
export type LearningProgress = { session_count: number; total_practice_minutes: number; last_active_at: string | null; sessions_last_7_days: number; completed_lesson_count: number; total_lesson_count: number; streak_days: number };
export type ReminderSettings = { enabled: boolean; local_time: string; weekdays: number[] };

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldPlaySound: false, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }),
});

export async function getLearningCatalog(): Promise<LearningCatalog> {
  return requestLearningApi<LearningCatalog>('/catalog');
}

export async function getLearningProgress(): Promise<LearningProgress> {
  return requestLearningApi<LearningProgress>('/progress');
}

export async function completeLesson(lessonId: number): Promise<void> {
  await requestLearningApi(`/lessons/${lessonId}/complete`, { method: 'POST' });
}

export async function getLessonProgress(): Promise<{ lesson_id: number; status: string }[]> {
  return requestLearningApi<{ lesson_id: number; status: string }[]>('/lesson-progress');
}

export async function getCurrentLearningUser(): Promise<{ email: string; display_name: string; roles: string[] }> {
  return requestLearningApi('/me');
}

export type AdminUser = { user_id: number; email: string; display_name: string; roles: string[] };
export async function getAdminUsers(): Promise<AdminUser[]> { return requestLearningApi('/admin/users'); }
export async function setUserRole(userId: number, role: 'learner' | 'admin'): Promise<void> {
  await requestLearningApi(`/admin/users/${userId}/role/${role}`, { method: 'PUT' });
}
export async function createTopic(input: { topic_name: string; description: string; level: string }): Promise<void> {
  await requestLearningApi('/admin/topics', { method: 'POST', body: JSON.stringify(input) });
}
export async function createLesson(input: { topic_id: number; lesson_title: string; content: string; objectives: string }): Promise<void> {
  await requestLearningApi('/admin/lessons', { method: 'POST', body: JSON.stringify(input) });
}
export async function createCatalogVocabulary(input: { lesson_id: number; word: string; definition: string; example: string }): Promise<void> {
  await requestLearningApi('/admin/vocabulary', { method: 'POST', body: JSON.stringify(input) });
}

export type SavedVocabulary = { user_vocabulary_id: number; vocabulary_id: number; word: string; definition: string; example: string; status: 'learning' | 'known' };
export async function getSavedVocabulary(): Promise<SavedVocabulary[]> {
  const raw = await AsyncStorage.getItem('elevate.saved-vocabulary.v1');
  let local: SavedVocabulary[] = [];
  try { local = raw ? JSON.parse(raw) as SavedVocabulary[] : []; } catch { local = []; }
  try {
    const remote = await requestLearningApi<SavedVocabulary[]>('/vocabulary');
    const merged = new Map(local.map((item) => [item.word.toLocaleLowerCase(), item]));
    for (const item of remote) merged.set(item.word.toLocaleLowerCase(), item);
    local = [...merged.values()];
    await AsyncStorage.setItem('elevate.saved-vocabulary.v1', JSON.stringify(local));
  } catch { /* keep the on-device collection available offline */ }
  return local;
}

export async function saveVocabulary(item: { word: string; definition?: string; example?: string; lesson_id?: number | null }): Promise<void> {
  const current = await getSavedVocabulary();
  const existing = current.find((saved) => saved.word.toLocaleLowerCase() === item.word.toLocaleLowerCase());
  const localItem: SavedVocabulary = {
    user_vocabulary_id: existing?.user_vocabulary_id ?? -Date.now(),
    vocabulary_id: existing?.vocabulary_id ?? -Date.now(),
    word: item.word,
    definition: item.definition ?? '',
    example: item.example ?? '',
    status: 'learning',
  };
  await AsyncStorage.setItem('elevate.saved-vocabulary.v1', JSON.stringify([localItem, ...current.filter((saved) => saved.word.toLocaleLowerCase() !== item.word.toLocaleLowerCase())]));
  try {
    await requestLearningApi('/vocabulary', { method: 'POST', body: JSON.stringify(item) });
    const synced = await requestLearningApi<SavedVocabulary[]>('/vocabulary');
    await AsyncStorage.setItem('elevate.saved-vocabulary.v1', JSON.stringify(synced));
  } catch { /* locally saved and retried when the list is loaded online */ }
}

export async function markVocabularyKnown(id: number): Promise<void> {
  const current = await getSavedVocabulary();
  const next = current.map((item) => item.user_vocabulary_id === id ? { ...item, status: 'known' as const } : item);
  await AsyncStorage.setItem('elevate.saved-vocabulary.v1', JSON.stringify(next));
  if (id > 0) await requestLearningApi(`/vocabulary/${id}/reviewed`, { method: 'POST' }).catch(() => undefined);
}

export async function uploadPracticeRecording(sessionId: string, uri: string): Promise<void> {
  const form = new FormData();
  if (Platform.OS === 'web') {
    const audio = await fetch(uri).then((response) => response.blob());
    form.append('file', audio, 'practice-recording.webm');
  } else {
    form.append('file', { uri, name: 'practice-recording.m4a', type: 'audio/mp4' } as unknown as Blob);
  }
  await requestLearningApi(`/sessions/${encodeURIComponent(sessionId)}/recordings`, { method: 'POST', body: form });
}

export async function savePronunciationFeedback(sessionId: string, detail: string, score?: number): Promise<void> {
  await requestLearningApi(`/sessions/${encodeURIComponent(sessionId)}/pronunciation-feedback`, {
    method: 'POST', body: JSON.stringify({ pronunciation_score: score ?? null, detailed_feedback: detail }),
  });
}

export async function loadReminderSettings(): Promise<ReminderSettings> {
  try {
    const saved = await requestLearningApi<ReminderSettings>('/reminders');
    await AsyncStorage.setItem(REMINDER_KEY, JSON.stringify(saved));
    return saved;
  } catch {
    const raw = await AsyncStorage.getItem(REMINDER_KEY);
    if (raw) {
      try { return JSON.parse(raw) as ReminderSettings; } catch { /* use defaults */ }
    }
    return { enabled: false, local_time: '19:00', weekdays: [0, 1, 2, 3, 4, 5, 6] };
  }
}

export async function updateReminderSettings(settings: ReminderSettings): Promise<{ settings: ReminderSettings; scheduled: boolean }> {
  let scheduled = false;
  if (Platform.OS !== 'web') {
    const existing = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(existing.filter((item) => item.content.data?.tag === REMINDER_TAG)
      .map((item) => Notifications.cancelScheduledNotificationAsync(item.identifier)));
    if (settings.enabled) {
      await Notifications.setNotificationChannelAsync('practice-reminders', {
        name: 'Nhắc luyện tập', importance: Notifications.AndroidImportance.DEFAULT,
      });
      let permission = await Notifications.getPermissionsAsync();
      if (!permission.granted) permission = await Notifications.requestPermissionsAsync();
      if (!permission.granted) throw new Error('NOTIFICATION_PERMISSION_DENIED');
      const [hour, minute] = settings.local_time.split(':').map(Number);
      await Promise.all(settings.weekdays.map((day) => Notifications.scheduleNotificationAsync({
        content: { title: 'Đến giờ luyện nói rồi!', body: 'Dành 15 phút luyện tiếng Anh hôm nay nhé.', data: { tag: REMINDER_TAG } },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday: day + 1, hour, minute, channelId: 'practice-reminders' },
      })));
      scheduled = settings.weekdays.length > 0;
    }
  }
  await AsyncStorage.setItem(REMINDER_KEY, JSON.stringify(settings));
  await requestLearningApi('/reminders', { method: 'PUT', body: JSON.stringify(settings) }).catch(() => undefined);
  return { settings, scheduled };
}

export async function getNotifications() {
  return requestLearningApi<{ notification_id: number; title: string; message: string; is_read: boolean; created_at: string }[]>('/notifications');
}

export async function markNotificationRead(id: number) {
  await requestLearningApi(`/notifications/${id}/read`, { method: 'POST' });
}
