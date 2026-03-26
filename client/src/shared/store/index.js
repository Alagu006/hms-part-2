import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

// ---------------------------------------------------------------------------
// Auth slice
// ---------------------------------------------------------------------------
const authSlice = (set, get) => ({
  user       : null,   // { id, firstName, lastName, roles, departmentId }
  accessToken: null,
  permissions: [],     // derived from roles if needed

  setAuth: ({ user, accessToken }) => {
    sessionStorage.setItem('accessToken', accessToken);
    set({ user, accessToken, permissions: user?.roles ?? [] });
  },

  clearAuth: () => {
    sessionStorage.removeItem('accessToken');
    set({ user: null, accessToken: null, permissions: [] });
  },

  hasRole: (role) => {
    const { user } = get();
    return user?.roles?.includes(role) ?? false;
  },

  hasAnyRole: (...roles) => {
    const { user } = get();
    return roles.some((r) => user?.roles?.includes(r));
  },
});

// ---------------------------------------------------------------------------
// Notifications slice
// ---------------------------------------------------------------------------
const notificationsSlice = (set) => ({
  notifications: [],
  unreadCount  : 0,

  setNotifications : (list)  => set({ notifications: list }),
  setUnreadCount   : (n)     => set({ unreadCount: n }),
  incrementUnread  : ()      => set((s) => ({ unreadCount: s.unreadCount + 1 })),
  decrementUnread  : ()      => set((s) => ({ unreadCount: Math.max(0, s.unreadCount - 1) })),

  prependNotification: (n) =>
    set((s) => ({ notifications: [n, ...s.notifications] })),

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
    set((s) => ({ notifications: s.notifications.filter((n) => n.id !== id) })),
});

// ---------------------------------------------------------------------------
// Messaging slice
// ---------------------------------------------------------------------------
const messagingSlice = (set) => ({
  activeGroup    : null,   // { id, name, type }
  unreadPerGroup : {},     // { [groupId]: number }

  setActiveGroup: (group) => set({ activeGroup: group }),

  setUnreadPerGroup: (groupId, count) =>
    set((s) => ({ unreadPerGroup: { ...s.unreadPerGroup, [groupId]: count } })),

  incrementGroupUnread: (groupId) =>
    set((s) => ({
      unreadPerGroup: {
        ...s.unreadPerGroup,
        [groupId]: (s.unreadPerGroup[groupId] ?? 0) + 1,
      },
    })),

  clearGroupUnread: (groupId) =>
    set((s) => ({ unreadPerGroup: { ...s.unreadPerGroup, [groupId]: 0 } })),
});

// ---------------------------------------------------------------------------
// Combined store
// Auth is persisted to sessionStorage so a page refresh keeps the session.
// Notifications and messaging are ephemeral (re-fetched on mount).
// ---------------------------------------------------------------------------
export const useStore = create(
  persist(
    (set, get) => ({
      ...authSlice(set, get),
      ...notificationsSlice(set),
      ...messagingSlice(set),
    }),
    {
      name   : 'hms-auth',
      storage: createJSONStorage(() => sessionStorage),
      // Only persist auth fields
      partialize: (state) => ({
        user       : state.user,
        accessToken: state.accessToken,
        permissions: state.permissions,
      }),
    }
  )
);

// Convenience selectors
export const useAuth         = () => useStore((s) => ({ user: s.user, accessToken: s.accessToken, setAuth: s.setAuth, clearAuth: s.clearAuth, hasRole: s.hasRole, hasAnyRole: s.hasAnyRole }));
export const useNotifStore   = () => useStore((s) => ({ notifications: s.notifications, unreadCount: s.unreadCount, setNotifications: s.setNotifications, setUnreadCount: s.setUnreadCount, incrementUnread: s.incrementUnread, decrementUnread: s.decrementUnread, prependNotification: s.prependNotification, markRead: s.markRead, markAllRead: s.markAllRead, removeNotification: s.removeNotification }));
export const useMessaging    = () => useStore((s) => ({ activeGroup: s.activeGroup, unreadPerGroup: s.unreadPerGroup, setActiveGroup: s.setActiveGroup, setUnreadPerGroup: s.setUnreadPerGroup, incrementGroupUnread: s.incrementGroupUnread, clearGroupUnread: s.clearGroupUnread }));
