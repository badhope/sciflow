import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useAppStore } from '../../store';
import { Task } from '../../types';

interface TimelineViewProps {
  tasks: Task[];
  onTaskPress?: (taskId: string) => void;
}

export const TimelineView: React.FC<TimelineViewProps> = ({ tasks, onTaskPress }) => {
  const { theme } = useAppStore();

  const sortedTasks = useMemo(() => {
    return tasks
      .filter((task) => task.dueDate && !task.isDeleted)
      .sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime());
  }, [tasks]);

  const groupedTasks = useMemo(() => {
    const groups: Record<string, Task[]> = {};
    
    sortedTasks.forEach((task) => {
      const dateKey = new Date(task.dueDate!).toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
      
      if (!groups[dateKey]) {
        groups[dateKey] = [];
      }
      groups[dateKey].push(task);
    });

    return groups;
  }, [sortedTasks]);

  const getStatusColor = (status: string): string => {
    const colors: Record<string, string> = {
      'todo': '#6b7280',
      'in-progress': '#3b82f6',
      'waiting': '#8b5cf6',
      'delegated': '#f59e0b',
      'completed': '#10b981',
      'cancelled': '#ef4444',
      'on-hold': '#6b7280',
    };
    return colors[status] || theme.colors.primary;
  };

  const getPriorityColor = (priority: string): string => {
    const colors: Record<string, string> = {
      low: '#10b981',
      medium: '#f59e0b',
      high: '#f97316',
      urgent: '#ef4444',
      critical: '#dc2626',
    };
    return colors[priority] || theme.colors.primary;
  };

  const getRelativeTime = (date: Date): { text: string; color: string } => {
    const now = new Date();
    const diff = date.getTime() - now.getTime();
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));

    if (days === 0) return { text: '今天', color: '#3b82f6' };
    if (days === 1) return { text: '明天', color: '#8b5cf6' };
    if (days === -1) return { text: '昨天', color: '#ef4444' };
    if (days < -1) return { text: `${Math.abs(days)}天前`, color: '#ef4444' };
    if (days <= 7) return { text: `${days}天后`, color: '#10b981' };
    return { text: `${days}天后`, color: '#6b7280' };
  };

  const isOverdue = (task: Task): boolean => {
    return !!(task.dueDate && new Date(task.dueDate) < new Date() && !task.completed);
  };

  const renderTaskCard = (task: Task) => {
    const overdue = isOverdue(task);
    const relativeTime = getRelativeTime(new Date(task.dueDate!));

    return (
      <TouchableOpacity
        key={task.id}
        style={[
          styles.taskCard,
          { backgroundColor: theme.colors.surface },
          overdue && styles.taskCardOverdue,
        ]}
        onPress={() => onTaskPress?.(task.id)}
      >
        <View style={styles.taskCardContent}>
          <View style={styles.taskTimeColumn}>
            {task.dueTime && (
              <Text style={[styles.taskTime, { color: theme.colors.textSecondary }]}>
                {new Date(task.dueTime).toLocaleTimeString('zh-CN', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </Text>
            )}
          </View>

          <View
            style={[
              styles.taskIndicator,
              { backgroundColor: getStatusColor(task.status) },
            ]}
          />

          <View style={styles.taskInfo}>
            <View style={styles.taskHeader}>
              <Text
                style={[
                  styles.taskTitle,
                  { color: theme.colors.text },
                  task.completed && styles.taskTitleCompleted,
                ]}
                numberOfLines={2}
              >
                {task.title}
              </Text>
            </View>

            <View style={styles.taskMeta}>
              <View
                style={[
                  styles.priorityBadge,
                  { backgroundColor: getPriorityColor(task.priority) + '20' },
                ]}
              >
                <Text
                  style={[
                    styles.priorityText,
                    { color: getPriorityColor(task.priority) },
                  ]}
                >
                  {task.priority === 'critical' ? '紧急且重要' :
                   task.priority === 'urgent' ? '紧急' :
                   task.priority === 'high' ? '高' :
                   task.priority === 'medium' ? '中' : '低'}
                </Text>
              </View>

              <Text
                style={[
                  styles.relativeTime,
                  { color: relativeTime.color },
                ]}
              >
                {relativeTime.text}
              </Text>
            </View>

            {task.description && (
              <Text
                style={[styles.taskDescription, { color: theme.colors.textSecondary }]}
                numberOfLines={2}
              >
                {task.description}
              </Text>
            )}

            <View style={styles.taskFooter}>
              {task.subtasks.length > 0 && (
                <View style={styles.taskStat}>
                  <MaterialIcons name="check-circle" size={11} color={theme.colors.textSecondary} />
                  <Text style={[styles.taskStatText, { color: theme.colors.textSecondary }]}>
                    {' '}{task.subtasks.filter((s) => s.completed).length}/{task.subtasks.length}
                  </Text>
                </View>
              )}

              {task.tags.length > 0 && (
                <View style={styles.taskStat}>
                  <MaterialIcons name="label" size={11} color={theme.colors.textSecondary} />
                  <Text style={[styles.taskStatText, { color: theme.colors.textSecondary }]}>
                    {' '}{task.tags.length}
                  </Text>
                </View>
              )}

              {task.estimatedTime && (
                <View style={styles.taskStat}>
                  <MaterialIcons name="timer" size={11} color={theme.colors.textSecondary} />
                  <Text style={[styles.taskStatText, { color: theme.colors.textSecondary }]}>
                    {' '}{task.estimatedTime}分钟
                  </Text>
                </View>
              )}
            </View>
          </View>

          {task.completed && (
            <View style={[styles.completedBadge, { backgroundColor: '#10b981' }]}>
              <MaterialIcons name="check" size={14} color="#FFFFFF" />
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  const renderTimelineGroup = (date: string, tasks: Task[]) => (
    <View key={date} style={styles.timelineGroup}>
      <View style={styles.timelineDateHeader}>
        <View style={[styles.timelineDot, { backgroundColor: theme.colors.primary }]} />
        <Text style={[styles.timelineDate, { color: theme.colors.text }]}>{date}</Text>
        <View style={[styles.timelineLine, { backgroundColor: theme.colors.border }]} />
      </View>

      <View style={styles.timelineItems}>
        {tasks.map(renderTaskCard)}
      </View>
    </View>
  );

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <MaterialIcons name="access-time" size={64} color={theme.colors.textSecondary} style={{ marginBottom: 16 }} />
      <Text style={[styles.emptyTitle, { color: theme.colors.text }]}>暂无任务</Text>
      <Text style={[styles.emptySubtitle, { color: theme.colors.textSecondary }]}>
        为任务设置截止日期以在时间线中显示
      </Text>
    </View>
  );

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: theme.colors.text }]}>
          时间线视图
        </Text>
        <Text style={[styles.headerCount, { color: theme.colors.textSecondary }]}>
          {sortedTasks.length} 个任务
        </Text>
      </View>

      {Object.entries(groupedTasks).length > 0 ? (
        Object.entries(groupedTasks).map(([date, tasks]) =>
          renderTimelineGroup(date, tasks)
        )
      ) : (
        renderEmptyState()
      )}

      <View style={styles.bottomPadding} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  headerCount: {
    fontSize: 14,
  },
  timelineGroup: {
    marginBottom: 24,
  },
  timelineDateHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  timelineDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 12,
  },
  timelineDate: {
    fontSize: 16,
    fontWeight: '600',
  },
  timelineLine: {
    flex: 1,
    height: 1,
    marginLeft: 12,
  },
  timelineItems: {
    marginLeft: 6,
    paddingLeft: 18,
    borderLeftWidth: 2,
    borderLeftColor: 'rgba(0,0,0,0.1)',
  },
  taskCard: {
    marginBottom: 12,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  taskCardOverdue: {
    borderLeftWidth: 4,
    borderLeftColor: '#ef4444',
  },
  taskCardContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 16,
  },
  taskTimeColumn: {
    width: 60,
    marginRight: 12,
  },
  taskTime: {
    fontSize: 12,
    fontWeight: '600',
  },
  taskIndicator: {
    width: 4,
    height: 40,
    borderRadius: 2,
    marginRight: 12,
  },
  taskInfo: {
    flex: 1,
  },
  taskHeader: {
    marginBottom: 8,
  },
  taskTitle: {
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 22,
  },
  taskTitleCompleted: {
    textDecorationLine: 'line-through',
    opacity: 0.6,
  },
  taskMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  priorityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    marginRight: 8,
  },
  priorityText: {
    fontSize: 11,
    fontWeight: '600',
  },
  relativeTime: {
    fontSize: 12,
    fontWeight: '500',
  },
  taskDescription: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 8,
  },
  taskFooter: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  taskStat: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 12,
    marginBottom: 4,
  },
  taskStatText: {
    fontSize: 11,
  },
  completedBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  completedBadgeText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 'bold',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
    marginTop: 60,
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
  },
  bottomPadding: {
    height: 40,
  },
});
