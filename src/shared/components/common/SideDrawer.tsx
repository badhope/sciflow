import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Animated,
  Dimensions,
  ScrollView,
  PanResponder,
  Platform,
} from 'react-native';
import { MaterialIcons, Ionicons } from '@expo/vector-icons';

export interface DrawerItem {
  key: string;
  icon: string;
  iconType?: 'material' | 'ionicons';
  label: string;
  description?: string;
  color: string;
  badge?: number;
  target: string;
  group?: 'organize' | 'insight' | 'manage' | 'tool';
}

export interface SideDrawerProps {
  visible: boolean;
  onClose: () => void;
  items: DrawerItem[];
  onNavigate: (target: string) => void;
  pendingCount?: number;
  completedToday?: number;
  theme: any;
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const DRAWER_WIDTH = Math.min(320, SCREEN_WIDTH * 0.85);

export function SideDrawer({
  visible,
  onClose,
  items,
  onNavigate,
  pendingCount = 0,
  completedToday = 0,
  theme,
}: SideDrawerProps) {
  const translateX = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const lastDx = useRef(0);

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(translateX, {
          toValue: 0,
          duration: 240,
          useNativeDriver: Platform.OS !== 'web',
        }),
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: 240,
          useNativeDriver: Platform.OS !== 'web',
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(translateX, {
          toValue: -DRAWER_WIDTH,
          duration: 200,
          useNativeDriver: Platform.OS !== 'web',
        }),
        Animated.timing(backdropOpacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: Platform.OS !== 'web',
        }),
      ]).start();
    }
  }, [visible, translateX, backdropOpacity]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) =>
        visible && gestureState.dx < -10,
      onPanResponderMove: (_, gestureState) => {
        lastDx.current = gestureState.dx;
        if (gestureState.dx < 0) {
          translateX.setValue(gestureState.dx);
        }
      },
      onPanResponderRelease: () => {
        if (lastDx.current < -DRAWER_WIDTH * 0.3) {
          Animated.timing(translateX, {
            toValue: -DRAWER_WIDTH,
            duration: 180,
            useNativeDriver: Platform.OS !== 'web',
          }).start(() => onClose());
          Animated.timing(backdropOpacity, {
            toValue: 0,
            duration: 180,
            useNativeDriver: Platform.OS !== 'web',
          }).start();
        } else {
          Animated.spring(translateX, {
            toValue: 0,
            useNativeDriver: Platform.OS !== 'web',
          }).start();
        }
        lastDx.current = 0;
      },
    })
  ).current;

  const grouped = {
    organize: items.filter((i) => i.group === 'organize'),
    insight: items.filter((i) => i.group === 'insight'),
    manage: items.filter((i) => i.group === 'manage'),
    tool: items.filter((i) => i.group === 'tool'),
  };

  const handleItemPress = (target: string) => {
    onClose();
    setTimeout(() => onNavigate(target), 200);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <Animated.View
          style={[
            styles.backdrop,
            {
              opacity: backdropOpacity,
              backgroundColor: theme.colors.backdrop || 'rgba(0,0,0,0.5)',
            },
          ]}
        >
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={onClose}
          />
        </Animated.View>

        <Animated.View
          style={[
            styles.drawer,
            {
              width: DRAWER_WIDTH,
              backgroundColor: theme.colors.card,
              borderRightColor: theme.colors.border,
              transform: [{ translateX }],
            },
          ]}
          {...panResponder.panHandlers}
        >
          <View
            style={[
              styles.drawerHeader,
              { borderBottomColor: theme.colors.border },
            ]}
          >
            <View
              style={[
                styles.brandIcon,
                { backgroundColor: theme.colors.primary + '18' },
              ]}
            >
              <MaterialIcons
                name="check-circle"
                size={28}
                color={theme.colors.primary}
              />
            </View>
            <View style={{ flex: 1, marginLeft: 14 }}>
              <Text
                style={[
                  styles.brandTitle,
                  { color: theme.colors.text },
                ]}
              >
                TaskFlow
              </Text>
              <Text
                style={[
                  styles.brandSubtitle,
                  { color: theme.colors.textSecondary },
                ]}
              >
                任务管理 · 智能建议
              </Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={styles.closeBtn}
            >
              <MaterialIcons
                name="close"
                size={20}
                color={theme.colors.textSecondary}
              />
            </TouchableOpacity>
          </View>

          <View style={styles.statsRow}>
            <View
              style={[
                styles.statChip,
                { backgroundColor: theme.colors.primary + '12' },
              ]}
            >
              <MaterialIcons
                name="schedule"
                size={14}
                color={theme.colors.primary}
              />
              <Text
                style={[
                  styles.statChipText,
                  { color: theme.colors.primary },
                ]}
              >
                {pendingCount} 待办
              </Text>
            </View>
            <View
              style={[
                styles.statChip,
                { backgroundColor: theme.colors.success + '12' },
              ]}
            >
              <MaterialIcons
                name="check-circle"
                size={14}
                color={theme.colors.success}
              />
              <Text
                style={[
                  styles.statChipText,
                  { color: theme.colors.success },
                ]}
              >
                {completedToday} 今日完成
              </Text>
            </View>
          </View>

          <ScrollView
            style={styles.scroll}
            showsVerticalScrollIndicator={false}
          >
            {(['organize', 'insight', 'manage', 'tool'] as const).map(
              (groupKey) => {
                const groupItems = grouped[groupKey];
                if (groupItems.length === 0) return null;
                const labels = {
                  organize: '组织',
                  insight: '洞察',
                  manage: '管理',
                  tool: '工具',
                };
                return (
                  <View key={groupKey} style={styles.group}>
                    <Text
                      style={[
                        styles.groupTitle,
                        { color: theme.colors.textTertiary },
                      ]}
                    >
                      {labels[groupKey]}
                    </Text>
                    {groupItems.map((item) => {
                      const Icon =
                        item.iconType === 'ionicons' ? Ionicons : MaterialIcons;
                      return (
                        <TouchableOpacity
                          key={item.key}
                          style={[
                            styles.item,
                            { borderBottomColor: theme.colors.border + '60' },
                          ]}
                          onPress={() => handleItemPress(item.target)}
                          activeOpacity={0.6}
                        >
                          <View
                            style={[
                              styles.itemIcon,
                              { backgroundColor: item.color + '18' },
                            ]}
                          >
                            <Icon
                              name={item.icon as any}
                              size={20}
                              color={item.color}
                            />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text
                              style={[
                                styles.itemLabel,
                                { color: theme.colors.text },
                              ]}
                            >
                              {item.label}
                            </Text>
                            {item.description && (
                              <Text
                                style={[
                                  styles.itemDesc,
                                  { color: theme.colors.textTertiary },
                                ]}
                                numberOfLines={1}
                              >
                                {item.description}
                              </Text>
                            )}
                          </View>
                          {item.badge != null && item.badge > 0 && (
                            <View
                              style={[
                                styles.badge,
                                { backgroundColor: item.color },
                              ]}
                            >
                              <Text style={styles.badgeText}>
                                {item.badge}
                              </Text>
                            </View>
                          )}
                          <MaterialIcons
                            name="chevron-right"
                            size={18}
                            color={theme.colors.textTertiary}
                          />
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                );
              }
            )}
          </ScrollView>

          <View
            style={[
              styles.drawerFooter,
              { borderTopColor: theme.colors.border },
            ]}
          >
            <Text
              style={[
                styles.footerText,
                { color: theme.colors.textTertiary },
              ]}
            >
              v1.1.0 · {pendingCount + completedToday} 任务
            </Text>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  backdrop: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  drawer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    borderRightWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOffset: { width: 4, height: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 16,
  },
  drawerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  brandIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  brandTitle: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  brandSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  statChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
  },
  statChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  scroll: {
    flex: 1,
  },
  group: {
    paddingTop: 14,
    paddingBottom: 6,
  },
  groupTitle: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    paddingHorizontal: 22,
    marginBottom: 6,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  itemIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  itemLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  itemDesc: {
    fontSize: 12,
    marginTop: 2,
  },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
    marginRight: 8,
  },
  badgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  drawerFooter: {
    paddingHorizontal: 22,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footerText: {
    fontSize: 11,
    letterSpacing: 0.3,
  },
});
