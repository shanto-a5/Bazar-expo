import * as React from 'react';
import { AppState, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import messaging from '@react-native-firebase/messaging';
import * as Notifications from 'expo-notifications';
import { notificationService } from '@/services/notification-service';
import { vantaApi } from '@/api/vanta-api';
import { useSession } from '@/modules/session/session-context';

let registeredToken: string | null = null;

Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowAlert: true, shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true }) });
try { messaging().setBackgroundMessageHandler(async () => undefined); } catch { /* iOS setup may be completed later */ }
const stringData = (data?: Record<string, unknown> | null): Record<string, string> => Object.fromEntries(Object.entries(data || {}).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));

export async function enablePushNotifications(): Promise<void> {
  await Notifications.setNotificationChannelAsync('marketplace', { name: 'Marketplace updates', importance: Notifications.AndroidImportance.HIGH });
  let client;
  try { client = messaging(); } catch { throw new Error('Firebase messaging is not configured on this device yet.'); }
  if (Platform.OS === 'ios') await client.requestPermission();
  else {
    const permission = await Notifications.requestPermissionsAsync();
    if (!permission.granted) throw new Error('Notification permission was not granted.');
  }
  const token = await client.getToken();
  await vantaApi.registerPushDevice(token, Platform.OS as 'android' | 'ios');
  registeredToken = token;
}

export async function unregisterPushDevice(): Promise<void> {
  try { const token = registeredToken || await messaging().getToken(); await vantaApi.unregisterPushDevice(token); } catch { /* sign-out must not be blocked */ }
  registeredToken = null;
}
export async function unregisterAllPushDevices(): Promise<void> {
  try { await vantaApi.unregisterPushDevice(); } catch { /* sign-out must not be blocked */ }
  registeredToken = null;
}

export function PushNotificationBridge(): null {
  const router = useRouter();
  const { user } = useSession();
  React.useEffect(() => {
    let client;
    try { client = messaging(); } catch { return; }
    let alive = true;
    const open = (data?: Record<string, string>) => {
      if (data?.orderId) router.push({ pathname: '/order/[id]', params: { id: data.orderId } });
      else if (data?.productId) router.push({ pathname: '/product/[id]', params: { id: data.productId } });
      else router.push('/notifications');
    };
    const foreground = client.onMessage(async (message) => {
      if (user) await notificationService.hydrate(user.id).catch(() => undefined);
      await Notifications.scheduleNotificationAsync({ content: { title: message.notification?.title || 'Bazar update', body: message.notification?.body || '', data: message.data }, trigger: null });
      const count = user ? notificationService.unreadCount(user.id) : 0;
      await Notifications.setBadgeCountAsync(count).catch(() => undefined);
    });
    const opened = client.onNotificationOpenedApp((message) => open(stringData(message.data)));
    client.getInitialNotification().then((message) => { if (alive && message) open(stringData(message.data)); }).catch(() => undefined);
    const response = Notifications.addNotificationResponseReceivedListener((event) => open(stringData(event.notification.request.content.data)));
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active' && user) void notificationService.hydrate(user.id).then(() => Notifications.setBadgeCountAsync(notificationService.unreadCount(user.id))).catch(() => undefined);
    });
    return () => { alive = false; foreground(); opened(); response.remove(); appState.remove(); };
  }, [router, user?.id]);
  React.useEffect(() => {
    if (!user) { registeredToken = null; return; }
    let client;
    try { client = messaging(); } catch { return; }
    void client.hasPermission().then(async (status) => {
      const allowed = status === messaging.AuthorizationStatus.AUTHORIZED || status === messaging.AuthorizationStatus.PROVISIONAL;
      if (!allowed) return;
      const token = await client.getToken();
      if (registeredToken && registeredToken !== token) await vantaApi.unregisterPushDevice(registeredToken).catch(() => undefined);
      await vantaApi.registerPushDevice(token, Platform.OS as 'android' | 'ios');
      registeredToken = token;
    }).catch(() => undefined);
    const changed = client.onTokenRefresh((token) => {
      void (async () => {
        const previous = registeredToken;
        if (previous && previous !== token) await vantaApi.unregisterPushDevice(previous).catch(() => undefined);
        await vantaApi.registerPushDevice(token, Platform.OS as 'android' | 'ios');
        registeredToken = token;
      })().catch(() => undefined);
    });
    return changed;
  }, [user?.id]);
  return null;
}
