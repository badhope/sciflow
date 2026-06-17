import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  Platform,
  ScrollView,
  StyleProp,
  ViewStyle,
  TextStyle,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useAppStore } from '../../store';

export interface MentionUser {
  id: string;
  name: string;
  username?: string;
  color?: string;
  avatar?: string;
}

export interface MentionEntity {
  id: string;
  name: string;
  start: number;
  end: number;
}

const MENTION_REGEX = /@([\p{L}\p{N}_\-.]+)/gu;

export function parseMentions(text: string): MentionEntity[] {
  const out: MentionEntity[] = [];
  let m: RegExpExecArray | null;
  MENTION_REGEX.lastIndex = 0;
  while ((m = MENTION_REGEX.exec(text)) !== null) {
    out.push({ id: m[1], name: m[1], start: m.index, end: m.index + m[0].length });
  }
  return out;
}

export function renderMentionText(
  text: string,
  theme: any,
  baseStyle?: StyleProp<TextStyle>,
  mentionColor?: string
): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let last = 0;
  const mentions = parseMentions(text);
  for (let i = 0; i < mentions.length; i++) {
    const m = mentions[i];
    if (m.start > last) parts.push(text.substring(last, m.start));
    parts.push(
      <Text
        key={`mention-${i}-${m.start}`}
        style={{ color: mentionColor ?? theme.colors.primary, fontWeight: '600' }}
      >
        @{m.name}
      </Text>
    );
    last = m.end;
  }
  if (last < text.length) parts.push(text.substring(last));
  return <Text style={baseStyle}>{parts}</Text>;
}

export interface MentionInputProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit?: () => void;
  users: MentionUser[];
  placeholder?: string;
  multiline?: boolean;
  style?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
  maxHeight?: number;
  autoFocus?: boolean;
  disabled?: boolean;
}

export function MentionInput({
  value,
  onChange,
  onSubmit,
  users,
  placeholder = '发表评论，使用 @ 提及成员',
  multiline = true,
  style,
  inputStyle,
  maxHeight = 120,
  autoFocus = false,
  disabled = false,
}: MentionInputProps) {
  const { theme } = useAppStore();
  const inputRef = useRef<TextInput>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);

  const findActiveMention = useCallback(
    (text: string, pos: number): { query: string; start: number } | null => {
      const before = text.substring(0, pos);
      const atIdx = before.lastIndexOf('@');
      if (atIdx < 0) return null;
      const between = before.substring(atIdx + 1);
      if (/\s/.test(between)) return null;
      if (between.length > 32) return null;
      return { query: between, start: atIdx };
    },
    []
  );

  useEffect(() => {
    const m = findActiveMention(value, cursor);
    if (m) {
      setQuery(m.query);
      setShowSuggestions(true);
    } else {
      setShowSuggestions(false);
    }
  }, [value, cursor, findActiveMention]);

  const filtered = users.filter((u) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return u.name.toLowerCase().includes(q) || (u.username ?? '').toLowerCase().includes(q);
  });

  const applyMention = useCallback(
    (user: MentionUser) => {
      const m = findActiveMention(value, cursor);
      if (!m) return;
      const before = value.substring(0, m.start);
      const afterCursor = value.substring(cursor);
      const inserted = `@${user.name} `;
      const newText = before + inserted + afterCursor;
      onChange(newText);
      const newCursor = m.start + inserted.length;
      setCursor(newCursor);
      setShowSuggestions(false);
      setTimeout(() => inputRef.current?.setNativeProps({ selection: { start: newCursor, end: newCursor } }), 10);
    },
    [value, cursor, findActiveMention, onChange]
  );

  const handleChange = (v: string) => {
    onChange(v);
  };

  const handleSelectionChange = (e: any) => {
    const start = e.nativeEvent?.selection?.start ?? 0;
    setCursor(start);
  };

  const handleKeyPress = (e: any) => {
    if (e.nativeEvent?.key === 'Escape' && showSuggestions) {
      setShowSuggestions(false);
    }
  };

  return (
    <View style={[styles.wrap, style]}>
      <View style={[styles.inputWrap, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
        {showSuggestions && filtered.length > 0 && (
          <View style={[styles.suggestions, { backgroundColor: theme.colors.card, borderColor: theme.colors.border }]}>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              style={{ maxHeight: 160 }}
              showsVerticalScrollIndicator={false}
            >
              {filtered.slice(0, 6).map((u) => (
                <TouchableOpacity
                  key={u.id}
                  onPress={() => applyMention(u)}
                  activeOpacity={0.7}
                  style={styles.suggestionRow}
                >
                  <View style={[styles.avatar, { backgroundColor: (u.color ?? theme.colors.primary) + '20' }]}>
                    <Text style={[styles.avatarText, { color: u.color ?? theme.colors.primary }]}>
                      {u.name.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.userName, { color: theme.colors.text }]} numberOfLines={1}>
                      {u.name}
                    </Text>
                    {u.username && (
                      <Text style={[styles.userHandle, { color: theme.colors.textTertiary }]}>
                        @{u.username}
                      </Text>
                    )}
                  </View>
                  <MaterialIcons name="alternate-email" size={14} color={theme.colors.textTertiary} />
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={handleChange}
          onSelectionChange={handleSelectionChange}
          onKeyPress={handleKeyPress}
          placeholder={placeholder}
          placeholderTextColor={theme.colors.textTertiary}
          multiline={multiline}
          autoFocus={autoFocus}
          editable={!disabled}
          onSubmitEditing={onSubmit}
          blurOnSubmit={!multiline}
          style={[
            styles.input,
            {
              color: theme.colors.text,
              maxHeight,
              minHeight: multiline ? 44 : 36,
            },
            inputStyle,
          ]}
        />

        {value.length > 0 && (
          <View style={styles.bottomBar}>
            <View style={styles.bottomLeft}>
              <MaterialIcons name="alternate-email" size={12} color={theme.colors.textTertiary} />
              <Text style={[styles.hint, { color: theme.colors.textTertiary }]}>
                使用 @ 提及成员，提及 {parseMentions(value).length} 人
              </Text>
            </View>
            {onSubmit && (
              <TouchableOpacity
                onPress={onSubmit}
                disabled={!value.trim()}
                style={[
                  styles.sendBtn,
                  { backgroundColor: value.trim() ? theme.colors.primary : theme.colors.border },
                ]}
              >
                <MaterialIcons name="send" size={14} color="#fff" />
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
  },
  inputWrap: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 6,
  },
  input: {
    fontSize: 14,
    paddingTop: Platform.OS === 'ios' ? 8 : 4,
    paddingBottom: 4,
    lineHeight: 20,
  },
  suggestions: {
    position: 'absolute',
    bottom: '100%',
    left: 0,
    right: 0,
    marginBottom: 6,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    zIndex: 100,
    elevation: 8,
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 10,
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 12,
    fontWeight: '700',
  },
  userName: {
    fontSize: 13,
    fontWeight: '600',
  },
  userHandle: {
    fontSize: 11,
    marginTop: 1,
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 4,
  },
  bottomLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  hint: {
    fontSize: 11,
  },
  sendBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
