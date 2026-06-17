import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Animated,
  Easing,
  Vibration,
  Platform,
  Dimensions,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useAppStore } from '../../store';
import { WhiteNoisePlayer } from './WhiteNoisePlayer';

export interface FocusModeProps {
  visible: boolean;
  onClose: () => void;
  taskTitle?: string;
  onComplete?: () => void;
}

type Phase = 'focus' | 'shortBreak' | 'longBreak';
const DURATIONS: Record<Phase, number> = { focus: 25 * 60, shortBreak: 5 * 60, longBreak: 15 * 60 };
const LABELS: Record<Phase, string> = { focus: '专注', shortBreak: '短休息', longBreak: '长休息' };

const { width } = Dimensions.get('window');
const CIRCLE_SIZE = Math.min(width * 0.7, 320);
const STROKE = 8;

export function FocusMode({ visible, onClose, taskTitle, onComplete }: FocusModeProps) {
  const { addSession } = useAppStore();
  const [phase, setPhase] = useState<Phase>('focus');
  const [remaining, setRemaining] = useState(DURATIONS.focus);
  const [running, setRunning] = useState(false);
  const [cycle, setCycle] = useState(0);
  const [showNoisePanel, setShowNoisePanel] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAt = useRef<Date | null>(null);
  const breathe = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setPhase('focus');
      setRemaining(DURATIONS.focus);
      setCycle(0);
      setRunning(false);
      startedAt.current = null;
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
  }, [visible]);

  useEffect(() => {
    if (running) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(breathe, {
            toValue: 1,
            duration: 4000,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(breathe, {
            toValue: 0,
            duration: 4000,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ])
      );
      loop.start();
      return () => loop.stop();
    }
  }, [running, breathe]);

  const handleCompletePhase = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setRunning(false);
    if (Platform.OS !== 'web') Vibration.vibrate(200);
    if (phase === 'focus' && startedAt.current) {
      addSession({
        taskTitle,
        mode: 'focus',
        startedAt: startedAt.current,
        duration: DURATIONS.focus,
        completed: true,
      });
      onComplete?.();
    }
    const nextCycle = cycle + 1;
    if (nextCycle % 4 === 0) {
      setPhase('longBreak');
      setRemaining(DURATIONS.longBreak);
    } else {
      setPhase('shortBreak');
      setRemaining(DURATIONS.shortBreak);
    }
    setCycle(nextCycle);
  }, [phase, cycle, taskTitle, addSession, onComplete]);

  useEffect(() => {
    if (running) {
      intervalRef.current = setInterval(() => {
        setRemaining((r) => {
          if (r <= 1) {
            handleCompletePhase();
            return 0;
          }
          return r - 1;
        });
      }, 1000);
      return () => {
        if (intervalRef.current) clearInterval(intervalRef.current);
      };
    }
  }, [running, handleCompletePhase]);

  const handleStart = () => {
    if (!running && !startedAt.current) startedAt.current = new Date();
    setRunning(true);
  };

  const handlePause = () => setRunning(false);

  const handleReset = () => {
    setRunning(false);
    setRemaining(DURATIONS[phase]);
    startedAt.current = null;
  };

  const handleSkip = () => {
    handleCompletePhase();
  };

  const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
  const ss = String(remaining % 60).padStart(2, '0');
  const phaseColor = phase === 'focus' ? '#10b981' : phase === 'shortBreak' ? '#3b82f6' : '#8b5cf6';

  const breatheScale = breathe.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.06],
  });

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={[styles.container, { backgroundColor: '#0a0e1a' }]}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={onClose} style={styles.iconBtn} hitSlop={10}>
            <MaterialIcons name="close" size={26} color="rgba(255,255,255,0.6)" />
          </TouchableOpacity>
          <View style={styles.cycleIndicator}>
            {[0, 1, 2, 3].map((i) => (
              <View
                key={i}
                style={[
                  styles.cycleDot,
                  { backgroundColor: i < cycle % 4 ? phaseColor : 'rgba(255,255,255,0.15)' },
                ]}
              />
            ))}
          </View>
          <View style={styles.iconBtn} />
        </View>

        {taskTitle && (
          <View style={styles.taskWrap}>
            <MaterialIcons name="radio-button-checked" size={14} color={phaseColor} />
            <Text style={styles.taskTitle} numberOfLines={1}>
              {taskTitle}
            </Text>
          </View>
        )}

        <View style={styles.phaseRow}>
          {(['focus', 'shortBreak', 'longBreak'] as Phase[]).map((p) => (
            <TouchableOpacity
              key={p}
              style={[
                styles.phasePill,
                phase === p && { backgroundColor: phaseColor + '30', borderColor: phaseColor },
              ]}
              onPress={() => {
                if (!running) {
                  setPhase(p);
                  setRemaining(DURATIONS[p]);
                }
              }}
              disabled={running}
            >
              <Text
                style={[
                  styles.phasePillText,
                  { color: phase === p ? phaseColor : 'rgba(255,255,255,0.4)' },
                ]}
              >
                {LABELS[p]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.timerWrap}>
          <Animated.View
            style={[
              styles.circle,
              {
                width: CIRCLE_SIZE,
                height: CIRCLE_SIZE,
                transform: running ? [{ scale: breatheScale }] : undefined,
              },
            ]}
          >
            <View
              style={[
                { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
                styles.ringTrack,
                {
                  borderRadius: CIRCLE_SIZE / 2,
                  borderWidth: STROKE,
                  borderColor: 'rgba(255,255,255,0.08)',
                },
              ]}
            />
            <View
              style={[
                styles.ringProgress,
                {
                  width: CIRCLE_SIZE,
                  height: CIRCLE_SIZE,
                  borderRadius: CIRCLE_SIZE / 2,
                  borderWidth: STROKE,
                  borderColor: phaseColor,
                  borderTopColor: 'transparent',
                  borderRightColor: 'transparent',
                  transform: [{ rotate: '-45deg' }],
                },
              ]}
            />
            <View style={styles.timerInner}>
              <Text style={styles.timerText}>
                {mm}:{ss}
              </Text>
              <Text style={styles.timerLabel}>
                {LABELS[phase]} · 第 {cycle + 1} 回合
              </Text>
            </View>
          </Animated.View>
        </View>

        <View style={styles.controls}>
          <TouchableOpacity
            style={[styles.controlBtn, { backgroundColor: 'rgba(255,255,255,0.08)' }]}
            onPress={handleReset}
          >
            <MaterialIcons name="refresh" size={22} color="rgba(255,255,255,0.7)" />
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.controlBtn,
              { backgroundColor: showNoisePanel ? phaseColor : 'rgba(255,255,255,0.08)' },
            ]}
            onPress={() => setShowNoisePanel((v) => !v)}
            accessibilityLabel="切换白噪声"
          >
            <MaterialIcons
              name={showNoisePanel ? 'volume-up' : 'music-note'}
              size={22}
              color={showNoisePanel ? '#FFFFFF' : 'rgba(255,255,255,0.7)'}
            />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.playBtn, { backgroundColor: phaseColor }]}
            onPress={running ? handlePause : handleStart}
            activeOpacity={0.85}
          >
            <MaterialIcons
              name={running ? 'pause' : 'play-arrow'}
              size={36}
              color="#FFFFFF"
            />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.controlBtn, { backgroundColor: 'rgba(255,255,255,0.08)' }]}
            onPress={handleSkip}
          >
            <MaterialIcons name="skip-next" size={22} color="rgba(255,255,255,0.7)" />
          </TouchableOpacity>
        </View>

        {showNoisePanel && (
          <View style={styles.noiseWrap}>
            <WhiteNoisePlayer autoStart={false} />
          </View>
        )}

        <Text style={styles.hint}>
          关闭手机通知 · 专注于当下任务
        </Text>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: Platform.OS === 'ios' ? 50 : 24,
    paddingHorizontal: 24,
    paddingBottom: 32,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 44,
  },
  iconBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cycleIndicator: {
    flexDirection: 'row',
    gap: 6,
  },
  cycleDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  taskWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
    gap: 6,
  },
  taskTitle: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 14,
    fontWeight: '500',
    maxWidth: 280,
  },
  phaseRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginTop: 24,
  },
  phasePill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  phasePillText: {
    fontSize: 12,
    fontWeight: '600',
  },
  timerWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringTrack: {
    position: 'absolute',
  },
  ringProgress: {
    position: 'absolute',
  },
  timerInner: {
    alignItems: 'center',
  },
  timerText: {
    color: '#FFFFFF',
    fontSize: 72,
    fontWeight: '200',
    letterSpacing: 2,
    fontVariant: ['tabular-nums'],
  },
  timerLabel: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 13,
    fontWeight: '500',
    marginTop: 8,
    letterSpacing: 0.5,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    marginBottom: 20,
  },
  controlBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#10b981',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 8,
  },
  hint: {
    textAlign: 'center',
    color: 'rgba(255,255,255,0.35)',
    fontSize: 12,
    fontStyle: 'italic',
  },
  noiseWrap: {
    marginBottom: 16,
  },
});
