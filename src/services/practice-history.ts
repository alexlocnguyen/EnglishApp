import AsyncStorage from '@react-native-async-storage/async-storage';
import { requestLearningApi } from './bff-auth';

const SESSIONS_KEY = 'elevate.practice.sessions.v1';
const REVIEWED_KEY = 'elevate.practice.reviewed.v1';

export type PracticeTurn = {
  transcript: string;
  translation?: string;
  reply?: string;
  suggestions?: string[];
  feedback?: string;
  pronunciationFeedback?: string;
  hasAudio?: boolean;
  audioBase64?: string;
};

export type PracticeFeedbackItem = {
  title: string;
  detail: string;
  score?: string;
};

export type PracticeSession = {
  id: string;
  topic: string;
  createdAt: string;
  durationSeconds: number;
  transcript: string;
  turns: PracticeTurn[];
  summary?: string;
  feedback?: PracticeFeedbackItem[];
  lessonId?: number;
};

export type ReviewCard = {
  id: string;
  sessionId: string;
  topic: string;
  title: string;
  prompt: string;
  answer: string;
  kind: 'feedback' | 'phrase';
  reviewed: boolean;
};

async function readSessions(): Promise<PracticeSession[]> {
  const raw = await AsyncStorage.getItem(SESSIONS_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as PracticeSession[] : [];
  } catch {
    return [];
  }
}

export async function getPracticeSessions(): Promise<PracticeSession[]> {
  const local = await readSessions();
  try {
    const remote = await requestLearningApi<PracticeSession[]>('/sessions');
    const merged = new Map(local.map((session) => [session.id, session]));
    for (const session of remote) merged.set(session.id, session);
    const sessions = [...merged.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100);
    await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions.slice(0, 50)));
    return sessions;
  } catch {
    return local.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

export async function savePracticeSession(session: PracticeSession): Promise<void> {
  const sessions = await readSessions();
  const localSession: PracticeSession = { ...session, turns: session.turns.map((turn) => {
    const safeTurn = { ...turn };
    delete safeTurn.audioBase64;
    return safeTurn;
  }) };
  const next = [localSession, ...sessions.filter((item) => item.id !== session.id)].slice(0, 50);
  await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify(next));
  await syncPracticeSession(session).catch(() => undefined);
}

async function syncPracticeSession(session: PracticeSession): Promise<void> {
  await requestLearningApi('/sessions', {
    method: 'POST',
    body: JSON.stringify({
      client_session_id: session.id,
      topic: session.topic,
      lesson_id: session.lessonId ?? null,
      created_at: session.createdAt,
      duration_seconds: session.durationSeconds,
      transcript: session.transcript,
      turns: session.turns,
      summary: session.summary ?? null,
      feedback: session.feedback ?? [],
    }),
  });
}

export async function updatePracticeSession(
  id: string,
  update: Partial<Pick<PracticeSession, 'transcript' | 'summary' | 'feedback'>>,
): Promise<void> {
  const sessions = await readSessions();
  const next = sessions.map((session) => session.id === id ? { ...session, ...update } : session);
  await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify(next));
  const updated = next.find((session) => session.id === id);
  if (updated) await syncPracticeSession(updated).catch(() => undefined);
}

export async function getReviewCards(): Promise<ReviewCard[]> {
  const [sessions, rawReviewed] = await Promise.all([
    readSessions(),
    AsyncStorage.getItem(REVIEWED_KEY),
  ]);
  let reviewedIds: string[] = [];
  try {
    const parsed: unknown = rawReviewed ? JSON.parse(rawReviewed) : [];
    if (Array.isArray(parsed)) reviewedIds = parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    reviewedIds = [];
  }
  const reviewed = new Set(reviewedIds);
  const cards: ReviewCard[] = [];
  const seen = new Set<string>();

  for (const session of sessions.sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    for (const [index, item] of (session.feedback ?? []).entries()) {
      const id = `${session.id}:feedback:${index}`;
      const dedupeKey = item.title.trim().toLocaleLowerCase();
      if (!dedupeKey || seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      cards.push({
        id,
        sessionId: session.id,
        topic: session.topic,
        title: item.title,
        prompt: `Bạn cần cải thiện điều gì về “${item.title}” trong chủ đề ${session.topic}?`,
        answer: item.detail,
        kind: 'feedback',
        reviewed: reviewed.has(id),
      });
    }

    for (const [turnIndex, turn] of session.turns.entries()) {
      for (const [suggestionIndex, suggestion] of (turn.suggestions ?? []).entries()) {
        const id = `${session.id}:phrase:${turnIndex}:${suggestionIndex}`;
        const dedupeKey = suggestion.trim().toLocaleLowerCase();
        if (!dedupeKey || seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        cards.push({
          id,
          sessionId: session.id,
          topic: session.topic,
          title: suggestion,
          prompt: `Hãy thử nói câu này trong một tình huống tương tự:`,
          answer: suggestion,
          kind: 'phrase',
          reviewed: reviewed.has(id),
        });
      }
    }
  }
  try {
    const remote = await requestLearningApi<ReviewCard[]>('/review-cards');
    const merged = new Map(cards.map((card) => [card.id, card]));
    for (const card of remote) merged.set(card.id, card);
    return [...merged.values()];
  } catch {
    return cards;
  }
}

export async function markReviewCardDone(id: string): Promise<void> {
  const raw = await AsyncStorage.getItem(REVIEWED_KEY);
  let ids: string[] = [];
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) ids = parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    ids = [];
  }
  if (!ids.includes(id)) ids.push(id);
  await AsyncStorage.setItem(REVIEWED_KEY, JSON.stringify(ids));
  if (/^\d+$/.test(id)) await requestLearningApi(`/review-cards/${id}/reviewed`, { method: 'POST' }).catch(() => undefined);
}
