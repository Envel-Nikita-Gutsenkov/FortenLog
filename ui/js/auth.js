import { api } from './api.js';

export const auth = {
    isAuthenticated: () => !!localStorage.getItem('logged_in'),
    login: async (username, password) => {
        try {
            const res = await api('/api/system/login', {
                method: 'POST',
                body: JSON.stringify({ username, password })
            });
            if (res && res.data && res.data.success) {
                localStorage.setItem('logged_in', 'true');
                if (res.data.password_change_required) {
                    localStorage.setItem('password_change_required', 'true');
                } else {
                    localStorage.removeItem('password_change_required');
                }
                return { success: true };
            }
            return { success: false, error: (res && res.data) ? res.data.error : 'Invalid credentials' };
        } catch (e) {
            return { success: false, error: 'Connection failed' };
        }
    },
    logout: async () => {
        try {
            await api('/api/system/logout', { method: 'POST' });
        } catch (e) {
            console.warn('Logout API failed, forcing local logout');
        }
        localStorage.removeItem('logged_in');
        // Clear all cookies (including forten_sess)
        document.cookie = 'forten_sess=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0';
        // Redirect to root which will trigger auth check
        window.location.href = '/';
    }
};
