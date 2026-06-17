import React, { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  ScrollView,
  Animated,
  Vibration,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { toast } from './Toast';

export interface NoiseTrack {
  id: string;
  name: string;
  icon: string;
  color: string;
  description: string;
  generator: 'white' | 'pink' | 'brown' | 'rain' | 'ocean' | 'forest';
  available: boolean;
}

export interface WhiteNoisePlayerHandle {
  play: () => void;
  pause: () => void;
  toggle: () => void;
  setTrack: (id: string) => void;
  setVolume: (v: number) => void;
}

export const NOISE_TRACKS: NoiseTrack[] = [
  { id: 'white', name: '白噪声', icon: 'graphic-eq', color: '#3b82f6', description: '均匀频谱 · 提升专注', generator: 'white', available: true },
  { id: 'pink', name: '粉噪声', icon: 'multitrack-audio', color: '#ec4899', description: '更柔和 · 适合长时间', generator: 'pink', available: true },
  { id: 'brown', name: '棕噪声', icon: 'surround-sound', color: '#8b5cf6', description: '深沉低频 · 帮助入睡', generator: 'brown', available: true },
  { id: 'rain', name: '雨声', icon: 'water-drop', color: '#06b6d4', description: '柔和白噪声 · 平静', generator: 'rain', available: true },
  { id: 'ocean', name: '海浪', icon: 'waves', color: '#10b981', description: '低频白噪声 · 冥想', generator: 'ocean', available: true },
  { id: 'forest', name: '森林', icon: 'park', color: '#22c55e', description: '粉噪声 · 放松', generator: 'forest', available: true },
];

interface WebAudioContextRef {
  ctx: AudioContext;
  gain: GainNode;
  source: AudioBufferSourceNode | null;
}

function createNoiseBuffer(ctx: AudioContext, generator: NoiseTrack['generator']): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const bufferSize = sampleRate * 2;
  const buffer = ctx.createBuffer(1, bufferSize, sampleRate);
  const data = buffer.getChannelData(0);

  switch (generator) {
    case 'white': {
      for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
      break;
    }
    case 'pink': {
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
        b6 = white * 0.115926;
      }
      break;
    }
    case 'brown': {
      let lastOut = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        data[i] = (lastOut + (0.02 * white)) / 1.02;
        lastOut = data[i];
        data[i] *= 3.5;
      }
      break;
    }
    case 'rain': {
      for (let i = 0; i < bufferSize; i++) {
        const base = (Math.random() * 2 - 1) * 0.4;
        const drop = Math.random() > 0.998 ? (Math.random() * 2 - 1) * 0.8 : 0;
        data[i] = base + drop;
      }
      break;
    }
    case 'ocean': {
      let phase = 0;
      for (let i = 0; i < bufferSize; i++) {
        phase += 0.0001;
        const wave = Math.sin(phase) * 0.6;
        const noise = (Math.random() * 2 - 1) * 0.3;
        const fade = (Math.sin(phase * 0.5) + 1) / 2;
        data[i] = (wave + noise) * fade;
      }
      break;
    }
    case 'forest': {
      for (let i = 0; i < bufferSize; i++) {
        const rustle = (Math.random() * 2 - 1) * 0.25;
        const bird = Math.random() > 0.9995 ? (Math.random() * 2 - 1) * 0.5 : 0;
        const wind = Math.sin(i * 0.0002) * 0.15;
        data[i] = rustle + bird + wind;
      }
      break;
    }
  }
  return buffer;
}

export const WhiteNoisePlayer = forwardRef<WhiteNoisePlayerHandle, {
  autoStart?: boolean;
  onStateChange?: (state: { playing: boolean; trackId: string }) => void;
  compact?: boolean;
}>(({ autoStart = false, onStateChange, compact = false }, ref) => {
  const [currentTrackId, setCurrentTrackId] = useState('white');
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(0.4);
  const [supported] = useState(() => Platform.OS === 'web' && typeof window !== 'undefined' && typeof (window as any).AudioContext !== 'undefined');
  const audioRef = useRef<WebAudioContextRef | null>(null);
  const pulseAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (autoStart && supported) {
      setTimeout(() => {
        if (audioRef.current === null) {
          startAudio();
        }
      }, 200);
    }
    return () => stopAudio();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (playing) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1, duration: 1500, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 0, duration: 1500, useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => loop.stop();
    } else {
      pulseAnim.setValue(0);
    }
  }, [playing, pulseAnim]);

  const startAudio = useCallback(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const Win = window as any;
    if (!audioRef.current) {
      const AC = Win.AudioContext || (Win as any).webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      const gain = ctx.createGain();
      gain.gain.value = volume;
      gain.connect(ctx.destination);
      audioRef.current = { ctx, gain, source: null };
    }
    const { ctx, gain } = audioRef.current;
    if (ctx.state === 'suspended') ctx.resume();
    if (audioRef.current.source) {
      try { audioRef.current.source.stop(); } catch {
        // ignore stop errors
      }
    }
    const track = NOISE_TRACKS.find((t) => t.id === currentTrackId) ?? NOISE_TRACKS[0];
    const buffer = createNoiseBuffer(ctx, track.generator);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(gain);
    source.start();
    audioRef.current.source = source;
    setPlaying(true);
    onStateChange?.({ playing: true, trackId: currentTrackId });
  }, [currentTrackId, volume, onStateChange]);

  const stopAudio = useCallback(() => {
    if (audioRef.current?.source) {
      try { audioRef.current.source.stop(); } catch {
        // ignore stop errors
      }
      audioRef.current.source = null;
    }
    setPlaying(false);
    onStateChange?.({ playing: false, trackId: currentTrackId });
  }, [currentTrackId, onStateChange]);

  const changeTrack = useCallback(
    (id: string) => {
      if (Platform.OS !== 'web') {
        Vibration.vibrate(40);
        return;
      }
      setCurrentTrackId(id);
      if (playing) {
        setTimeout(() => {
          setCurrentTrackId(id);
          if (audioRef.current?.source) {
            try { audioRef.current.source.stop(); } catch {
        // ignore stop errors
      }
          }
          startAudio();
        }, 50);
      }
    },
    [playing, startAudio]
  );

  const changeVolume = useCallback(
    (v: number) => {
      setVolume(v);
      if (audioRef.current) {
        audioRef.current.gain.gain.value = v;
      }
    },
    []
  );

  useImperativeHandle(
    ref,
    () => ({
      play: startAudio,
      pause: stopAudio,
      toggle: () => (playing ? stopAudio() : startAudio()),
      setTrack: changeTrack,
      setVolume: changeVolume,
    }),
    [playing, startAudio, stopAudio, changeTrack, changeVolume]
  );

  const handleToggle = () => {
    if (Platform.OS !== 'web') {
      Vibration.vibrate(60);
      toast.info('白噪声播放仅在 Web 端可用，请访问 taskflow 网页版');
      return;
    }
    if (playing) stopAudio();
    else startAudio();
  };

  const currentTrack = NOISE_TRACKS.find((t) => t.id === currentTrackId) ?? NOISE_TRACKS[0];
  const pulseScale = pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.15] });

  return (
    <View style={[styles.container, compact && styles.compact, { backgroundColor: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.08)' }]}>
      <View style={styles.headerRow}>
        <View style={[styles.iconWrap, { backgroundColor: currentTrack.color + '20' }]}>
          <Animated.View style={{ transform: playing ? [{ scale: pulseScale }] : [] }}>
            <MaterialIcons name={currentTrack.icon as any} size={20} color={currentTrack.color} />
          </Animated.View>
        </View>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.title}>{currentTrack.name}</Text>
          <Text style={styles.subtitle}>{currentTrack.description}</Text>
        </View>
        <TouchableOpacity
          onPress={handleToggle}
          style={[styles.playButton, { backgroundColor: currentTrack.color }]}
          activeOpacity={0.85}
        >
          <MaterialIcons
            name={playing ? 'pause' : 'play-arrow'}
            size={22}
            color="#FFFFFF"
          />
        </TouchableOpacity>
      </View>

      {!compact && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.trackRow}
        >
          {NOISE_TRACKS.map((track) => {
            const isActive = track.id === currentTrackId;
            return (
              <TouchableOpacity
                key={track.id}
                onPress={() => changeTrack(track.id)}
                activeOpacity={0.7}
                style={[
                  styles.trackChip,
                  {
                    backgroundColor: isActive ? track.color + '30' : 'rgba(255,255,255,0.04)',
                    borderColor: isActive ? track.color : 'rgba(255,255,255,0.1)',
                  },
                ]}
              >
                <MaterialIcons
                  name={track.icon as any}
                  size={16}
                  color={isActive ? track.color : 'rgba(255,255,255,0.5)'}
                />
                <Text
                  style={[
                    styles.trackText,
                    { color: isActive ? track.color : 'rgba(255,255,255,0.6)' },
                  ]}
                >
                  {track.name}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {!supported && Platform.OS !== 'web' && (
        <View style={styles.warnRow}>
          <MaterialIcons name="info-outline" size={14} color="rgba(255,255,255,0.4)" />
          <Text style={styles.warnText}>
            移动端暂不支持白噪声，请使用 Web 端获得完整体验
          </Text>
        </View>
      )}

      {!supported && Platform.OS === 'web' && (
        <View style={styles.warnRow}>
          <MaterialIcons name="info-outline" size={14} color="rgba(255,255,255,0.4)" />
          <Text style={styles.warnText}>当前浏览器不支持 Web Audio</Text>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
  },
  compact: {
    padding: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 15,
    fontWeight: '600',
  },
  subtitle: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 12,
    marginTop: 2,
  },
  playButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trackRow: {
    flexDirection: 'row',
    gap: 8,
    paddingTop: 14,
  },
  trackChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  trackText: {
    fontSize: 12,
    fontWeight: '500',
  },
  warnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
  },
  warnText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 11,
  },
});

WhiteNoisePlayer.displayName = 'WhiteNoisePlayer';
