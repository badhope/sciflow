import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useAppStore } from '../../store';

export interface MultiSelectAction {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  onPress: () => void;
  color?: 'primary' | 'error' | 'warning' | 'success';
  destructive?: boolean;
}

interface MultiSelectBarProps {
  count: number;
  total: number;
  onSelectAll: () => void;
  onClear: () => void;
  onExit: () => void;
  actions: MultiSelectAction[];
}

const COLOR_MAP = {
  primary: { bg: '#3b82f6', fg: '#FFFFFF' },
  error: { bg: '#ef4444', fg: '#FFFFFF' },
  warning: { bg: '#f59e0b', fg: '#FFFFFF' },
  success: { bg: '#10b981', fg: '#FFFFFF' },
};

export function MultiSelectBar({
  count,
  total,
  onSelectAll,
  onClear,
  onExit,
  actions,
}: MultiSelectBarProps) {
  const { theme } = useAppStore();
  const allSelected = count > 0 && count === total;

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.border,
        },
      ]}
    >
      <View style={styles.leftSection}>
        <TouchableOpacity onPress={onExit} style={styles.iconBtn} hitSlop={8}>
          <MaterialIcons name="close" size={22} color={theme.colors.text} />
        </TouchableOpacity>
        <View>
          <Text style={[styles.countText, { color: theme.colors.text }]}>
            {count > 0 ? `已选 ${count}` : '选择项目'}
          </Text>
          {total > 0 && (
            <TouchableOpacity onPress={allSelected ? onClear : onSelectAll}>
              <Text style={[styles.selectAllText, { color: theme.colors.primary }]}>
                {allSelected ? '取消全选' : `全选 (${total})`}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
      <View style={styles.actions}>
        {actions.map((a, i) => {
          const c = a.destructive ? COLOR_MAP.error : COLOR_MAP[a.color || 'primary'];
          const disabled = count === 0;
          return (
            <TouchableOpacity
              key={i}
              style={[
                styles.actionBtn,
                { backgroundColor: c.bg + (disabled ? '40' : '') },
              ]}
              onPress={a.onPress}
              disabled={disabled}
            >
              <MaterialIcons name={a.icon} size={20} color={disabled ? theme.colors.textTertiary : c.fg} />
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 16,
    borderTopWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 8,
  },
  leftSection: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  iconBtn: {
    padding: 8,
    marginRight: 4,
  },
  countText: {
    fontSize: 14,
    fontWeight: '700',
  },
  selectAllText: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
