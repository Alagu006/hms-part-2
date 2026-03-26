import { useEffect, useRef } from 'react';
import { io }               from 'socket.io-client';
import { create }           from 'zustand';

const API_BASE   = import.meta.env.VITE_API_URL    ?? '/api';
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ?? '';

// ---------------------------------------------------------------------------
// High-priority types that show a toast
// ---------------------------------------------------------------------------
const HIGH_PRIORITY = new Set([
  'VITALS_CRITICAL',
  'EMERGENCY_ALERT',
  'DRUG_INTERACTION_WARN',
  'BLOOD_REQUEST',
]);

// ---------------------------------------------------------------------------
// Zustand store
// ---------------------------------------------------------------------------
export const useNotificationStore = create((set, get) => ({
  unreadCount  : 0,
  notifications: [],
  toasts       : [],

  setUnreadCount : (n)  => set({ unreadCount: n }),
  incrementUnread: ()   => set((s) => ({ unreadCount: s.unreadCount + 1 })),
  decrementUnread: ()   => set((s) => ({ unreadCount: Math.max(0, s.unreadCount - 1) })),

  prependNotification: (n) =>
    set((s) => ({ notifications: [n, ...s.notifications] })),

  setNotifications: (list) => set({ notifications: list }),

  markRead: (id) =>
    set((s) => ({
      notifications: s.notifications.map((n) =>
        n.id === id ? { ...n, is_read: true } : n
      ),
    })),

  markAllRead: () =>
    set((s) => ({
      notifications: s.notifications.map((n) => ({ ...n, is_read: true })),
      unreadCount  : 0,
    })),

  removeNotification: (id) =>
    set((s) => ({
      notifications: s.notifications.filter((n) => n.id !== id),
    })),

  addToast: (toast) => {
    const id = crypto.randomUUID();
    set((s) => ({ toasts: [...s.toasts, { ...toast, id }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, toast.duration ?? 5000);
  },

  dismissToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

// ---------------------------------------------------------------------------
// Hook — connect socket, listen for events, manage push permission
// ---------------------------------------------------------------------------
export function useNotifications(currentUser) {
  const store     = useNotificationStore();
  const socketRef = useRef(null);

  // ── Initial unread count fetch ────────────────────────────────────────────
  useEffect(() => {
    if (!currentUser?.id) return;

    fetch(`${API_BASE}/notifications/unread-count`, {
      headers: { Authorization: `Bearer ${sessionStorage.getItem('accessToken')}` },
    })
      .then((r) => r.json())
      .then((json) => store.setUnreadCount(json.count ?? 0))
      .catch(console.error);
  }, [currentUser?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Socket.io connection ──────────────────────────────────────────────────
  useEffect(() => {
    if (!currentUser?.id) return;

    const socket = io(`${SOCKET_URL}/notifications`, {
      auth      : { token: sessionStorage.getItem('accessToken') },
      transports: ['websocket'],
    });

    socketRef.current = socket;

    socket.on('notification:new', (notification) => {
      store.prependNotification(notification);
      store.incrementUnread();

      if (HIGH_PRIORITY.has(notification.type) || notification.highPriority) {
        store.addToast({
          title   : notification.title,
          body    : notification.body,
          type    : notification.type,
          duration: 8000,
          priority: 'high',
        });
      }
    });

    socket.on('notification:read_ack', ({ notificationId }) => {
      store.markRead(notificationId);
    });

    return () => socket.disconnect();
  }, [currentUser?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Web Push permission + subscription ───────────────────────────────────
  useEffect(() => {
    if (!currentUser?.id) return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    if (sessionStorage.getItem('pushRequested')) return;

    sessionStorage.setItem('pushRequested', '1');

    async function setupPush() {
      try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') return;

        // Fetch VAPID public key
        const keyRes = await fetch(`${API_BASE}/notifications/vapid-public-key`, {
          headers: { Authorization: `Bearer ${sessionStorage.getItem('accessToken')}` },
        });
        if (!keyRes.ok) return;
        const { key } = await keyRes.json();

        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly     : true,
          applicationServerKey: urlBase64ToUint8Array(key),
        });

        await fetch(`${API_BASE}/notifications/subscribe`, {
          method : 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization : `Bearer ${sessionStorage.getItem('accessToken')}`,
          },
          body: JSON.stringify({ subscription: sub.toJSON() }),
        });
      } catch (err) {
        console.warn('[push] Setup failed:', err.message);
      }
    }

    setupPush();
  }, [currentUser?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── REST helpers exposed to components ───────────────────────────────────
  async function fetchNotifications(page = 1) {
    const res = await fetch(`${API_BASE}/notifications?page=${page}&limit=20`, {
      headers: { Authorization: `Bearer ${sessionStorage.getItem('accessToken')}` },
    });
    const json = await res.json();
    if (page === 1) store.setNotifications(json.notifications ?? []);
    else store.setNotifications([...store.notifications, ...(json.notifications ?? [])]);
    store.setUnreadCount(json.unreadCount ?? 0);
    return json;
  }

  async function markRead(id) {
    store.markRead(id);
    store.decrementUnread();
    await fetch(`${API_BASE}/notifications/${id}/read`, {
      method : 'PATCH',
      headers: { Authorization: `Bearer ${sessionStorage.getItem('accessToken')}` },
    }).catch(console.error);
  }

  async function markAllRead() {
    store.markAllRead();
    await fetch(`${API_BASE}/notifications/read-all`, {
      method : 'PATCH',
      headers: { Authorization: `Bearer ${sessionStorage.getItem('accessToken')}` },
    }).catch(console.error);
  }

  async function remove(id) {
    store.removeNotification(id);
    await fetch(`${API_BASE}/notifications/${id}`, {
      method : 'DELETE',
      headers: { Authorization: `Bearer ${sessionStorage.getItem('accessToken')}` },
    }).catch(console.error);
  }

  return { fetchNotifications, markRead, markAllRead, remove };
}

// ---------------------------------------------------------------------------
// Utility: convert VAPID base64 key to Uint8Array for PushManager
// ---------------------------------------------------------------------------
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw     = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}
