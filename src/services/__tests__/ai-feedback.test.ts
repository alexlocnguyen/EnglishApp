function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('AI speaking feedback service', () => {
  const fetchMock: jest.MockedFunction<typeof fetch> = jest.fn();

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.EXPO_PUBLIC_API_URL = 'http://localhost:8000';
    globalThis.fetch = fetchMock;
  });

  function loadService() {
    return jest.requireActual<typeof import('../ai-feedback')>('../ai-feedback');
  }

  test('normalizes a successful backend feedback response', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      summary: 'Good progress.',
      feedback: [{ title: 'Grammar', detail: 'Use the past tense.', score: 85 }],
    }));
    const { getAiSpeakingFeedback } = loadService();

    await expect(getAiSpeakingFeedback('Interview', 'I work yesterday.')).resolves.toEqual({
      summary: 'Good progress.',
      feedback: [{ title: 'Grammar', detail: 'Use the past tense.', score: '85' }],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/api/ai/speaking-feedback',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('rejects malformed feedback instead of returning an empty result', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ summary: 'No criteria.' }));
    const { getAiSpeakingFeedback } = loadService();

    await expect(getAiSpeakingFeedback('Interview', 'I work yesterday.'))
      .rejects.toThrow('AI chưa trả về nội dung nhận xét có thể sử dụng.');
  });

  test('shows the backend validation detail on request failure', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ detail: 'Transcript is required.' }, 422));
    const { getAiSpeakingFeedback } = loadService();

    await expect(getAiSpeakingFeedback('Interview', 'I work yesterday.'))
      .rejects.toThrow('Transcript is required.');
  });

  test('rejects blank input before making a network request', async () => {
    const { getAiSpeakingFeedback } = loadService();

    await expect(getAiSpeakingFeedback('Interview', '  ')).rejects.toThrow('Cần có chủ đề');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
