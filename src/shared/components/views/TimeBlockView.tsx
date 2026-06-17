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

const HOUR_HEIGHT = 60;
const TIME_COLUMN_WIDTH = 60;

interface TimeBlockViewProps {
  tasks: Task[];
  onTaskPress?: (taskId: string) => void;
}

export const TimeBlockView: React.FC<TimeBlockViewProps> = ({ tasks, onTaskPress }) => {
  const { theme } = useAppStore();
  const [selectedDate, setSelectedDate] = useState(new Date());

  const hours = Array.from({ length: 24 }, (_, i) => i);

  const tasksWithTime = useMemo(() => {
    return tasks.filter(
      (task) =>
        task.dueTime &&
        task.dueDate &&
        new Date(task.dueDate).toDateString() === selectedDate.toDateString() &&
        !task.isDeleted
    );
  }, [tasks, selectedDate]);

  const getTaskPosition = (task: Task) => {
    if (!task.dueTime) return null;

    const time = new Date(task.dueTime);
    const hour = time.getHours();
    const minute = time.getMinutes();
    const top = hour * HOUR_HEIGHT + (minute / 60) * HOUR_HEIGHT;

    const duration = task.estimatedTime || 60;
    const height = (duration / 60) * HOUR_HEIGHT;

    return { top, height: Math.max(height, 30) };
  };

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

  const navigateDate = (direction: number) => {
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() + direction);
    setSelectedDate(newDate);
  };

  const goToToday = () => {
    setSelectedDate(new Date());
  };

  const isToday = (): boolean => {
    const today = new Date();
    return (
      selectedDate.getDate() === today.getDate() &&
      selectedDate.getMonth() === today.getMonth() &&
      selectedDate.getFullYear() === today.getFullYear()
    );
  };

  const renderTimeColumn = () => (
    <View style={styles.timeColumn}>
      {hours.map((hour) => (
        <View key={hour} style={styles.timeCell}>
          <Text style={[styles.timeText, { color: theme.colors.textSecondary }]}>
            {hour.toString().padStart(2, '0')}:00
          </Text>
        </View>
      ))}
    </View>
  );

  const renderCurrentTimeLine = () => {
    if (!isToday()) return null;

    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();
    const top = hour * HOUR_HEIGHT + (minute / 60) * HOUR_HEIGHT;

    return (
      <View style={[styles.currentTimeLine, { top }]}>
        <View style={[styles.currentTimeDot, { backgroundColor: '#ef4444' }]} />
        <View style={[styles.currentTimeBar, { backgroundColor: '#ef4444' }]} />
      </View>
    );
  };

  const renderTaskBlock = (task: Task) => {
    const position = getTaskPosition(task);
    if (!position) return null;

    const color = getStatusColor(task.status);

    return (
      <TouchableOpacity
        key={task.id}
        style={[
          styles.taskBlock,
          {
            top: position.top,
            height: position.height,
            backgroundColor: color + '20',
            borderLeftColor: color,
          },
        ]}
        onPress={() => onTaskPress?.(task.id)}
      >
        <Text
          style={[styles.taskBlockTitle, { color: theme.colors.text }]}
          numberOfLines={position.height > 40 ? 2 : 1}
        >
          {task.title}
        </Text>
        {position.height > 60 && task.estimatedTime && (
          <View style={styles.taskDurationRow}>
            <MaterialIcons name="timer" size={11} color={theme.colors.textSecondary} />
            <Text style={[styles.taskBlockDuration, { color: theme.colors.textSecondary, marginLeft: 2 }]}>
              {' '}{task.estimatedTime}分钟
            </Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  const renderHourGrid = () => (
    <View style={styles.hourGrid}>
      {hours.map((hour) => (
        <View key={hour} style={styles.hourRow}>
          <View style={[styles.hourLine, { backgroundColor: theme.colors.border }]} />
        </View>
      ))}
    </View>
  );

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <MaterialIcons name="access-time" size={48} color={theme.colors.textSecondary} style={{ marginBottom: 12 }} />
      <Text style={[styles.emptyTitle, { color: theme.colors.text }]}>暂无安排</Text>
      <Text style={[styles.emptySubtitle, { color: theme.colors.textSecondary }]}>
        为任务设置时间来在时间块视图中显示
      </Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={[styles.header, { backgroundColor: theme.colors.surface }]}>
        <TouchableOpacity onPress={() => navigateDate(-1)} style={styles.navButton}>
          <Text style={[styles.navButtonText, { color: theme.colors.primary }]}>‹</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={goToToday} style={styles.dateContainer}>
          <Text style={[styles.dateText, { color: theme.colors.text }]}>
            {selectedDate.toLocaleDateString('zh-CN', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              weekday: 'long',
            })}
          </Text>
          {!isToday() && (
            <View style={[styles.todayBadge, { backgroundColor: theme.colors.primary }]}>
              <Text style={styles.todayBadgeText}>今天</Text>
            </View>
          )}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigateDate(1)} style={styles.navButton}>
          <Text style={[styles.navButtonText, { color: theme.colors.primary }]}>›</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.scheduleContainer}>
          {renderTimeColumn()}

          <View style={styles.scheduleContent}>
            {renderHourGrid()}
            {renderCurrentTimeLine()}
            {tasksWithTime.length > 0 ? (
              tasksWithTime.map(renderTaskBlock)
            ) : (
              <View style={styles.emptyOverlay}>
                {renderEmptyState()}
              </View>
            )}
          </View>
        </View>
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
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  navButton: {
    padding: 8,
  },
  navButtonText: {
    fontSize: 32,
    fontWeight: '300',
  },
  dateContainer: {
    flex: 1,
    alignItems: 'center',
  },
  dateText: {
    fontSize: 16,
    fontWeight: '600',
  },
  todayBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    marginTop: 4,
  },
  todayBadgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  content: {
    flex: 1,
  },
  scheduleContainer: {
    flexDirection: 'row',
  },
  timeColumn: {
    width: TIME_COLUMN_WIDTH,
    borderRightWidth: 1,
    borderRightColor: 'rgba(0,0,0,0.1)',
  },
  timeCell: {
    height: HOUR_HEIGHT,
    justifyContent: 'flex-start',
    paddingLeft: 8,
    paddingTop: 4,
  },
  timeText: {
    fontSize: 11,
    fontWeight: '500',
  },
  scheduleContent: {
    flex: 1,
    position: 'relative',
  },
  hourGrid: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  hourRow: {
    height: HOUR_HEIGHT,
  },
  hourLine: {
    height: 1,
  },
  currentTimeLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 10,
  },
  currentTimeDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginLeft: -5,
  },
  currentTimeBar: {
    flex: 1,
    height: 2,
  },
  taskBlock: {
    position: 'absolute',
    left: 8,
    right: 8,
    borderLeftWidth: 4,
    borderRadius: 6,
    padding: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
    overflow: 'hidden',
  },
  taskBlockTitle: {
    fontSize: 13,
    fontWeight: '600',
  },
  taskBlockDuration: {
    fontSize: 11,
    marginTop: 4,
  },
  taskDurationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  emptyOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyState: {
    alignItems: 'center',
    padding: 40,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  emptySubtitle: {
    fontSize: 13,
    textAlign: 'center',
  },
});
