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
import { Task } from '../../types';

const DAY_WIDTH = 40;
const ROW_HEIGHT = 50;

interface GanttViewProps {
  tasks: Task[];
  onTaskPress?: (taskId: string) => void;
  startDate?: Date;
  endDate?: Date;
}

export const GanttView: React.FC<GanttViewProps> = ({
  tasks,
  onTaskPress,
  startDate: propStartDate,
  endDate: propEndDate,
}) => {
  const { theme } = useAppStore();
  const [viewMode, setViewMode] = useState<'day' | 'week' | 'month'>('week');

  const { days, tasksWithDates } = useMemo(() => {
    const tasksWithDueDates = tasks.filter((task) => task.dueDate && !task.isDeleted);

    if (tasksWithDueDates.length === 0) {
      const today = new Date();
      const start = propStartDate || new Date(today.setDate(today.getDate() - 7));
      const end = propEndDate || new Date(today.setDate(today.getDate() + 30));
      
      const days: Date[] = [];
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        days.push(new Date(d));
      }
      
      return {
        days,
        tasksWithDates: [],
      };
    }

    const dates = tasksWithDueDates.map((task) => new Date(task.dueDate!));
    const minDate = propStartDate || new Date(Math.min(...dates.map((d) => d.getTime())));
    const maxDate = propEndDate || new Date(Math.max(...dates.map((d) => d.getTime())) + 7 * 24 * 60 * 60 * 1000);

    minDate.setDate(minDate.getDate() - 7);
    maxDate.setDate(maxDate.getDate() + 7);

    const allDays: Date[] = [];
    for (let d = new Date(minDate); d <= maxDate; d.setDate(d.getDate() + 1)) {
      allDays.push(new Date(d));
    }

    const tasksData = tasksWithDueDates.map((task) => {
      const dueDate = new Date(task.dueDate!);
      const taskStart = task.startDate ? new Date(task.startDate) : new Date(dueDate.getTime() - 3 * 24 * 60 * 60 * 1000);
      const taskEnd = dueDate;

      const startOffset = Math.floor((taskStart.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24));
      const duration = Math.max(1, Math.ceil((taskEnd.getTime() - taskStart.getTime()) / (1000 * 60 * 60 * 24)));

      return {
        task,
        startOffset,
        duration,
      };
    });

    return {
      days: allDays,
      tasksWithDates: tasksData,
    };
  }, [tasks, propStartDate, propEndDate]);

  const getBarStyle = (task: Task) => {
    const colors: Record<string, string> = {
      'todo': '#6b7280',
      'in-progress': '#3b82f6',
      'waiting': '#8b5cf6',
      'delegated': '#f59e0b',
      'completed': '#10b981',
      'cancelled': '#ef4444',
      'on-hold': '#6b7280',
    };
    return colors[task.status] || theme.colors.primary;
  };

  const isToday = (date: Date): boolean => {
    const today = new Date();
    return (
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear()
    );
  };

  const formatDate = (date: Date): string => {
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  };

  const renderTimelineHeader = () => (
    <View style={styles.timelineHeader}>
      <View style={styles.taskNameColumn}>
        <Text style={[styles.headerText, { color: theme.colors.textSecondary }]}>任务</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.datesContainer}>
          {days.map((date, index) => (
            <TouchableOpacity
              key={index}
              style={[
                styles.dateCell,
                isToday(date) && { backgroundColor: theme.colors.primary + '20' },
              ]}
            >
              <Text
                style={[
                  styles.dateText,
                  { color: isToday(date) ? theme.colors.primary : theme.colors.textSecondary },
                ]}
              >
                {formatDate(date)}
              </Text>
              <Text style={[styles.dayText, { color: theme.colors.textSecondary }]}>
                {['日', '一', '二', '三', '四', '五', '六'][date.getDay()]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </View>
  );

  const renderTaskRow = (item: { task: Task; startOffset: number; duration: number }) => {
    const { task, startOffset, duration } = item;
    const barWidth = duration * DAY_WIDTH;
    const barLeft = startOffset * DAY_WIDTH;
    const barColor = getBarStyle(task);
    const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && !task.completed;

    return (
      <View key={task.id} style={styles.taskRow}>
        <View style={styles.taskNameColumn}>
          <TouchableOpacity
            style={styles.taskNameContent}
            onPress={() => onTaskPress?.(task.id)}
          >
            <View
              style={[styles.statusDot, { backgroundColor: barColor }]}
            />
            <Text
              style={[styles.taskName, { color: theme.colors.text }]}
              numberOfLines={2}
            >
              {task.title}
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.barContainer}>
            <View
              style={[
                styles.gridLine,
                { width: days.length * DAY_WIDTH },
              ]}
            >
              {days.map((date, index) => (
                <View
                  key={index}
                  style={[
                    styles.dayLine,
                    isToday(date) && { backgroundColor: theme.colors.primary + '30' },
                  ]}
                />
              ))}
            </View>

            <View
              style={[
                styles.taskBar,
                {
                  left: barLeft,
                  width: barWidth,
                  backgroundColor: barColor,
                },
              ]}
            >
              <Text style={styles.taskBarText} numberOfLines={1}>
                {task.title}
              </Text>
              {isOverdue && (
                <View style={styles.overdueIndicator}>
                  <Text style={styles.overdueText}>!</Text>
                </View>
              )}
            </View>
          </View>
        </ScrollView>
      </View>
    );
  };

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <MaterialIcons name="trending-up" size={64} color={theme.colors.textSecondary} />
      <Text style={[styles.emptyTitle, { color: theme.colors.text }]}>暂无任务</Text>
      <Text style={[styles.emptySubtitle, { color: theme.colors.textSecondary }]}>
        为任务设置截止日期以在甘特图中显示
      </Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.viewModeSelector}>
        {(['day', 'week', 'month'] as const).map((mode) => (
          <TouchableOpacity
            key={mode}
            style={[
              styles.viewModeButton,
              viewMode === mode && { backgroundColor: theme.colors.primary },
            ]}
            onPress={() => setViewMode(mode)}
          >
            <Text
              style={[
                styles.viewModeText,
                { color: viewMode === mode ? '#FFFFFF' : theme.colors.text },
              ]}
            >
              {mode === 'day' ? '日' : mode === 'week' ? '周' : '月'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {renderTimelineHeader()}

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {tasksWithDates.length > 0 ? (
          tasksWithDates.map(renderTaskRow)
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
  viewModeSelector: {
    flexDirection: 'row',
    padding: 16,
    justifyContent: 'center',
  },
  viewModeButton: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
    marginHorizontal: 4,
  },
  viewModeText: {
    fontSize: 14,
    fontWeight: '500',
  },
  timelineHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  taskNameColumn: {
    width: 150,
    padding: 12,
    borderRightWidth: 1,
    borderRightColor: 'rgba(0,0,0,0.1)',
  },
  headerText: {
    fontSize: 13,
    fontWeight: '600',
  },
  datesContainer: {
    flexDirection: 'row',
  },
  dateCell: {
    width: DAY_WIDTH,
    alignItems: 'center',
    paddingVertical: 8,
    borderRightWidth: 1,
    borderRightColor: 'rgba(0,0,0,0.05)',
  },
  dateText: {
    fontSize: 11,
    fontWeight: '500',
  },
  dayText: {
    fontSize: 10,
    marginTop: 2,
  },
  content: {
    flex: 1,
  },
  taskRow: {
    flexDirection: 'row',
    minHeight: ROW_HEIGHT,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  taskNameContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  taskName: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
  },
  barContainer: {
    position: 'relative',
    height: ROW_HEIGHT,
  },
  gridLine: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    flexDirection: 'row',
  },
  dayLine: {
    width: DAY_WIDTH,
    borderRightWidth: 1,
    borderRightColor: 'rgba(0,0,0,0.05)',
  },
  taskBar: {
    position: 'absolute',
    top: 15,
    height: 24,
    borderRadius: 4,
    paddingHorizontal: 8,
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  taskBarText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
  },
  overdueIndicator: {
    position: 'absolute',
    right: -6,
    top: -6,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#ef4444',
    justifyContent: 'center',
    alignItems: 'center',
  },
  overdueText: {
    color: '#FFFFFF',
    fontSize: 10,
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
});
