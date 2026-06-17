import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Easing,
  Platform,
  Alert,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useAppStore } from '../../store';

export interface VoiceInputProps {
  onResult: (transcript: string) => void;
  size?: number;
  color?: string;
  hint?: string;
}

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

export function VoiceInput({ onResult, size = 48, color, hint = '点击开始语音输入' }: VoiceInputProps) {
  const { theme } = useAppStore();
  const primary = color || theme.colors.primary;
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [supported, setSupported] = useState<boolean | null>(null);
  const pulse = useRef(new Animated.Value(0)).current;
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    if (Platform.OS === 'web') {
      const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      setSupported(!!SR);
    } else {
      setSupported(false);
    }
  }, []);

  useEffect(() => {
    if (listening) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, {
            toValue: 1,
            duration: 800,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(pulse, {
            toValue: 0,
            duration: 800,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
        ])
      );
      loop.start();
      return () => loop.stop();
    } else {
      pulse.setValue(0);
    }
  }, [listening, pulse]);

  const stop = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore stop errors
      }
      recognitionRef.current = null;
    }
    setListening(false);
  }, []);

  const start = useCallback(() => {
    if (Platform.OS !== 'web') {
      Alert.alert('不支持', '当前平台暂不支持语音输入，仅 Web 平台可用');
      return;
    }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      Alert.alert('不支持', '当前浏览器不支持 Web Speech API。请使用 Chrome / Edge。');
      return;
    }

    try {
      const recognition = new SR();
      recognition.lang = 'zh-CN';
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        setListening(true);
        setTranscript('');
      };
      recognition.onresult = (event: any) => {
        let interim = '';
        let final = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const r = event.results[i];
          if (r.isFinal) final += r[0].transcript;
          else interim += r[0].transcript;
        }
        const t = final || interim;
        setTranscript(t);
        if (final) {
          onResult(final.trim());
          setListening(false);
        }
      };
      recognition.onerror = (e: any) => {
        console.warn('SpeechRecognition error', e.error);
        setListening(false);
        if (e.error !== 'aborted' && e.error !== 'no-speech') {
          Alert.alert('识别失败', `错误: ${e.error}`);
        }
      };
      recognition.onend = () => {
        setListening(false);
        if (transcript && !finalResult.current) {
          onResult(transcript.trim());
        }
      };
      recognitionRef.current = recognition;
      recognition.start();
    } catch (err: any) {
      console.error('Failed to start speech recognition', err);
      Alert.alert('启动失败', err?.message || '未知错误');
    }
  }, [onResult, transcript]);

  const finalResult = useRef(false);

  if (supported === false) {
    return null;
  }

  const ring1 = pulse.interpolate({ inputRange: [0, 1], outputRange: [0, 22] });
  const ring2 = pulse.interpolate({ inputRange: [0, 1], outputRange: [0, 36] });
  const opacity1 = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] });
  const opacity2 = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0] });

  return (
    <View style={styles.wrap}>
      <View style={styles.ringWrap}>
        {listening && (
          <>
            <Animated.View
              style={[
                styles.ring,
                {
                  width: size,
                  height: size,
                  borderRadius: size / 2,
                  borderColor: primary,
                  transform: [{ scale: ring2.interpolate({ inputRange: [0, 1], outputRange: [1, 1.8] }) }],
                  opacity: opacity2,
                },
              ]}
            />
            <Animated.View
              style={[
                styles.ring,
                {
                  width: size,
                  height: size,
                  borderRadius: size / 2,
                  borderColor: primary,
                  transform: [{ scale: ring1.interpolate({ inputRange: [0, 1], outputRange: [1, 1.4] }) }],
                  opacity: opacity1,
                },
              ]}
            />
          </>
        )}
        <TouchableOpacity
          style={[
            styles.btn,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: listening ? '#ef4444' : primary,
            },
          ]}
          onPress={listening ? stop : start}
          activeOpacity={0.85}
        >
          <MaterialIcons
            name={listening ? 'mic' : 'mic-none'}
            size={size * 0.5}
            color="#FFFFFF"
          />
        </TouchableOpacity>
      </View>
      {listening && (
        <View style={[styles.bubble, { backgroundColor: theme.colors.surface, borderColor: primary }]}>
          {transcript ? (
            <Text style={[styles.bubbleText, { color: theme.colors.text }]}>{transcript}</Text>
          ) : (
            <Text style={[styles.bubbleHint, { color: theme.colors.textSecondary }]}>正在聆听...</Text>
          )}
        </View>
      )}
      {!listening && hint && (
        <Text style={[styles.hint, { color: theme.colors.textSecondary }]}>{hint}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    gap: 6,
  },
  ringWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    borderWidth: 2,
  },
  btn: {
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  bubble: {
    marginTop: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    maxWidth: 280,
  },
  bubbleText: {
    fontSize: 14,
  },
  bubbleHint: {
    fontSize: 12,
    fontStyle: 'italic',
  },
  hint: {
    fontSize: 11,
  },
});
