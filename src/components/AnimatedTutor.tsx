import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

type Props = {
  speaking: boolean;
  statusText?: string;
  compact?: boolean;
};

const COLORS = { robotFace: '#252B43', cyan: '#31E6ED', muted: '#CFD6E8' };

export function AnimatedTutor({ speaking, statusText, compact = false }: Props) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: speaking ? 360 : 1050, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: speaking ? 360 : 1050, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [pulse, speaking]);

  const pulseScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.045] });
  const scale = compact ? Animated.multiply(pulseScale, 0.78) : pulseScale;
  const glowOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.75] });

  return (
    <View style={[styles.tutorStage, compact && styles.compactStage]}>
      <Animated.View style={[styles.tutorGlow, compact && styles.compactGlow, { opacity: glowOpacity, transform: [{ scale }] }]} />
      <Animated.View style={[styles.robot, { transform: [{ scale }] }]}>
        <View style={styles.robotAntenna} />
        <View style={styles.robotSideLeft} />
        <View style={styles.robotSideRight} />
        <View style={styles.robotShell}>
          <View style={styles.robotScreen}>
            <View style={styles.robotEyes}><View style={styles.robotEye} /><View style={styles.robotEye} /></View>
            <View style={[styles.robotSmile, speaking && styles.robotSmileSpeaking]} />
          </View>
        </View>
      </Animated.View>
      {statusText !== '' && <Text style={styles.tutorStatus}>{statusText ?? (speaking ? 'Đang nói…' : 'Đang lắng nghe bạn')}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  tutorStage: { alignItems: 'center', justifyContent: 'center', minHeight: 250, overflow: 'hidden' },
  compactStage: { minHeight: 185, width: '100%' },
  tutorGlow: { backgroundColor: '#5C73D8', borderRadius: 100, height: 180, position: 'absolute', width: 180 },
  compactGlow: { height: 150, width: 150 },
  robot: { alignItems: 'center', height: 154, justifyContent: 'center', width: 194 },
  robotAntenna: { backgroundColor: '#8582FF', borderRadius: 14, height: 32, position: 'absolute', top: 2, width: 40 },
  robotSideLeft: { backgroundColor: '#7974EE', borderRadius: 12, height: 40, left: 2, position: 'absolute', top: 66, width: 26 },
  robotSideRight: { backgroundColor: '#7974EE', borderRadius: 12, height: 40, position: 'absolute', right: 2, top: 66, width: 26 },
  robotShell: { backgroundColor: '#F2F4FA', borderColor: '#C6CCDA', borderRadius: 54, borderWidth: 5, height: 130, justifyContent: 'center', padding: 9, width: 166 },
  robotScreen: { alignItems: 'center', backgroundColor: COLORS.robotFace, borderRadius: 38, flex: 1, justifyContent: 'center' },
  robotEyes: { flexDirection: 'row', gap: 28 },
  robotEye: { backgroundColor: COLORS.cyan, borderRadius: 8, height: 15, width: 15 },
  robotSmile: { borderBottomColor: COLORS.cyan, borderBottomLeftRadius: 16, borderBottomRightRadius: 16, borderBottomWidth: 4, height: 10, marginTop: 7, width: 24 },
  robotSmileSpeaking: { borderBottomWidth: 7, height: 15, width: 20 },
  tutorStatus: { color: COLORS.muted, fontSize: 13, marginTop: 10 },
});
