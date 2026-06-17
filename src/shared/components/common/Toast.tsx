import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
  Platform,
  SafeAreaView,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useAppStore } from '../../store';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastConfig {
  id: string;
  type: ToastType;
  message: string;
  description?: string;
  action?: {
    label: string;
    onPress: () => void;
  };
  duration?: number;
}

let toastQueue: ToastConfig[] = [];
let listeners: Array<(toast: ToastConfig | null) => void> = [];

export function showToast(config: Omit<ToastConfig, 'id'>) {
  const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const toast: ToastConfig = { id, duration: 3500, ...config };
  toastQueue.push(toast);
  listeners.forEach(l => l(toastQueue[0] || null));
  if (!config.action) {
    setTimeout(() => dismissToast(id), toast.duration);
  }
}

export function dismissToast(id: string) {
  toastQueue = toastQueue.filter(t => t.id !== id);
  listeners.forEach(l => l(toastQueue[0] || null));
}

export const toast = {
  success: (message: string, description?: string) => showToast({ type: 'success', message, description }),
  error: (message: string, description?: string) => showToast({ type: 'error', message, description }),
  info: (message: string, description?: string) => showToast({ type: 'info', message, description }),
  warning: (message: string, description?: string) => showToast({ type: 'warning', message, description }),
  withAction: (message: string, actionLabel: string, action: () => void, type: ToastType = 'info') => {
    showToast({ type, message, action: { label: actionLabel, onPress: action }, duration: 5000 });
  },
};

export function ToastContainer() {
  const { theme } = useAppStore();
  const [current, setCurrent] = useState<ToastConfig | null>(null);
  const translateY = useRef(new Animated.Value(100)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const handler = (toast: ToastConfig | null) => setCurrent(toast);
    listeners.push(handler);
    return () => {
      listeners = listeners.filter(l => l !== handler);
    };
  }, []);

  useEffect(() => {
    if (current) {
      Animated.parallel([
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 6 }),
        Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(translateY, { toValue: 100, duration: 180, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true }),
      ]).start();
    }
  }, [current, translateY, opacity]);

  if (!current) return null;

  const colors = {
    success: { bg: theme.colors.success, icon: 'check-circle' },
    error: { bg: theme.colors.error, icon: 'error' },
    info: { bg: theme.colors.primary, icon: 'info' },
    warning: { bg: theme.colors.warning, icon: 'warning' },
  }[current.type];

  return (
    <SafeAreaView pointerEvents="box-none" style={styles.safeArea}>
      <Animated.View
        pointerEvents={current ? 'auto' : 'none'}
        style={[
          styles.container,
          {
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.border,
            shadowColor: '#000',
            transform: [{ translateY }],
            opacity,
          },
        ]}
      >
        <View style={[styles.iconWrap, { backgroundColor: colors.bg + '20' }]}>
          <MaterialIcons name={colors.icon as any} size={22} color={colors.bg} />
        </View>
        <View style={styles.textWrap}>
          <Text style={[styles.message, { color: theme.colors.text }]} numberOfLines={2}>
            {current.message}
          </Text>
          {current.description && (
            <Text style={[styles.description, { color: theme.colors.textSecondary }]} numberOfLines={2}>
              {current.description}
            </Text>
          )}
        </View>
        {current.action && (
          <TouchableOpacity
            onPress={() => {
              current.action?.onPress();
              dismissToast(current.id);
            }}
            style={styles.actionButton}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={[styles.actionText, { color: theme.colors.primary }]}>
              {current.action.label}
            </Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          onPress={() => dismissToast(current.id)}
          style={styles.closeButton}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <MaterialIcons name="close" size={18} color={theme.colors.textTertiary} />
        </TouchableOpacity>
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingBottom: Platform.select({ ios: 96, android: 88, default: 88 }),
    zIndex: 9999,
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 10,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 12,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  textWrap: {
    flex: 1,
  },
  message: {
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: -0.1,
  },
  description: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  actionButton: {
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  actionText: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  closeButton: {
    padding: 2,
  },
});
