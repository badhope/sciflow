import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useAppStore } from '../../store';
import { Task } from '../../types';

export interface TaskSuggestion {
  id: string;
  kind: 'time' | 'priority' | 'merge' | 'subtask' | 'category' | 'tag';
  title: string;
  reason: string;
  confidence: number;
  action?: () => void;
  payload?: any;
}

interface HourBucketStat {
  hour: number;
  completionRate: number;
  count: number;
}

interface CategoryStat {
  categoryId: string;
  count: number;
  avgDurationMs: number;
  preferredHour: number;
}

function bucketCompletedByHour(tasks: Task[]): HourBucketStat[] {
  const buckets: Record<number, { completed: number; total: number }> = {};
  for (let h = 0; h < 24; h++) buckets[h] = { completed: 0, total: 0 };
  for (const t of tasks) {
    if (!t.completedAt) continue;
    const hour = new Date(t.completedAt).getHours();
    buckets[hour].completed += 1;
    buckets[hour].total += 1;
  }
  const arr: HourBucketStat[] = [];
  for (let h = 0; h < 24; h++) {
    arr.push({
      hour: h,
      completionRate: 0,
      count: 0,
    });
  }
  for (const t of tasks) {
    const created = new Date(t.createdAt).getHours();
    buckets[created].total += 1;
    if (t.completedAt) buckets[created].completed += 1;
  }
  for (let h = 0; h < 24; h++) {
    const b = buckets[h];
    arr[h] = {
      hour: h,
      completionRate: b.total > 0 ? b.completed / b.total : 0,
      count: b.completed,
    };
  }
  return arr;
}

function categoryStats(tasks: Task[]): Map<string, CategoryStat> {
  const map = new Map<string, CategoryStat>();
  for (const t of tasks) {
    if (!t.categoryId) continue;
    const existing = map.get(t.categoryId) ?? {
      categoryId: t.categoryId,
      count: 0,
      avgDurationMs: 0,
      preferredHour: 9,
    };
    existing.count += 1;
    if (t.completedAt) {
      const dur = new Date(t.completedAt).getTime() - new Date(t.createdAt).getTime();
      existing.avgDurationMs = (existing.avgDurationMs * (existing.count - 1) + dur) / existing.count;
    }
    const h = t.completedAt ? new Date(t.completedAt).getHours() : new Date(t.createdAt).getHours();
    existing.preferredHour = Math.round((existing.preferredHour + h) / 2);
    map.set(t.categoryId, existing);
  }
  return map;
}

function findSimilarOpenTask(openTasks: Task[], title: string): Task | null {
  const norm = title.toLowerCase().replace(/\s+/g, '').trim();
  if (!norm) return null;
  for (const t of openTasks) {
    const tn = t.title.toLowerCase().replace(/\s+/g, '').trim();
    if (tn === norm) return t;
    if (tn.includes(norm) || norm.includes(tn)) return t;
  }
  return null;
}

function buildPrioritySuggestion(tasks: Task[]): TaskSuggestion | null {
  const open = tasks.filter((t) => !t.completed && !t.isArchived && !t.isDeleted);
  if (open.length === 0) return null;
  const now = Date.now();
  const scored = open
    .map((t) => {
      const overdue = t.dueDate ? Math.max(0, now - new Date(t.dueDate).getTime()) : 0;
      const ageDays = (now - new Date(t.createdAt).getTime()) / (1000 * 60 * 60 * 24);
      const score = overdue / (1000 * 60 * 60 * 24) * 5 + ageDays;
      return { t, score };
    })
    .sort((a, b) => b.score - a.score);
  const top = scored[0];
  if (!top || top.score < 1) return null;
  return {
    id: 'priority-' + top.t.id,
    kind: 'priority',
    title: `将「${top.t.title}」设为紧急优先级`,
    reason: `该任务已创建 ${Math.round((now - new Date(top.t.createdAt).getTime()) / (1000 * 60 * 60 * 24))} 天未完成${top.t.dueDate ? '且已过期' : ''}`,
    confidence: Math.min(0.95, 0.5 + top.score * 0.1),
    payload: { taskId: top.t.id, priority: 'urgent' },
  };
}

function buildTimeSuggestion(buckets: HourBucketStat[]): TaskSuggestion | null {
  const valid = buckets.filter((b) => b.count >= 2);
  if (valid.length === 0) return null;
  valid.sort((a, b) => b.completionRate - a.completionRate);
  const top = valid[0];
  if (top.completionRate < 0.6) return null;
  return {
    id: 'time-' + top.hour,
    kind: 'time',
    title: `将任务安排在 ${top.hour}:00 左右完成`,
    reason: `你在该时段的任务完成率达 ${Math.round(top.completionRate * 100)}% (${top.count} 次)`,
    confidence: top.completionRate,
  };
}

function buildCategorySuggestion(stats: Map<string, CategoryStat>, categories: any[]): TaskSuggestion | null {
  if (stats.size === 0) return null;
  let best: CategoryStat | null = null;
  let bestName = '';
  for (const s of stats.values()) {
    if (!best || s.count > best.count) {
      best = s;
      const cat = categories.find((c) => c.id === s.categoryId);
      bestName = cat?.name ?? '未分类';
    }
  }
  if (!best) return null;
  return {
    id: 'category-' + best.categoryId,
    kind: 'category',
    title: `优先处理「${bestName}」分类下的任务`,
    reason: `你最近在「${bestName}」上最活跃 (${best.count} 个任务)，完成节奏更快`,
    confidence: Math.min(0.9, 0.5 + best.count * 0.05),
    payload: { categoryId: best.categoryId },
  };
}

function buildMergeSuggestion(tasks: Task[]): TaskSuggestion | null {
  const open = tasks.filter((t) => !t.completed && !t.isArchived && !t.isDeleted);
  if (open.length < 2) return null;
  for (const t of open) {
    const similar = findSimilarOpenTask(open.filter((x) => x.id !== t.id), t.title);
    if (similar) {
      return {
        id: 'merge-' + t.id + '-' + similar.id,
        kind: 'merge',
        title: `合并相似任务`,
        reason: `「${t.title}」和「${similar.title}」内容相似，可合并避免重复`,
        confidence: 0.75,
        payload: { keep: t.id, remove: similar.id },
      };
    }
  }
  return null;
}

function buildSubtaskSuggestion(tasks: Task[]): TaskSuggestion | null {
  const open = tasks.filter((t) => !t.completed && !t.isArchived && !t.isDeleted);
  for (const t of open) {
    if (t.description && t.description.length > 30 && !t.subtasks?.length) {
      return {
        id: 'subtask-' + t.id,
        kind: 'subtask',
        title: `将「${t.title}」拆分为子任务`,
        reason: `该任务描述较长 (${t.description.length} 字符)，拆分为子任务可以提高完成率`,
        confidence: 0.7,
        payload: { taskId: t.id },
      };
    }
  }
  return null;
}

export function useTaskSuggestions(limit = 4): TaskSuggestion[] {
  const { tasks, categories } = useAppStore();
  return useMemo(() => {
    const buckets = bucketCompletedByHour(tasks);
    const stats = categoryStats(tasks);
    const candidates: (TaskSuggestion | null)[] = [
      buildPrioritySuggestion(tasks),
      buildTimeSuggestion(buckets),
      buildCategorySuggestion(stats, categories),
      buildMergeSuggestion(tasks),
      buildSubtaskSuggestion(tasks),
    ];
    return candidates
      .filter((c): c is TaskSuggestion => c !== null)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, limit);
  }, [tasks, categories, limit]);
}

export interface TaskSuggestionsProps {
  suggestions?: TaskSuggestion[];
  onApply?: (s: TaskSuggestion) => void;
  onDismiss?: (id: string) => void;
  emptyHint?: string;
}

export function TaskSuggestions({
  suggestions: provided,
  onApply,
  onDismiss,
  emptyHint = '暂无建议 · 继续积累任务历史以获得更智能的推荐',
}: TaskSuggestionsProps) {
  const { theme } = useAppStore();
  const auto = useTaskSuggestions();
  const list = provided ?? auto;

  if (list.length === 0) {
    return (
      <View style={[styles.empty, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
        <MaterialIcons name="auto-awesome" size={20} color={theme.colors.textTertiary} />
        <Text style={[styles.emptyText, { color: theme.colors.textTertiary }]}>{emptyHint}</Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <MaterialIcons name="auto-awesome" size={16} color={theme.colors.primary} />
        <Text style={[styles.headerTitle, { color: theme.colors.text }]}>智能建议</Text>
        <View style={[styles.aiBadge, { backgroundColor: theme.colors.primary + '20' }]}>
          <Text style={[styles.aiBadgeText, { color: theme.colors.primary }]}>AI</Text>
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        nestedScrollEnabled
      >
        {list.map((s) => {
          const kindMeta = kindMap[s.kind];
          return (
            <View
              key={s.id}
              style={[
                styles.card,
                {
                  backgroundColor: theme.colors.card,
                  borderColor: theme.colors.border,
                },
              ]}
            >
              <View style={styles.cardHeader}>
                <View style={[styles.kindIcon, { backgroundColor: kindMeta.color + '20' }]}>
                  <MaterialIcons name={kindMeta.icon as any} size={14} color={kindMeta.color} />
                </View>
                <Text style={[styles.kindLabel, { color: kindMeta.color }]}>{kindMeta.label}</Text>
                {onDismiss && (
                  <TouchableOpacity onPress={() => onDismiss(s.id)} hitSlop={8} style={styles.dismissBtn}>
                    <MaterialIcons name="close" size={14} color={theme.colors.textTertiary} />
                  </TouchableOpacity>
                )}
              </View>

              <Text style={[styles.title, { color: theme.colors.text }]} numberOfLines={2}>
                {s.title}
              </Text>
              <Text style={[styles.reason, { color: theme.colors.textSecondary }]} numberOfLines={3}>
                {s.reason}
              </Text>

              <View style={styles.confidenceRow}>
                <View style={[styles.confidenceBar, { backgroundColor: theme.colors.border }]}>
                  <View
                    style={[
                      styles.confidenceFill,
                      {
                        backgroundColor: kindMeta.color,
                        width: `${Math.round(s.confidence * 100)}%`,
                      },
                    ]}
                  />
                </View>
                <Text style={[styles.confidenceText, { color: theme.colors.textTertiary }]}>
                  {Math.round(s.confidence * 100)}%
                </Text>
              </View>

              {onApply && (
                <TouchableOpacity
                  onPress={() => onApply(s)}
                  activeOpacity={0.85}
                  style={[styles.applyBtn, { backgroundColor: kindMeta.color }]}
                >
                  <Text style={styles.applyText}>应用建议</Text>
                  <MaterialIcons name="arrow-forward" size={14} color="#fff" />
                </TouchableOpacity>
              )}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const kindMap: Record<TaskSuggestion['kind'], { label: string; icon: string; color: string }> = {
  time: { label: '时间', icon: 'schedule', color: '#3b82f6' },
  priority: { label: '优先级', icon: 'priority-high', color: '#ef4444' },
  merge: { label: '合并', icon: 'merge-type', color: '#8b5cf6' },
  subtask: { label: '子任务', icon: 'account-tree', color: '#10b981' },
  category: { label: '分类', icon: 'folder', color: '#f59e0b' },
  tag: { label: '标签', icon: 'label', color: '#06b6d4' },
};

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  headerTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  aiBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    marginLeft: 4,
  },
  aiBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  row: {
    paddingHorizontal: 16,
    paddingBottom: 4,
    gap: 10,
  },
  card: {
    width: 240,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    marginRight: 8,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  kindIcon: {
    width: 22,
    height: 22,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kindLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
    flex: 1,
  },
  dismissBtn: {
    padding: 2,
  },
  title: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
    marginBottom: 4,
  },
  reason: {
    fontSize: 11,
    lineHeight: 15,
    marginBottom: 8,
  },
  confidenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  confidenceBar: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  confidenceFill: {
    height: '100%',
    borderRadius: 2,
  },
  confidenceText: {
    fontSize: 10,
    fontWeight: '600',
    minWidth: 30,
    textAlign: 'right',
  },
  applyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    borderRadius: 8,
    gap: 4,
  },
  applyText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  empty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 20,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  emptyText: {
    fontSize: 12,
    flex: 1,
  },
});
