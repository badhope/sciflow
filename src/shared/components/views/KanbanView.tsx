import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useAppStore } from '../../store';
import { Task, TaskStatus, Priority } from '../../types';

const { width } = Dimensions.get('window');

const KANBAN_COLUMNS: { status: TaskStatus; title: string; color: string }[] = [
  { status: 'todo', title: '待办', color: '#6b7280' },
  { status: 'in-progress', title: '进行中', color: '#3b82f6' },
  { status: 'waiting', title: '等待中', color: '#8b5cf6' },
  { status: 'delegated', title: '已委托', color: '#f59e0b' },
  { status: 'completed', title: '已完成', color: '#10b981' },
];

const PRIORITY_COLORS: Record<Priority, string> = {
  low: '#10b981',
  medium: '#f59e0b',
  high: '#f97316',
  urgent: '#ef4444',
  critical: '#dc2626',
};

interface KanbanViewProps {
  tasks: Task[];
  onTaskPress?: (taskId: string) => void;
}

export const KanbanView: React.FC<KanbanViewProps> = ({ tasks, onTaskPress }) => {
  const { theme } = useAppStore();

  const tasksByStatus = useMemo(() => {
    const grouped: Record<TaskStatus, Task[]> = {
      'todo': [],
      'in-progress': [],
      'waiting': [],
      'delegated': [],
      'completed': [],
      'cancelled': [],
      'on-hold': [],
    };

    tasks.forEach((task) => {
      if (!task.isDeleted) {
        grouped[task.status].push(task);
      }
    });

    return grouped;
  }, [tasks]);

  const renderTaskCard = (task: Task) => {
    const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && !task.completed;

    return (
      <TouchableOpacity
        key={task.id}
        style={[
          styles.taskCard,
          { backgroundColor: theme.colors.surface },
          isOverdue && { borderLeftColor: theme.colors.error, borderLeftWidth: 3 },
        ]}
        onPress={() => onTaskPress?.(task.id)}
      >
        <View style={styles.taskCardHeader}>
          <View
            style={[
              styles.priorityIndicator,
              { backgroundColor: PRIORITY_COLORS[task.priority] },
            ]}
          />
          <Text
            style={[styles.taskTitle, { color: theme.colors.text }]}
            numberOfLines={2}
          >
            {task.title}
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

        <View style={styles.taskCardFooter}>
          {task.dueDate && (
            <View style={styles.taskMeta}>
              <MaterialIcons name="calendar-today" size={11} color={isOverdue ? theme.colors.error : theme.colors.textSecondary} />
              <Text style={[styles.taskMetaText, { color: isOverdue ? theme.colors.error : theme.colors.textSecondary }]}>
                {' '}{new Date(task.dueDate).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
              </Text>
            </View>
          )}

          {task.subtasks.length > 0 && (
            <View style={styles.taskMeta}>
              <MaterialIcons name="check-circle" size={11} color={theme.colors.textSecondary} />
              <Text style={[styles.taskMetaText, { color: theme.colors.textSecondary }]}>
                {' '}{task.subtasks.filter((s) => s.completed).length}/{task.subtasks.length}
              </Text>
            </View>
          )}

          {task.tags.length > 0 && (
            <View style={styles.taskMeta}>
              <MaterialIcons name="label" size={11} color={theme.colors.textSecondary} />
              <Text style={[styles.taskMetaText, { color: theme.colors.textSecondary }]}>
                {' '}{task.tags.length}
              </Text>
            </View>
          )}
        </View>

        {task.estimatedTime && (
          <View style={styles.taskTime}>
            <View style={styles.taskMetaRow}>
              <MaterialIcons name="timer" size={11} color={theme.colors.textSecondary} />
              <Text style={[styles.taskTimeText, { color: theme.colors.textSecondary }]}>
                {' '}{task.estimatedTime}分钟
              </Text>
            </View>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  const renderColumn = (column: typeof KANBAN_COLUMNS[0]) => {
    const columnTasks = tasksByStatus[column.status] || [];

    return (
      <View key={column.status} style={styles.column}>
        <View style={styles.columnHeader}>
          <View style={[styles.columnTitleContainer, { backgroundColor: column.color }]}>
            <Text style={styles.columnTitle}>{column.title}</Text>
          </View>
          <View style={[styles.columnCount, { backgroundColor: column.color + '20' }]}>
            <Text style={[styles.columnCountText, { color: column.color }]}>
              {columnTasks.length}
            </Text>
          </View>
        </View>

        <ScrollView
          style={styles.columnContent}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.columnContentContainer}
        >
          {columnTasks.map(renderTaskCard)}
          
          {columnTasks.length === 0 && (
            <View style={[styles.emptyColumn, { backgroundColor: theme.colors.background }]}>
              <Text style={[styles.emptyColumnText, { color: theme.colors.textSecondary }]}>
                暂无任务
              </Text>
            </View>
          )}
        </ScrollView>
      </View>
    );
  };

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
    >
      {KANBAN_COLUMNS.map(renderColumn)}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: 8,
  },
  column: {
    width: width * 0.75,
    marginHorizontal: 8,
  },
  columnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  columnTitleContainer: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  columnTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  columnCount: {
    marginLeft: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  columnCountText: {
    fontSize: 12,
    fontWeight: '600',
  },
  columnContent: {
    flex: 1,
  },
  columnContentContainer: {
    paddingBottom: 20,
  },
  taskCard: {
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  taskCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  priorityIndicator: {
    width: 4,
    height: 20,
    borderRadius: 2,
    marginRight: 8,
  },
  taskTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
  },
  taskDescription: {
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 8,
  },
  taskCardFooter: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
  },
  taskMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 12,
    marginBottom: 4,
  },
  taskMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  taskMetaText: {
    fontSize: 11,
  },
  taskTime: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.05)',
  },
  taskTimeText: {
    fontSize: 11,
  },
  emptyColumn: {
    padding: 24,
    borderRadius: 8,
    alignItems: 'center',
  },
  emptyColumnText: {
    fontSize: 13,
  },
});
