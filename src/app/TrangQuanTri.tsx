import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { PageFrame, pageStyles, palette } from '../components/PageFrame';
import { createCatalogVocabulary, createLesson, createTopic, getAdminUsers, getCurrentLearningUser, getLearningCatalog, setUserRole, type AdminUser, type LearningCatalog } from '../services/learning-api';

const inputStyle = { backgroundColor: '#FFFFFF12', borderColor: '#FFFFFF30', borderRadius: 10, borderWidth: 1, color: '#FFF', marginBottom: 8, paddingHorizontal: 12, paddingVertical: 10 } as const;

export default function AdminScreen() {
  const [catalog, setCatalog] = useState<LearningCatalog | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [topicName, setTopicName] = useState('');
  const [lessonTitle, setLessonTitle] = useState('');
  const [word, setWord] = useState('');
  const [definition, setDefinition] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const user = await getCurrentLearningUser();
      const isAdmin = user.roles.includes('admin');
      setAllowed(isAdmin);
      if (isAdmin) {
        const [nextCatalog, nextUsers] = await Promise.all([getLearningCatalog(), getAdminUsers()]);
        setCatalog(nextCatalog);
        setUsers(nextUsers);
      }
      setMessage(isAdmin ? '' : 'Tài khoản hiện tại chưa được cấp quyền quản trị.');
    } catch {
      setMessage('Không tải được dữ liệu quản trị. Hãy đăng nhập và kiểm tra cấu hình backend/database.');
    } finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function addTopic() {
    if (!topicName.trim()) return;
    setBusy(true);
    try { await createTopic({ topic_name: topicName.trim(), description: 'Chủ đề do quản trị viên tạo', level: 'A2' }); setTopicName(''); setMessage('Đã thêm chủ đề.'); await load(); }
    catch { setMessage('Không thêm được chủ đề. Tên có thể đã tồn tại hoặc tài khoản thiếu quyền.'); }
    finally { setBusy(false); }
  }

  async function addLesson() {
    const topic = catalog?.topics[0];
    if (!topic || !lessonTitle.trim()) { setMessage('Hãy thêm chủ đề và nhập tên bài học trước.'); return; }
    setBusy(true);
    try { await createLesson({ topic_id: topic.topic_id, lesson_title: lessonTitle.trim(), content: '', objectives: 'Luyện giao tiếp theo chủ đề.' }); setLessonTitle(''); setMessage('Đã thêm bài học vào chủ đề đầu tiên.'); await load(); }
    catch { setMessage('Không thêm được bài học. Hãy tải lại dữ liệu và thử lại.'); }
    finally { setBusy(false); }
  }

  async function addWord() {
    const lesson = catalog?.lessons[0];
    if (!lesson || !word.trim()) { setMessage('Hãy thêm bài học và nhập từ vựng trước.'); return; }
    setBusy(true);
    try { await createCatalogVocabulary({ lesson_id: lesson.lesson_id, word: word.trim(), definition: definition.trim(), example: '' }); setWord(''); setDefinition(''); setMessage('Đã thêm từ vào bài học đầu tiên.'); await load(); }
    catch { setMessage('Không thêm được từ vựng. Hãy kiểm tra dữ liệu và thử lại.'); }
    finally { setBusy(false); }
  }

  async function changeRole(user: AdminUser, makeAdmin: boolean) {
    setBusy(true);
    try { await setUserRole(user.user_id, makeAdmin ? 'admin' : 'learner'); await load(); }
    catch { setMessage('Không cập nhật được vai trò.'); }
    finally { setBusy(false); }
  }

  return (
    <PageFrame title="Quản trị nội dung" subtitle="Quản lý chương trình học và vai trò">
      <View style={{ gap: 10, paddingBottom: 20 }}>
        {loading ? <View style={pageStyles.card}><ActivityIndicator color={palette.green} /></View> : null}
        {!loading && !allowed ? <View style={pageStyles.card}><Text style={pageStyles.bodyText}>{message}</Text><Text style={pageStyles.secondaryText}>Quản trị viên được cấu hình bằng INITIAL_ADMIN_EMAILS trong backend/.env.</Text></View> : null}
        {allowed ? <>
          <View style={pageStyles.card}>
            <Text style={pageStyles.cardTitle}>THÊM CHỦ ĐỀ</Text>
            <TextInput placeholder="Tên chủ đề" placeholderTextColor="#AAB1C8" value={topicName} onChangeText={setTopicName} style={inputStyle} />
            <Pressable disabled={busy} onPress={() => void addTopic()} style={pageStyles.action}><Text style={pageStyles.actionText}>Tạo chủ đề</Text></Pressable>
          </View>
          <View style={pageStyles.card}>
            <Text style={pageStyles.cardTitle}>THÊM BÀI HỌC</Text>
            <Text style={pageStyles.secondaryText}>Bài học mới sẽ thuộc chủ đề đầu tiên trong danh sách.</Text>
            <TextInput placeholder="Tên bài học" placeholderTextColor="#AAB1C8" value={lessonTitle} onChangeText={setLessonTitle} style={inputStyle} />
            <Pressable disabled={busy} onPress={() => void addLesson()} style={pageStyles.action}><Text style={pageStyles.actionText}>Tạo bài học</Text></Pressable>
          </View>
          <View style={pageStyles.card}>
            <Text style={pageStyles.cardTitle}>THÊM TỪ VỰNG</Text>
            <Text style={pageStyles.secondaryText}>Từ mới sẽ thuộc bài học đầu tiên trong danh sách.</Text>
            <TextInput placeholder="Từ hoặc cụm từ" placeholderTextColor="#AAB1C8" value={word} onChangeText={setWord} style={inputStyle} />
            <TextInput placeholder="Nghĩa / định nghĩa" placeholderTextColor="#AAB1C8" value={definition} onChangeText={setDefinition} style={inputStyle} />
            <Pressable disabled={busy} onPress={() => void addWord()} style={pageStyles.action}><Text style={pageStyles.actionText}>Lưu từ vựng</Text></Pressable>
          </View>
          <View style={pageStyles.card}>
            <Text style={pageStyles.cardTitle}>VAI TRÒ NGƯỜI DÙNG</Text>
            {users.map((user) => {
              const isAdmin = user.roles.includes('admin');
              return <View key={user.user_id} style={{ borderTopColor: '#FFFFFF20', borderTopWidth: 1, marginTop: 10, paddingTop: 10 }}>
                <Text style={pageStyles.bodyText}>{user.display_name || user.email}</Text>
                <Text style={pageStyles.secondaryText}>{user.email} · {user.roles.join(', ') || 'chưa có vai trò'}</Text>
                <Pressable disabled={busy} onPress={() => void changeRole(user, !isAdmin)} style={[pageStyles.action, { marginTop: 8 }]}>
                  <Text style={pageStyles.actionText}>{isAdmin ? 'Hạ xuống người học' : 'Cấp quyền quản trị'}</Text>
                </Pressable>
              </View>;
            })}
          </View>
        </> : null}
        {message && allowed ? <Text accessibilityRole="alert" style={pageStyles.secondaryText}>{message}</Text> : null}
      </View>
    </PageFrame>
  );
}
