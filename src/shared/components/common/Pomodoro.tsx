import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Animated,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useAppStore } from '../../store';

type Mode = 'focus' | 'shortBreak' | 'longBreak';

const DURATIONS: Record<Mode, number> = {
  focus: 25 * 60,
  shortBreak: 5 * 60,
  longBreak: 15 * 60,
};

const LABELS: Record<Mode, string> = {
  focus: '专注',
  shortBreak: '短休息',
  longBreak: '长休息',
};

interface PomodoroProps {
  visible: boolean;
  onClose: () => void;
  taskTitle?: string;
  onComplete?: () => void;
}

export function Pomodoro({ visible, onClose, taskTitle, onComplete }: PomodoroProps) {
  const { theme, addSession, userPreferences } = useAppStore();
  const [mode, setMode] = useState<Mode>('focus');
  const [secondsLeft, setSecondsLeft] = useState(DURATIONS.focus);
  const [running, setRunning] = useState(false);
  const [cycleCount, setCycleCount] = useState(0);
  const intervalRef = useRef<any>(null);
  const startTimeRef = useRef<number>(0);
  const progressAnim = useRef(new Animated.Value(0)).current;

  const totalSeconds = DURATIONS[mode];

  useEffect(() => {
    if (running) {
      startTimeRef.current = Date.now() - (totalSeconds - secondsLeft) * 1000;
      intervalRef.current = setInterval(() => {
        setSecondsLeft(prev => {
          if (prev <= 1) {
            handleComplete();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: 1 - secondsLeft / totalSeconds,
      duration: 200,
      useNativeDriver: false,
    }).start();
  }, [secondsLeft, totalSeconds, progressAnim]);

  const handleComplete = useCallback(() => {
    setRunning(false);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (mode === 'focus') {
      addSession({
        taskTitle,
        mode: 'focus',
        startedAt: new Date(startTimeRef.current),
        duration: DURATIONS.focus,
        completed: true,
      });
      const newCount = cycleCount + 1;
      setCycleCount(newCount);
      setMode(newCount % 4 === 0 ? 'longBreak' : 'shortBreak');
      setSecondsLeft(DURATIONS[newCount % 4 === 0 ? 'longBreak' : 'shortBreak']);
      onComplete?.();
    } else {
      setMode('focus');
      setSecondsLeft(DURATIONS.focus);
    }
  }, [mode, cycleCount, taskTitle, addSession, onComplete]);

  const handleReset = () => {
    setRunning(false);
    if (intervalRef.current) clearInterval(intervalRef.current);
    setSecondsLeft(DURATIONS[mode]);
  };

  const handleModeSwitch = (newMode: Mode) => {
    setMode(newMode);
    setSecondsLeft(DURATIONS[newMode]);
    setRunning(false);
  };

  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  const modeColor = mode === 'focus' ? theme.colors.primary : mode === 'shortBreak' ? theme.colors.success : theme.colors.info;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.container, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: theme.colors.text }]}>专注计时器</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeIcon} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <MaterialIcons name="close" size={22} color={theme.colors.text} />
            </TouchableOpacity>
          </View>

          {taskTitle && (
            <View style={[styles.taskBadge, { backgroundColor: theme.colors.divider }]}>
              <MaterialIcons name="check-circle" size={14} color={theme.colors.primary} />
              <Text style={[styles.taskTitle, { color: theme.colors.textSecondary }]} numberOfLines={1}>
                {taskTitle}
              </Text>
            </View>
          )}

          <View style={styles.modeRow}>
            {(['focus', 'shortBreak', 'longBreak'] as Mode[]).map(m => (
              <TouchableOpacity
                key={m}
                style={[
                  styles.modeChip,
                  { backgroundColor: theme.colors.divider },
                  mode === m && { backgroundColor: modeColor },
                ]}
                onPress={() => handleModeSwitch(m)}
              >
                <Text
                  style={[
                    styles.modeChipText,
                    { color: mode === m ? '#FFFFFF' : theme.colors.textSecondary },
                  ]}
                >
                  {LABELS[m]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.timerWrap}>
            <Animated.View
              style={[
                styles.progressRing,
                { borderColor: theme.colors.divider },
              ]}
            >
              <Animated.View
                style={[
                  styles.progressFill,
                  {
                    borderColor: modeColor,
                    transform: [
                      {
                        rotate: progressAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: ['0deg', '360deg'],
                        }),
                      },
                    ],
                  },
                ]}
              />
            </Animated.View>
            <View style={styles.timerContent}>
              <Text style={[styles.timerText, { color: theme.colors.text }]}>{timeStr}</Text>
              <Text style={[styles.timerLabel, { color: theme.colors.textSecondary }]}>
                {LABELS[mode]} · 第 {cycleCount + 1} 轮
              </Text>
            </View>
          </View>

          <View style={styles.controls}>
            <TouchableOpacity
              style={[styles.controlButton, { backgroundColor: theme.colors.divider }]}
              onPress={handleReset}
            >
              <MaterialIcons name="refresh" size={22} color={theme.colors.text} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.primaryButton, { backgroundColor: modeColor }]}
              onPress={() => setRunning(r => !r)}
            >
              <MaterialIcons name={running ? 'pause' : 'play-arrow'} size={28} color="#FFFFFF" />
              <Text style={styles.primaryButtonText}>{running ? '暂停' : '开始'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.controlButton, { backgroundColor: theme.colors.divider }]}
              onPress={handleComplete}
            >
              <MaterialIcons name="skip-next" size={22} color={theme.colors.text} />
            </TouchableOpacity>
          </View>

          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: theme.colors.text }]}>{cycleCount}</Text>
              <Text style={[styles.statLabel, { color: theme.colors.textSecondary }]}>已完成</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: theme.colors.divider }]} />
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: theme.colors.text }]}>
                {Math.floor(cycleCount * 25)}
              </Text>
              <Text style={[styles.statLabel, { color: theme.colors.textSecondary }]}>总分钟</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: theme.colors.divider }]} />
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: theme.colors.text }]}>
                {userPreferences?.pomodoroSettings?.dailyGoal || 4}
              </Text>
              <Text style={[styles.statLabel, { color: theme.colors.textSecondary }]}>今日目标</Text>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  container: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 24,
    padding: 24,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.25,
    shadowRadius: 32,
    elevation: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  closeIcon: {
    padding: 2,
  },
  taskBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    gap: 6,
    marginBottom: 16,
    alignSelf: 'flex-start',
  },
  taskTitle: {
    fontSize: 12,
    fontWeight: '500',
  },
  modeRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 20,
  },
  modeChip: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: 'center',
  },
  modeChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  timerWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 20,
    position: 'relative',
  },
  progressRing: {
    width: 240,
    height: 240,
    borderRadius: 120,
    borderWidth: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressFill: {
    position: 'absolute',
    width: 240,
    height: 240,
    borderRadius: 120,
    borderWidth: 6,
    borderTopColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: 'transparent',
  },
  timerContent: {
    position: 'absolute',
    alignItems: 'center',
  },
  timerText: {
    fontSize: 56,
    fontWeight: '300',
    letterSpacing: -2,
    fontVariant: ['tabular-nums'],
  },
  timerLabel: {
    fontSize: 13,
    marginTop: 4,
    letterSpacing: 0.3,
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    marginTop: 16,
  },
  controlButton: {
    width: 48,
    height: 48,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    height: 56,
    borderRadius: 18,
    gap: 6,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 24,
    paddingHorizontal: 8,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  statLabel: {
    fontSize: 11,
    marginTop: 2,
    letterSpacing: 0.3,
  },
  statDivider: {
    width: 1,
    height: 24,
  },
});
