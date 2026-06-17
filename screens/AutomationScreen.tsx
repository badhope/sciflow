import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  SafeAreaView,
  Switch,
  Alert,
  Modal,
  ScrollView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { MaterialIcons } from '@expo/vector-icons';
import { useAppStore } from '../src/shared/store';
import {
  RootStackParamList,
  AutomationRule,
  AutomationCondition,
  AutomationAction,
  AutomationTriggerType,
  AutomationActionType,
} from '../src/shared/types';
import { Button } from '../src/shared/components/common';
import { toast } from '../src/shared/components/common/Toast';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Automation'>;

const TRIGGER_TYPES: { type: AutomationTriggerType; label: string; iconName: keyof typeof MaterialIcons.glyphMap; description: string }[] = [
  { type: 'task-created', label: '任务创建', iconName: 'check-circle', description: '当新任务被创建时触发' },
  { type: 'task-updated', label: '任务更新', iconName: 'edit', description: '当任务被修改时触发' },
  { type: 'task-completed', label: '任务完成', iconName: 'celebration', description: '当任务标记为完成时触发' },
  { type: 'task-overdue', label: '任务逾期', iconName: 'warning', description: '当任务超过截止日期时触发' },
  { type: 'due-date-approaching', label: '截止临近', iconName: 'access-time', description: '当任务截止日期临近时触发' },
  { type: 'scheduled', label: '定时触发', iconName: 'calendar-today', description: '按设定的时间计划触发' },
  { type: 'manual', label: '手动触发', iconName: 'touch-app', description: '手动执行自动化规则' },
  { type: 'webhook', label: 'Webhook', iconName: 'link', description: '当收到Webhook请求时触发' },
];

const ACTION_TYPES: { type: AutomationActionType; label: string; iconName: keyof typeof MaterialIcons.glyphMap; description: string }[] = [
  { type: 'update-field', label: '更新字段', iconName: 'loop', description: '修改任务的指定字段' },
  { type: 'add-tag', label: '添加标签', iconName: 'label', description: '为任务添加标签' },
  { type: 'remove-tag', label: '移除标签', iconName: 'label-off', description: '移除任务的标签' },
  { type: 'move-project', label: '移动项目', iconName: 'folder', description: '将任务移动到其他项目' },
  { type: 'assign', label: '分配任务', iconName: 'person', description: '将任务分配给用户' },
  { type: 'send-notification', label: '发送通知', iconName: 'notifications', description: '发送通知消息' },
  { type: 'create-subtask', label: '创建子任务', iconName: 'playlist-add', description: '为任务创建子任务' },
  { type: 'duplicate', label: '复制任务', iconName: 'content-copy', description: '复制任务到指定位置' },
  { type: 'archive', label: '归档任务', iconName: 'archive', description: '将任务归档' },
  { type: 'webhook', label: '发送Webhook', iconName: 'link', description: '发送HTTP请求' },
];

const CONDITION_FIELDS = [
  { field: 'title', label: '任务标题', type: 'text' },
  { field: 'description', label: '任务描述', type: 'text' },
  { field: 'status', label: '任务状态', type: 'select' },
  { field: 'priority', label: '优先级', type: 'select' },
  { field: 'dueDate', label: '截止日期', type: 'date' },
  { field: 'categoryId', label: '分类', type: 'select' },
  { field: 'projectId', label: '项目', type: 'select' },
  { field: 'tags', label: '标签', type: 'multi-select' },
  { field: 'assigneeId', label: '负责人', type: 'select' },
  { field: 'isRecurring', label: '是否重复', type: 'boolean' },
];

const CONDITION_OPERATORS = [
  { value: 'equals', label: '等于' },
  { value: 'not-equals', label: '不等于' },
  { value: 'contains', label: '包含' },
  { value: 'not-contains', label: '不包含' },
  { value: 'starts-with', label: '开头是' },
  { value: 'ends-with', label: '结尾是' },
  { value: 'is-empty', label: '为空' },
  { value: 'is-not-empty', label: '不为空' },
  { value: 'greater-than', label: '大于' },
  { value: 'less-than', label: '小于' },
];

export default function AutomationScreen() {
  const navigation = useNavigation<NavigationProp>();
  const {
    theme,
    automationRules,
    addAutomationRule,
    deleteAutomationRule,
    toggleAutomationRule,
    executeAutomation,
  } = useAppStore();

  const [showAddModal, setShowAddModal] = useState(false);
  const [showRuleDetailModal, setShowRuleDetailModal] = useState(false);
  const [selectedRule, setSelectedRule] = useState<AutomationRule | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterEnabled, setFilterEnabled] = useState<boolean | null>(null);

  const [newRule, setNewRule] = useState<{
    name: string;
    description: string;
    triggerType: AutomationTriggerType;
    conditions: AutomationCondition[];
    actions: AutomationAction[];
  }>({
    name: '',
    description: '',
    triggerType: 'task-created',
    conditions: [],
    actions: [],
  });

  const filteredRules = automationRules.filter((rule) => {
    if (filterEnabled !== null && rule.isEnabled !== filterEnabled) return false;
    if (searchQuery && !rule.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const handleCreateRule = () => {
    if (!newRule.name.trim()) {
      toast.error('请输入规则名称');
      return;
    }

    const rule: AutomationRule = {
      id: `automation-${Date.now()}`,
      name: newRule.name.trim(),
      description: newRule.description,
      trigger: {
        type: newRule.triggerType,
        config: {},
      },
      conditions: newRule.conditions.length > 0 ? newRule.conditions : [],
      actions: newRule.actions.length > 0 ? newRule.actions : [],
      isEnabled: true,
      isSystem: false,
      priority: 0,
      executionCount: 0,
      lastExecutedAt: null,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: null,
    };

    addAutomationRule(rule);
    setShowAddModal(false);
    setNewRule({
      name: '',
      description: '',
      triggerType: 'task-created',
      conditions: [],
      actions: [],
    });
    toast.success('自动化规则已创建');
  };

  const handleDeleteRule = (ruleId: string) => {
    Alert.alert(
      '删除规则',
      '确定要删除这个自动化规则吗？',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: () => deleteAutomationRule(ruleId),
        },
      ]
    );
  };

  const handleExecuteRule = (rule: AutomationRule) => {
    Alert.alert(
      '执行规则',
      `确定要立即执行"${rule.name}"吗？`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '执行',
          onPress: () => {
            executeAutomation(rule.id, {});
            toast.success('规则已执行');
          },
        },
      ]
    );
  };

  const addCondition = () => {
    const newCondition: AutomationCondition = {
      id: `condition-${Date.now()}`,
      type: 'field',
      field: 'status',
      operator: 'equals',
      value: '',
      conjunction: 'and',
    };
    setNewRule({ ...newRule, conditions: [...newRule.conditions, newCondition] });
  };

  const updateCondition = (index: number, updates: Partial<AutomationCondition>) => {
    const updated = [...newRule.conditions];
    updated[index] = { ...updated[index], ...updates };
    setNewRule({ ...newRule, conditions: updated });
  };

  const removeCondition = (index: number) => {
    const updated = [...newRule.conditions];
    updated.splice(index, 1);
    setNewRule({ ...newRule, conditions: updated });
  };

  const addAction = () => {
    const newAction: AutomationAction = {
      id: `action-${Date.now()}`,
      type: 'update-field',
      config: {},
      delay: 0,
      order: newRule.actions.length,
    };
    setNewRule({ ...newRule, actions: [...newRule.actions, newAction] });
  };

  const removeAction = (index: number) => {
    const updated = [...newRule.actions];
    updated.splice(index, 1);
    setNewRule({ ...newRule, actions: updated });
  };

  const openRuleDetail = (rule: AutomationRule) => {
    setSelectedRule(rule);
    setShowRuleDetailModal(true);
  };

  const renderRuleCard = ({ item }: { item: AutomationRule }) => {
    const triggerInfo = TRIGGER_TYPES.find((t) => t.type === item.trigger.type);

    return (
      <View style={[styles.ruleCard, { backgroundColor: theme.colors.surface }]}>
        <TouchableOpacity
          onPress={() => openRuleDetail(item)}
          onLongPress={() => {
            Alert.alert(item.name, '选择操作', [
              { text: '查看详情', onPress: () => openRuleDetail(item) },
              { text: item.isEnabled ? '禁用' : '启用', onPress: () => toggleAutomationRule(item.id) },
              { text: '立即执行', onPress: () => handleExecuteRule(item) },
              ...(!item.isSystem
                ? [{ text: '删除', style: 'destructive' as const, onPress: () => handleDeleteRule(item.id) }]
                : []),
              { text: '取消', style: 'cancel' },
            ]);
          }}
        >
          <View style={styles.ruleHeader}>
            <View style={styles.ruleInfo}>
              <MaterialIcons name={triggerInfo?.iconName || 'settings'} size={32} color={theme.colors.primary} style={{ marginRight: 12 }} />
              <View style={styles.ruleTitleContainer}>
                <Text style={[styles.ruleName, { color: theme.colors.text }]} numberOfLines={1}>
                  {item.name}
                </Text>
                {item.description && (
                  <Text style={[styles.ruleDescription, { color: theme.colors.textSecondary }]} numberOfLines={1}>
                    {item.description}
                  </Text>
                )}
              </View>
            </View>
            <View style={styles.ruleToggle}>
              <Switch
                value={item.isEnabled}
                onValueChange={() => toggleAutomationRule(item.id)}
                trackColor={{ false: '#767577', true: theme.colors.primary }}
                thumbColor={item.isEnabled ? '#f4f3f4' : '#f4f3f4'}
              />
            </View>
          </View>

          <View style={styles.ruleDetails}>
            <View style={styles.ruleMeta}>
              <View style={[styles.metaBadge, { backgroundColor: theme.colors.primary + '20' }]}>
                <Text style={[styles.metaBadgeText, { color: theme.colors.primary }]}>
                  {triggerInfo?.label || item.trigger.type}
                </Text>
              </View>
              {item.isSystem && (
                <View style={[styles.metaBadge, { backgroundColor: '#10b98120' }]}>
                  <Text style={[styles.metaBadgeText, { color: '#10b981' }]}>系统</Text>
                </View>
              )}
            </View>

            <View style={styles.ruleStats}>
              <Text style={[styles.statText, { color: theme.colors.textSecondary }]}>
                执行 {item.executionCount} 次
              </Text>
              {item.lastExecutedAt && (
                <Text style={[styles.statText, { color: theme.colors.textSecondary }]}>
                  上次 {new Date(item.lastExecutedAt).toLocaleDateString()}
                </Text>
              )}
            </View>
          </View>

          {item.conditions.length > 0 && (
            <View style={styles.ruleConditions}>
              <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary }]}>
                条件: {item.conditions.length} 个
              </Text>
            </View>
          )}

          {item.actions.length > 0 && (
            <View style={styles.ruleActions}>
              <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary }]}>
                动作: {item.actions.length} 个
              </Text>
            </View>
          )}
        </TouchableOpacity>
      </View>
    );
  };

  const renderHeader = () => (
    <View style={[styles.header, { backgroundColor: theme.colors.surface }]}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
        <MaterialIcons name="arrow-back" size={24} color={theme.colors.primary} />
      </TouchableOpacity>
      <Text style={[styles.headerTitle, { color: theme.colors.text }]}>自动化规则</Text>
      <TouchableOpacity onPress={() => setShowAddModal(true)} style={styles.addButton}>
        <MaterialIcons name="add" size={24} color={theme.colors.primary} />
      </TouchableOpacity>
    </View>
  );

  const renderSearchBar = () => (
    <View style={[styles.searchBar, { backgroundColor: theme.colors.surface }]}>
      <View style={[styles.searchInputContainer, { backgroundColor: theme.colors.background }]}>
        <MaterialIcons name="search" size={16} color={theme.colors.textSecondary} style={{ marginRight: 8 }} />
        <TextInput
          style={[styles.searchInput, { color: theme.colors.text }]}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="搜索自动化规则..."
          placeholderTextColor={theme.colors.textSecondary}
        />
      </View>
    </View>
  );

  const renderFilterBar = () => (
    <View style={styles.filterBar}>
      <TouchableOpacity
        style={[styles.filterButton, filterEnabled === null && { backgroundColor: theme.colors.primary }]}
        onPress={() => setFilterEnabled(null)}
      >
        <Text style={[styles.filterButtonText, { color: filterEnabled === null ? '#FFFFFF' : theme.colors.text }]}>
          全部
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.filterButton, filterEnabled === true && { backgroundColor: theme.colors.primary }]}
        onPress={() => setFilterEnabled(true)}
      >
        <Text style={[styles.filterButtonText, { color: filterEnabled === true ? '#FFFFFF' : theme.colors.text }]}>
          已启用
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.filterButton, filterEnabled === false && { backgroundColor: theme.colors.primary }]}
        onPress={() => setFilterEnabled(false)}
      >
        <Text style={[styles.filterButtonText, { color: filterEnabled === false ? '#FFFFFF' : theme.colors.text }]}>
          已禁用
        </Text>
      </TouchableOpacity>
    </View>
  );

  const renderCreateModal = () => (
    <Modal
      visible={showAddModal}
      animationType="slide"
      transparent={true}
      onRequestClose={() => setShowAddModal(false)}
    >
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContent, { backgroundColor: theme.colors.surface }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: theme.colors.text }]}>创建自动化规则</Text>
            <TouchableOpacity onPress={() => setShowAddModal(false)}>
              <MaterialIcons name="close" size={24} color={theme.colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalBody}>
            <View style={styles.formGroup}>
              <Text style={[styles.formLabel, { color: theme.colors.text }]}>规则名称 *</Text>
              <TextInput
                style={[styles.formInput, { color: theme.colors.text, borderColor: theme.colors.border }]}
                value={newRule.name}
                onChangeText={(text) => setNewRule({ ...newRule, name: text })}
                placeholder="例如：紧急任务自动标记"
                placeholderTextColor={theme.colors.textSecondary}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={[styles.formLabel, { color: theme.colors.text }]}>描述</Text>
              <TextInput
                style={[styles.formInput, styles.formTextArea, { color: theme.colors.text, borderColor: theme.colors.border }]}
                value={newRule.description}
                onChangeText={(text) => setNewRule({ ...newRule, description: text })}
                placeholder="规则描述..."
                placeholderTextColor={theme.colors.textSecondary}
                multiline
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={[styles.formLabel, { color: theme.colors.text }]}>触发器</Text>
              <View style={styles.triggerGrid}>
                {TRIGGER_TYPES.map((trigger) => (
                  <TouchableOpacity
                    key={trigger.type}
                    style={[
                      styles.triggerOption,
                      newRule.triggerType === trigger.type && { backgroundColor: theme.colors.primary + '20' },
                    ]}
                    onPress={() => setNewRule({ ...newRule, triggerType: trigger.type })}
                  >
                    <MaterialIcons name={trigger.iconName} size={16} color={theme.colors.primary} style={{ marginRight: 4 }} />
                    <Text style={[styles.triggerLabel, { color: theme.colors.text }]}>{trigger.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.formGroup}>
              <View style={styles.sectionHeader}>
                <Text style={[styles.formLabel, { color: theme.colors.text }]}>条件</Text>
                <TouchableOpacity onPress={addCondition}>
                  <Text style={[styles.addLink, { color: theme.colors.primary }]}>+ 添加条件</Text>
                </TouchableOpacity>
              </View>
              {newRule.conditions.map((condition, index) => (
                <View key={condition.id} style={[styles.conditionItem, { backgroundColor: theme.colors.background }]}>
                  <View style={styles.conditionRow}>
                    <View style={styles.conditionField}>
                      <Text style={[styles.smallLabel, { color: theme.colors.textSecondary }]}>字段</Text>
                      <View style={[styles.selectInput, { borderColor: theme.colors.border }]}>
                        <Text style={[styles.selectText, { color: theme.colors.text }]}>
                          {CONDITION_FIELDS.find((f) => f.field === condition.field)?.label || condition.field}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.conditionOperator}>
                      <Text style={[styles.smallLabel, { color: theme.colors.textSecondary }]}>操作</Text>
                      <View style={[styles.selectInput, { borderColor: theme.colors.border }]}>
                        <Text style={[styles.selectText, { color: theme.colors.text }]}>
                          {CONDITION_OPERATORS.find((o) => o.value === condition.operator)?.label || condition.operator}
                        </Text>
                      </View>
                    </View>
                  </View>
                  <View style={styles.conditionRow}>
                    <View style={styles.conditionValue}>
                      <Text style={[styles.smallLabel, { color: theme.colors.textSecondary }]}>值</Text>
                      <TextInput
                        style={[styles.valueInput, { color: theme.colors.text, borderColor: theme.colors.border }]}
                        value={String(condition.value)}
                        onChangeText={(text) => updateCondition(index, { value: text })}
                        placeholder="输入值"
                        placeholderTextColor={theme.colors.textSecondary}
                      />
                    </View>
                    <TouchableOpacity onPress={() => removeCondition(index)} style={styles.removeButton}>
                      <Text style={styles.removeButtonText}>删除</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
              {newRule.conditions.length === 0 && (
                <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>暂无条件（可选）</Text>
              )}
            </View>

            <View style={styles.formGroup}>
              <View style={styles.sectionHeader}>
                <Text style={[styles.formLabel, { color: theme.colors.text }]}>动作</Text>
                <TouchableOpacity onPress={addAction}>
                  <Text style={[styles.addLink, { color: theme.colors.primary }]}>+ 添加动作</Text>
                </TouchableOpacity>
              </View>
              {newRule.actions.map((action, index) => {
                const actionInfo = ACTION_TYPES.find((a) => a.type === action.type);
                return (
                  <View key={action.id} style={[styles.actionItem, { backgroundColor: theme.colors.background }]}>
                    <View style={styles.actionHeader}>
                      <MaterialIcons name={actionInfo?.iconName || 'settings'} size={16} color={theme.colors.primary} style={{ marginRight: 8 }} />
                      <Text style={[styles.actionLabel, { color: theme.colors.text }]}>
                        {actionInfo?.label || action.type}
                      </Text>
                      <TouchableOpacity onPress={() => removeAction(index)}>
                        <Text style={[styles.removeLink, { color: theme.colors.error }]}>删除</Text>
                      </TouchableOpacity>
                    </View>
                    <View style={styles.actionTypeSelect}>
                      <Text style={[styles.smallLabel, { color: theme.colors.textSecondary }]}>动作类型</Text>
                      <View style={[styles.selectInput, { borderColor: theme.colors.border }]}>
                        <Text style={[styles.selectText, { color: theme.colors.text }]}>
                          {actionInfo?.label || action.type}
                        </Text>
                      </View>
                    </View>
                  </View>
                );
              })}
              {newRule.actions.length === 0 && (
                <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>暂无动作（至少需要一个）</Text>
              )}
            </View>
          </ScrollView>

          <View style={styles.modalFooter}>
            <Button title="取消" onPress={() => setShowAddModal(false)} variant="secondary" style={styles.modalButton} />
            <Button title="创建" onPress={handleCreateRule} variant="primary" style={styles.modalButton} />
          </View>
        </View>
      </View>
    </Modal>
  );

  const renderDetailModal = () => {
    if (!selectedRule) return null;
    const triggerInfo = TRIGGER_TYPES.find((t) => t.type === selectedRule.trigger.type);

    return (
      <Modal
        visible={showRuleDetailModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowRuleDetailModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.colors.surface }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.colors.text }]}>{selectedRule.name}</Text>
              <TouchableOpacity onPress={() => setShowRuleDetailModal(false)}>
                <MaterialIcons name="close" size={24} color={theme.colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody}>
              {selectedRule.description && (
                <View style={styles.detailSection}>
                  <Text style={[styles.detailLabel, { color: theme.colors.textSecondary }]}>描述</Text>
                  <Text style={[styles.detailText, { color: theme.colors.text }]}>{selectedRule.description}</Text>
                </View>
              )}

              <View style={styles.detailSection}>
                <Text style={[styles.detailLabel, { color: theme.colors.textSecondary }]}>触发器</Text>
                <View style={[styles.detailBadge, { backgroundColor: theme.colors.primary + '20' }]}>
                  <MaterialIcons name={triggerInfo?.iconName || 'settings'} size={16} color={theme.colors.primary} style={{ marginRight: 8 }} />
                  <Text style={[styles.detailBadgeText, { color: theme.colors.primary }]}>
                    {triggerInfo?.label || selectedRule.trigger.type}
                  </Text>
                </View>
                {triggerInfo && (
                  <Text style={[styles.detailDescription, { color: theme.colors.textSecondary }]}>
                    {triggerInfo.description}
                  </Text>
                )}
              </View>

              {selectedRule.conditions.length > 0 && (
                <View style={styles.detailSection}>
                  <Text style={[styles.detailLabel, { color: theme.colors.textSecondary }]}>
                    条件 ({selectedRule.conditions.length})
                  </Text>
                  {selectedRule.conditions.map((condition, _index) => {
                    const fieldInfo = CONDITION_FIELDS.find((f) => f.field === condition.field);
                    const operatorInfo = CONDITION_OPERATORS.find((o) => o.value === condition.operator);
                    return (
                      <View key={condition.id} style={[styles.conditionDisplay, { backgroundColor: theme.colors.background }]}>
                        <Text style={[styles.conditionDisplayText, { color: theme.colors.text }]}>
                          {fieldInfo?.label || condition.field} {operatorInfo?.label || condition.operator}{' '}
                          {String(condition.value)}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              )}

              {selectedRule.actions.length > 0 && (
                <View style={styles.detailSection}>
                  <Text style={[styles.detailLabel, { color: theme.colors.textSecondary }]}>
                    动作 ({selectedRule.actions.length})
                  </Text>
                  {selectedRule.actions.map((action, _index) => {
                    const actionInfo = ACTION_TYPES.find((a) => a.type === action.type);
                    return (
                      <View key={action.id} style={[styles.actionDisplay, { backgroundColor: theme.colors.background }]}>
                        <MaterialIcons name={actionInfo?.iconName || 'settings'} size={16} color={theme.colors.primary} style={{ marginRight: 8 }} />
                        <Text style={[styles.actionDisplayText, { color: theme.colors.text }]}>
                          {actionInfo?.label || action.type}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              )}

              <View style={styles.detailSection}>
                <Text style={[styles.detailLabel, { color: theme.colors.textSecondary }]}>统计</Text>
                <View style={styles.statsGrid}>
                  <View style={[styles.statItem, { backgroundColor: theme.colors.background }]}>
                    <Text style={[styles.statValue, { color: theme.colors.text }]}>{selectedRule.executionCount}</Text>
                    <Text style={[styles.statLabel, { color: theme.colors.textSecondary }]}>执行次数</Text>
                  </View>
                  <View style={[styles.statItem, { backgroundColor: theme.colors.background }]}>
                    <Text style={[styles.statValue, { color: theme.colors.text }]}>
                      {selectedRule.isEnabled ? '是' : '否'}
                    </Text>
                    <Text style={[styles.statLabel, { color: theme.colors.textSecondary }]}>启用状态</Text>
                  </View>
                </View>
                {selectedRule.lastExecutedAt && (
                  <Text style={[styles.lastExecuted, { color: theme.colors.textSecondary }]}>
                    上次执行: {new Date(selectedRule.lastExecutedAt).toLocaleString()}
                  </Text>
                )}
                {selectedRule.lastError && (
                  <View style={[styles.errorBox, { backgroundColor: theme.colors.error + '20' }]}>
                    <Text style={[styles.errorText, { color: theme.colors.error }]}>错误: {selectedRule.lastError}</Text>
                  </View>
                )}
              </View>
            </ScrollView>

            <View style={styles.modalFooter}>
              <Button
                title="执行"
                onPress={() => {
                  handleExecuteRule(selectedRule);
                  setShowRuleDetailModal(false);
                }}
                variant="secondary"
                style={styles.modalButton}
              />
              <Button
                title="关闭"
                onPress={() => setShowRuleDetailModal(false)}
                variant="primary"
                style={styles.modalButton}
              />
            </View>
          </View>
        </View>
      </Modal>
    );
  };

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <MaterialIcons name="smart-toy" size={64} color={theme.colors.textSecondary} style={{ opacity: 0.6 }} />
      <Text style={[styles.emptyTitle, { color: theme.colors.text }]}>暂无自动化规则</Text>
      <Text style={[styles.emptySubtitle, { color: theme.colors.textSecondary }]}>
        点击右上角的"新建"按钮，创建您的第一个自动化规则
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {renderHeader()}
      {renderSearchBar()}
      {renderFilterBar()}

      <FlatList
        data={filteredRules}
        keyExtractor={(item) => item.id}
        renderItem={renderRuleCard}
        ListEmptyComponent={renderEmptyState}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />

      {renderCreateModal()}
      {renderDetailModal()}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  backButton: { padding: 4 },
  backButtonText: { fontSize: 16 },
  headerTitle: { fontSize: 18, fontWeight: '600' },
  addButton: { padding: 4 },
  addButtonText: { fontSize: 16, fontWeight: '600' },
  searchBar: { padding: 16 },
  searchInputContainer: { flexDirection: 'row', alignItems: 'center', borderRadius: 8, paddingHorizontal: 12 },
  searchIcon: { fontSize: 16, marginRight: 8 },
  searchInput: { flex: 1, fontSize: 16, paddingVertical: 10 },
  filterBar: { flexDirection: 'row', paddingHorizontal: 16, marginBottom: 12 },
  filterButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 8,
  },
  filterButtonText: { fontSize: 13, fontWeight: '500' },
  listContent: { padding: 16, flexGrow: 1 },
  ruleCard: {
    marginBottom: 12,
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  ruleHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 },
  ruleInfo: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  ruleIcon: { fontSize: 32, marginRight: 12 },
  ruleTitleContainer: { flex: 1 },
  ruleName: { fontSize: 16, fontWeight: '600', marginBottom: 2 },
  ruleDescription: { fontSize: 13 },
  ruleToggle: { marginLeft: 12 },
  ruleDetails: { paddingHorizontal: 16, paddingBottom: 12 },
  ruleMeta: { flexDirection: 'row', marginBottom: 8 },
  metaBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    marginRight: 8,
  },
  metaBadgeText: { fontSize: 12, fontWeight: '600' },
  ruleStats: { flexDirection: 'row', justifyContent: 'space-between' },
  statText: { fontSize: 12 },
  ruleConditions: { paddingHorizontal: 16, paddingBottom: 8 },
  ruleActions: { paddingHorizontal: 16, paddingBottom: 16 },
  sectionLabel: { fontSize: 12 },
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40, marginTop: 60 },
  emptyTitle: { fontSize: 18, fontWeight: '600', marginBottom: 8 },
  emptySubtitle: { fontSize: 14, textAlign: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
  modalContent: { borderRadius: 12, maxHeight: '90%' },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  modalTitle: { fontSize: 18, fontWeight: '600' },
  modalClose: { fontSize: 28, lineHeight: 28 },
  modalBody: { padding: 16, maxHeight: 500 },
  modalFooter: {
    flexDirection: 'row',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.1)',
  },
  modalButton: { flex: 1, marginHorizontal: 4 },
  formGroup: { marginBottom: 20 },
  formLabel: { fontSize: 14, fontWeight: '600', marginBottom: 8 },
  formInput: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  formTextArea: { minHeight: 80, textAlignVertical: 'top' },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  addLink: { fontSize: 14, fontWeight: '600' },
  triggerGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  triggerOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginRight: 8,
    marginBottom: 8,
  },
  triggerIcon: { fontSize: 16, marginRight: 4 },
  triggerLabel: { fontSize: 13 },
  conditionItem: { padding: 12, borderRadius: 8, marginBottom: 8 },
  conditionRow: { flexDirection: 'row', marginBottom: 8 },
  conditionField: { flex: 1, marginRight: 8 },
  conditionOperator: { flex: 1, marginRight: 8 },
  conditionValue: { flex: 2 },
  smallLabel: { fontSize: 11, marginBottom: 4 },
  selectInput: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 6 },
  selectText: { fontSize: 13 },
  valueInput: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 6, fontSize: 13 },
  removeButton: { justifyContent: 'center', alignItems: 'center', paddingHorizontal: 12 },
  removeButtonText: { color: '#EF4444', fontSize: 13 },
  emptyText: { fontSize: 13, textAlign: 'center', padding: 16 },
  actionItem: { padding: 12, borderRadius: 8, marginBottom: 8 },
  actionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  actionIcon: { fontSize: 16, marginRight: 8 },
  actionLabel: { flex: 1, fontSize: 14, fontWeight: '500' },
  removeLink: { fontSize: 13 },
  actionTypeSelect: { marginTop: 4 },
  detailSection: { marginBottom: 20 },
  detailLabel: { fontSize: 12, fontWeight: '600', marginBottom: 8, textTransform: 'uppercase' },
  detailText: { fontSize: 14, lineHeight: 20 },
  detailBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, alignSelf: 'flex-start' },
  detailIcon: { fontSize: 16, marginRight: 8 },
  detailBadgeText: { fontSize: 14, fontWeight: '600' },
  detailDescription: { fontSize: 13, marginTop: 8 },
  conditionDisplay: { padding: 12, borderRadius: 8, marginBottom: 8 },
  conditionDisplayText: { fontSize: 13 },
  actionDisplay: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 8, marginBottom: 8 },
  actionDisplayIcon: { fontSize: 16, marginRight: 8 },
  actionDisplayText: { fontSize: 14 },
  statsGrid: { flexDirection: 'row', marginBottom: 12 },
  statItem: { flex: 1, padding: 12, borderRadius: 8, marginRight: 8, alignItems: 'center' },
  statValue: { fontSize: 24, fontWeight: '700', marginBottom: 4 },
  statLabel: { fontSize: 12 },
  lastExecuted: { fontSize: 12, marginTop: 8 },
  errorBox: { padding: 12, borderRadius: 8, marginTop: 8 },
  errorText: { fontSize: 13 },
});
