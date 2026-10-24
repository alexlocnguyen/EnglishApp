export const EXPERIENCE_OPTIONS = [
  { label: 'Mới bắt đầu học', icon: '🌱' },
  { label: 'Đã học nhưng ít thực hành', icon: '📚' },
  { label: 'Có thể giao tiếp cơ bản', icon: '💬' },
];

export const DIFFICULTY_OPTIONS = [
  { label: 'Nghe không kịp khi người khác nói', icon: '👂' },
  { label: 'Khó tìm từ để diễn đạt', icon: '💭' },
  { label: 'Ngại nói vì sợ mắc lỗi', icon: '😅' },
  { label: 'Phát âm chưa rõ', icon: '🗣️' },
];

export const LEVEL_OPTIONS = [
  { label: 'Mới bắt đầu', icon: '🌱', detail: 'Làm quen với từ vựng và câu giao tiếp cơ bản.', rank: 1 },
  { label: 'Sơ cấp', icon: '🌿', detail: 'Hiểu các câu quen thuộc và trả lời ngắn.', rank: 2 },
  { label: 'Trung cấp', icon: '🌳', detail: 'Trao đổi về công việc và chủ đề hằng ngày.', rank: 3 },
  { label: 'Nâng cao', icon: '🚀', detail: 'Diễn đạt ý tưởng linh hoạt trong nhiều tình huống.', rank: 4 },
];

export const PURPOSE_OPTIONS = [
  { label: 'Giao tiếp hằng ngày', icon: '💬', detail: 'Tự tin trò chuyện trong cuộc sống' },
  { label: 'Công việc', icon: '💼', detail: 'Trao đổi hiệu quả với đồng nghiệp' },
  { label: 'Học tập', icon: '🎓', detail: 'Tiếp cận tài liệu và kiến thức mới' },
  { label: 'Du lịch', icon: '✈️', detail: 'Thoải mái khám phá thế giới' },
];

export const PURPOSE_OUTCOMES: Record<string, string> = {
  'Giao tiếp hằng ngày': 'Tự tin giao tiếp trong các tình huống hằng ngày',
  'Công việc': 'Tự tin sử dụng tiếng Anh trong công việc',
  'Học tập': 'Chủ động học tập bằng tiếng Anh',
  'Du lịch': 'Thoải mái giao tiếp trong những chuyến đi',
};

export const TIME_OPTIONS = [
  { label: '5 phút', title: 'Bắt đầu nhẹ nhàng', icon: '⏱️' },
  { label: '15 phút', title: 'Tiến bộ đều đặn', icon: '⚡' },
  { label: '30 phút', title: 'Tăng tốc mỗi ngày', icon: '🔥' },
];

export const ROADMAP = [
  { title: 'Bước 1 · Xây nền tảng', detail: 'Ôn từ vựng và mẫu câu thiết thực.', icon: '📘' },
  { title: 'Bước 2 · Luyện phản xạ', detail: 'Thực hành nghe và trả lời theo tình huống.', icon: '🎧' },
  { title: 'Bước 3 · Tự tin ứng dụng', detail: 'Dùng tiếng Anh để đạt mục tiêu của bạn.', icon: '🎯' },
];

export const TOTAL_SURVEY_STEPS = 5;
