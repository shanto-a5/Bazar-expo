import * as React from 'react';
export async function enablePushNotifications(): Promise<void> { throw new Error('Push notifications are unavailable on this platform.'); }
export async function unregisterPushDevice(): Promise<void> {}
export async function unregisterAllPushDevices(): Promise<void> {}
export function PushNotificationBridge(): null { return null; }
