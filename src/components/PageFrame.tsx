import { StatusBar } from 'expo-status-bar';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const COLORS = { background: '#142052', white: '#FFFFFF', muted: '#D9DEEC' };

export function PageFrame({ title, subtitle, children, scroll = true }: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  scroll?: boolean;
}) {
  const body = scroll ? (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>{children}</ScrollView>
  ) : <View style={styles.content}>{children}</View>;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.page}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Quay lại" onPress={() => router.back()} style={styles.back}>
            <Text style={styles.backText}>‹</Text>
          </Pressable>
          <View style={styles.headerCopy}>
            <Text style={styles.brand}>Elevate</Text>
            <Text style={styles.title}>{title}</Text>
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          </View>
        </View>
        {body}
      </View>
    </SafeAreaView>
  );
}

export const palette = { background: '#142052', green: '#A8D65A', greenDark: '#8ABF26', white: '#FFFFFF', muted: '#D9DEEC', ink: '#17234E', red: '#EA2434' };
export const pageStyles = StyleSheet.create({
  heading: { color: palette.white, fontFamily: 'serif', fontSize: 23, fontWeight: '700', marginBottom: 6 },
  paragraph: { color: palette.muted, fontSize: 14, lineHeight: 21, marginBottom: 16 },
  card: { backgroundColor: '#FFFFFF0D', borderColor: '#FFFFFF20', borderRadius: 16, borderWidth: 1, marginBottom: 12, padding: 16 },
  cardTitle: { color: palette.green, fontSize: 13, fontWeight: '800', letterSpacing: 0.4, marginBottom: 7 },
  bodyText: { color: palette.white, fontSize: 15, lineHeight: 22 },
  secondaryText: { color: palette.muted, fontSize: 13, lineHeight: 20, marginTop: 6 },
  action: { alignItems: 'center', backgroundColor: palette.greenDark, borderRadius: 14, justifyContent: 'center', marginTop: 8, minHeight: 50, paddingHorizontal: 16 },
  actionText: { color: palette.white, fontSize: 15, fontWeight: '700' },
});

const styles = StyleSheet.create({
  safeArea: { backgroundColor: COLORS.background, flex: 1 },
  page: { alignSelf: 'center', flex: 1, maxWidth: 480, paddingHorizontal: 20, width: '100%' },
  header: { alignItems: 'center', flexDirection: 'row', gap: 8, paddingBottom: 14, paddingTop: 5 },
  back: { alignItems: 'center', height: 44, justifyContent: 'center', width: 30 },
  backText: { color: COLORS.white, fontFamily: 'serif', fontSize: 38, lineHeight: 42 },
  headerCopy: { flex: 1 },
  brand: { color: COLORS.white, fontFamily: 'serif', fontSize: 27, fontStyle: 'italic', letterSpacing: -2 },
  title: { color: COLORS.white, fontFamily: 'serif', fontSize: 16, marginTop: 1 },
  subtitle: { color: COLORS.muted, fontSize: 11, marginTop: 2 },
  content: { flexGrow: 1, paddingBottom: 20, paddingTop: 2 },
});
