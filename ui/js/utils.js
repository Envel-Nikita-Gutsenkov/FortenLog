export function formatRelativeTime(date) {
    if (!date) return 'never';
    const now = new Date();
    const then = new Date(date);
    const diff = Math.floor((now - then) / 1000);
    
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
}

export function maskSensitive(key, val) {
    if (!val) return '';
    const sensitive = ['api_key', 'token', 'password', 'secret', 'auth', 'email'];
    if (sensitive.some(s => key.toLowerCase().includes(s))) {
        if (typeof val !== 'string') return '********';
        if (val.length < 8) return '********';
        return val.substring(0, 4) + '********' + val.substring(val.length - 4);
    }
    return val;
}

export function escapeHtml(text) {
    if (!text) return '';
    return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function bufferToBase64(buffer) {
    return btoa(String.fromCharCode(...new Uint8Array(buffer)))
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export function base64ToBuffer(base64) {
    const binary = atob(base64.replace(/-/g, "+").replace(/_/g, "/"));
    const buffer = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) buffer[i] = binary.charCodeAt(i);
    return buffer.buffer;
}
