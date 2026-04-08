import { Tabs, useRouter } from 'expo-router';
import { Home, FileText, CheckSquare, BarChart3, Building2, MapPin, Settings, Shield, MessageCircle } from 'lucide-react-native';
import { useAuth } from '@/contexts/AuthContext';
import { TouchableOpacity, Text, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

export default function TabLayout() {
  const { profile, signOut } = useAuth();
  const router = useRouter();
  const { t } = useTranslation();

  const handleLogout = async () => {
    await signOut();
    router.replace('/login');
  };

  const getTabsForRole = () => {
    const commonTabs = ['profile', 'chat'];
    switch (profile?.role) {
      case 'administrator':
        return ['admin', 'regional', 'estate', 'reports', 'analytics', 'approval', ...commonTabs];
      case 'krani_panen':
        return ['index', ...commonTabs];
      case 'krani_buah':
        return ['krani-buah', ...commonTabs];
      case 'mandor':
        return ['mandor', 'approval', 'reports', ...commonTabs];
      case 'asisten':
        return ['asisten', 'monitoring', 'reports', ...commonTabs];
      case 'senior_asisten':
        return ['asisten', 'reports', 'analytics', ...commonTabs];
      case 'estate_manager':
        return ['estate', 'reports', 'monitoring', ...commonTabs];
      case 'regional_gm':
        return ['regional', 'reports', 'analytics', ...commonTabs];
      default:
        return ['index', ...commonTabs];
    }
  };

  const visibleTabs = getTabsForRole();

  return (
    <Tabs
      screenOptions={{
        headerStyle: {
          backgroundColor: '#2d5016',
        },
        headerTintColor: '#fff',
        headerTitleStyle: {
          fontWeight: '600',
        },
        tabBarActiveTintColor: '#2d5016',
        tabBarInactiveTintColor: '#999',
        tabBarStyle: {
          paddingBottom: 5,
          paddingTop: 5,
          height: 60,
        },
        headerRight: () => (
          <TouchableOpacity onPress={handleLogout} style={styles.logoutButton}>
            <Text style={styles.logoutText}>{t('common.logout')}</Text>
          </TouchableOpacity>
        ),
      }}
    >
      <Tabs.Screen
        name="admin"
        options={{
          title: t('screen.dashboardAdmin'),
          tabBarLabel: t('tabs.admin'),
          tabBarIcon: ({ size, color }) => <Shield size={size} color={color} />,
          href: visibleTabs.includes('admin') ? '/(tabs)/admin' : null,
        }}
      />
      <Tabs.Screen
        name="index"
        options={{
          title: t('screen.dashboardKraniPanen'),
          tabBarLabel: t('tabs.home'),
          tabBarIcon: ({ size, color }) => <Home size={size} color={color} />,
          href: visibleTabs.includes('index') ? '/(tabs)' : null,
        }}
      />
      <Tabs.Screen
        name="krani-buah"
        options={{
          title: t('screen.dashboardKraniBuah'),
          tabBarLabel: t('tabs.home'),
          tabBarIcon: ({ size, color }) => <FileText size={size} color={color} />,
          href: visibleTabs.includes('krani-buah') ? '/(tabs)/krani-buah' : null,
        }}
      />
      <Tabs.Screen
        name="mandor"
        options={{
          title: t('screen.dashboardMandor'),
          tabBarLabel: t('tabs.home'),
          tabBarIcon: ({ size, color }) => <Home size={size} color={color} />,
          href: visibleTabs.includes('mandor') ? '/(tabs)/mandor' : null,
        }}
      />
      <Tabs.Screen
        name="asisten"
        options={{
          title: t('screen.dashboardAsisten'),
          tabBarLabel: t('tabs.home'),
          tabBarIcon: ({ size, color }) => <Home size={size} color={color} />,
          href: visibleTabs.includes('asisten') ? '/(tabs)/asisten' : null,
        }}
      />
      <Tabs.Screen
        name="estate"
        options={{
          title: t('screen.dashboardManager'),
          tabBarLabel: t('tabs.home'),
          tabBarIcon: ({ size, color }) => <Building2 size={size} color={color} />,
          href: visibleTabs.includes('estate') ? '/(tabs)/estate' : null,
        }}
      />
      <Tabs.Screen
        name="regional"
        options={{
          title: t('screen.dashboardRegional'),
          tabBarLabel: t('tabs.home'),
          tabBarIcon: ({ size, color }) => <MapPin size={size} color={color} />,
          href: visibleTabs.includes('regional') ? '/(tabs)/regional' : null,
        }}
      />
      <Tabs.Screen
        name="reports"
        options={{
          title: t('screen.reports'),
          tabBarLabel: t('tabs.reports'),
          tabBarIcon: ({ size, color }) => <FileText size={size} color={color} />,
          href: visibleTabs.includes('reports') ? '/(tabs)/reports' : null,
        }}
      />
      <Tabs.Screen
        name="analytics"
        options={{
          title: t('screen.analytics'),
          tabBarLabel: t('tabs.analytics'),
          tabBarIcon: ({ size, color }) => <BarChart3 size={size} color={color} />,
          href: visibleTabs.includes('analytics') ? '/(tabs)/analytics' : null,
        }}
      />
      <Tabs.Screen
        name="approval"
        options={{
          title: t('screen.approval'),
          tabBarLabel: t('tabs.approval'),
          tabBarIcon: ({ size, color }) => <CheckSquare size={size} color={color} />,
          href: visibleTabs.includes('approval') ? '/(tabs)/approval' : null,
        }}
      />
      <Tabs.Screen
        name="monitoring"
        options={{
          title: t('screen.monitoring'),
          tabBarLabel: t('tabs.monitoring'),
          tabBarIcon: ({ size, color }) => <BarChart3 size={size} color={color} />,
          href: visibleTabs.includes('monitoring') ? '/(tabs)/monitoring' : null,
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: t('tabs.chat') || 'Chat',
          tabBarLabel: t('tabs.chat') || 'Chat',
          tabBarIcon: ({ size, color }) => <MessageCircle size={size} color={color} />,
          href: (visibleTabs.includes('chat') ? '/(tabs)/chat' : null) as any,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('screen.profile'),
          tabBarLabel: t('tabs.profile'),
          tabBarIcon: ({ size, color }) => <Settings size={size} color={color} />,
          href: visibleTabs.includes('profile') ? '/(tabs)/profile' : null,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  logoutButton: {
    marginRight: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 6,
  },
  logoutText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
});
