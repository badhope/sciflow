import React, { useRef, useCallback, useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Animated,
  PanResponder,
  LayoutChangeEvent,
  ViewStyle,
  TouchableOpacity,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useAppStore } from '../../store';

export interface DraggableItem {
  id: string;
}

export interface DraggableListProps<T extends DraggableItem> {
  data: T[];
  keyExtractor: (item: T) => string;
  renderItem: (item: T, index: number, drag: () => void, isActive: boolean) => React.ReactNode;
  onReorder: (from: number, to: number) => void;
  itemHeight?: number;
  showHandle?: boolean;
  handleComponent?: React.ReactNode;
  dragActivationMs?: number;
  enabled?: boolean;
  scrollEnabled?: boolean;
}

interface DragState {
  activeId: string | null;
  startY: number;
  startIndex: number;
  currentIndex: number;
  offsetY: Animated.Value;
  rowOffsets: Map<string, number>;
}

export function DraggableList<T extends DraggableItem>({
  data,
  keyExtractor,
  renderItem,
  onReorder,
  itemHeight: _itemHeight = 64,
  showHandle = true,
  handleComponent,
  dragActivationMs = 250,
  enabled = true,
}: DraggableListProps<T>) {
  const { theme } = useAppStore();
  const [orderedData, setOrderedData] = useState<T[]>(data);
  const [activeId, setActiveId] = useState<string | null>(null);
  const dragState = useRef<DragState>({
    activeId: null,
    startY: 0,
    startIndex: -1,
    currentIndex: -1,
    offsetY: new Animated.Value(0),
    rowOffsets: new Map(),
  });
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const itemRefs = useRef<Map<string, View>>(new Map());

  // Re-sync the local visual order from props when not dragging. We keep a
  // local copy during a drag (so the animation can render the moving row
  // without round-tripping the store on every frame) and only push the
  // final order up via onReorder.
  useEffect(() => {
    if (!activeId) setOrderedData(data);
  }, [data, activeId]);

  const setItemRef = useCallback((id: string, ref: View | null) => {
    if (ref) {
      itemRefs.current.set(id, ref);
    } else {
      itemRefs.current.delete(id);
    }
  }, []);

  const onItemLayout = useCallback(
    (id: string) => (e: LayoutChangeEvent) => {
      const { y, height } = e.nativeEvent.layout;
      dragState.current.rowOffsets.set(id, y + height / 2);
    },
    []
  );

  const beginDrag = useCallback(
    (id: string, pageY: number) => {
      const idx = orderedData.findIndex((it) => keyExtractor(it) === id);
      if (idx < 0) return;
      dragState.current.activeId = id;
      dragState.current.startY = pageY;
      dragState.current.startIndex = idx;
      dragState.current.currentIndex = idx;
      dragState.current.offsetY.setValue(0);
      setActiveId(id);
    },
    [orderedData, keyExtractor]
  );

  const updateDrag = useCallback(
    (pageY: number) => {
      const { activeId, startY, startIndex, rowOffsets, offsetY } = dragState.current;
      if (!activeId) return;
      const delta = pageY - startY;
      offsetY.setValue(delta);
      const targetY = startY + delta;
      let newIndex = startIndex;
      for (let i = 0; i < orderedData.length; i++) {
        const it = orderedData[i];
        const id = keyExtractor(it);
        const center = rowOffsets.get(id);
        if (center !== undefined && targetY < center) {
          newIndex = i;
          break;
        }
        newIndex = i;
      }
      if (newIndex !== dragState.current.currentIndex) {
        dragState.current.currentIndex = newIndex;
        setOrderedData((prev) => {
          const next = [...prev];
          const [moved] = next.splice(startIndex, 1);
          if (moved) next.splice(newIndex, 0, moved);
          return next;
        });
      }
    },
    [orderedData, keyExtractor]
  );

  const endDrag = useCallback(() => {
    const { activeId, startIndex, currentIndex } = dragState.current;
    if (!activeId) return;
    if (startIndex !== currentIndex && currentIndex >= 0) {
      onReorder(startIndex, currentIndex);
    }
    dragState.current.activeId = null;
    dragState.current.startIndex = -1;
    dragState.current.currentIndex = -1;
    Animated.spring(dragState.current.offsetY, {
      toValue: 0,
      useNativeDriver: true,
      friction: 8,
    }).start();
    setActiveId(null);
  }, [onReorder]);

  const makePanResponder = useCallback(
    (id: string) =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 5,
        onPanResponderGrant: () => {},
        onPanResponderMove: (_e, g) => {
          if (dragState.current.activeId === id) {
            updateDrag(g.moveY);
          }
        },
        onPanResponderRelease: () => {
          if (dragState.current.activeId === id) {
            endDrag();
          }
        },
        onPanResponderTerminate: () => {
          if (dragState.current.activeId === id) endDrag();
        },
      }).panHandlers,
    [updateDrag, endDrag]
  );

  const triggerLongPress = useCallback(
    (id: string) => () => {
      const ref = itemRefs.current.get(id);
      if (ref) {
        ref.measureInWindow((_x, y, _w, h) => {
          beginDrag(id, y + h / 2);
        });
      }
    },
    [beginDrag]
  );

  const clearLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const startLongPress = useCallback(
    (id: string) => () => {
      clearLongPress();
      if (!enabled) return;
      longPressTimer.current = setTimeout(() => {
        triggerLongPress(id)();
      }, dragActivationMs);
    },
    [dragActivationMs, enabled, triggerLongPress, clearLongPress]
  );

  if (!enabled) {
    return (
      <View style={styles.container}>
        {data.map((item, index) => (
          <View key={keyExtractor(item)} style={styles.row}>
            {renderItem(item, index, () => {}, false)}
          </View>
        ))}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {orderedData.map((item, index) => {
        const id = keyExtractor(item);
        const isActive = activeId === id;
        const itemStyle: ViewStyle | undefined = isActive
          ? {
              zIndex: 999,
              elevation: 12,
              transform: [{ translateY: dragState.current.offsetY }, { scale: 1.03 }],
              shadowColor: theme.colors.primary,
              shadowOpacity: 0.4,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 4 },
            }
          : undefined;
        return (
          <Animated.View
            key={id}
            ref={(r) => setItemRef(id, r as View | null)}
            onLayout={onItemLayout(id)}
            style={[styles.row, itemStyle]}
            {...(isActive ? {} : makePanResponder(id))}
          >
            {showHandle && (
              <TouchableOpacity
                style={styles.handleTouch}
                onPressIn={startLongPress(id)}
                onPressOut={clearLongPress}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                disabled={!enabled}
              >
                {handleComponent ?? (
                  <MaterialIcons
                    name="drag-handle"
                    size={20}
                    color={enabled ? theme.colors.textTertiary : theme.colors.border}
                  />
                )}
              </TouchableOpacity>
            )}
            <View
              style={styles.itemContent}
              onTouchStart={startLongPress(id)}
              onTouchEnd={clearLongPress}
            >
              {renderItem(item, index, triggerLongPress(id), isActive)}
            </View>
          </Animated.View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  handleTouch: {
    width: 40,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  itemContent: {
    flex: 1,
  },
});

export default DraggableList;
