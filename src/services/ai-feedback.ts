import { requestJson } from './api-errors';

export type AiFeedbackItem = {
  title: string;
  score?: string;
  detail: string;
};

export type AiSpeakingFeedback = {
  summary?: string;
  feedback: AiFeedbackItem[];
};

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL?.trim().replace(/\/$/, '');
const FEEDBACK_PATH = process.env.EXPO_PUBLIC_AI_FEEDBACK_PATH?.trim() || '/api/ai/speaking-feedback';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseFeedback(payload: unknown): AiSpeakingFeedback {
  const data = isRecord(payload) && isRecord(payload.data) ? payload.data : payload;
  if (!isRecord(data)) throw new Error('Dữ liệu phản hồi từ AI không đúng định dạng.');

  const rawItems = data.feedback ?? data.items ?? data.criteria;
  const feedback = Array.isArray(rawItems)
    ? rawItems.flatMap((item): AiFeedbackItem[] => {
        if (!isRecord(item)) return [];
        const title = item.title ?? item.category ?? item.name;
        const detail = item.detail ?? item.feedback ?? item.suggestion ?? item.comment;
        if (typeof title !== 'string' || typeof detail !== 'string') return [];
        const score = item.score ?? item.rating;
        return [{ title, detail, ...(typeof score === 'string' || typeof score === 'number' ? { score: String(score) } : {}) }];
      })
    : [];

  if (feedback.length === 0) {
    throw new Error('AI chưa trả về nội dung nhận xét có thể sử dụng.');
  }

  const summary = data.summary ?? data.overall_feedback ?? data.overallFeedback;
  return {
    feedback,
    ...(typeof summary === 'string' ? { summary } : {}),
  };
}

/** Request structured grammar and improvement feedback for a completed practice transcript. */
export async function getAiSpeakingFeedback(topic: string, transcript: string): Promise<AiSpeakingFeedback> {
  if (!topic.trim() || !transcript.trim()) {
    throw new Error('Cần có chủ đề và nội dung buổi luyện tập để phân tích.');
  }
  if (!API_BASE_URL) {
    throw new Error('Chưa cấu hình EXPO_PUBLIC_API_URL để kết nối backend AI.');
  }

  const payload = await requestJson<unknown>(
    `${API_BASE_URL}${FEEDBACK_PATH.startsWith('/') ? FEEDBACK_PATH : `/${FEEDBACK_PATH}`}`,
    {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, transcript }),
    },
    {
      networkMessage: 'Không thể kết nối backend. Hãy kiểm tra mạng và địa chỉ API.',
      httpErrorMessage: 'Backend AI trả về lỗi',
      invalidResponseMessage: 'Backend AI trả về dữ liệu không đúng định dạng.',
    },
  );

  return parseFeedback(payload);
}
