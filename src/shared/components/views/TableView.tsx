import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useAppStore } from '../../store';
import { Task, Priority, TaskStatus } from '../../types';

interface Column {
  key: string;
  title: string;
  width: number;
  sortable?: boolean;
}

interface TableViewProps {
  tasks: Task[];
  onTaskPress?: (taskId: string) => void;
}

const COLUMNS: Column[] = [
  { key: 'checkbox', title: '', width: 40 },
  { key: 'title', title: '任务', width: 200, sortable: true },
  { key: 'status', title: '状态', width: 100, sortable: true },
  { key: 'priority', title: '优先级', width: 100, sortable: true },
  { key: 'dueDate', title: '截止日期', width: 120, sortable: true },
  { key: 'project', title: '项目', width: 120 },
  { key: 'category', title: '分类', width: 100 },
  { key: 'tags', title: '标签', width: 80 },
  { key: 'progress', title: '进度', width: 80 },
];

export const TableView: React.FC<TableViewProps> = ({ tasks, onTaskPress }) => {
  const { theme, projects, categories, tags, toggleTaskComplete } = useAppStore();
  const [sortBy, setSortBy] = useState<string | null>('dueDate');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  const sortedTasks = useMemo(() => {
    const result = [...tasks].filter((t) => !t.isDeleted);

    if (sortBy) {
      result.sort((a, b) => {
        let comparison = 0;

        switch (sortBy) {
          case 'title':
            comparison = a.title.localeCompare(b.title);
            break;
          case 'status':
            comparison = a.status.localeCompare(b.status);
            break;
          case 'priority': {
            const priorityOrder = { critical: 0, urgent: 1, high: 2, medium: 3, low: 4 };
            comparison = priorityOrder[a.priority] - priorityOrder[b.priority];
            break;
          }
          case 'dueDate': {
            const aDate = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
            const bDate = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
            comparison = aDate - bDate;
            break;
          }
          default:
            comparison = 0;
        }

        return sortOrder === 'asc' ? comparison : -comparison;
      });
    }

    return result;
  }, [tasks, sortBy, sortOrder]);

  const handleSort = (columnKey: string) => {
    if (sortBy === columnKey) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(columnKey);
      setSortOrder('asc');
    }
  };

  const getStatusLabel = (status: TaskStatus): string => {
    const labels: Record<TaskStatus, string> = {
      'todo': '待办',
      'in-progress': '进行中',
      'waiting': '等待中',
      'delegated': '已委托',
      'completed': '已完成',
      'cancelled': '已取消',
      'on-hold': '暂停',
    };
    return labels[status];
  };

  const getStatusColor = (status: TaskStatus): string => {
    const colors: Record<TaskStatus, string> = {
      'todo': '#6b7280',
      'in-progress': '#3b82f6',
      'waiting': '#8b5cf6',
      'delegated': '#f59e0b',
      'completed': '#10b981',
      'cancelled': '#ef4444',
      'on-hold': '#6b7280',
    };
    return colors[status];
  };

  const getPriorityLabel = (priority: Priority): string => {
    const labels: Record<Priority, string> = {
      low: '低',
      medium: '中',
      high: '高',
      urgent: '紧急',
      critical: '紧急且重要',
    };
    return labels[priority];
  };

  const getPriorityColor = (priority: Priority): string => {
    const colors: Record<Priority, string> = {
      low: '#10b981',
      medium: '#f59e0b',
      high: '#f97316',
      urgent: '#ef4444',
      critical: '#dc2626',
    };
    return colors[priority];
  };

  const renderHeader = () => (
    <View style={styles.tableHeader}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.headerRow}>
          {COLUMNS.map((column) => (
            <TouchableOpacity
              key={column.key}
              style={[styles.headerCell, { width: column.width }]}
              onPress={() => column.sortable && handleSort(column.key)}
              disabled={!column.sortable}
            >
              <Text
                style={[
                  styles.headerText,
                  { color: theme.colors.text },
                  sortBy === column.key && { color: theme.colors.primary },
                ]}
              >
                {column.title}
              </Text>
              {column.sortable && sortBy === column.key && (
                <Text style={[styles.sortIcon, { color: theme.colors.primary }]}>
                  {sortOrder === 'asc' ? '↑' : '↓'}
                </Text>
              )}
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </View>
  );

  const renderRow = (task: Task) => {
    const project = projects.find((p) => p.id === task.projectId);
    const category = categories.find((c) => c.id === task.categoryId);
    const taskTags = tags.filter((t) => task.tags.includes(t.id));
    const progress = task.subtasks.length > 0
      ? (task.subtasks.filter((s) => s.completed).length / task.subtasks.length) * 100
      : 0;
    const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && !task.completed;

    return (
      <View
        key={task.id}
        style={[
          styles.tableRow,
          { backgroundColor: theme.colors.surface },
        ]}
      >
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.rowContent}>
            <View style={[styles.cell, { width: COLUMNS[0].width }]}>
              <TouchableOpacity
                style={[
                  styles.checkbox,
                  {
                    backgroundColor: task.completed ? '#10b981' : 'transparent',
                    borderColor: task.completed ? '#10b981' : theme.colors.border,
                  },
                ]}
                onPress={() => toggleTaskComplete(task.id)}
              >
                {task.completed && <MaterialIcons name="check" size={14} color="#FFFFFF" />}
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[styles.cell, { width: COLUMNS[1].width }]}
              onPress={() => onTaskPress?.(task.id)}
            >
              <Text
                style={[
                  styles.cellText,
                  { color: theme.colors.text },
                  task.completed && styles.completedText,
                ]}
                numberOfLines={2}
              >
                {task.title}
              </Text>
            </TouchableOpacity>

            <View style={[styles.cell, { width: COLUMNS[2].width }]}>
              <View
                style={[
                  styles.statusBadge,
                  { backgroundColor: getStatusColor(task.status) + '20' },
                ]}
              >
                <Text
                  style={[styles.statusText, { color: getStatusColor(task.status) }]}
                >
                  {getStatusLabel(task.status)}
                </Text>
              </View>
            </View>

            <View style={[styles.cell, { width: COLUMNS[3].width }]}>
              <View
                style={[
                  styles.priorityBadge,
                  { backgroundColor: getPriorityColor(task.priority) + '20' },
                ]}
              >
                <View
                  style={[
                    styles.priorityDot,
                    { backgroundColor: getPriorityColor(task.priority) },
                  ]}
                />
                <Text
                  style={[
                    styles.priorityText,
                    { color: getPriorityColor(task.priority) },
                  ]}
                >
                  {getPriorityLabel(task.priority)}
                </Text>
              </View>
            </View>

            <View style={[styles.cell, { width: COLUMNS[4].width }]}>
              <Text
                style={[
                  styles.cellText,
                  { color: isOverdue ? theme.colors.error : theme.colors.text },
                ]}
              >
                {task.dueDate
                  ? new Date(task.dueDate).toLocaleDateString('zh-CN', {
                      month: 'short',
                      day: 'numeric',
                    })
                  : '-'}
              </Text>
            </View>

            <View style={[styles.cell, { width: COLUMNS[5].width }]}>
              {project && (
                <View style={[styles.tagBadge, { backgroundColor: project.color + '20' }]}>
                  <Text style={[styles.tagText, { color: project.color }]} numberOfLines={1}>
                    {project.name}
                  </Text>
                </View>
              )}
            </View>

            <View style={[styles.cell, { width: COLUMNS[6].width }]}>
              {category && (
                <View style={[styles.tagBadge, { backgroundColor: category.color + '20' }]}>
                  <Text style={[styles.tagText, { color: category.color }]} numberOfLines={1}>
                    {category.name}
                  </Text>
                </View>
              )}
            </View>

            <View style={[styles.cell, { width: COLUMNS[7].width }]}>
              <View style={styles.tagCellRow}>
                {taskTags.length > 0 ? (
                  <>
                    <MaterialIcons name="label" size={13} color={theme.colors.textSecondary} />
                    <Text style={[styles.cellText, { color: theme.colors.textSecondary, marginLeft: 2 }]}>
                      {' '}{taskTags.length}
                    </Text>
                  </>
                ) : (
                  <Text style={[styles.cellText, { color: theme.colors.textSecondary }]}>-</Text>
                )}
              </View>
            </View>

            <View style={[styles.cell, { width: COLUMNS[8].width }]}>
              {task.subtasks.length > 0 ? (
                <Text style={[styles.cellText, { color: theme.colors.text }]}>
                  {progress.toFixed(0)}%
                </Text>
              ) : (
                <Text style={[styles.cellText, { color: theme.colors.textSecondary }]}>-</Text>
              )}
            </View>
          </View>
        </ScrollView>
      </View>
    );
  };

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <MaterialIcons name="bar-chart" size={64} color={theme.colors.textSecondary} style={{ marginBottom: 16 }} />
      <Text style={[styles.emptyTitle, { color: theme.colors.text }]}>暂无任务</Text>
      <Text style={[styles.emptySubtitle, { color: theme.colors.textSecondary }]}>
        创建任务以在表格视图中显示
      </Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: theme.colors.text }]}>
          表格视图
        </Text>
        <Text style={[styles.headerCount, { color: theme.colors.textSecondary }]}>
          {sortedTasks.length} 个任务
        </Text>
      </View>

      {renderHeader()}

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {sortedTasks.length > 0 ? (
          sortedTasks.map(renderRow)
        ) : (
          renderEmptyState()
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  headerCount: {
    fontSize: 14,
  },
  tableHeader: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.1)',
    backgroundColor: 'rgba(0,0,0,0.02)',
  },
  headerRow: {
    flexDirection: 'row',
  },
  headerCell: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerText: {
    fontSize: 13,
    fontWeight: '600',
  },
  sortIcon: {
    fontSize: 12,
    marginLeft: 4,
  },
  content: {
    flex: 1,
  },
  tableRow: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  rowContent: {
    flexDirection: 'row',
  },
  cell: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    justifyContent: 'center',
  },
  cellText: {
    fontSize: 13,
  },
  completedText: {
    textDecorationLine: 'line-through',
    opacity: 0.6,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkmark: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
  },
  priorityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  priorityDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 4,
  },
  priorityText: {
    fontSize: 11,
    fontWeight: '600',
  },
  tagBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  tagCellRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  tagText: {
    fontSize: 11,
    fontWeight: '500',
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
});
