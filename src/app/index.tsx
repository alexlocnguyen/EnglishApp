import { StatusBar } from 'expo-status-bar';
import { router, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image } from 'expo-image';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LoginOnboardingFlow, type LoginProvider, type SurveyAnswers } from '@/components/LoginOnboardingFlow';
import { authService } from '@/services/auth-service';
import type { AuthUser } from '@/services/auth-provider';

const COLORS = {
  background: '#142052',
  primary: '#8ABF26',
  secondary: '#A8D65A',
  white: '#FFFFFF',
  mutedWhite: '#E8EAF2',
};

type MenuItem = {
  label: string;
  width: `${number}%`;
  color: string;
  href?: Href;
};

const MENU_ITEMS: MenuItem[] = [
  {
    label: 'Luyện tập',
    width: '100%',
    color: COLORS.primary,
    href: '/TrangChonChuDe' as Href,
  },
  { label: 'Lịch sử', width: '88%', color: COLORS.secondary, href: '/TrangLichSu' as Href },
  { label: 'Chương trình học', width: '82%', color: COLORS.secondary, href: '/TrangBaiHoc' as Href },
  { label: 'Ôn tập', width: '76%', color: COLORS.secondary, href: '/TrangTuVung' as Href },
  { label: 'Quản trị', width: '70%', color: COLORS.secondary, href: '/TrangQuanTri' as Href },
  { label: 'Cài đặt', width: '64%', color: COLORS.secondary, href: '/TrangCaiDat' as Href },
];

function SlantedMenuButton({
  label,
  width,
  color,
  href,
}: MenuItem) {
  const content = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={href ? () => router.push(href) : undefined}
      style={({ pressed }) => [
        styles.menuButton,
        { width, opacity: pressed ? 0.82 : 1 },
      ]}>
      <View style={[styles.buttonBody, { backgroundColor: color }]} />
      <View style={[styles.buttonTip, { borderTopColor: color }]} />
      <Text style={styles.menuButtonText}>{label}</Text>
    </Pressable>
  );
  return content;
}

export default function HomeScreen() {
  const [infoVisible, setInfoVisible] = useState(false);
  const [authFlowVisible, setAuthFlowVisible] = useState(false);
  const [profileView, setProfileView] = useState<'overview' | 'personal' | null>(null);
  const [profileAnswers, setProfileAnswers] = useState<SurveyAnswers>({});
  const [signedInUser, setSignedInUser] = useState<AuthUser | null>(null);

  useEffect(() => authService.observeUser(setSignedInUser), []);

  function markAuthenticated(_provider: LoginProvider, answers: SurveyAnswers) {
    setProfileAnswers(answers);
  }

  function finishSignIn(provider: LoginProvider, answers: SurveyAnswers) {
    markAuthenticated(provider, answers);
    setAuthFlowVisible(false);
  }

  function finishAndStartLesson(provider: LoginProvider, answers: SurveyAnswers) {
    finishSignIn(provider, answers);
    router.push('/TrangChonChuDe');
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>
        <View style={styles.page}>
          <View style={styles.topBar}>
            <Text accessibilityLabel="Elevate" style={styles.brand}>Elevate</Text>
            {signedInUser ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Mở hồ sơ người dùng"
                onPress={() => setProfileView('overview')}
                style={({ pressed }) => [styles.avatarButton, pressed && styles.footerPressed]}>
                <Text style={styles.avatarInitial}>{(signedInUser.displayName || signedInUser.email || 'E').charAt(0).toUpperCase()}</Text>
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                onPress={() => setAuthFlowVisible(true)}
                style={({ pressed }) => [styles.loginButton, pressed && styles.footerPressed]}>
                <Text style={styles.loginButtonText}>Đăng nhập</Text>
              </Pressable>
            )}
          </View>

          <View style={styles.hero}>
            <Text style={styles.greeting}>Chào bạn!</Text>
            <Text style={styles.tagline}>
              Cùng mình luyện tập ngay hôm nay!
            </Text>
            <Text style={styles.dailyGoal}>15 phút mỗi ngày</Text>
          </View>

          <View style={styles.menu}>
            {MENU_ITEMS.map((item) => (
              <SlantedMenuButton key={item.label} {...item} />
            ))}
          </View>

          <View style={styles.homeFooter}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Thông tin về ElevateEnglish"
              onPress={() => setInfoVisible(true)}
              style={({ pressed }) => [styles.infoButton, pressed && styles.footerPressed]}>
              <Text style={styles.infoIcon}>i</Text>
            </Pressable>

            <View accessibilityLabel="Linh vật Elevate" style={styles.mascot}>
              <Image
                contentFit="contain"
                source={require('@/assets/images/elevate-mascot.png')}
                style={styles.mascotImage}
              />
            </View>
          </View>
        </View>
      </ScrollView>

      <Modal
        animationType="fade"
        onRequestClose={() => setInfoVisible(false)}
        transparent
        visible={infoVisible}>
        <View style={styles.infoOverlay}>
          <View accessibilityRole="alert" style={styles.infoCard}>
            <Text style={styles.infoTitle}>Về ElevateEnglish</Text>
            <Text style={styles.infoDescription}>
              Ứng dụng giúp bạn luyện nói tiếng Anh mỗi ngày qua các chủ đề gần gũi, từ vựng và phần phản hồi sau buổi học.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => setInfoVisible(false)}
              style={({ pressed }) => [styles.infoCloseButton, pressed && styles.footerPressed]}>
              <Text style={styles.infoCloseText}>Đã hiểu</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <LoginOnboardingFlow
        onClose={() => setAuthFlowVisible(false)}
        onAuthenticated={markAuthenticated}
        onFinish={finishSignIn}
        onStartLesson={finishAndStartLesson}
        initialProvider={signedInUser ? 'Email' : null}
        initialAnswers={profileAnswers}
        visible={authFlowVisible}
      />

      <Modal
        animationType="fade"
        onRequestClose={() => setProfileView(null)}
        transparent
        visible={profileView !== null}>
        <View style={styles.infoOverlay}>
          {profileView === 'overview' ? (
            <View accessibilityRole="alert" style={styles.infoCard}>
              <View style={styles.profileHeading}>
                <View style={styles.profileAvatar}>
                  <Text style={styles.profileAvatarInitial}>{(signedInUser?.displayName || signedInUser?.email || 'E').charAt(0).toUpperCase()}</Text>
                </View>
                <View style={styles.profileIdentity}>
                  <Text style={styles.profileName}>{signedInUser?.displayName || signedInUser?.email}</Text>
                  <Text style={styles.profileProvider}>Tài khoản Elevate</Text>
                </View>
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={() => setProfileView('personal')}
                style={({ pressed }) => [styles.personalInfoButton, pressed && styles.footerPressed]}>
                <Text style={styles.personalInfoText}>Thông tin cá nhân</Text>
                <Text style={styles.personalInfoArrow}>›</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  void authService.logout().finally(() => {
                    setProfileAnswers({});
                    setProfileView(null);
                  });
                }}
                style={({ pressed }) => [styles.logoutButton, pressed && styles.footerPressed]}>
                <Text style={styles.logoutButtonText}>Đăng xuất</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => setProfileView(null)}
                style={({ pressed }) => [styles.modalCancelButton, pressed && styles.footerPressed]}>
                <Text style={styles.modalCancelText}>Đóng</Text>
              </Pressable>
            </View>
          ) : (
            <View accessibilityRole="alert" style={styles.infoCard}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setProfileView('overview')}
                style={({ pressed }) => [styles.profileBackButton, pressed && styles.footerPressed]}>
                <Text style={styles.profileBackText}>‹  Hồ sơ</Text>
              </Pressable>
              <Text style={styles.infoTitle}>Thông tin cá nhân</Text>
              <View style={styles.personalInfoRow}>
                <Text style={styles.personalInfoLabel}>Tên hiển thị</Text>
                <Text style={styles.personalInfoValue}>{signedInUser?.displayName || signedInUser?.email}</Text>
              </View>
              <View style={styles.personalInfoRow}>
                <Text style={styles.personalInfoLabel}>Đăng nhập bằng</Text>
                <Text style={styles.personalInfoValue}>Email và mật khẩu</Text>
              </View>
              <View style={styles.personalInfoRow}>
                <Text style={styles.personalInfoLabel}>Kinh nghiệm tiếng Anh</Text>
                <Text style={styles.personalInfoValue}>{profileAnswers.experience ?? 'Chưa cung cấp'}</Text>
              </View>
              <View style={styles.personalInfoRow}>
                <Text style={styles.personalInfoLabel}>Khó khăn muốn cải thiện</Text>
                <Text style={styles.personalInfoValue}>{profileAnswers.difficulties?.join(', ') || 'Chưa cung cấp'}</Text>
              </View>
              <View style={styles.personalInfoRow}>
                <Text style={styles.personalInfoLabel}>Thời gian học mỗi ngày</Text>
                <Text style={styles.personalInfoValue}>{profileAnswers.dailyTime ?? 'Chưa cung cấp'}</Text>
              </View>
              <View style={styles.personalInfoRow}>
                <Text style={styles.personalInfoLabel}>Trình độ hiện tại</Text>
                <Text style={styles.personalInfoValue}>{profileAnswers.level ?? 'Chưa cung cấp'}</Text>
              </View>
              <View style={styles.personalInfoRow}>
                <Text style={styles.personalInfoLabel}>Mục đích học</Text>
                <Text style={styles.personalInfoValue}>{profileAnswers.purpose ?? 'Chưa cung cấp'}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setProfileView(null);
                  setAuthFlowVisible(true);
                }}
                style={({ pressed }) => [styles.changeRoadmapButton, pressed && styles.footerPressed]}>
                <Text style={styles.changeRoadmapButtonText}>Thay đổi lộ trình</Text>
              </Pressable>
            </View>
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollContent: {
    flexGrow: 1,
  },
  page: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 480,
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 18,
    paddingBottom: 36,
  },
  brand: {
    color: COLORS.white,
    fontFamily: 'serif',
    fontSize: 34,
    fontStyle: 'italic',
    letterSpacing: -2,
  },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  loginButton: {
    alignItems: 'center',
    borderColor: '#FFFFFF90',
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 40,
    minWidth: 92,
    paddingHorizontal: 12,
  },
  loginButtonText: {
    color: COLORS.white,
    fontSize: 12,
    fontWeight: '600',
  },
  avatarButton: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#FFFFFF90',
    borderRadius: 18,
    borderWidth: 1,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  avatarInitial: {
    color: '#4285F4',
    fontSize: 19,
    fontWeight: '800',
  },
  facebookInitial: {
    color: '#1877F2',
  },
  hero: {
    alignItems: 'center',
    marginTop: 42,
  },
  greeting: {
    color: COLORS.white,
    fontFamily: 'serif',
    fontSize: 48,
    fontStyle: 'italic',
    lineHeight: 60,
    textAlign: 'center',
  },
  tagline: {
    color: COLORS.mutedWhite,
    fontFamily: 'serif',
    fontSize: 17,
    lineHeight: 25,
    marginTop: 4,
    textAlign: 'center',
  },
  dailyGoal: {
    color: COLORS.secondary,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 1,
    marginTop: 14,
    textTransform: 'uppercase',
  },
  menu: {
    alignItems: 'flex-start',
    gap: 14,
    marginTop: 58,
    width: '100%',
  },
  homeFooter: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 'auto',
    height: 196,
    overflow: 'hidden',
    position: 'relative',
  },
  infoButton: {
    alignItems: 'center',
    alignSelf: 'flex-end',
    justifyContent: 'center',
    marginBottom: 14,
    minHeight: 44,
    width: 44,
    zIndex: 2,
  },
  infoIcon: {
    borderColor: '#E8EAF2B0',
    borderRadius: 14,
    borderWidth: 1.4,
    color: COLORS.mutedWhite,
    fontFamily: 'serif',
    fontSize: 17,
    fontStyle: 'italic',
    fontWeight: '600',
    height: 28,
    lineHeight: 25,
    textAlign: 'center',
    width: 28,
  },
  mascot: {
    bottom: -25,
    position: 'absolute',
    right: -23,
    height: 205,
    width: 205,
  },
  mascotImage: {
    height: '100%',
    width: '100%',
  },
  footerPressed: {
    opacity: 0.76,
    transform: [{ scale: 0.97 }],
  },
  infoOverlay: {
    alignItems: 'center',
    backgroundColor: '#00000099',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  infoCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    maxWidth: 360,
    padding: 22,
    width: '100%',
  },
  infoTitle: {
    color: COLORS.background,
    fontFamily: 'serif',
    fontSize: 23,
    fontWeight: '700',
  },
  infoDescription: {
    color: '#536078',
    fontSize: 15,
    lineHeight: 23,
    marginTop: 10,
  },
  infoCloseButton: {
    alignItems: 'center',
    alignSelf: 'flex-end',
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    justifyContent: 'center',
    marginTop: 20,
    minHeight: 44,
    paddingHorizontal: 18,
  },
  infoCloseText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '700',
  },
  modalCancelButton: {
    alignItems: 'center',
    alignSelf: 'center',
    justifyContent: 'center',
    marginTop: 8,
    minHeight: 40,
    paddingHorizontal: 16,
  },
  modalCancelText: {
    color: '#536078',
    fontSize: 14,
    fontWeight: '600',
  },
  previewNote: {
    color: '#7A8498',
    fontSize: 11,
    lineHeight: 17,
    marginTop: 16,
    textAlign: 'center',
  },
  profileHeading: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  profileAvatar: {
    alignItems: 'center',
    backgroundColor: '#EEF3FF',
    borderRadius: 24,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  profileAvatarInitial: {
    color: '#4285F4',
    fontSize: 22,
    fontWeight: '800',
  },
  profileIdentity: {
    flex: 1,
  },
  profileName: {
    color: COLORS.background,
    fontSize: 16,
    fontWeight: '700',
  },
  profileProvider: {
    color: '#68738A',
    fontSize: 12,
    marginTop: 3,
  },
  streakCard: {
    alignItems: 'center',
    backgroundColor: '#FFF7E8',
    borderColor: '#FFE2AD',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 13,
    marginTop: 20,
    padding: 15,
  },
  streakEmoji: {
    fontSize: 32,
  },
  streakCount: {
    color: '#9B5C00',
    fontSize: 19,
    fontWeight: '800',
  },
  streakCaption: {
    color: '#815F30',
    fontSize: 12,
    marginTop: 2,
  },
  personalInfoButton: {
    alignItems: 'center',
    borderBottomColor: '#E8EAF0',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
    minHeight: 50,
  },
  personalInfoText: {
    color: COLORS.background,
    fontSize: 14,
    fontWeight: '600',
  },
  personalInfoArrow: {
    color: '#7A8498',
    fontSize: 25,
  },
  logoutButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    justifyContent: 'center',
    marginTop: 8,
    minHeight: 40,
    paddingHorizontal: 2,
  },
  logoutButtonText: {
    color: '#C43C4B',
    fontSize: 14,
    fontWeight: '600',
  },
  profileBackButton: {
    alignSelf: 'flex-start',
    marginBottom: 14,
    paddingVertical: 4,
    paddingRight: 10,
  },
  profileBackText: {
    color: '#536078',
    fontSize: 14,
    fontWeight: '600',
  },
  personalInfoRow: {
    borderBottomColor: '#E8EAF0',
    borderBottomWidth: 1,
    paddingVertical: 14,
  },
  personalInfoLabel: {
    color: '#7A8498',
    fontSize: 12,
  },
  personalInfoValue: {
    color: COLORS.background,
    fontSize: 15,
    fontWeight: '600',
    marginTop: 5,
  },
  changeRoadmapButton: {
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    justifyContent: 'center',
    marginTop: 18,
    minHeight: 48,
    paddingHorizontal: 16,
  },
  changeRoadmapButtonText: { color: COLORS.white, fontSize: 14, fontWeight: '700' },
  menuButton: {
    alignItems: 'center',
    height: 54,
    justifyContent: 'center',
    position: 'relative',
    width: '100%',
  },
  buttonBody: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    // Slight overlap with the angled tip hides Android's rasterized join seam.
    right: 32,
    top: 0,
  },
  buttonTip: {
    borderRightColor: 'transparent',
    borderRightWidth: 34,
    borderTopWidth: 54,
    position: 'absolute',
    right: 0,
    top: 0,
    width: 0,
  },
  menuButtonText: {
    color: COLORS.white,
    fontFamily: 'serif',
    fontSize: 19,
    textAlign: 'center',
  },
});
