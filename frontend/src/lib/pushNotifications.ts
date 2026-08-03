import { api } from "@/lib/api";

const PUBLIC_VAPID_KEY = "BJC9vbn9P7m7-ux3LXC3Nf0A66PRdaFR3UFoekjeq8GTcI9SUja8dtKoICpcro7Ufl9F4FVGkR-fKZjYcpJh8Yo";

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from(rawData, character => character.charCodeAt(0)) as Uint8Array<ArrayBuffer>;
}

export async function configurePushNotifications(): Promise<NotificationPermission> {
  if (typeof window === "undefined" || !("Notification" in window)) {
    throw new Error("Push notifications are not supported on this device or browser.");
  }
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    throw new Error("This browser cannot register H+H Hub push alerts.");
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission;

  const registration = await navigator.serviceWorker.register("/sw.js");
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing ?? await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(PUBLIC_VAPID_KEY),
  });
  const payload = subscription.toJSON();
  if (!payload.endpoint || !payload.keys?.p256dh || !payload.keys?.auth) {
    throw new Error("The browser returned an incomplete push subscription.");
  }
  await api.subscribePush({
    endpoint: payload.endpoint,
    keys: { p256dh: payload.keys.p256dh, auth: payload.keys.auth },
  });
  return permission;
}
