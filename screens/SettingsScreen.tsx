import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  SafeAreaView,
  Alert,
  Linking,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { MaterialIcons } from '@expo/vector-icons';
import { useAppStore } from '../src/shared/store';
import { RootStackParamList, Theme } from '../src/shared/types';
import { toast } from '../src/shared/components/common/Toast';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Settings'>;

const APP_VERSION = '1.0.0';

export default function SettingsScreen() {
  const navigation = useNavigation<NavigationProp>();
  const {
    theme,
    setTheme,
    sidebarOpen,
    setSidebarOpen,
    exportData,
    importData,
    resetData,
    syncConfig,
    setSyncConfig,
    userPreferences,
    updateNotificationSettings,
    updateDisplaySettings,
    updatePrivacySettings,
  } = useAppStore();

  const notif = userPreferences?.notifications;
  const display = userPreferences?.displaySettings;
  const privacy = userPreferences?.privacySettings;

  const handleExportData = async () => {
    Alert.alert(
      '导出数据',
      '将导出所有任务、项目、分类、标签等数据为JSON格式。是否继续？',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '导出',
          onPress: async () => {
            try {
              const dataStr = await exportData();
              const data = JSON.parse(dataStr);
              Alert.alert('导出成功', `数据已导出，共 ${data.tasks?.length || 0} 个任务、${data.projects?.length || 0} 个项目`);
            } catch {
              Alert.alert('导出失败', '导出数据时发生错误，请重试。');
            }
          },
        },
      ]
    );
  };

  const handleImportData = () => {
    Alert.alert(
      '导入数据',
      '导入数据将覆盖当前的匹配数据。请确保备份文件格式正确。是否继续？',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '导入',
          onPress: async () => {
            try {
              const sampleData = JSON.stringify({
                version: '1.0',
                tasks: [],
                projects: [],
                categories: [],
              });
              await importData(sampleData);
              toast.success('数据已成功导入');
            } catch {
              toast.error('导入数据失败，请检查文件格式是否正确');
            }
          },
        },
      ]
    );
  };

  const handleResetData = () => {
    Alert.alert(
      '重置所有数据',
      '此操作将删除所有本地数据，包括任务、项目、分类、标签、习惯、笔记等。此操作不可撤销！',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '重置',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              '确认重置',
              '您确定要重置所有数据吗？所有内容将永久丢失。',
              [
                { text: '取消', style: 'cancel' },
                {
                  text: '确认重置',
                  style: 'destructive',
                  onPress: () => {
                    resetData();
                    Alert.alert('已重置', '所有数据已成功重置。');
                  },
                },
              ]
            );
          },
        },
      ]
    );
  };

  const handleClearCache = () => {
    Alert.alert(
      '清除缓存',
      '将清除应用缓存以释放存储空间。是否继续？',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '清除',
          onPress: () => toast.success('缓存已成功清除'),
        },
      ]
    );
  };

  const handleRateApp = () => {
    toast.info('感谢您的支持！请在应用商店给我们评分 ⭐');
  };

  const handleContactSupport = () => {
    Linking.openURL('mailto:support@taskflow.app');
  };

  const handlePrivacyPolicy = () => {
    Linking.openURL('https://taskflow.app/privacy');
  };

  const handleTermsOfService = () => {
    Linking.openURL('https://taskflow.app/terms');
  };

  const renderHeader = () => (
    <View style={[styles.header, { backgroundColor: theme.colors.surface }]}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
        <MaterialIcons name="arrow-back" size={24} color={theme.colors.primary} />
      </TouchableOpacity>
      <Text style={[styles.headerTitle, { color: theme.colors.text }]}>设置</Text>
      <View style={styles.headerRight} />
    </View>
  );

  const renderSection = (title: string, children: React.ReactNode) => (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>{title}</Text>
      <View style={[styles.sectionContent, { backgroundColor: theme.colors.surface }]}>
        {children}
      </View>
    </View>
  );

  const renderSettingRow = (
    icon: React.ReactNode,
    title: string,
    subtitle?: string,
    rightComponent?: React.ReactNode,
    onPress?: () => void
  ) => (
    <TouchableOpacity
      style={styles.settingRow}
      onPress={onPress}
      disabled={!onPress}
      activeOpacity={onPress ? 0.6 : 1}
    >
      <View style={styles.settingLeft}>
        <View style={styles.settingIconContainer}>{icon}</View>
        <View style={styles.settingTextContainer}>
          <Text style={[styles.settingTitle, { color: theme.colors.text }]}>{title}</Text>
          {subtitle && (
            <Text style={[styles.settingSubtitle, { color: theme.colors.textSecondary }]}>
              {subtitle}
            </Text>
          )}
        </View>
      </View>
      {rightComponent}
    </TouchableOpacity>
  );

  const renderThemeSelector = () => {
    const themeOptions: { type: Theme; label: string; iconName: keyof typeof MaterialIcons.glyphMap; bgColor: string }[] = [
      { type: 'light', label: '浅色', iconName: 'light-mode', bgColor: '#FFFFFF' },
      { type: 'dark', label: '深色', iconName: 'dark-mode', bgColor: '#1F2937' },
      { type: 'system', label: '跟随系统', iconName: 'settings-brightness', bgColor: '#F2F2F7' },
    ];

    return (
      <View style={styles.themeSelector}>
        {themeOptions.map((option) => {
          const isActive = theme.type === option.type;
          return (
            <TouchableOpacity
              key={option.type}
              style={[
                styles.themeOption,
                isActive && { borderColor: theme.colors.primary, borderWidth: 2 },
              ]}
              onPress={() => setTheme({ type: option.type })}
            >
              <View
                style={[
                  styles.themePreview,
                  {
                    backgroundColor: option.bgColor,
                    borderColor: isActive ? theme.colors.primary : 'rgba(0,0,0,0.1)',
                  },
                ]}
              >
                <MaterialIcons
                  name={option.iconName}
                  size={28}
                  color={option.type === 'dark' ? '#F9FAFB' : '#374151'}
                />
              </View>
              <Text style={[styles.themeLabel, { color: theme.colors.text }]}>
                {option.label}
              </Text>
              {isActive && (
                <MaterialIcons name="check-circle" size={16} color={theme.colors.primary} style={styles.themeCheck} />
              )}
            </TouchableOpacity>
          );
        })}
      </View>
    );
  };

  const renderThemeColorsPreview = () => (
    <View style={[styles.colorPreviewSection, { backgroundColor: theme.colors.surface }]}>
      <Text style={[styles.colorPreviewTitle, { color: theme.colors.textSecondary }]}>
        当前主题颜色预览
      </Text>
      <View style={styles.colorPalette}>
        {[
          { label: '主色', color: theme.colors.primary },
          { label: '背景', color: theme.colors.background },
          { label: '表面', color: theme.colors.surface },
          { label: '文字', color: theme.colors.text },
          { label: '成功', color: theme.colors.success },
          { label: '警告', color: theme.colors.warning },
          { label: '错误', color: theme.colors.error },
          { label: '边框', color: theme.colors.border },
        ].map((item) => (
          <View key={item.label} style={styles.colorItem}>
            <View style={[styles.colorSwatch, { backgroundColor: item.color }]} />
            <Text style={[styles.colorLabel, { color: theme.colors.textSecondary }]}>
              {item.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {renderHeader()}

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {renderSection(
          '外观',
          <>
            {renderSettingRow(
              <MaterialIcons name="palette" size={22} color={theme.colors.primary} />,
              '主题',
              `当前: ${theme.type === 'light' ? '浅色' : theme.type === 'dark' ? '深色' : '跟随系统'}`
            )}
            <View style={styles.themeSection}>
              {renderThemeSelector()}
            </View>
            {renderThemeColorsPreview()}
            {renderSettingRow(
              <MaterialIcons name="menu-open" size={22} color={theme.colors.primary} />,
              '侧边栏',
              '始终显示侧边导航栏',
              <Switch
                value={sidebarOpen}
                onValueChange={setSidebarOpen}
                trackColor={{ false: '#767577', true: theme.colors.primary }}
                thumbColor={sidebarOpen ? '#FFFFFF' : '#f4f3f4'}
              />
            )}
          </>
        )}

        {renderSection(
          '通知',
          <>
            {renderSettingRow(
              <MaterialIcons name="notifications-active" size={22} color={theme.colors.warning} />,
              '任务提醒',
              '在任务截止前发送提醒通知',
              <Switch
                value={notif?.taskReminders ?? true}
                onValueChange={(value) => updateNotificationSettings({ taskReminders: value })}
                trackColor={{ false: '#767577', true: theme.colors.primary }}
                thumbColor={notif?.taskReminders ? '#FFFFFF' : '#f4f3f4'}
              />
            )}
            {renderSettingRow(
              <MaterialIcons name="summarize" size={22} color={theme.colors.info} />,
              '每日摘要',
              '每天早上发送任务摘要',
              <Switch
                value={notif?.dailyDigest ?? true}
                onValueChange={(value) => updateNotificationSettings({ dailyDigest: value })}
                trackColor={{ false: '#767577', true: theme.colors.primary }}
                thumbColor={notif?.dailyDigest ? '#FFFFFF' : '#f4f3f4'}
              />
            )}
            {renderSettingRow(
              <MaterialIcons name="trending-up" size={22} color={theme.colors.success} />,
              '每周报告',
              '每周发送进度报告',
              <Switch
                value={notif?.weeklyReport ?? false}
                onValueChange={(value) => updateNotificationSettings({ weeklyReport: value })}
                trackColor={{ false: '#767577', true: theme.colors.primary }}
                thumbColor={notif?.weeklyReport ? '#FFFFFF' : '#f4f3f4'}
              />
            )}
            {renderSettingRow(
              <MaterialIcons name="people" size={22} color={theme.colors.secondary} />,
              '团队更新',
              '团队成员变动通知',
              <Switch
                value={notif?.teamUpdates ?? true}
                onValueChange={(value) => updateNotificationSettings({ teamUpdates: value })}
                trackColor={{ false: '#767577', true: theme.colors.primary }}
                thumbColor={notif?.teamUpdates ? '#FFFFFF' : '#f4f3f4'}
              />
            )}
            {renderSettingRow(
              <MaterialIcons name="volume-up" size={22} color={theme.colors.textSecondary} />,
              '提示音',
              '通知时播放提示音',
              <Switch
                value={notif?.soundEnabled ?? true}
                onValueChange={(value) => updateNotificationSettings({ soundEnabled: value })}
                trackColor={{ false: '#767577', true: theme.colors.primary }}
                thumbColor={notif?.soundEnabled ? '#FFFFFF' : '#f4f3f4'}
              />
            )}
            {renderSettingRow(
              <MaterialIcons name="vibration" size={22} color={theme.colors.textSecondary} />,
              '振动',
              '通知时振动',
              <Switch
                value={notif?.vibrationEnabled ?? true}
                onValueChange={(value) => updateNotificationSettings({ vibrationEnabled: value })}
                trackColor={{ false: '#767577', true: theme.colors.primary }}
                thumbColor={notif?.vibrationEnabled ? '#FFFFFF' : '#f4f3f4'}
              />
            )}
            {renderSettingRow(
              <MaterialIcons name="bedtime" size={22} color={theme.colors.textSecondary} />,
              '免打扰时段',
              `当前: ${notif?.quietHoursStart || '22:00'} - ${notif?.quietHoursEnd || '08:00'}`,
              <Switch
                value={notif?.quietHoursEnabled ?? false}
                onValueChange={(value) => updateNotificationSettings({ quietHoursEnabled: value })}
                trackColor={{ false: '#767577', true: theme.colors.primary }}
                thumbColor={notif?.quietHoursEnabled ? '#FFFFFF' : '#f4f3f4'}
              />
            )}
          </>
        )}

        {renderSection(
          '显示',
          <>
            {renderSettingRow(
              <MaterialIcons name="dashboard" size={22} color={theme.colors.primary} />,
              '紧凑模式',
              '减少列表项间距以显示更多内容',
              <Switch
                value={display?.compactMode ?? false}
                onValueChange={(value) => updateDisplaySettings({ compactMode: value })}
                trackColor={{ false: '#767577', true: theme.colors.primary }}
                thumbColor={display?.compactMode ? '#FFFFFF' : '#f4f3f4'}
              />
            )}
            {renderSettingRow(
              <MaterialIcons name="check-circle" size={22} color={theme.colors.success} />,
              '显示已完成任务',
              '在列表中显示已完成的任务',
              <Switch
                value={display?.showCompletedTasks ?? true}
                onValueChange={(value) => updateDisplaySettings({ showCompletedTasks: value })}
                trackColor={{ false: '#767577', true: theme.colors.primary }}
                thumbColor={display?.showCompletedTasks ? '#FFFFFF' : '#f4f3f4'}
              />
            )}
            {renderSettingRow(
              <MaterialIcons name="format-list-bulleted" size={22} color={theme.colors.primary} />,
              '显示子任务',
              '在任务列表中显示子任务',
              <Switch
                value={display?.showSubtasks ?? true}
                onValueChange={(value) => updateDisplaySettings({ showSubtasks: value })}
                trackColor={{ false: '#767577', true: theme.colors.primary }}
                thumbColor={display?.showSubtasks ? '#FFFFFF' : '#f4f3f4'}
              />
            )}
            {renderSettingRow(
              <MaterialIcons name="attach-file" size={22} color={theme.colors.primary} />,
              '显示附件',
              '在任务列表中显示附件',
              <Switch
                value={display?.showAttachments ?? true}
                onValueChange={(value) => updateDisplaySettings({ showAttachments: value })}
                trackColor={{ false: '#767577', true: theme.colors.primary }}
                thumbColor={display?.showAttachments ? '#FFFFFF' : '#f4f3f4'}
              />
            )}
            {renderSettingRow(
              <MaterialIcons name="animation" size={22} color={theme.colors.primary} />,
              '动画效果',
              '启用页面切换动画',
              <Switch
                value={display?.showAnimations ?? true}
                onValueChange={(value) => updateDisplaySettings({ showAnimations: value })}
                trackColor={{ false: '#767577', true: theme.colors.primary }}
                thumbColor={display?.showAnimations ? '#FFFFFF' : '#f4f3f4'}
              />
            )}
            {renderSettingRow(
              <MaterialIcons name="text-fields" size={22} color={theme.colors.primary} />,
              '字体大小',
              `当前: ${display?.fontSize === 'small' ? '小' : display?.fontSize === 'large' ? '大' : '中'}`
            )}
          </>
        )}

        {renderSection(
          '数据管理',
          <>
            {renderSettingRow(
              <MaterialIcons name="cloud-upload" size={22} color={theme.colors.info} />,
              '导出数据',
              '将数据导出为JSON格式备份',
              <MaterialIcons name="chevron-right" size={24} color={theme.colors.textSecondary} />,
              handleExportData
            )}
            {renderSettingRow(
              <MaterialIcons name="cloud-download" size={22} color={theme.colors.success} />,
              '导入数据',
              '从备份文件恢复数据',
              <MaterialIcons name="chevron-right" size={24} color={theme.colors.textSecondary} />,
              handleImportData
            )}
            {renderSettingRow(
              <MaterialIcons name="delete-sweep" size={22} color={theme.colors.warning} />,
              '清除缓存',
              '释放存储空间',
              <MaterialIcons name="chevron-right" size={24} color={theme.colors.textSecondary} />,
              handleClearCache
            )}
            {renderSettingRow(
              <MaterialIcons name="warning" size={22} color={theme.colors.error} />,
              '重置所有数据',
              '删除所有本地数据，此操作不可撤销',
              <MaterialIcons name="chevron-right" size={24} color={theme.colors.error} />,
              handleResetData
            )}
          </>
        )}

        {renderSection(
          '同步与备份',
          <>
            {renderSettingRow(
              <MaterialIcons name="sync" size={22} color={theme.colors.primary} />,
              '自动同步',
              syncConfig?.enabled ? '已启用' : '已禁用',
              <Switch
                value={syncConfig?.enabled || false}
                onValueChange={(value) => setSyncConfig({ ...syncConfig, enabled: value })}
                trackColor={{ false: '#767577', true: theme.colors.primary }}
                thumbColor={syncConfig?.enabled ? '#FFFFFF' : '#f4f3f4'}
              />
            )}
            {renderSettingRow(
              <MaterialIcons name="timer" size={22} color={theme.colors.primary} />,
              '同步频率',
              syncConfig?.syncInterval ? `每 ${syncConfig.syncInterval} 分钟` : '每 15 分钟',
              <MaterialIcons name="chevron-right" size={24} color={theme.colors.textSecondary} />
            )}
          </>
        )}

        {renderSection(
          '隐私与安全',
          <>
            {renderSettingRow(
              <MaterialIcons name="fingerprint" size={22} color={theme.colors.primary} />,
              '生物识别锁',
              '使用Face ID或指纹解锁',
              <Switch
                value={privacy?.biometricLock ?? false}
                onValueChange={(value) => updatePrivacySettings({ biometricLock: value })}
                trackColor={{ false: '#767577', true: theme.colors.primary }}
                thumbColor={privacy?.biometricLock ? '#FFFFFF' : '#f4f3f4'}
              />
            )}
            {renderSettingRow(
              <MaterialIcons name="lock-clock" size={22} color={theme.colors.primary} />,
              '自动锁定',
              `${privacy?.autoLockTimeout ?? 5} 分钟无操作后锁定`,
              <MaterialIcons name="chevron-right" size={24} color={theme.colors.textSecondary} />
            )}
            {renderSettingRow(
              <MaterialIcons name="analytics" size={22} color={theme.colors.primary} />,
              '发送分析数据',
              '帮助改进应用体验',
              <Switch
                value={privacy?.analytics ?? true}
                onValueChange={(value) => updatePrivacySettings({ analytics: value })}
                trackColor={{ false: '#767577', true: theme.colors.primary }}
                thumbColor={privacy?.analytics ? '#FFFFFF' : '#f4f3f4'}
              />
            )}
          </>
        )}

        {renderSection(
          '高级功能',
          <>
            {renderSettingRow(
              <MaterialIcons name="folder" size={22} color={theme.colors.primary} />,
              '项目管理',
              '创建和管理项目',
              <MaterialIcons name="chevron-right" size={24} color={theme.colors.textSecondary} />,
              () => navigation.navigate('Projects')
            )}
            {renderSettingRow(
              <MaterialIcons name="label" size={22} color={theme.colors.secondary} />,
              '分类管理',
              '组织任务分类',
              <MaterialIcons name="chevron-right" size={24} color={theme.colors.textSecondary} />,
              () => navigation.navigate('Categories')
            )}
            {renderSettingRow(
              <MaterialIcons name="local-offer" size={22} color={theme.colors.warning} />,
              '标签管理',
              '为任务添加标签',
              <MaterialIcons name="chevron-right" size={24} color={theme.colors.textSecondary} />,
              () => navigation.navigate('Tags')
            )}
            {renderSettingRow(
              <MaterialIcons name="view-list" size={22} color={theme.colors.info} />,
              '视图管理',
              '自定义任务视图',
              <MaterialIcons name="chevron-right" size={24} color={theme.colors.textSecondary} />,
              () => navigation.navigate('Views')
            )}
            {renderSettingRow(
              <MaterialIcons name="file-copy" size={22} color={theme.colors.success} />,
              '任务模板',
              '快速创建重复任务',
              <MaterialIcons name="chevron-right" size={24} color={theme.colors.textSecondary} />,
              () => navigation.navigate('Templates')
            )}
            {renderSettingRow(
              <MaterialIcons name="auto-awesome" size={22} color={theme.colors.primary} />,
              '自动化规则',
              '设置自动化工作流',
              <MaterialIcons name="chevron-right" size={24} color={theme.colors.textSecondary} />,
              () => navigation.navigate('Automation')
            )}
            {renderSettingRow(
              <MaterialIcons name="gps-fixed" size={22} color={theme.colors.secondary} />,
              '目标追踪',
              '设定和追踪长期目标',
              <MaterialIcons name="chevron-right" size={24} color={theme.colors.textSecondary} />,
              () => navigation.navigate('Goals')
            )}
            {renderSettingRow(
              <MaterialIcons name="sync" size={22} color={theme.colors.success} />,
              '习惯养成',
              '追踪每日习惯',
              <MaterialIcons name="chevron-right" size={24} color={theme.colors.textSecondary} />,
              () => navigation.navigate('Habits')
            )}
            {renderSettingRow(
              <MaterialIcons name="edit" size={22} color={theme.colors.warning} />,
              '笔记',
              '记录想法和灵感',
              <MaterialIcons name="chevron-right" size={24} color={theme.colors.textSecondary} />,
              () => navigation.navigate('Notes')
            )}
          </>
        )}

        {renderSection(
          '关于',
          <>
            {renderSettingRow(
              <MaterialIcons name="star" size={22} color="#F59E0B" />,
              '评价应用',
              '在应用商店给我们评分',
              <MaterialIcons name="chevron-right" size={24} color={theme.colors.textSecondary} />,
              handleRateApp
            )}
            {renderSettingRow(
              <MaterialIcons name="mail" size={22} color={theme.colors.primary} />,
              '联系支持',
              'support@taskflow.app',
              <MaterialIcons name="chevron-right" size={24} color={theme.colors.textSecondary} />,
              handleContactSupport
            )}
            {renderSettingRow(
              <MaterialIcons name="description" size={22} color={theme.colors.primary} />,
              '隐私政策',
              undefined,
              <MaterialIcons name="chevron-right" size={24} color={theme.colors.textSecondary} />,
              handlePrivacyPolicy
            )}
            {renderSettingRow(
              <MaterialIcons name="gavel" size={22} color={theme.colors.primary} />,
              '服务条款',
              undefined,
              <MaterialIcons name="chevron-right" size={24} color={theme.colors.textSecondary} />,
              handleTermsOfService
            )}
            {renderSettingRow(
              <MaterialIcons name="info" size={22} color={theme.colors.primary} />,
              '版本',
              APP_VERSION,
            )}
            {renderSettingRow(
              <MaterialIcons name="code" size={22} color={theme.colors.primary} />,
              '构建',
              'TaskFlow v' + APP_VERSION,
            )}
          </>
        )}

        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: theme.colors.textSecondary }]}>
            TaskFlow - 让任务管理更简单
          </Text>
          <Text style={[styles.footerCopyright, { color: theme.colors.textSecondary }]}>
            {'\u00A9'} 2024 TaskFlow. 保留所有权利。
          </Text>
        </View>

        <View style={styles.bottomPadding} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  headerRight: {
    width: 40,
  },
  section: {
    marginTop: 24,
    paddingHorizontal: 20,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 10,
    marginLeft: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  sectionContent: {
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  settingRowLast: {
    borderBottomWidth: 0,
  },
  settingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 14,
  },
  settingIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  settingTextContainer: {
    flex: 1,
  },
  settingTitle: {
    fontSize: 15,
    fontWeight: '500',
    letterSpacing: -0.1,
  },
  settingSubtitle: {
    fontSize: 12,
    marginTop: 2,
    lineHeight: 16,
  },
  themeSection: {
    padding: 16,
  },
  themeSelector: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'flex-start',
  },
  themeOption: {
    alignItems: 'center',
    padding: 10,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: 'transparent',
    minWidth: 80,
  },
  themePreview: {
    width: 56,
    height: 56,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
    borderWidth: 1,
  },
  themeLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  themeCheck: {
    position: 'absolute',
    top: 4,
    right: 4,
  },
  colorPreviewSection: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    borderRadius: 12,
  },
  colorPreviewTitle: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 12,
  },
  colorPalette: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  colorItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 16,
    marginBottom: 8,
  },
  colorSwatch: {
    width: 20,
    height: 20,
    borderRadius: 6,
    marginRight: 6,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.1)',
  },
  colorLabel: {
    fontSize: 11,
  },
  footer: {
    marginTop: 40,
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  footerText: {
    fontSize: 14,
    marginBottom: 4,
  },
  footerCopyright: {
    fontSize: 12,
  },
  bottomPadding: {
    height: 40,
  },
});
