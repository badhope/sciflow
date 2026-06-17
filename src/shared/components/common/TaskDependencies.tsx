import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useAppStore } from '../../store';
import { Task } from '../../types';

export interface TaskDependenciesProps {
  task: Task;
  onPressTask?: (taskId: string) => void;
}

export function TaskDependencies({ task, onPressTask }: TaskDependenciesProps) {
  const { theme, tasks } = useAppStore();

  const { blockedBy, blocking } = useMemo(() => {
    const all = new Map(tasks.map((t) => [t.id, t]));
    const blockedBy = (task.blockedBy || []).map((id) => all.get(id)).filter(Boolean) as Task[];
    const blocking = (task.dependencies || []).map((id) => all.get(id)).filter(Boolean) as Task[];
    return { blockedBy, blocking };
  }, [task, tasks]);

  if (blockedBy.length === 0 && blocking.length === 0) {
    return (
      <View style={[styles.empty, { backgroundColor: theme.colors.surface }]}>
        <MaterialIcons name="account-tree" size={20} color={theme.colors.textTertiary} />
        <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
          此任务没有依赖关系
        </Text>
      </View>
    );
  }

  const renderItem = (t: Task, kind: 'blockedBy' | 'blocking') => {
    const isBlocked = kind === 'blockedBy' && !t.completed;
    return (
      <TouchableOpacity
        key={t.id}
        style={[
          styles.item,
          {
            backgroundColor: theme.colors.background,
            borderColor: isBlocked ? theme.colors.warning : theme.colors.border,
            borderWidth: isBlocked ? 1.5 : 1,
          },
        ]}
        onPress={() => onPressTask?.(t.id)}
        activeOpacity={0.7}
        disabled={!onPressTask}
      >
        <MaterialIcons
          name={t.completed ? 'check-circle' : isBlocked ? 'block' : 'radio-button-unchecked'}
          size={18}
          color={t.completed ? theme.colors.success : isBlocked ? theme.colors.warning : theme.colors.textTertiary}
        />
        <Text
          style={[
            styles.itemTitle,
            {
              color: t.completed ? theme.colors.textTertiary : theme.colors.text,
              textDecorationLine: t.completed ? 'line-through' : 'none',
            },
          ]}
          numberOfLines={1}
        >
          {t.title}
        </Text>
        {isBlocked && (
          <View style={[styles.badge, { backgroundColor: theme.colors.warning + '20' }]}>
            <Text style={[styles.badgeText, { color: theme.colors.warning }]}>阻塞</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {blockedBy.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <MaterialIcons name="hourglass-empty" size={16} color={theme.colors.warning} />
            <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
              被阻塞于 ({blockedBy.length})
            </Text>
          </View>
          <Text style={[styles.sectionHint, { color: theme.colors.textSecondary }]}>
            完成下列任务后才能开始此任务
          </Text>
          <View style={styles.list}>
            {blockedBy.map((t) => renderItem(t, 'blockedBy'))}
          </View>
        </View>
      )}

      {blocking.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <MaterialIcons name="subdirectory-arrow-right" size={16} color={theme.colors.info} />
            <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
              依赖于本任务 ({blocking.length})
            </Text>
          </View>
          <Text style={[styles.sectionHint, { color: theme.colors.textSecondary }]}>
            完成本任务后才能开始下列任务
          </Text>
          <View style={styles.list}>
            {blocking.map((t) => renderItem(t, 'blocking'))}
          </View>
        </View>
      )}
    </View>
  );
}

interface DependencyGraphProps {
  taskIds: string[];
  onPressTask?: (id: string) => void;
}

export function DependencyGraph({ taskIds, onPressTask }: DependencyGraphProps) {
  const { theme, tasks } = useAppStore();
  const idSet = useMemo(() => new Set(taskIds), [taskIds]);
  const subset = tasks.filter((t) => idSet.has(t.id));
  const edges = useMemo(() => {
    const e: { from: string; to: string }[] = [];
    subset.forEach((t) => {
      (t.dependencies || []).forEach((depId) => {
        if (idSet.has(depId)) e.push({ from: depId, to: t.id });
      });
    });
    return e;
  }, [subset, idSet]);

  if (subset.length === 0) {
    return (
      <View style={[styles.empty, { backgroundColor: theme.colors.surface }]}>
        <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
          暂无关联任务
        </Text>
      </View>
    );
  }

  const byId = new Map(subset.map((t) => [t.id, t]));
  const depth = (id: string, seen = new Set<string>()): number => {
    if (seen.has(id)) return 0;
    seen.add(id);
    const t = byId.get(id);
    if (!t || !t.dependencies?.length) return 0;
    return 1 + Math.max(0, ...t.dependencies.filter((d) => idSet.has(d)).map((d) => depth(d, seen)));
  };

  const levels = new Map<string, number>();
  subset.forEach((t) => levels.set(t.id, depth(t.id)));

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={styles.graph}>
        {Array.from(new Set(levels.values())).sort().map((lvl) => (
          <View key={lvl} style={styles.column}>
            <Text style={[styles.columnTitle, { color: theme.colors.textSecondary }]}>
              Level {lvl + 1}
            </Text>
            {subset
              .filter((t) => levels.get(t.id) === lvl)
              .map((t) => (
                <TouchableOpacity
                  key={t.id}
                  style={[
                    styles.node,
                    {
                      backgroundColor: t.completed
                        ? theme.colors.success + '20'
                        : theme.colors.card,
                      borderColor: t.completed ? theme.colors.success : theme.colors.primary,
                    },
                  ]}
                  onPress={() => onPressTask?.(t.id)}
                  activeOpacity={0.7}
                  disabled={!onPressTask}
                >
                  <Text
                    style={[
                      styles.nodeText,
                      { color: t.completed ? theme.colors.textTertiary : theme.colors.text },
                    ]}
                    numberOfLines={2}
                  >
                    {t.title}
                  </Text>
                </TouchableOpacity>
              ))}
          </View>
        ))}
        {edges.length > 0 && (
          <View style={styles.edgeInfo}>
            <MaterialIcons name="east" size={14} color={theme.colors.textSecondary} />
            <Text style={[styles.edgeText, { color: theme.colors.textSecondary }]}>
              {edges.length} 条依赖
            </Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 16,
  },
  section: {
    gap: 8,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  sectionHint: {
    fontSize: 12,
    marginLeft: 22,
  },
  list: {
    gap: 6,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 10,
    gap: 10,
  },
  itemTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  empty: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    gap: 8,
  },
  emptyText: {
    fontSize: 13,
  },
  graph: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
    padding: 8,
  },
  column: {
    minWidth: 140,
    gap: 8,
  },
  columnTitle: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  node: {
    padding: 10,
    borderRadius: 10,
    borderWidth: 1.5,
    minHeight: 56,
    justifyContent: 'center',
  },
  nodeText: {
    fontSize: 12,
    fontWeight: '500',
  },
  edgeInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: 8,
    alignSelf: 'center',
  },
  edgeText: {
    fontSize: 11,
  },
});
