import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  SafeAreaView,
  Alert,
  Modal,
  ScrollView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { MaterialIcons } from '@expo/vector-icons';
import { useAppStore } from '../src/shared/store';
import { RootStackParamList, Note } from '../src/shared/types';

import { toast } from '../src/shared/components/common/Toast';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Notes'>;

const NOTE_COLORS = [
  '#fef3c7', '#fed7aa', '#fecaca', '#fde7f3',
  '#e9d5ff', '#dbeafe', '#cffafe', '#d1fae5',
  '#f3f4f6', '#ffffff',
];

const NOTE_ICONS: (keyof typeof MaterialIcons.glyphMap)[] = [
  'edit-note', 'lightbulb', 'stars', 'menu-book',
  'business-center', 'home', 'star', 'bookmark',
];

export default function NotesScreen() {
  const navigation = useNavigation<NavigationProp>();
  const {
    theme,
    notes,
    addNote,
    updateNote,
    deleteNote,
    archiveNote,
    pinNote,
  } = useAppStore();

  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [newNote, setNewNote] = useState<Partial<Note>>({
    title: '',
    content: '',
    color: '#fef3c7',
    icon: 'edit-note',
    isPinned: false,
    isArchived: false,
    isLocked: false,
    tags: [],
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [selectedColor, setSelectedColor] = useState('#fef3c7');

  const filteredNotes = notes.filter(
    (note) =>
      !note.isArchived &&
      (note.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        note.content.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const pinnedNotes = filteredNotes.filter((note) => note.isPinned);
  const otherNotes = filteredNotes.filter((note) => !note.isPinned);

  const handleAddNote = () => {
    if (!newNote.title?.trim()) {
      toast.error('请输入笔记标题');
      return;
    }

    const note = {
      title: newNote.title.trim(),
      content: newNote.content || '',
      contentHtml: '',
      isMarkdown: false,
      color: selectedColor,
      icon: newNote.icon || 'edit-note',
      isPinned: false,
      isArchived: false,
      isLocked: false,
      tags: newNote.tags || [],
      categoryId: null,
      projectId: null,
      attachments: [],
      links: [],
      taskLinks: [],
      versionHistory: [],
      createdBy: null,
    };

    addNote(note);
    setShowAddModal(false);
    setNewNote({
      title: '',
      content: '',
      color: '#fef3c7',
      icon: 'edit-note',
      isPinned: false,
      isArchived: false,
      isLocked: false,
      tags: [],
    });
    setSelectedColor('#fef3c7');
  };

  const handleUpdateNote = () => {
    if (!selectedNote || !newNote.title?.trim()) return;

    updateNote(selectedNote.id, {
      title: newNote.title.trim(),
      content: newNote.content,
      color: selectedColor,
      icon: newNote.icon,
      tags: newNote.tags,
    });

    setShowEditModal(false);
    setSelectedNote(null);
  };

  const handleDeleteNote = (noteId: string) => {
    Alert.alert(
      '删除笔记',
      '确定要删除这个笔记吗？此操作不可撤销。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: () => deleteNote(noteId),
        },
      ]
    );
  };

  const handleArchiveNote = (noteId: string) => {
    archiveNote(noteId);
  };

  const handlePinNote = (noteId: string) => {
    pinNote(noteId);
  };

  const openEditModal = (note: Note) => {
    setSelectedNote(note);
    setNewNote({
      title: note.title,
      content: note.content,
      icon: note.icon,
      tags: note.tags,
    });
    setSelectedColor(note.color || '#fef3c7');
    setShowEditModal(true);
  };

  const formatDate = (date: Date): string => {
    const now = new Date();
    const diff = now.getTime() - new Date(date).getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (days === 0) return '今天';
    if (days === 1) return '昨天';
    if (days < 7) return `${days}天前`;
    return new Date(date).toLocaleDateString('zh-CN');
  };

  const renderNoteCard = (note: Note, isGrid: boolean = true) => {
    if (isGrid) {
      return (
        <TouchableOpacity
          key={note.id}
          style={[styles.noteCard, { backgroundColor: note.color }]}
          onPress={() => openEditModal(note)}
          onLongPress={() => {
            Alert.alert('笔记操作', note.title, [
              { text: '编辑', onPress: () => openEditModal(note) },
              { text: note.isPinned ? '取消置顶' : '置顶', onPress: () => handlePinNote(note.id) },
              { text: '归档', onPress: () => handleArchiveNote(note.id) },
              { text: '删除', style: 'destructive', onPress: () => handleDeleteNote(note.id) },
              { text: '取消', style: 'cancel' },
            ]);
          }}
        >
          <View style={styles.noteIconRow}>
            <MaterialIcons name={note.icon as any || 'edit-note'} size={24} color={note.color} />
            {note.isPinned && <MaterialIcons name="push-pin" size={16} color="#f59e0b" />}
          </View>
          <Text style={[styles.noteTitle, { color: '#1f2937' }]} numberOfLines={2}>
            {note.title}
          </Text>
          {note.content && (
            <Text style={[styles.noteContent, { color: '#6b7280' }]} numberOfLines={4}>
              {note.content}
            </Text>
          )}
          <View style={styles.noteFooter}>
            <Text style={[styles.noteDate, { color: '#9ca3af' }]}>
              {formatDate(note.updatedAt)}
            </Text>
          </View>
        </TouchableOpacity>
      );
    } else {
      return (
        <TouchableOpacity
          key={note.id}
          style={[styles.noteListItem, { backgroundColor: theme.colors.surface }]}
          onPress={() => openEditModal(note)}
          onLongPress={() => {
            Alert.alert('笔记操作', note.title, [
              { text: '编辑', onPress: () => openEditModal(note) },
              { text: note.isPinned ? '取消置顶' : '置顶', onPress: () => handlePinNote(note.id) },
              { text: '归档', onPress: () => handleArchiveNote(note.id) },
              { text: '删除', style: 'destructive', onPress: () => handleDeleteNote(note.id) },
              { text: '取消', style: 'cancel' },
            ]);
          }}
        >
          <View style={[styles.noteListColor, { backgroundColor: note.color }]} />
          <View style={styles.noteListContent}>
            <View style={styles.noteListHeader}>
              <MaterialIcons name={note.icon as any || 'edit-note'} size={20} color={note.color} style={styles.noteListIcon} />
              <Text style={[styles.noteListTitle, { color: theme.colors.text }]} numberOfLines={1}>
                {note.title}
              </Text>
              {note.isPinned && <MaterialIcons name="push-pin" size={14} color="#f59e0b" />}
            </View>
            {note.content && (
              <Text style={[styles.noteListPreview, { color: theme.colors.textSecondary }]} numberOfLines={1}>
                {note.content}
              </Text>
            )}
            <Text style={[styles.noteListDate, { color: theme.colors.textSecondary }]}>
              {formatDate(note.updatedAt)}
            </Text>
          </View>
        </TouchableOpacity>
      );
    }
  };

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <MaterialIcons name="note" size={64} color={theme.colors.textSecondary} style={{ opacity: 0.6 }} />
      <Text style={[styles.emptyTitle, { color: theme.colors.text }]}>暂无笔记</Text>
      <Text style={[styles.emptySubtitle, { color: theme.colors.textSecondary }]}>
        点击右下角的"+"按钮，创建您的第一条笔记
      </Text>
    </View>
  );

  const renderAddModal = () => (
    <Modal
      visible={showAddModal}
      animationType="slide"
      transparent={true}
      onRequestClose={() => setShowAddModal(false)}
    >
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContent, { backgroundColor: theme.colors.surface }]}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowAddModal(false)}>
              <Text style={[styles.cancelButton, { color: theme.colors.textSecondary }]}>取消</Text>
            </TouchableOpacity>
            <Text style={[styles.modalTitle, { color: theme.colors.text }]}>新建笔记</Text>
            <TouchableOpacity onPress={handleAddNote}>
              <Text style={[styles.saveButton, { color: theme.colors.primary }]}>保存</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalBody}>
            <View style={styles.iconSelector}>
              <Text style={[styles.selectorLabel, { color: theme.colors.text }]}>图标</Text>
              <View style={styles.iconGrid}>
                {NOTE_ICONS.map((iconName) => (
                  <TouchableOpacity
                    key={iconName}
                    style={[
                      styles.iconOption,
                      newNote.icon === iconName && { backgroundColor: theme.colors.primary + '20' },
                    ]}
                    onPress={() => setNewNote({ ...newNote, icon: iconName })}
                  >
                    <MaterialIcons name={iconName} size={24} color={theme.colors.primary} />
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.formGroup}>
              <Text style={[styles.formLabel, { color: theme.colors.text }]}>标题</Text>
              <TextInput
                style={[styles.formInput, { color: theme.colors.text, borderColor: theme.colors.border }]}
                value={newNote.title}
                onChangeText={(text) => setNewNote({ ...newNote, title: text })}
                placeholder="笔记标题"
                placeholderTextColor={theme.colors.textSecondary}
                autoFocus
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={[styles.formLabel, { color: theme.colors.text }]}>内容</Text>
              <TextInput
                style={[styles.formTextArea, { color: theme.colors.text, borderColor: theme.colors.border }]}
                value={newNote.content}
                onChangeText={(text) => setNewNote({ ...newNote, content: text })}
                placeholder="写下你的想法..."
                placeholderTextColor={theme.colors.textSecondary}
                multiline
                numberOfLines={8}
                textAlignVertical="top"
              />
            </View>

            <View style={styles.colorSelector}>
              <Text style={[styles.selectorLabel, { color: theme.colors.text }]}>颜色</Text>
              <View style={styles.colorGrid}>
                {NOTE_COLORS.map((color) => (
                  <TouchableOpacity
                    key={color}
                    style={[
                      styles.colorOption,
                      { backgroundColor: color },
                      selectedColor === color && styles.colorOptionSelected,
                    ]}
                    onPress={() => setSelectedColor(color)}
                  >
                    {selectedColor === color && (
                      <MaterialIcons name="check" size={18} color="rgba(0,0,0,0.5)" />
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );

  const renderEditModal = () => (
    <Modal
      visible={showEditModal}
      animationType="slide"
      transparent={true}
      onRequestClose={() => setShowEditModal(false)}
    >
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContent, { backgroundColor: theme.colors.surface }]}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowEditModal(false)}>
              <Text style={[styles.cancelButton, { color: theme.colors.textSecondary }]}>取消</Text>
            </TouchableOpacity>
            <Text style={[styles.modalTitle, { color: theme.colors.text }]}>编辑笔记</Text>
            <TouchableOpacity onPress={handleUpdateNote}>
              <Text style={[styles.saveButton, { color: theme.colors.primary }]}>保存</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalBody}>
            <View style={styles.iconSelector}>
              <Text style={[styles.selectorLabel, { color: theme.colors.text }]}>图标</Text>
              <View style={styles.iconGrid}>
                {NOTE_ICONS.map((iconName) => (
                  <TouchableOpacity
                    key={iconName}
                    style={[
                      styles.iconOption,
                      newNote.icon === iconName && { backgroundColor: theme.colors.primary + '20' },
                    ]}
                    onPress={() => setNewNote({ ...newNote, icon: iconName })}
                  >
                    <MaterialIcons name={iconName} size={24} color={theme.colors.primary} />
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.formGroup}>
              <Text style={[styles.formLabel, { color: theme.colors.text }]}>标题</Text>
              <TextInput
                style={[styles.formInput, { color: theme.colors.text, borderColor: theme.colors.border }]}
                value={newNote.title}
                onChangeText={(text) => setNewNote({ ...newNote, title: text })}
                placeholder="笔记标题"
                placeholderTextColor={theme.colors.textSecondary}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={[styles.formLabel, { color: theme.colors.text }]}>内容</Text>
              <TextInput
                style={[styles.formTextArea, { color: theme.colors.text, borderColor: theme.colors.border }]}
                value={newNote.content}
                onChangeText={(text) => setNewNote({ ...newNote, content: text })}
                placeholder="写下你的想法..."
                placeholderTextColor={theme.colors.textSecondary}
                multiline
                numberOfLines={8}
                textAlignVertical="top"
              />
            </View>

            <View style={styles.colorSelector}>
              <Text style={[styles.selectorLabel, { color: theme.colors.text }]}>颜色</Text>
              <View style={styles.colorGrid}>
                {NOTE_COLORS.map((color) => (
                  <TouchableOpacity
                    key={color}
                    style={[
                      styles.colorOption,
                      { backgroundColor: color },
                      selectedColor === color && styles.colorOptionSelected,
                    ]}
                    onPress={() => setSelectedColor(color)}
                  >
                    {selectedColor === color && (
                      <MaterialIcons name="check" size={18} color="rgba(0,0,0,0.5)" />
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <TouchableOpacity
              style={[styles.deleteButton, { backgroundColor: theme.colors.error + '10' }]}
              onPress={() => {
                if (selectedNote) {
                  handleDeleteNote(selectedNote.id);
                  setShowEditModal(false);
                }
              }}
            >
              <Text style={[styles.deleteButtonText, { color: theme.colors.error }]}>
                删除笔记
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );

  const renderHeader = () => (
    <View style={[styles.header, { backgroundColor: theme.colors.surface }]}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
        <MaterialIcons name="arrow-back" size={24} color={theme.colors.primary} />
      </TouchableOpacity>
      <Text style={[styles.headerTitle, { color: theme.colors.text }]}>笔记</Text>
      <View style={styles.headerActions}>
        <TouchableOpacity
        style={styles.viewModeButton}
        onPress={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
      >
        <MaterialIcons name={viewMode === 'grid' ? 'format-list-bulleted' : 'grid-view'} size={20} color={theme.colors.primary} />
      </TouchableOpacity>
      </View>
    </View>
  );

  const renderSearchBar = () => (
    <View style={[styles.searchBar, { backgroundColor: theme.colors.surface }]}>
      <View style={[styles.searchInputContainer, { backgroundColor: theme.colors.surface }]}>
        <MaterialIcons name="search" size={16} color={theme.colors.textSecondary} style={{ marginRight: 8 }} />
        <TextInput
          style={[styles.searchInput, { color: theme.colors.text }]}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="搜索笔记..."
          placeholderTextColor={theme.colors.textSecondary}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <MaterialIcons name="close" size={20} color={theme.colors.textSecondary} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {renderHeader()}
      {renderSearchBar()}

      {notes.length === 0 && !searchQuery ? (
        renderEmptyState()
      ) : (
        <ScrollView
          contentContainerStyle={styles.notesContainer}
          showsVerticalScrollIndicator={false}
        >
          <View>
            {pinnedNotes.length > 0 && (
                <View style={styles.section}>
                  <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>
                    置顶笔记 ({pinnedNotes.length})
                  </Text>
                  <View style={viewMode === 'grid' ? styles.notesGrid : styles.notesList}>
                    {pinnedNotes.map((note) => renderNoteCard(note, viewMode === 'grid'))}
                  </View>
                </View>
              )}

              {otherNotes.length > 0 && (
                <View style={styles.section}>
                  <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>
                    其他笔记 ({otherNotes.length})
                  </Text>
                  <View style={viewMode === 'grid' ? styles.notesGrid : styles.notesList}>
                    {otherNotes.map((note) => renderNoteCard(note, viewMode === 'grid'))}
                  </View>
                </View>
              )}

              {filteredNotes.length === 0 && searchQuery && (
                <View style={styles.noResults}>
                  <Text style={[styles.noResultsText, { color: theme.colors.textSecondary }]}>
                    没有找到匹配的笔记
                  </Text>
                </View>
              )}
            </View>
        </ScrollView>
      )}

      <TouchableOpacity
        style={[styles.fab, { backgroundColor: theme.colors.primary }]}
        onPress={() => setShowAddModal(true)}
      >
        <Text style={styles.fabIcon}>+</Text>
      </TouchableOpacity>

      {renderAddModal()}
      {renderEditModal()}
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
  headerActions: {
    flexDirection: 'row',
  },
  viewModeButton: {
    padding: 4,
  },
  viewModeIcon: {
    fontSize: 20,
  },
  searchBar: {
    padding: 16,
  },
  searchInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    paddingHorizontal: 12,
  },
  searchIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 10,
  },
  clearIcon: {
    fontSize: 20,
    padding: 4,
  },
  listContent: {
    paddingBottom: 100,
  },
  notesContainer: {
    padding: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  notesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -6,
  },
  notesList: {
    flexDirection: 'column',
  },
  noteCard: {
    width: '47%',
    marginHorizontal: '1.5%',
    marginBottom: 12,
    padding: 12,
    borderRadius: 12,
    minHeight: 120,
  },
  noteListItem: {
    flexDirection: 'row',
    marginBottom: 8,
    borderRadius: 12,
    overflow: 'hidden',
  },
  noteListColor: {
    width: 6,
  },
  noteListContent: {
    flex: 1,
    padding: 12,
  },
  noteListHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  noteListIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  noteListTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
  },
  noteListPreview: {
    fontSize: 13,
    marginBottom: 4,
  },
  noteListDate: {
    fontSize: 11,
  },
  noteIconRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  noteIcon: {
    fontSize: 20,
  },
  pinIcon: {
    fontSize: 14,
  },
  noteTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 6,
  },
  noteContent: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 8,
    flex: 1,
  },
  noteFooter: {
    marginTop: 'auto',
  },
  noteDate: {
    fontSize: 11,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
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
  noResults: {
    padding: 40,
    alignItems: 'center',
  },
  noResultsText: {
    fontSize: 14,
  },
  fab: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  fabIcon: {
    fontSize: 32,
    color: '#FFFFFF',
    lineHeight: 36,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    maxHeight: '90%',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
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
    fontSize: 18,
    fontWeight: '600',
  },
  cancelButton: {
    fontSize: 15,
  },
  saveButton: {
    fontSize: 15,
    fontWeight: '600',
  },
  modalBody: {
    padding: 16,
  },
  iconSelector: {
    marginBottom: 16,
  },
  selectorLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  iconGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  iconOption: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
    margin: 2,
  },
  iconText: {
    fontSize: 24,
  },
  formGroup: {
    marginBottom: 16,
  },
  formLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  formInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  formTextArea: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    minHeight: 150,
  },
  colorSelector: {
    marginBottom: 16,
  },
  colorGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  colorOption: {
    width: 40,
    height: 40,
    borderRadius: 20,
    margin: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  colorOptionSelected: {
    borderWidth: 3,
    borderColor: 'rgba(0,0,0,0.2)',
  },
  colorCheck: {
    fontSize: 18,
    fontWeight: 'bold',
    color: 'rgba(0,0,0,0.5)',
  },
  deleteButton: {
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 16,
  },
  deleteButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
