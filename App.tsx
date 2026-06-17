import React, { useEffect, useMemo, useState } from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { MaterialIcons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import {
  RootStackParamList,
  MainTabParamList,
  HomeStackParamList,
  CalendarStackParamList,
  AnalyticsStackParamList,
  SearchStackParamList,
} from './src/shared/types';
import { useAppStore } from './src/shared/store';
import { ToastContainer } from './src/shared/components/common/Toast';
import { ErrorBoundary } from './src/shared/components/common/ErrorBoundary';
import { QuickAddTask } from './src/shared/components/common/QuickAddTask';
import { useKeyboardShortcuts } from './src/shared/hooks/useKeyboardShortcuts';
import HomeScreen from './screens/HomeScreen';
import TaskDetailScreen from './screens/TaskDetailScreen';
import CategoriesScreen from './screens/CategoriesScreen';
import SearchScreen from './screens/SearchScreen';
import CalendarScreen from './screens/CalendarScreen';
import AnalyticsScreen from './screens/AnalyticsScreen';
import GoalsScreen from './screens/GoalsScreen';
import SettingsScreen from './screens/SettingsScreen';
import HabitsScreen from './screens/HabitsScreen';
import NotesScreen from './screens/NotesScreen';
import ProjectsScreen from './screens/ProjectsScreen';
import TagsScreen from './screens/TagsScreen';
import ViewsScreen from './screens/ViewsScreen';
import TemplatesScreen from './screens/TemplatesScreen';
import AutomationScreen from './screens/AutomationScreen';

const RootStack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();
const HomeStack = createNativeStackNavigator<HomeStackParamList>();
const CalendarStack = createNativeStackNavigator<CalendarStackParamList>();
const AnalyticsStack = createNativeStackNavigator<AnalyticsStackParamList>();
const SearchStack = createNativeStackNavigator<SearchStackParamList>();

function HomeStackScreen() {
  const { theme } = useAppStore();
  return (
    <HomeStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.surface },
        headerTintColor: theme.colors.text,
        headerTitleStyle: { fontWeight: 'bold' },
        headerShadowVisible: false,
      }}
    >
      <HomeStack.Screen name="Home" component={HomeScreen} options={{ title: 'TaskFlow' }} />
      <HomeStack.Screen name="TaskDetail" component={TaskDetailScreen} />
      <HomeStack.Screen name="Categories" component={CategoriesScreen} />
      <HomeStack.Screen name="Projects" component={ProjectsScreen} />
      <HomeStack.Screen name="Goals" component={GoalsScreen} />
      <HomeStack.Screen name="Habits" component={HabitsScreen} />
      <HomeStack.Screen name="Notes" component={NotesScreen} />
      <HomeStack.Screen name="Settings" component={SettingsScreen} />
      <HomeStack.Screen name="Tags" component={TagsScreen} />
      <HomeStack.Screen name="Views" component={ViewsScreen} />
      <HomeStack.Screen name="Templates" component={TemplatesScreen} />
      <HomeStack.Screen name="Automation" component={AutomationScreen} />
      <HomeStack.Screen name="Analytics" component={AnalyticsScreen} />
      <HomeStack.Screen name="Calendar" component={CalendarScreen} />
    </HomeStack.Navigator>
  );
}

function CalendarStackScreen() {
  const { theme } = useAppStore();
  return (
    <CalendarStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.surface },
        headerTintColor: theme.colors.text,
        headerTitleStyle: { fontWeight: 'bold' },
        headerShadowVisible: false,
      }}
    >
      <CalendarStack.Screen name="Calendar" component={CalendarScreen} options={{ title: '日历' }} />
      <CalendarStack.Screen name="TaskDetail" component={TaskDetailScreen} options={{ title: '任务详情' }} />
    </CalendarStack.Navigator>
  );
}

function AnalyticsStackScreen() {
  const { theme } = useAppStore();
  return (
    <AnalyticsStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.surface },
        headerTintColor: theme.colors.text,
        headerTitleStyle: { fontWeight: 'bold' },
        headerShadowVisible: false,
      }}
    >
      <AnalyticsStack.Screen name="Analytics" component={AnalyticsScreen} options={{ title: '统计' }} />
    </AnalyticsStack.Navigator>
  );
}

function SearchStackScreen() {
  const { theme } = useAppStore();
  return (
    <SearchStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.surface },
        headerTintColor: theme.colors.text,
        headerTitleStyle: { fontWeight: 'bold' },
        headerShadowVisible: false,
      }}
    >
      <SearchStack.Screen name="Search" component={SearchScreen} options={{ title: '搜索' }} />
      <SearchStack.Screen name="TaskDetail" component={TaskDetailScreen} options={{ title: '任务详情' }} />
    </SearchStack.Navigator>
  );
}

function CreateTabButton({ onPress }: { onPress: () => void }) {
  const { theme } = useAppStore();

  return (
    <TouchableOpacity
      style={styles.fabContainer}
      activeOpacity={0.85}
      onPress={onPress}
    >
      <View style={[styles.fab, { backgroundColor: theme.colors.primary, shadowColor: theme.colors.primary }]}>
        <MaterialIcons name="add" size={30} color={theme.colors.onPrimary} />
      </View>
    </TouchableOpacity>
  );
}

function CreatePlaceholder() {
  return <View />;
}

function getTabBarIcon(routeName: string, focused: boolean, color: string, _size: number) {
  let iconName: keyof typeof MaterialIcons.glyphMap = 'circle';

  switch (routeName) {
    case 'HomeTab':
      iconName = focused ? 'check-circle' : 'check-circle-outline';
      break;
    case 'CalendarTab':
      iconName = focused ? 'event' : 'event-available';
      break;
    case 'AnalyticsTab':
      iconName = focused ? 'insights' : 'insights';
      break;
    case 'SearchTab':
      iconName = 'search';
      break;
  }

  return <MaterialIcons name={iconName} size={focused ? 24 : 22} color={color} />;
}

function MainTabsScreen() {
  const { theme } = useAppStore();
  const [showQuickAdd, setShowQuickAdd] = useState(false);

  useKeyboardShortcuts({
    'mod+k': () => {
      setShowQuickAdd(false);
    },
    'mod+n': () => setShowQuickAdd(true),
    escape: () => setShowQuickAdd(false),
  });

  return (
    <View style={{ flex: 1 }}>
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textTertiary,
        tabBarStyle: {
          position: 'absolute',
          left: 16,
          right: 16,
          bottom: 12,
          backgroundColor: theme.colors.glassBackground,
          borderTopWidth: 0,
          borderRadius: 24,
          height: 64,
          paddingTop: 6,
          paddingBottom: 6,
          paddingHorizontal: 8,
          shadowColor: '#0F172A',
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.12,
          shadowRadius: 24,
          elevation: 12,
          borderWidth: 1,
          borderColor: theme.colors.glassBorder,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
          letterSpacing: 0.2,
          marginTop: 2,
        },
        tabBarItemStyle: {
          paddingVertical: 4,
        },
        tabBarIcon: ({ focused, color, size }) =>
          getTabBarIcon(route.name, focused, color, size),
      })}
    >
      <Tab.Screen
        name="HomeTab"
        component={HomeStackScreen}
        options={{ tabBarLabel: '任务' }}
      />
      <Tab.Screen
        name="CalendarTab"
        component={CalendarStackScreen}
        options={{ tabBarLabel: '日历' }}
      />
      <Tab.Screen
        name="CreateTab"
        component={CreatePlaceholder}
        listeners={{
          tabPress: (e) => {
            e.preventDefault();
            setShowQuickAdd(true);
          },
        }}
        options={{
          tabBarLabel: '',
          tabBarButton: () => <CreateTabButton onPress={() => setShowQuickAdd(true)} />,
        }}
      />
      <Tab.Screen
        name="AnalyticsTab"
        component={AnalyticsStackScreen}
        options={{ tabBarLabel: '统计' }}
      />
      <Tab.Screen
        name="SearchTab"
        component={SearchStackScreen}
        options={{ tabBarLabel: '搜索' }}
      />
    </Tab.Navigator>
    <QuickAddTask visible={showQuickAdd} onClose={() => setShowQuickAdd(false)} />
    </View>
  );
}

export default function App() {
  const { theme, loadData } = useAppStore();

  useEffect(() => {
    loadData();
  }, [loadData]);

  const navigationTheme = useMemo(() => {
    const isDark = theme.type === 'dark';
    const base = isDark ? DarkTheme : DefaultTheme;
    return {
      ...base,
      dark: isDark,
      colors: {
        ...base.colors,
        primary: theme.colors.primary,
        background: theme.colors.background,
        card: theme.colors.surface,
        text: theme.colors.text,
        border: theme.colors.border,
        notification: theme.colors.error,
      },
    };
  }, [theme.type, theme.colors]);

  return (
    <ErrorBoundary>
    <NavigationContainer theme={navigationTheme}>
      <RootStack.Navigator
        screenOptions={{ headerShown: false }}
        initialRouteName="MainTabs"
      >
        <RootStack.Screen name="MainTabs" component={MainTabsScreen} />
      </RootStack.Navigator>
      <StatusBar style={theme.type === 'dark' ? 'light' : 'dark'} />
      <ToastContainer />
    </NavigationContainer>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  fabContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: -28,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 10,
  },
});