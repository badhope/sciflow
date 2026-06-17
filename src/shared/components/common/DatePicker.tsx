import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TouchableWithoutFeedback,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useAppStore } from '../../store';

interface DatePickerProps {
  value: Date | null;
  onChange: (date: Date | null) => void;
  label?: string;
  placeholder?: string;
  mode?: 'date' | 'time' | 'datetime';
  minimumDate?: Date;
  maximumDate?: Date;
}

export const DatePicker: React.FC<DatePickerProps> = ({
  value,
  onChange,
  label,
  placeholder = '选择日期',
  mode = 'date',
  minimumDate,
  maximumDate,
}) => {
  const { theme } = useAppStore();
  const [showPicker, setShowPicker] = useState(false);
  const [tempDate, setTempDate] = useState(value || new Date());

  const formatDate = (date: Date | null): string => {
    if (!date) return '';
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  };

  const formatTime = (date: Date | null): string => {
    if (!date) return '';
    return date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatDateTime = (date: Date | null): string => {
    if (!date) return '';
    return `${formatDate(date)} ${formatTime(date)}`;
  };

  const handleConfirm = () => {
    onChange(tempDate);
    setShowPicker(false);
  };

  const handleCancel = () => {
    setTempDate(value || new Date());
    setShowPicker(false);
  };

  const handleClear = () => {
    onChange(null);
    setShowPicker(false);
  };

  const getDisplayValue = (): string => {
    if (!value) return placeholder;
    switch (mode) {
      case 'date':
        return formatDate(value);
      case 'time':
        return formatTime(value);
      case 'datetime':
        return formatDateTime(value);
      default:
        return formatDate(value);
    }
  };

  return (
    <View style={styles.container}>
      {label && (
        <Text style={[styles.label, { color: theme.colors.text }]}>{label}</Text>
      )}
      
      <TouchableOpacity
        style={[
          styles.input,
          {
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.border,
          },
        ]}
        onPress={() => setShowPicker(true)}
      >
        <Text
          style={[
            styles.inputText,
            {
              color: value ? theme.colors.text : theme.colors.textSecondary,
            },
          ]}
        >
          {getDisplayValue()}
        </Text>
        <Text style={[styles.icon, { color: theme.colors.textSecondary }]}>
          📅
        </Text>
      </TouchableOpacity>

      <Modal
        visible={showPicker}
        animationType="slide"
        transparent={true}
        onRequestClose={handleCancel}
      >
        <TouchableWithoutFeedback onPress={handleCancel}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback>
              <View
                style={[styles.modalContent, { backgroundColor: theme.colors.surface }]}
              >
                <View style={styles.modalHeader}>
                  <TouchableOpacity onPress={handleClear}>
                    <Text style={[styles.clearButton, { color: theme.colors.error }]}>
                      清除
                    </Text>
                  </TouchableOpacity>
                  <Text style={[styles.modalTitle, { color: theme.colors.text }]}>
                    {mode === 'date' ? '选择日期' : mode === 'time' ? '选择时间' : '选择日期和时间'}
                  </Text>
                  <TouchableOpacity onPress={handleConfirm}>
                    <Text
                      style={[styles.confirmButton, { color: theme.colors.primary }]}
                    >
                      确定
                    </Text>
                  </TouchableOpacity>
                </View>

                <DateTimePicker
                  value={tempDate}
                  mode={mode}
                  display="spinner"
                  onChange={(event, selectedDate) => {
                    if (selectedDate) {
                      setTempDate(selectedDate);
                    }
                  }}
                  minimumDate={minimumDate}
                  maximumDate={maximumDate}
                  locale="zh-CN"
                  style={styles.picker}
                />

                <View style={styles.quickDates}>
                  <Text
                    style={[styles.quickDatesLabel, { color: theme.colors.textSecondary }]}
                  >
                    快捷选择
                  </Text>
                  <View style={styles.quickDatesRow}>
                    <TouchableOpacity
                      style={[
                        styles.quickDateButton,
                        { backgroundColor: theme.colors.background },
                      ]}
                      onPress={() => {
                        const today = new Date();
                        if (mode === 'time') {
                          setTempDate(new Date(today.setHours(9, 0, 0, 0)));
                        } else {
                          setTempDate(today);
                        }
                      }}
                    >
                      <Text
                        style={[
                          styles.quickDateText,
                          { color: theme.colors.text },
                        ]}
                      >
                        今天
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.quickDateButton,
                        { backgroundColor: theme.colors.background },
                      ]}
                      onPress={() => {
                        const tomorrow = new Date();
                        tomorrow.setDate(tomorrow.getDate() + 1);
                        if (mode === 'time') {
                          setTempDate(new Date(tomorrow.setHours(9, 0, 0, 0)));
                        } else {
                          setTempDate(tomorrow);
                        }
                      }}
                    >
                      <Text
                        style={[
                          styles.quickDateText,
                          { color: theme.colors.text },
                        ]}
                      >
                        明天
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.quickDateButton,
                        { backgroundColor: theme.colors.background },
                      ]}
                      onPress={() => {
                        const nextWeek = new Date();
                        nextWeek.setDate(nextWeek.getDate() + 7);
                        if (mode === 'time') {
                          setTempDate(new Date(nextWeek.setHours(9, 0, 0, 0)));
                        } else {
                          setTempDate(nextWeek);
                        }
                      }}
                    >
                      <Text
                        style={[
                          styles.quickDateText,
                          { color: theme.colors.text },
                        ]}
                      >
                        一周后
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.quickDateButton,
                        { backgroundColor: theme.colors.background },
                      ]}
                      onPress={() => {
                        const nextMonth = new Date();
                        nextMonth.setMonth(nextMonth.getMonth() + 1);
                        if (mode === 'time') {
                          setTempDate(new Date(nextMonth.setHours(9, 0, 0, 0)));
                        } else {
                          setTempDate(nextMonth);
                        }
                      }}
                    >
                      <Text
                        style={[
                          styles.quickDateText,
                          { color: theme.colors.text },
                        ]}
                      >
                        一月后
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  input: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  inputText: {
    fontSize: 14,
    flex: 1,
  },
  icon: {
    fontSize: 16,
    marginLeft: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  clearButton: {
    fontSize: 14,
  },
  confirmButton: {
    fontSize: 14,
    fontWeight: '600',
  },
  picker: {
    height: 200,
  },
  quickDates: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.1)',
  },
  quickDatesLabel: {
    fontSize: 12,
    marginBottom: 8,
  },
  quickDatesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  quickDateButton: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginHorizontal: 2,
    alignItems: 'center',
  },
  quickDateText: {
    fontSize: 13,
  },
});
