import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { PageFrame, pageStyles, palette } from '../components/PageFrame';
import { getNotifications, markNotificationRead } from '../services/learning-api';

type AppNotification = { notification_id: number; title: string; message: string; is_read: boolean; created_at: string };

export default function NotificationsScreen() {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    setLoading(true);
    setError('');
    void getNotifications().then(setItems).catch(() => setError('Đăng nhập và kết nối PostgreSQL để tải thông báo của bạn.')).finally(() => setLoading(false));
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function markRead(id: number) {
    try { await markNotificationRead(id); setItems((current) => current.map((item) => item.notification_id === id ? { ...item, is_read: true } : item)); }
    catch { setError('Chưa cập nhật được trạng thái thông báo.'); }
  }

  return (
    <PageFrame title="Thông báo học tập" subtitle="Nhắc nhở và hoạt động gần đây">
      <Text style={pageStyles.heading}>Hoạt động của bạn</Text>
      <Text style={pageStyles.paragraph}>Thông báo được tạo khi bạn hoàn thành bài học và lưu trong tài khoản.</Text>
      {loading ? <View style={[pageStyles.card, { alignItems: 'center' }]}><ActivityIndicator color={palette.green} /></View> : null}
      {error ? <View accessibilityRole="alert" style={pageStyles.card}><Text style={pageStyles.bodyText}>{error}</Text><Pressable onPress={load} style={pageStyles.action}><Text style={pageStyles.actionText}>Tải lại</Text></Pressable></View> : null}
      {!loading && !error && items.length === 0 ? <View style={pageStyles.card}><Text style={pageStyles.bodyText}>Chưa có thông báo. Hoàn thành một bài học để ghi nhận hoạt động đầu tiên.</Text></View> : null}
      {items.map((item) => (
        <Pressable key={item.notification_id} onPress={() => !item.is_read && void markRead(item.notification_id)} style={[pageStyles.card, !item.is_read && { borderColor: palette.green }]}>
          <Text style={pageStyles.cardTitle}>{item.is_read ? 'ĐÃ ĐỌC' : 'MỚI'} · {new Date(item.created_at).toLocaleString('vi-VN')}</Text>
          <Text style={pageStyles.bodyText}>{item.title}</Text>
          <Text style={pageStyles.secondaryText}>{item.message}</Text>
        </Pressable>
      ))}
    </PageFrame>
  );
}
