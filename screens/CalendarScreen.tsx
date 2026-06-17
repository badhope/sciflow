import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  Platform,
  ScrollView,
  Dimensions,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { MaterialIcons } from '@expo/vector-icons';
import { useAppStore } from '../src/shared/store';
import { RootStackParamList, Task } from '../src/shared/types';
import { TaskCard } from '../src/shared/components/common';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Calendar'>;

const { width } = Dimensions.get('window');

type CalendarView = 'day' | 'week' | 'month';

export default function CalendarScreen() {
  const navigation = useNavigation<NavigationProp>();
  const { theme, tasks } = useAppStore();

  const [currentDate, setCurrentDate] = useState(new Date());
  const [calendarView, setCalendarView] = useState<CalendarView>('month');
  const [selectedDate, setSelectedDate] = useState(new Date());

  const getDaysInMonth = (date: Date): Date[] => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const days: Date[] = [];

    const startPadding = firstDay.getDay();
    for (let i = startPadding - 1; i >= 0; i--) {
      const prevDate = new Date(year, month, -i);
      days.push(prevDate);
    }

    for (let i = 1; i <= lastDay.getDate(); i++) {
      days.push(new Date(year, month, i));
    }

    const endPadding = 42 - days.length;
    for (let i = 1; i <= endPadding; i++) {
      days.push(new Date(year, month + 1, i));
    }

    return days;
  };

  const getWeekDays = (): Date[] => {
    const startOfWeek = new Date(selectedDate);
    const day = startOfWeek.getDay();
    startOfWeek.setDate(startOfWeek.getDate() - day);

    const days: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(startOfWeek);
      date.setDate(startOfWeek.getDate() + i);
      days.push(date);
    }
    return days;
  };

  const getTasksForDate = (date: Date): Task[] => {
    return tasks.filter((task) => {
      if (!task.dueDate) return false;
      const taskDate = new Date(task.dueDate);
      return (
        taskDate.getDate() === date.getDate() &&
        taskDate.getMonth() === date.getMonth() &&
        taskDate.getFullYear() === date.getFullYear() &&
        !task.isDeleted
      );
    });
  };

  const monthNames = [
    '一月', '二月', '三月', '四月', '五月', '六月',
    '七月', '八月', '九月', '十月', '十一月', '十二月'
  ];

  const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  const navigateMonth = (direction: number) => {
    const newDate = new Date(currentDate);
    newDate.setMonth(newDate.getMonth() + direction);
    setCurrentDate(newDate);
  };

  const navigateWeek = (direction: number) => {
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() + direction * 7);
    setSelectedDate(newDate);
    setCurrentDate(newDate);
  };

  const navigateDay = (direction: number) => {
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() + direction);
    setSelectedDate(newDate);
    setCurrentDate(newDate);
  };

  const goToToday = () => {
    const today = new Date();
    setCurrentDate(today);
    setSelectedDate(today);
  };

  const selectedDateTasks = getTasksForDate(selectedDate);

  const isToday = (date: Date): boolean => {
    const today = new Date();
    return (
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear()
    );
  };

  const isSelected = (date: Date): boolean => {
    return (
      date.getDate() === selectedDate.getDate() &&
      date.getMonth() === selectedDate.getMonth() &&
      date.getFullYear() === selectedDate.getFullYear()
    );
  };

  const isCurrentMonth = (date: Date): boolean => {
    return date.getMonth() === currentDate.getMonth();
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

  const renderHeader = () => (
    <View style={[styles.header, { backgroundColor: theme.colors.surface }]}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
        <MaterialIcons name="arrow-back" size={24} color={theme.colors.primary} />
      </TouchableOpacity>
      <Text style={[styles.headerTitle, { color: theme.colors.text }]}>日历</Text>
      <TouchableOpacity onPress={goToToday} style={styles.todayButton}>
        <Text style={[styles.todayButtonText, { color: theme.colors.primary }]}>今天</Text>
      </TouchableOpacity>
    </View>
  );

  const renderViewSwitcher = () => (
    <View style={[styles.viewSwitcher, { backgroundColor: theme.colors.surface }]}>
      <TouchableOpacity
        style={[
          styles.viewButton,
          calendarView === 'day' && { backgroundColor: theme.colors.primary },
        ]}
        onPress={() => setCalendarView('day')}
      >
        <Text
          style={[
            styles.viewButtonText,
            { color: calendarView === 'day' ? '#FFFFFF' : theme.colors.text },
          ]}
        >
          日
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[
          styles.viewButton,
          calendarView === 'week' && { backgroundColor: theme.colors.primary },
        ]}
        onPress={() => setCalendarView('week')}
      >
        <Text
          style={[
            styles.viewButtonText,
            { color: calendarView === 'week' ? '#FFFFFF' : theme.colors.text },
          ]}
        >
          周
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[
          styles.viewButton,
          calendarView === 'month' && { backgroundColor: theme.colors.primary },
        ]}
        onPress={() => setCalendarView('month')}
      >
        <Text
          style={[
            styles.viewButtonText,
            { color: calendarView === 'month' ? '#FFFFFF' : theme.colors.text },
          ]}
        >
          月
        </Text>
      </TouchableOpacity>
    </View>
  );

  const renderMonthView = () => {
    const days = getDaysInMonth(currentDate);
    
    return (
      <View style={styles.monthContainer}>
        <View style={styles.monthHeader}>
          <TouchableOpacity onPress={() => navigateMonth(-1)} style={styles.navButton}>
            <MaterialIcons name="chevron-left" size={28} color={theme.colors.primary} />
          </TouchableOpacity>
          <Text style={[styles.monthTitle, { color: theme.colors.text }]}>
            {currentDate.getFullYear()}年 {monthNames[currentDate.getMonth()]}
          </Text>
          <TouchableOpacity onPress={() => navigateMonth(1)} style={styles.navButton}>
            <MaterialIcons name="chevron-right" size={28} color={theme.colors.primary} />
          </TouchableOpacity>
        </View>

        <View style={styles.weekDaysRow}>
          {weekDays.map((day, index) => (
            <View key={index} style={styles.weekDayCell}>
              <Text style={[styles.weekDayText, { color: theme.colors.textSecondary }]}>{day}</Text>
            </View>
          ))}
        </View>

        <View style={styles.daysGrid}>
          {days.map((date, index) => {
            const dayTasks = getTasksForDate(date);
            const hasOverdue = dayTasks.some(
              (t) => t.dueDate && new Date(t.dueDate) < new Date() && !t.completed
            );
            
            return (
              <TouchableOpacity
                key={index}
                style={[
                  styles.dayCell,
                  !isCurrentMonth(date) && styles.otherMonthDay,
                  isToday(date) && { backgroundColor: theme.colors.primary + '20' },
                  isSelected(date) && { backgroundColor: theme.colors.primary },
                ]}
                onPress={() => setSelectedDate(date)}
              >
                <Text
                  style={[
                    styles.dayText,
                    { color: isSelected(date) ? '#FFFFFF' : theme.colors.text },
                    !isCurrentMonth(date) && { color: theme.colors.textSecondary },
                  ]}
                >
                  {date.getDate()}
                </Text>
                {dayTasks.length > 0 && (
                  <View style={styles.taskIndicators}>
                    {dayTasks.slice(0, 3).map((task, i) => (
                      <View
                        key={i}
                        style={[
                          styles.taskDot,
                          { backgroundColor: getPriorityColor(task.priority) },
                        ]}
                      />
                    ))}
                    {dayTasks.length > 3 && (
                      <Text style={[styles.moreText, { color: theme.colors.textSecondary }]}>
                        +{dayTasks.length - 3}
                      </Text>
                    )}
                  </View>
                )}
                {hasOverdue && (
                  <View style={[styles.overdueDot, { backgroundColor: theme.colors.error }]} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    );
  };

  const renderWeekView = () => {
    const weekDays = getWeekDays();
    
    return (
      <View style={styles.weekContainer}>
        <View style={styles.weekHeader}>
          <TouchableOpacity onPress={() => navigateWeek(-1)} style={styles.navButton}>
            <MaterialIcons name="chevron-left" size={28} color={theme.colors.primary} />
          </TouchableOpacity>
          <Text style={[styles.weekTitle, { color: theme.colors.text }]}>
            {weekDays[0].getMonth() + 1}月 {weekDays[0].getDate()}日 - {weekDays[6].getMonth() + 1}月 {weekDays[6].getDate()}日
          </Text>
          <TouchableOpacity onPress={() => navigateWeek(1)} style={styles.navButton}>
            <MaterialIcons name="chevron-right" size={28} color={theme.colors.primary} />
          </TouchableOpacity>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {weekDays.map((date, index) => {
            const dayTasks = getTasksForDate(date);
            
            return (
              <View key={index} style={styles.weekDayColumn}>
                <TouchableOpacity
                  style={[
                    styles.weekDayHeader,
                    isToday(date) && { backgroundColor: theme.colors.primary + '20' },
                    isSelected(date) && { backgroundColor: theme.colors.primary },
                  ]}
                  onPress={() => setSelectedDate(date)}
                >
                  <Text
                    style={[
                      styles.weekDayName,
                      { color: isSelected(date) ? '#FFFFFF' : theme.colors.textSecondary },
                    ]}
                  >
                    {['日', '一', '二', '三', '四', '五', '六'][date.getDay()]}
                  </Text>
                  <Text
                    style={[
                      styles.weekDayNumber,
                      { color: isSelected(date) ? '#FFFFFF' : theme.colors.text },
                    ]}
                  >
                    {date.getDate()}
                  </Text>
                </TouchableOpacity>

                <ScrollView style={styles.weekDayContent} showsVerticalScrollIndicator={false}>
                  {dayTasks.map((task) => (
                    <TouchableOpacity
                      key={task.id}
                      style={[styles.weekTaskCard, { backgroundColor: getPriorityColor(task.priority) + '20' }]}
                      onPress={() => navigation.navigate('TaskDetail', { taskId: task.id })}
                    >
                      <View
                        style={[
                          styles.weekTaskIndicator,
                          { backgroundColor: getPriorityColor(task.priority) },
                        ]}
                      />
                      <Text style={[styles.weekTaskTitle, { color: theme.colors.text }]} numberOfLines={2}>
                        {task.title}
                      </Text>
                      {task.dueTime && (
                        <Text style={[styles.weekTaskTime, { color: theme.colors.textSecondary }]}>
                          {new Date(task.dueTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </Text>
                      )}
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            );
          })}
        </ScrollView>
      </View>
    );
  };

  const renderDayView = () => {
    const hours = Array.from({ length: 24 }, (_, i) => i);
    
    return (
      <View style={styles.dayContainer}>
        <View style={styles.dayHeader}>
          <TouchableOpacity onPress={() => navigateDay(-1)} style={styles.navButton}>
            <MaterialIcons name="chevron-left" size={28} color={theme.colors.primary} />
          </TouchableOpacity>
          <View style={styles.dayHeaderCenter}>
            <Text style={[styles.dayDateText, { color: theme.colors.text }]}>
              {selectedDate.getFullYear()}年 {selectedDate.getMonth() + 1}月 {selectedDate.getDate()}日
            </Text>
            <Text style={[styles.dayWeekText, { color: theme.colors.textSecondary }]}>
              {['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][selectedDate.getDay()]}
            </Text>
          </View>
          <TouchableOpacity onPress={() => navigateDay(1)} style={styles.navButton}>
            <MaterialIcons name="chevron-right" size={28} color={theme.colors.primary} />
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.daySchedule} showsVerticalScrollIndicator={false}>
          {hours.map((hour) => {
            const hourTasks = selectedDateTasks.filter((task) => {
              if (!task.dueTime) return false;
              return new Date(task.dueTime).getHours() === hour;
            });

            return (
              <View key={hour} style={styles.hourRow}>
                <View style={styles.hourLabel}>
                  <Text style={[styles.hourText, { color: theme.colors.textSecondary }]}>
                    {hour.toString().padStart(2, '0')}:00
                  </Text>
                </View>
                <View style={[styles.hourContent, { borderColor: theme.colors.border }]}>
                  {hourTasks.map((task) => (
                    <TouchableOpacity
                      key={task.id}
                      style={[styles.hourTaskCard, { backgroundColor: getPriorityColor(task.priority) + '20' }]}
                      onPress={() => navigation.navigate('TaskDetail', { taskId: task.id })}
                    >
                      <View
                        style={[
                          styles.hourTaskIndicator,
                          { backgroundColor: getPriorityColor(task.priority) },
                        ]}
                      />
                      <Text style={[styles.hourTaskTitle, { color: theme.colors.text }]}>
                        {task.title}
                      </Text>
                      {task.estimatedTime && (
                        <Text style={[styles.hourTaskDuration, { color: theme.colors.textSecondary }]}>
                          {task.estimatedTime}分钟
                        </Text>
                      )}
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            );
          })}
        </ScrollView>
      </View>
    );
  };

  const renderSelectedDateDetails = () => (
    <View style={[styles.selectedDateDetails, { backgroundColor: theme.colors.surface }]}>
      <View style={styles.detailsHeader}>
        <Text style={[styles.detailsDate, { color: theme.colors.text }]}>
          {selectedDate.getMonth() + 1}月{selectedDate.getDate()}日 {['日', '一', '二', '三', '四', '五', '六'][selectedDate.getDay()]}
        </Text>
        <Text style={[styles.detailsCount, { color: theme.colors.textSecondary }]}>
          {selectedDateTasks.length}个任务
        </Text>
      </View>

      <ScrollView style={styles.detailsContent} showsVerticalScrollIndicator={false}>
        {selectedDateTasks.length > 0 ? (
          selectedDateTasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onPress={() => navigation.navigate('TaskDetail', { taskId: task.id })}
              compact
            />
          ))
        ) : (
          <View style={styles.noTasksContainer}>
            <Text style={[styles.noTasksText, { color: theme.colors.textSecondary }]}>
              当天没有任务
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {renderHeader()}
      {renderViewSwitcher()}

      <View style={styles.content}>
        {calendarView === 'month' && renderMonthView()}
        {calendarView === 'week' && renderWeekView()}
        {calendarView === 'day' && renderDayView()}
      </View>

      {calendarView !== 'day' && renderSelectedDateDetails()}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  backButton: {
    padding: 4,
  },
  backButtonText: {
    fontSize: 16,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  todayButton: {
    padding: 4,
  },
  todayButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  viewSwitcher: {
    flexDirection: 'row',
    padding: 8,
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 8,
  },
  viewButton: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 6,
  },
  viewButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  content: {
    flex: 1,
    marginTop: 12,
  },
  monthContainer: {
    flex: 1,
    paddingHorizontal: 16,
  },
  monthHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  navButton: {
    padding: 8,
  },
  navButtonText: {
    fontSize: 24,
    fontWeight: '300',
  },
  monthTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  weekDaysRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  weekDayCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
  },
  weekDayText: {
    fontSize: 12,
    fontWeight: '600',
  },
  daysGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  dayCell: {
    width: '14.2857%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 4,
    borderRadius: 8,
  },
  otherMonthDay: {
    opacity: 0.4,
  },
  dayText: {
    fontSize: 14,
    fontWeight: '500',
  },
  taskIndicators: {
    flexDirection: 'row',
    marginTop: 2,
  },
  taskDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    marginHorizontal: 1,
  },
  moreText: {
    fontSize: 8,
  },
  overdueDot: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  weekContainer: {
    flex: 1,
  },
  weekHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  weekTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  weekDayColumn: {
    width: width * 0.4,
    marginHorizontal: 4,
  },
  weekDayHeader: {
    alignItems: 'center',
    padding: 8,
    borderRadius: 8,
    marginBottom: 8,
  },
  weekDayName: {
    fontSize: 12,
    marginBottom: 4,
  },
  weekDayNumber: {
    fontSize: 20,
    fontWeight: '600',
  },
  weekDayContent: {
    maxHeight: 300,
  },
  weekTaskCard: {
    padding: 8,
    borderRadius: 6,
    marginBottom: 6,
  },
  weekTaskIndicator: {
    width: 4,
    height: 4,
    borderRadius: 2,
    marginBottom: 4,
  },
  weekTaskTitle: {
    fontSize: 12,
    marginBottom: 2,
  },
  weekTaskTime: {
    fontSize: 10,
  },
  dayContainer: {
    flex: 1,
  },
  dayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  dayHeaderCenter: {
    alignItems: 'center',
  },
  dayDateText: {
    fontSize: 18,
    fontWeight: '600',
  },
  dayWeekText: {
    fontSize: 14,
    marginTop: 4,
  },
  daySchedule: {
    flex: 1,
    paddingHorizontal: 16,
  },
  hourRow: {
    flexDirection: 'row',
    minHeight: 60,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  hourLabel: {
    width: 60,
    paddingVertical: 8,
  },
  hourText: {
    fontSize: 12,
  },
  hourContent: {
    flex: 1,
    paddingVertical: 4,
    borderLeftWidth: 1,
    paddingLeft: 8,
  },
  hourTaskCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    borderRadius: 6,
    marginBottom: 4,
  },
  hourTaskIndicator: {
    width: 4,
    height: 20,
    borderRadius: 2,
    marginRight: 8,
  },
  hourTaskTitle: {
    flex: 1,
    fontSize: 13,
  },
  hourTaskDuration: {
    fontSize: 11,
  },
  selectedDateDetails: {
    maxHeight: 250,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    marginTop: 12,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  detailsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  detailsDate: {
    fontSize: 16,
    fontWeight: '600',
  },
  detailsCount: {
    fontSize: 14,
  },
  detailsContent: {
    maxHeight: 180,
  },
  noTasksContainer: {
    padding: 20,
    alignItems: 'center',
  },
  noTasksText: {
    fontSize: 14,
  },
});
