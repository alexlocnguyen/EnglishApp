import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AnimatedTutor } from '@/components/AnimatedTutor';
import {
  DIFFICULTY_OPTIONS,
  EXPERIENCE_OPTIONS,
  LEVEL_OPTIONS,
  PURPOSE_OPTIONS,
  PURPOSE_OUTCOMES,
  ROADMAP,
  TIME_OPTIONS,
  TOTAL_SURVEY_STEPS,
} from '@/constants/onboarding';
import { authService } from '@/services/auth-service';

const COLORS = {
  background: '#142052',
  green: '#A8D65A',
  greenDark: '#8ABF26',
  white: '#FFFFFF',
  muted: '#CFD6E8',
};

export type LoginProvider = 'Email';

export type SurveyAnswers = {
  experience?: string;
  difficulties?: string[];
  level?: string;
  purpose?: string;
  dailyTime?: string;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  onFinish: (provider: LoginProvider, answers: SurveyAnswers) => void;
  onAuthenticated: (provider: LoginProvider, answers: SurveyAnswers) => void;
  onStartLesson: (provider: LoginProvider, answers: SurveyAnswers) => void;
  initialProvider?: LoginProvider | null;
  initialAnswers?: SurveyAnswers;
};

const TOTAL_STEPS = TOTAL_SURVEY_STEPS;

export function LoginOnboardingFlow({ visible, onClose, onFinish, onAuthenticated, onStartLesson, initialProvider = null, initialAnswers = {} }: Props) {
  const [screen, setScreen] = useState<'providers' | 'survey' | 'loading' | 'result'>('providers');
  const [provider, setProvider] = useState<LoginProvider | null>(null);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<SurveyAnswers>({});
  const [selectedDifficulties, setSelectedDifficulties] = useState<string[]>([]);
  const [selectedLevel, setSelectedLevel] = useState<string | null>(null);
  const [choiceLocked, setChoiceLocked] = useState(false);
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  const [commitmentChecked, setCommitmentChecked] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authNotice, setAuthNotice] = useState('');
  const translateX = useRef(new Animated.Value(0)).current;
  const spinnerRotation = useRef(new Animated.Value(0)).current;
  const choiceTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initializedForVisibility = useRef(false);

  useEffect(() => {
    if (!visible) {
      initializedForVisibility.current = false;
      return;
    }
    if (initializedForVisibility.current) return;
    initializedForVisibility.current = true;
    setScreen(initialProvider ? 'survey' : 'providers');
    setProvider(initialProvider);
    setStep(0);
    setAnswers(initialProvider ? initialAnswers : {});
    setSelectedDifficulties(initialProvider ? initialAnswers.difficulties ?? [] : []);
    setSelectedLevel(initialProvider ? initialAnswers.level ?? null : null);
    setChoiceLocked(false);
    setCommitmentChecked(false);
    setAuthError('');
    setAuthNotice('');
    translateX.setValue(0);
  }, [visible, translateX]);

  useEffect(() => {
    if (screen !== 'loading') return;
    setLoadingMessageIndex(0);
    const firstMessage = setTimeout(() => setLoadingMessageIndex(1), 750);
    const secondMessage = setTimeout(() => setLoadingMessageIndex(2), 1550);
    const showResult = setTimeout(() => {
      if (provider) onAuthenticated(provider, answers);
      setScreen('result');
    }, 2450);
    const spinner = Animated.loop(
      Animated.timing(spinnerRotation, {
        toValue: 1,
        duration: 1500,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    spinner.start();

    return () => {
      clearTimeout(firstMessage);
      clearTimeout(secondMessage);
      clearTimeout(showResult);
      spinner.stop();
      spinnerRotation.setValue(0);
    };
  }, [screen, spinnerRotation]);

  useEffect(() => () => {
    if (choiceTimeout.current) clearTimeout(choiceTimeout.current);
  }, []);

  const currentLevel = LEVEL_OPTIONS.find((option) => option.label === answers.level);
  const finalMilestone = PURPOSE_OUTCOMES[answers.purpose ?? ''] ?? 'Tự tin giao tiếp trong tình huống thực tế';
  const timeLabel = answers.dailyTime ?? '15 phút';
  const spin = spinnerRotation.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  function chooseProvider(nextProvider: LoginProvider) {
    setProvider(nextProvider);
    setAnswers({});
    setSelectedDifficulties([]);
    setStep(0);
    setScreen('survey');
  }

  async function submitCredentials() {
    setAuthError('');
    setAuthNotice('');
    if (!email.trim() || !password) {
      setAuthError('Nhập email và mật khẩu để tiếp tục.');
      return;
    }
    if (isRegistering && !displayName.trim()) {
      setAuthError('Nhập tên hiển thị của bạn.');
      return;
    }
    if (isRegistering && password.length < 6) {
      setAuthError('Mật khẩu cần có ít nhất 6 ký tự.');
      return;
    }

    setAuthBusy(true);
    try {
      if (isRegistering) await authService.register(email, password, displayName);
      else await authService.login(email, password);
      chooseProvider('Email');
    } catch (error) {
      setAuthError(authService.getErrorMessage(error));
    } finally {
      setAuthBusy(false);
    }
  }

  async function requestPasswordReset() {
    setAuthError('');
    setAuthNotice('');
    if (!email.trim()) {
      setAuthError('Nhập email để nhận liên kết đặt lại mật khẩu.');
      return;
    }
    setAuthBusy(true);
    try {
      await authService.requestPasswordReset(email);
      setAuthNotice('Đã gửi liên kết đặt lại mật khẩu. Hãy kiểm tra email của bạn.');
    } catch (error) {
      setAuthError(authService.getErrorMessage(error));
    } finally {
      setAuthBusy(false);
    }
  }

  function completeSurvey(nextAnswers: SurveyAnswers) {
    setAnswers(nextAnswers);
    setScreen('loading');
  }

  function advance(nextAnswers: SurveyAnswers) {
    if (choiceTimeout.current) clearTimeout(choiceTimeout.current);
    setChoiceLocked(true);
    Animated.timing(translateX, {
      toValue: -52,
      duration: 145,
      easing: Easing.in(Easing.ease),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) return;
      const nextStep = step + 1;
      if (nextStep >= TOTAL_STEPS) {
        completeSurvey(nextAnswers);
        return;
      }
      setAnswers(nextAnswers);
      setStep(nextStep);
      setSelectedLevel(null);
      translateX.setValue(52);
      Animated.timing(translateX, {
        toValue: 0,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start(() => setChoiceLocked(false));
    });
  }

  function chooseSingle(key: 'experience' | 'level' | 'purpose' | 'dailyTime', label: string) {
    if (choiceLocked) return;
    if (key === 'level') setSelectedLevel(label);
    const nextAnswers = { ...answers, [key]: label };
    setAnswers(nextAnswers);
    setChoiceLocked(true);
    choiceTimeout.current = setTimeout(() => {
      setChoiceLocked(false);
      advance(nextAnswers);
    }, key === 'level' ? 650 : 220);
  }

  function toggleDifficulty(label: string) {
    const next = selectedDifficulties.includes(label)
      ? selectedDifficulties.filter((item) => item !== label)
      : [...selectedDifficulties, label];
    setSelectedDifficulties(next);
    setAnswers((previous) => ({ ...previous, difficulties: next }));
  }

  function continueFromDifficulties() {
    advance({ ...answers, difficulties: selectedDifficulties });
  }

  function skip() {
    if (choiceTimeout.current) clearTimeout(choiceTimeout.current);
    translateX.stopAnimation();
    if (provider) onFinish(provider, answers);
    else onClose();
  }

  const difficultySelect = (item: (typeof DIFFICULTY_OPTIONS)[number]) => {
    const selected = selectedDifficulties.includes(item.label);
    return (
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: selected }}
        disabled={choiceLocked}
        key={item.label}
        onPress={() => toggleDifficulty(item.label)}
        style={({ pressed }) => [styles.problemRow, selected && styles.problemRowSelected, pressed && styles.optionPressed]}>
        <Text style={styles.problemEmoji}>{item.icon}</Text>
        <Text style={styles.problemLabel}>{item.label}</Text>
        <View style={[styles.checkbox, selected && styles.checkboxSelected]}>
          {selected && <Text style={styles.checkmark}>✓</Text>}
        </View>
      </Pressable>
    );
  };

  function renderSurveyQuestion() {
    if (step === 0) {
      return (
        <>
          <Text style={styles.questionTitle}>Bạn đã học tiếng Anh trước đây chưa?</Text>
          <Text style={styles.questionHint}>Chọn câu trả lời phù hợp nhất</Text>
          <View style={styles.choiceList}>
            {EXPERIENCE_OPTIONS.map((item) => (
              <Pressable
                accessibilityRole="button"
                disabled={choiceLocked}
                key={item.label}
                onPress={() => chooseSingle('experience', item.label)}
                style={({ pressed }) => [styles.choiceRow, answers.experience === item.label && styles.choiceRowSelected, pressed && styles.optionPressed]}>
                <Text style={styles.choiceEmoji}>{item.icon}</Text>
                <Text style={styles.choiceLabel}>{item.label}</Text>
                <Text style={styles.choiceArrow}>{answers.experience === item.label ? '✓' : '›'}</Text>
              </Pressable>
            ))}
          </View>
        </>
      );
    }

    if (step === 1) {
      return (
        <>
          <Text style={styles.questionTitle}>Khó khăn lớn nhất của bạn là gì?</Text>
          <Text style={styles.questionHint}>Chọn một hoặc nhiều mục</Text>
          <View style={styles.problemList}>{DIFFICULTY_OPTIONS.map(difficultySelect)}</View>
          <Pressable
            accessibilityRole="button"
            disabled={choiceLocked || selectedDifficulties.length === 0}
            onPress={continueFromDifficulties}
            style={({ pressed }) => [
              styles.continueButton,
              selectedDifficulties.length === 0 && styles.continueButtonDisabled,
              pressed && styles.optionPressed,
            ]}>
            <Text style={styles.continueButtonText}>Tiếp tục</Text>
          </Pressable>
        </>
      );
    }

    if (step === 2) {
      return (
        <>
          <Text style={styles.questionTitle}>Bạn tự đánh giá trình độ hiện tại ở mức nào?</Text>
          <Text style={styles.questionHint}>Chọn mức gần với bạn nhất</Text>
          <View style={styles.levelList}>
            {LEVEL_OPTIONS.map((item) => {
              const selected = selectedLevel === item.label;
              return (
                <Pressable
                  accessibilityRole="button"
                  disabled={choiceLocked && !selected}
                  key={item.label}
                  onPress={() => chooseSingle('level', item.label)}
                  style={({ pressed }) => [
                    styles.levelRow,
                    { marginLeft: (item.rank - 1) * 4 },
                    selected && styles.levelRowSelected,
                    pressed && styles.optionPressed,
                  ]}>
                  <Text style={styles.levelEmoji}>{item.icon}</Text>
                  <View style={styles.levelCopy}>
                    <Text style={styles.levelLabel}>{item.label}</Text>
                    {selected && <Text style={styles.levelDetail}>{item.detail}</Text>}
                  </View>
                  <View style={styles.levelMeter}>
                    {[1, 2, 3, 4].map((bar) => (
                      <View key={bar} style={[styles.levelMeterBar, bar <= item.rank && styles.levelMeterBarActive]} />
                    ))}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </>
      );
    }

    if (step === 3) {
      return (
        <>
          <Text style={styles.questionTitle}>Mục đích chính khi học tiếng Anh?</Text>
          <Text style={styles.questionHint}>Chọn điều bạn muốn đạt được</Text>
          <View style={styles.purposeGrid}>
            {PURPOSE_OPTIONS.map((item) => (
              <Pressable
                accessibilityRole="button"
                disabled={choiceLocked}
                key={item.label}
                onPress={() => chooseSingle('purpose', item.label)}
                style={({ pressed }) => [styles.purposeCard, answers.purpose === item.label && styles.purposeCardSelected, pressed && styles.optionPressed]}>
                <Text style={styles.purposeEmoji}>{item.icon}</Text>
                <Text style={styles.purposeLabel}>{item.label}</Text>
                <Text style={styles.purposeDetail}>{item.detail}</Text>
              </Pressable>
            ))}
          </View>
        </>
      );
    }

    return (
      <>
        <Text style={styles.questionTitle}>Mỗi ngày bạn có thể dành bao lâu?</Text>
        <Text style={styles.questionHint}>Chọn mục tiêu dễ duy trì với bạn</Text>
        <View style={styles.timeList}>
          {TIME_OPTIONS.map((item, index) => (
            <Pressable
              accessibilityRole="button"
              disabled={choiceLocked}
              key={item.label}
              onPress={() => chooseSingle('dailyTime', item.label)}
              style={({ pressed }) => [styles.timeRow, answers.dailyTime === item.label && styles.timeRowSelected, pressed && styles.optionPressed]}>
              <Text style={[styles.timeEmoji, { fontSize: 24 + index * 5 }]}>{item.icon}</Text>
              <View style={styles.timeCopy}>
                <Text style={styles.timeLabel}>{item.label} mỗi ngày</Text>
                <Text style={styles.timeTitle}>{item.title}</Text>
              </View>
              <View style={styles.timeBars}>
                {[1, 2, 3].map((bar) => (
                  <View key={bar} style={[styles.timeBar, bar <= index + 1 && styles.timeBarActive]} />
                ))}
              </View>
            </Pressable>
          ))}
        </View>
      </>
    );
  }

  function renderResult() {
    const levelSummary = currentLevel
      ? `${currentLevel.label} · ${currentLevel.rank === 1 ? 'A1' : currentLevel.rank === 2 ? 'A2' : currentLevel.rank === 3 ? 'B1–B2' : 'C1+'}`
      : 'Lộ trình phù hợp với bạn';
    return (
      <SafeAreaView style={styles.resultScreen}>
        <ScrollView contentContainerStyle={styles.resultScroll} showsVerticalScrollIndicator={false}>
          <View style={styles.resultHero}>
            <View style={styles.trophyBadge}>
              <Text style={styles.trophyEmoji}>🏆</Text>
            </View>
            <Text style={styles.resultEyebrow}>LỘ TRÌNH CÁ NHÂN HÓA</Text>
            <Text style={styles.resultTitle}>Lộ trình của bạn đã sẵn sàng!</Text>
            <Text style={styles.resultPurpose}>{answers.purpose ?? 'Tiếng Anh giao tiếp'}</Text>
          </View>

          <View style={styles.levelSummaryCard}>
            <View style={styles.levelSummaryTop}>
              <Text style={styles.levelSummaryIcon}>{currentLevel?.icon ?? '🌱'}</Text>
              <View style={styles.levelSummaryCopy}>
                <Text style={styles.levelSummaryCaption}>TRÌNH ĐỘ HIỆN TẠI</Text>
                <Text style={styles.levelSummaryValue}>{levelSummary}</Text>
              </View>
            </View>
            <Text style={styles.levelSummaryDescription}>
              {currentLevel
                ? `Mình sẽ giúp bạn tiến bộ từng ngày, bắt đầu từ ${currentLevel.label.toLowerCase()}.`
                : 'Mình sẽ bắt đầu bằng những bài học ngắn và dễ theo.'}
            </Text>
          </View>

          <View style={styles.roadmapHeading}>
            <Text style={styles.roadmapTitle}>Hành trình của bạn</Text>
            <Text style={styles.roadmapSubtext}>Đã mở khóa</Text>
          </View>
          <View style={styles.roadmapList}>
            {ROADMAP.map((item, index) => (
              <View key={item.title} style={styles.roadmapItem}>
                <View style={styles.roadmapRail}>
                  <View style={[styles.roadmapNode, index === 0 && styles.roadmapNodeActive]}>
                    <Text style={styles.roadmapIcon}>{item.icon}</Text>
                  </View>
                  {index < ROADMAP.length - 1 && <View style={styles.roadmapLine} />}
                </View>
                <View style={styles.roadmapCopy}>
                  <Text style={styles.roadmapStep}>{index === 2 ? 'MỤC TIÊU CUỐI' : `CỘT MỐC ${index + 1}`}</Text>
                  <Text style={styles.roadmapItemTitle}>{index === 2 ? finalMilestone : item.title.replace(/^Bước \d+ · /, '')}</Text>
                  <Text style={styles.roadmapDetail}>{index === 2 ? 'Áp dụng tiếng Anh vào mục tiêu bạn chọn' : item.detail}</Text>
                </View>
              </View>
            ))}
          </View>

          <View style={styles.commitmentCard}>
            <Text style={styles.commitmentIcon}>⏱️</Text>
            <View style={styles.commitmentCopy}>
              <Text style={styles.commitmentTitle}>{timeLabel} mỗi ngày</Text>
              <Text style={styles.commitmentSubtitle}>Mục tiêu nhỏ, tiến bộ đều đặn</Text>
            </View>
          </View>

          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: commitmentChecked }}
            onPress={() => setCommitmentChecked((checked) => !checked)}
            style={styles.commitmentCheckRow}>
            <View style={[styles.commitmentCheckbox, commitmentChecked && styles.commitmentCheckboxChecked]}>
              {commitmentChecked && <Text style={styles.commitmentCheckmark}>✓</Text>}
            </View>
            <Text style={styles.commitmentCheckText}>Mình sẽ cố gắng học {timeLabel} mỗi ngày</Text>
          </Pressable>

          <View style={styles.readyProgress}>
            <View style={styles.readyProgressTrack}>
              <View style={styles.readyProgressFill} />
            </View>
            <Text style={styles.readyProgressText}>Khảo sát đã hoàn tất · bước đầu tiên đã mở khóa</Text>
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={() => provider && (initialProvider ? onFinish(provider, answers) : onStartLesson(provider, answers))}
            style={({ pressed }) => [styles.startLessonButton, pressed && styles.optionPressed]}>
            <Text style={styles.startLessonText}>{initialProvider ? 'Cập nhật lộ trình' : 'Bắt đầu bài học đầu tiên'}</Text>
            <Text style={styles.startLessonArrow}>→</Text>
          </Pressable>
          <Text style={styles.freeNote}>{initialProvider ? 'Các câu trả lời mới sẽ thay thế lộ trình hiện tại' : 'Bài học đầu tiên · Miễn phí'}</Text>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <Modal
      animationType="none"
      onRequestClose={() => (screen === 'providers' ? onClose() : skip())}
      visible={visible}>
      {screen === 'providers' ? (
        <SafeAreaView style={styles.providerScreen}>
          <View style={styles.providerTop}>
            <Text style={styles.providerBrand}>Elevate</Text>
            <Pressable accessibilityRole="button" onPress={onClose} style={styles.providerClose}>
              <Text style={styles.providerCloseText}>×</Text>
            </Pressable>
          </View>
          <View style={styles.providerContent}>
            <Text style={styles.providerTitle}>{isRegistering ? 'Tạo tài khoản' : 'Chào mừng bạn trở lại'}</Text>
            <Text style={styles.providerDescription}>Đăng nhập để lưu lại quá trình học tập với Elevate.</Text>
            {isRegistering && (
              <TextInput
                accessibilityLabel="Tên hiển thị"
                autoCapitalize="words"
                editable={!authBusy}
                onChangeText={setDisplayName}
                placeholder="Tên hiển thị"
                placeholderTextColor="#9AA5BF"
                style={styles.authInput}
                value={displayName}
              />
            )}
            <TextInput
              accessibilityLabel="Email"
              autoCapitalize="none"
              autoComplete="email"
              autoCorrect={false}
              editable={!authBusy}
              keyboardType="email-address"
              onChangeText={setEmail}
              placeholder="Email"
              placeholderTextColor="#9AA5BF"
              style={styles.authInput}
              textContentType="emailAddress"
              value={email}
            />
            <TextInput
              accessibilityLabel="Mật khẩu"
              autoCapitalize="none"
              autoComplete={isRegistering ? 'new-password' : 'current-password'}
              editable={!authBusy}
              onChangeText={setPassword}
              placeholder="Mật khẩu"
              placeholderTextColor="#9AA5BF"
              secureTextEntry
              style={styles.authInput}
              textContentType={isRegistering ? 'newPassword' : 'password'}
              value={password}
            />
            {!!authError && <Text accessibilityRole="alert" style={styles.authError}>{authError}</Text>}
            {!!authNotice && <Text accessibilityRole="alert" style={styles.authNotice}>{authNotice}</Text>}
            <Pressable accessibilityRole="button" disabled={authBusy} onPress={submitCredentials} style={({ pressed }) => [styles.authButton, authBusy && styles.authButtonDisabled, pressed && styles.optionPressed]}>
              <Text style={styles.authButtonText}>{authBusy ? 'Đang xử lý…' : isRegistering ? 'Tạo tài khoản' : 'Đăng nhập'}</Text>
            </Pressable>
            {!isRegistering && (
              <Pressable accessibilityRole="button" disabled={authBusy} onPress={requestPasswordReset} style={styles.textAction}>
                <Text style={styles.textActionLabel}>Quên mật khẩu?</Text>
              </Pressable>
            )}
            <Pressable
              accessibilityRole="button"
              disabled={authBusy}
              onPress={() => {
                setIsRegistering((value) => !value);
                setAuthError('');
                setAuthNotice('');
              }}
              style={styles.textAction}>
              <Text style={styles.textActionLabel}>{isRegistering ? 'Đã có tài khoản? Đăng nhập' : 'Chưa có tài khoản? Đăng ký'}</Text>
            </Pressable>
          </View>
          <Text style={styles.providerFooter}>Tạo tài khoản miễn phí để đồng bộ tiến độ của bạn</Text>
        </SafeAreaView>
      ) : screen === 'survey' ? (
        <SafeAreaView style={styles.surveyScreen}>
          <View style={styles.surveyHeader}>
            <View style={styles.surveyProgressCopy}>
              <Text style={styles.surveyStepText}>Bước {step + 1}/{TOTAL_STEPS}</Text>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${((step + 1) / TOTAL_STEPS) * 100}%` }]} />
              </View>
            </View>
            <Pressable accessibilityRole="button" onPress={skip} style={styles.skipButton}>
              <Text style={styles.skipButtonText}>Bỏ qua</Text>
            </Pressable>
          </View>

          <Animated.View style={[styles.questionContent, { transform: [{ translateX }] }]}>
            <Text style={styles.questionEyebrow}>CÁ NHÂN HÓA LỘ TRÌNH</Text>
            {renderSurveyQuestion()}
          </Animated.View>
          <View style={styles.surveyFooter}>
            <View style={styles.footerDot} />
            <Text style={styles.surveyFooterText}>Chỉ mất vài giây · câu trả lời có thể chỉnh sửa sau</Text>
          </View>
        </SafeAreaView>
      ) : screen === 'loading' ? (
        <SafeAreaView style={styles.loadingScreen}>
          <Animated.View style={[styles.loadingSpinner, { transform: [{ rotate: spin }] }]} />
          <View style={styles.loadingMascot}><AnimatedTutor compact speaking={false} statusText="" /></View>
          <Text style={styles.loadingTitle}>{[
            'Đang phân tích mục tiêu của bạn…',
            'Đang thiết kế lộ trình riêng cho bạn…',
            'Lộ trình của bạn đã sẵn sàng!',
          ][loadingMessageIndex]}</Text>
          <View style={styles.loadingDots}>
            {[0, 1, 2].map((dot) => <View key={dot} style={[styles.loadingDot, dot <= loadingMessageIndex && styles.loadingDotActive]} />)}
          </View>
        </SafeAreaView>
      ) : (
        renderResult()
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  providerScreen: { backgroundColor: COLORS.background, flex: 1, justifyContent: 'space-between', paddingHorizontal: 26, paddingVertical: 18 },
  providerTop: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  providerBrand: { color: COLORS.white, fontFamily: 'serif', fontSize: 30, fontStyle: 'italic' },
  providerClose: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
  providerCloseText: { color: COLORS.muted, fontSize: 32, fontWeight: '300' },
  providerContent: { alignSelf: 'center', maxWidth: 420, width: '100%' },
  providerTitle: { color: COLORS.white, fontFamily: 'serif', fontSize: 30, textAlign: 'center' },
  providerDescription: { color: COLORS.muted, fontSize: 15, lineHeight: 22, marginBottom: 25, marginTop: 9, textAlign: 'center' },
  authInput: { backgroundColor: '#FFFFFF', borderColor: '#D7DBE5', borderRadius: 13, borderWidth: 1, color: '#252A35', fontSize: 15, height: 52, marginTop: 12, paddingHorizontal: 16 },
  authError: { color: '#FFC0C8', fontSize: 13, lineHeight: 19, marginTop: 12, textAlign: 'center' },
  authNotice: { color: '#C7E98F', fontSize: 13, lineHeight: 19, marginTop: 12, textAlign: 'center' },
  authButton: { alignItems: 'center', backgroundColor: COLORS.greenDark, borderRadius: 13, height: 54, justifyContent: 'center', marginTop: 18 },
  authButtonDisabled: { opacity: 0.65 },
  authButtonText: { color: COLORS.white, fontSize: 15, fontWeight: '700' },
  textAction: { alignSelf: 'center', marginTop: 15, padding: 5 },
  textActionLabel: { color: '#C7D2EE', fontSize: 13, fontWeight: '600', textAlign: 'center' },
  providerFooter: { color: '#AEB8D0', fontSize: 11, textAlign: 'center' },
  surveyScreen: { backgroundColor: COLORS.background, flex: 1, paddingHorizontal: 24 },
  surveyHeader: { alignItems: 'center', flexDirection: 'row', gap: 18, justifyContent: 'space-between', paddingTop: 12 },
  surveyProgressCopy: { flex: 1 },
  surveyStepText: { color: COLORS.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.4, marginBottom: 9 },
  progressTrack: { backgroundColor: '#FFFFFF30', borderRadius: 4, height: 5, overflow: 'hidden', width: '100%' },
  progressFill: { backgroundColor: COLORS.green, borderRadius: 4, height: '100%' },
  skipButton: { alignItems: 'center', justifyContent: 'center', minHeight: 42, minWidth: 58, paddingHorizontal: 4 },
  skipButtonText: { color: COLORS.green, fontSize: 13, fontWeight: '700' },
  questionContent: { flex: 1, justifyContent: 'center', paddingBottom: 22 },
  questionEyebrow: { color: COLORS.green, fontSize: 10, fontWeight: '800', letterSpacing: 1.5, marginBottom: 13 },
  questionTitle: { color: COLORS.white, fontFamily: 'serif', fontSize: 28, lineHeight: 36 },
  questionHint: { color: COLORS.muted, fontSize: 13, marginTop: 10 },
  choiceList: { gap: 11, marginTop: 24 },
  choiceRow: { alignItems: 'center', backgroundColor: '#FFFFFF12', borderColor: '#FFFFFF32', borderRadius: 15, borderWidth: 1, flexDirection: 'row', minHeight: 61, paddingHorizontal: 15 },
  choiceRowSelected: { backgroundColor: '#A8D65A20', borderColor: COLORS.green },
  choiceEmoji: { fontSize: 23, marginRight: 13, width: 31 },
  choiceLabel: { color: COLORS.white, flex: 1, fontSize: 15, fontWeight: '600' },
  choiceArrow: { color: '#FFFFFF90', fontSize: 26, marginLeft: 8 },
  problemList: { gap: 8, marginTop: 20 },
  problemRow: { alignItems: 'center', backgroundColor: '#FFFFFF12', borderColor: '#FFFFFF28', borderRadius: 13, borderWidth: 1, flexDirection: 'row', minHeight: 49, paddingHorizontal: 13 },
  problemRowSelected: { backgroundColor: '#A8D65A24', borderColor: COLORS.green },
  problemEmoji: { fontSize: 21, marginRight: 12, width: 29 },
  problemLabel: { color: COLORS.white, flex: 1, fontSize: 13, fontWeight: '600' },
  checkbox: { alignItems: 'center', borderColor: '#FFFFFF90', borderRadius: 6, borderWidth: 1.5, height: 21, justifyContent: 'center', width: 21 },
  checkboxSelected: { backgroundColor: COLORS.greenDark, borderColor: COLORS.greenDark },
  checkmark: { color: COLORS.white, fontSize: 14, fontWeight: '800', lineHeight: 18 },
  continueButton: { alignItems: 'center', backgroundColor: COLORS.greenDark, borderRadius: 14, height: 50, justifyContent: 'center', marginTop: 16 },
  continueButtonDisabled: { opacity: 0.45 },
  continueButtonText: { color: COLORS.white, fontSize: 15, fontWeight: '800' },
  levelList: { gap: 8, marginTop: 19 },
  levelRow: { alignItems: 'center', backgroundColor: '#FFFFFF12', borderColor: '#FFFFFF28', borderRadius: 13, borderWidth: 1, flexDirection: 'row', minHeight: 53, paddingHorizontal: 11 },
  levelRowSelected: { backgroundColor: '#A8D65A24', borderColor: COLORS.green, paddingVertical: 7 },
  levelEmoji: { fontSize: 22, marginRight: 10 },
  levelCopy: { flex: 1 },
  levelLabel: { color: COLORS.white, fontSize: 13, fontWeight: '700' },
  levelDetail: { color: COLORS.muted, fontSize: 10, lineHeight: 14, marginTop: 3 },
  levelMeter: { alignItems: 'flex-end', flexDirection: 'row', gap: 3, height: 20, marginLeft: 6 },
  levelMeterBar: { backgroundColor: '#FFFFFF35', borderRadius: 2, height: 6, width: 5 },
  levelMeterBarActive: { backgroundColor: COLORS.green, height: 15 },
  purposeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 23 },
  purposeCard: { alignItems: 'center', backgroundColor: '#FFFFFF12', borderColor: '#FFFFFF32', borderRadius: 16, borderWidth: 1, justifyContent: 'center', minHeight: 132, padding: 12, width: '48%' },
  purposeCardSelected: { backgroundColor: '#A8D65A20', borderColor: COLORS.green },
  purposeEmoji: { fontSize: 35, marginBottom: 8 },
  purposeLabel: { color: COLORS.white, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  purposeDetail: { color: COLORS.muted, fontSize: 10, marginTop: 4, textAlign: 'center' },
  timeList: { gap: 11, marginTop: 24 },
  timeRow: { alignItems: 'center', backgroundColor: '#FFFFFF12', borderColor: '#FFFFFF32', borderRadius: 15, borderWidth: 1, flexDirection: 'row', minHeight: 72, paddingHorizontal: 15 },
  timeRowSelected: { backgroundColor: '#A8D65A20', borderColor: COLORS.green },
  timeEmoji: { marginRight: 14, width: 39 },
  timeCopy: { flex: 1 },
  timeLabel: { color: COLORS.white, fontSize: 15, fontWeight: '700' },
  timeTitle: { color: COLORS.muted, fontSize: 11, marginTop: 3 },
  timeBars: { alignItems: 'flex-end', flexDirection: 'row', gap: 3, height: 25 },
  timeBar: { backgroundColor: '#FFFFFF35', borderRadius: 3, height: 7, width: 5 },
  timeBarActive: { backgroundColor: COLORS.green, height: 21 },
  optionPressed: { opacity: 0.82, transform: [{ scale: 0.985 }] },
  surveyFooter: { alignItems: 'center', flexDirection: 'row', justifyContent: 'center', paddingBottom: 18, paddingTop: 8 },
  footerDot: { backgroundColor: COLORS.green, borderRadius: 3, height: 6, marginRight: 8, width: 6 },
  surveyFooterText: { color: '#C3CBE0', fontSize: 10 },
  loadingScreen: { alignItems: 'center', backgroundColor: COLORS.background, flex: 1, justifyContent: 'center', padding: 28 },
  loadingSpinner: { borderColor: '#FFFFFF35', borderRadius: 105, borderRightColor: COLORS.green, borderTopColor: COLORS.green, borderWidth: 3, height: 210, position: 'absolute', width: 210 },
  loadingMascot: { height: 185, width: 185 },
  loadingTitle: { color: COLORS.white, fontFamily: 'serif', fontSize: 20, lineHeight: 29, marginTop: 30, minHeight: 58, textAlign: 'center' },
  loadingDots: { flexDirection: 'row', gap: 7, marginTop: 20 },
  loadingDot: { backgroundColor: '#FFFFFF45', borderRadius: 4, height: 7, width: 7 },
  loadingDotActive: { backgroundColor: COLORS.green, transform: [{ scale: 1.25 }] },
  resultScreen: { backgroundColor: COLORS.background, flex: 1 },
  resultScroll: { alignSelf: 'center', maxWidth: 520, padding: 22, paddingBottom: 32, width: '100%' },
  resultHero: { alignItems: 'center', paddingTop: 18 },
  trophyBadge: { alignItems: 'center', backgroundColor: '#FFFFFF14', borderColor: '#FFFFFF30', borderRadius: 38, borderWidth: 1, height: 76, justifyContent: 'center', width: 76 },
  trophyEmoji: { fontSize: 39 },
  resultEyebrow: { color: COLORS.green, fontSize: 10, fontWeight: '800', letterSpacing: 1.6, marginTop: 14 },
  resultTitle: { color: COLORS.white, fontFamily: 'serif', fontSize: 25, lineHeight: 32, marginTop: 5, textAlign: 'center' },
  resultPurpose: { color: COLORS.muted, fontSize: 13, marginTop: 6 },
  levelSummaryCard: { backgroundColor: '#FFFFFF', borderRadius: 17, marginTop: 20, padding: 16 },
  levelSummaryTop: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  levelSummaryIcon: { fontSize: 32 },
  levelSummaryCopy: { flex: 1 },
  levelSummaryCaption: { color: '#66718A', fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  levelSummaryValue: { color: COLORS.background, fontSize: 17, fontWeight: '800', marginTop: 4 },
  levelSummaryDescription: { color: '#56627B', fontSize: 11, lineHeight: 17, marginTop: 10 },
  roadmapHeading: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 21 },
  roadmapTitle: { color: COLORS.white, fontFamily: 'serif', fontSize: 19 },
  roadmapSubtext: { color: COLORS.green, fontSize: 10, fontWeight: '700' },
  roadmapList: { marginTop: 12 },
  roadmapItem: { flexDirection: 'row', minHeight: 66 },
  roadmapRail: { alignItems: 'center', marginRight: 12, width: 36 },
  roadmapNode: { alignItems: 'center', backgroundColor: '#FFFFFF18', borderColor: '#FFFFFF40', borderRadius: 17, borderWidth: 1, height: 34, justifyContent: 'center', width: 34 },
  roadmapNodeActive: { backgroundColor: '#A8D65A35', borderColor: COLORS.green },
  roadmapIcon: { fontSize: 16 },
  roadmapLine: { backgroundColor: '#FFFFFF38', flex: 1, marginVertical: 3, width: 1 },
  roadmapCopy: { flex: 1, paddingBottom: 13, paddingTop: 2 },
  roadmapStep: { color: COLORS.green, fontSize: 8, fontWeight: '800', letterSpacing: 1 },
  roadmapItemTitle: { color: COLORS.white, fontSize: 12, fontWeight: '700', marginTop: 3 },
  roadmapDetail: { color: COLORS.muted, fontSize: 10, lineHeight: 14, marginTop: 2 },
  commitmentCard: { alignItems: 'center', backgroundColor: '#FFFFFF14', borderColor: '#FFFFFF28', borderRadius: 13, borderWidth: 1, flexDirection: 'row', gap: 11, marginTop: 8, padding: 12 },
  commitmentIcon: { fontSize: 24 },
  commitmentCopy: { flex: 1 },
  commitmentTitle: { color: COLORS.white, fontSize: 13, fontWeight: '700' },
  commitmentSubtitle: { color: COLORS.muted, fontSize: 10, marginTop: 2 },
  commitmentCheckRow: { alignItems: 'center', flexDirection: 'row', marginTop: 12 },
  commitmentCheckbox: { alignItems: 'center', borderColor: '#FFFFFF85', borderRadius: 4, borderWidth: 1, height: 17, justifyContent: 'center', marginRight: 8, width: 17 },
  commitmentCheckboxChecked: { backgroundColor: COLORS.greenDark, borderColor: COLORS.greenDark },
  commitmentCheckmark: { color: COLORS.white, fontSize: 11, fontWeight: '800' },
  commitmentCheckText: { color: COLORS.muted, flex: 1, fontSize: 10 },
  readyProgress: { marginTop: 14 },
  readyProgressTrack: { backgroundColor: '#FFFFFF30', borderRadius: 3, height: 4, overflow: 'hidden' },
  readyProgressFill: { backgroundColor: COLORS.green, borderRadius: 3, height: '100%', width: '8%' },
  readyProgressText: { color: '#B8C2D9', fontSize: 9, marginTop: 5 },
  startLessonButton: { alignItems: 'center', backgroundColor: COLORS.greenDark, borderRadius: 15, flexDirection: 'row', height: 54, justifyContent: 'center', marginTop: 19 },
  startLessonText: { color: COLORS.white, fontSize: 14, fontWeight: '800' },
  startLessonArrow: { color: COLORS.white, fontSize: 21, marginLeft: 10 },
  freeNote: { color: '#AEB8D0', fontSize: 10, marginTop: 8, textAlign: 'center' },
});
