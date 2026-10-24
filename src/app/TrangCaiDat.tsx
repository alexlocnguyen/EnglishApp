import { useEffect, useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { PageFrame, pageStyles, palette } from '../components/PageFrame';
import { loadReminderSettings, updateReminderSettings } from '../services/learning-api';

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
  const [reminderMessage, setReminderMessage] = useState('');

  useEffect(() => {
    void loadReminderSettings().then((value) => setReminders(value.enabled));
  }, []);

  async function changeReminders(value: boolean) {
    setReminderMessage('');
    try {
      const result = await updateReminderSettings({ enabled: value, local_time: '19:00', weekdays: [0, 1, 2, 3, 4, 5, 6] });
      setReminders(value);
      setReminderMessage(value
        ? (result.scheduled ? 'Đã đặt nhắc học hằng ngày lúc 19:00 trên thiết bị.' : 'Thiết bị này chưa hỗ trợ đặt thông báo cục bộ.')
        : 'Đã tắt nhắc học.');
    } catch (error) {
      setReminderMessage(error instanceof Error && error.message === 'NOTIFICATION_PERMISSION_DENIED'
        ? 'Bạn chưa cấp quyền thông báo. Hãy bật quyền trong cài đặt thiết bị rồi thử lại.'
        : 'Chưa lưu được cài đặt nhắc học. Hãy thử lại.');
    }
  }

  return (
    <PageFrame title="Cài đặt" subtitle="Điều chỉnh trải nghiệm luyện nói">
      <Text style={pageStyles.heading}>Tùy chọn luyện tập</Text>
      <Text style={pageStyles.paragraph}>Cài đặt nhắc học được lưu trên thiết bị và đồng bộ với tài khoản khi backend sẵn sàng.</Text>
      <SettingRow title="Dịch song ngữ" description="Hiện nghĩa tiếng Việt dưới câu tiếng Anh" value={translation} onChange={setTranslation} />
      <SettingRow title="Đọc chậm câu mẫu" description="Giúp bạn nghe rõ từng từ" value={slowSpeech} onChange={setSlowSpeech} />
      <SettingRow title="Nhắc luyện tập hằng ngày" description="Nhắc bạn dành 15 phút luyện nói lúc 19:00" value={reminders} onChange={(value) => void changeReminders(value)} />
      {reminderMessage ? <Text accessibilityRole="alert" style={[pageStyles.secondaryText, { marginHorizontal: 4 }]}>{reminderMessage}</Text> : null}
      <View style={pageStyles.card}>
        <Text style={pageStyles.cardTitle}>TRÌNH ĐỘ HIỆN TẠI</Text>
        <Text style={pageStyles.bodyText}>A2 · Sơ cấp</Text>
        <Text style={pageStyles.secondaryText}>Nội dung sẽ ưu tiên câu ngắn và tình huống giao tiếp quen thuộc.</Text>
      </View>
    </PageFrame>
  );
}

