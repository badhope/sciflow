import React, { useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  PanResponder,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useAppStore } from '../../store';
import { Task } from '../../types';
import { TaskCard } from './TaskCard';

interface SwipeableTaskCardProps {
  task: Task;
  onPress: () => void;
  onToggleComplete?: (taskId: string) => void;
  onSwipeLeft?: (task: Task) => void;
  onSwipeRight?: (task: Task) => void;
  onLongPress?: () => void;
  showCheckbox?: boolean;
  compact?: boolean;
}

const SCREEN_WIDTH = Dimensions.get('window').width;
const SWIPE_THRESHOLD = 0.5;

export const SwipeableTaskCard = React.memo(function SwipeableTaskCard({
  task,
  onPress,
  onToggleComplete,
  onSwipeLeft,
  onSwipeRight,
  onLongPress,
  showCheckbox = true,
  compact = false,
}: SwipeableTaskCardProps) {
  const { theme } = useAppStore();
  const translateX = useRef(new Animated.Value(0)).current;
  const actionOpacityLeft = useRef(new Animated.Value(0)).current;
  const actionOpacityRight = useRef(new Animated.Value(0)).current;

  const resetPosition = useCallback(() => {
    Animated.spring(translateX, {
      toValue: 0,
      useNativeDriver: true,
      bounciness: 10,
    }).start();
    Animated.timing(actionOpacityLeft, {
      toValue: 0,
      duration: 150,
      useNativeDriver: true,
    }).start();
    Animated.timing(actionOpacityRight, {
      toValue: 0,
      duration: 150,
      useNativeDriver: true,
    }).start();
  }, [translateX, actionOpacityLeft, actionOpacityRight]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return Math.abs(gestureState.dx) > 10 && Math.abs(gestureState.dy) < 10;
      },
      onPanResponderMove: (_, gestureState) => {
        translateX.setValue(gestureState.dx);

        if (gestureState.dx > 0) {
          const opacity = Math.min(Math.abs(gestureState.dx) / 100, 1);
          actionOpacityRight.setValue(opacity);
          actionOpacityLeft.setValue(0);
        } else if (gestureState.dx < 0) {
          const opacity = Math.min(Math.abs(gestureState.dx) / 100, 1);
          actionOpacityLeft.setValue(opacity);
          actionOpacityRight.setValue(0);
        } else {
          actionOpacityLeft.setValue(0);
          actionOpacityRight.setValue(0);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        const cardWidth = SCREEN_WIDTH - 56;
        const threshold = cardWidth * SWIPE_THRESHOLD;

        if (gestureState.dx > threshold) {
          Animated.timing(translateX, {
            toValue: cardWidth * 2,
            duration: 250,
            useNativeDriver: true,
          }).start(() => {
            onSwipeRight?.(task);
          });
        } else if (gestureState.dx < -threshold) {
          Animated.timing(translateX, {
            toValue: -cardWidth * 2,
            duration: 250,
            useNativeDriver: true,
          }).start(() => {
            onSwipeLeft?.(task);
          });
        } else {
          resetPosition();
        }
      },
    })
  ).current;

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onLongPress={onLongPress}
      delayLongPress={350}
      style={styles.container}
    >
      <View style={styles.actionBackground}>
        <Animated.View
          style={[
            styles.actionLeft,
            { opacity: actionOpacityLeft },
          ]}
        >
          <View style={[styles.actionLeftContent, { backgroundColor: theme.colors.error }]}>
            <MaterialIcons name="delete" size={24} color="#FFFFFF" />
            <Text style={styles.actionText}>删除</Text>
          </View>
        </Animated.View>
        <Animated.View
          style={[
            styles.actionRight,
            { opacity: actionOpacityRight },
          ]}
        >
          <View style={[styles.actionRightContent, { backgroundColor: theme.colors.success }]}>
            <MaterialIcons name="check" size={24} color="#FFFFFF" />
            <Text style={styles.actionText}>完成</Text>
          </View>
        </Animated.View>
      </View>

      <Animated.View
        style={[
          styles.cardWrapper,
          { transform: [{ translateX }] },
        ]}
        {...panResponder.panHandlers}
      >
        <TaskCard
          task={task}
          onPress={onPress}
          onToggleComplete={onToggleComplete}
          showCheckbox={showCheckbox}
          compact={compact}
        />
      </Animated.View>
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    overflow: 'hidden',
  },
  actionBackground: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'stretch',
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  actionLeft: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'flex-end',
    paddingRight: 16,
  },
  actionLeftContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
  },
  actionRight: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'flex-start',
    paddingLeft: 16,
  },
  actionRightContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
  },
  actionText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 6,
  },
  cardWrapper: {
    zIndex: 1,
  },
});