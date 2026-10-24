import { useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { PageFrame, pageStyles, palette } from '../components/PageFrame';

function SettingRow({ title, description, value, onChange }: { title: string; description: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <View style={[pageStyles.card, { alignItems: 'center', flexDirection: 'row', gap: 12 }]}>
      <View style={{ flex: 1 }}>
        <Text style={pageStyles.bodyText}>{title}</Text>
        <Text style={pageStyles.secondaryText}>{description}</Text>
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ false: '#59617A', true: palette.greenDark }} thumbColor={value ? palette.green : '#D9DEEC'} />
    </View>
  );
}

export default function SettingsScreen() {
  const [translation, setTranslation] = useState(true);
  const [reminders, setReminders] = useState(false);
  const [slowSpeech, setSlowSpeech] = useState(true);
  return (
    <PageFrame title="Cài đặt" subtitle="Điều chỉnh trải nghiệm luyện nói">
      <Text style={pageStyles.heading}>Tùy chọn luyện tập</Text>
      <Text style={pageStyles.paragraph}>Các lựa chọn này đang được lưu trong phiên hiện tại.</Text>
      <SettingRow title="Dịch song ngữ" description="Hiện nghĩa tiếng Việt dưới câu tiếng Anh" value={translation} onChange={setTranslation} />
      <SettingRow title="Đọc chậm câu mẫu" description="Giúp bạn nghe rõ từng từ" value={slowSpeech} onChange={setSlowSpeech} />
      <SettingRow title="Nhắc luyện tập hằng ngày" description="Nhắc bạn dành 15 phút luyện nói" value={reminders} onChange={setReminders} />
      <View style={pageStyles.card}>
        <Text style={pageStyles.cardTitle}>TRÌNH ĐỘ HIỆN TẠI</Text>
        <Text style={pageStyles.bodyText}>A2 · Sơ cấp</Text>
        <Text style={pageStyles.secondaryText}>Nội dung sẽ ưu tiên câu ngắn và tình huống giao tiếp quen thuộc.</Text>
      </View>
    </PageFrame>
  );
}

