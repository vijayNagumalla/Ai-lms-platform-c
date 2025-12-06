/**
 * API Configuration Utility
 * Centralized configuration for API URLs and WebSocket connections
 */

/**
 * Get the base API URL
 * @returns {string} The base API URL
 */
export const getApiBaseUrl = () => {
  // Priority: user-provided env > production same-origin > dev fallback
  const configured = import.meta.env.VITE_API_URL?.trim();
  if (configured) {
    return configured;
  }

  const isBrowser = typeof window !== 'undefined';

  if (import.meta.env.PROD && isBrowser) {
    // On Vercel/Supabase deployments the API shares the same host
    const { origin } = window.location;
    return origin ? `${origin}/api` : '/api';
  }

  if (import.meta.env.DEV) {
    // Local dev server fallback
    return 'http://localhost:5000/api';
  }

  // Generic relative fallback (SSR/build-time)
  return '/api';
};

/**
 * Get the WebSocket URL for a given path
 * @param {string} path - The WebSocket path (e.g., '/ws/alerts/123')
 * @returns {string} The full WebSocket URL
 */
export const getWebSocketUrl = (path) => {
  // Remove leading slash if present
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  
  // Check for WebSocket URL in environment
  if (import.meta.env.VITE_WS_URL) {
    return `${import.meta.env.VITE_WS_URL}/${cleanPath}`;
  }
  
  // Derive from API URL
  const apiUrl = getApiBaseUrl();
  
  // If API URL is relative, use current origin
  if (apiUrl.startsWith('/')) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    return `${protocol}//${host}/${cleanPath}`;
  }
  
  // If API URL is absolute, convert to WebSocket URL
  if (apiUrl.startsWith('http://')) {
    return apiUrl.replace('http://', 'ws://').replace('/api', '') + '/' + cleanPath;
  }
  
  if (apiUrl.startsWith('https://')) {
    return apiUrl.replace('https://', 'wss://').replace('/api', '') + '/' + cleanPath;
  }
  
  // Fallback for development
  if (import.meta.env.DEV) {
    return `ws://localhost:5000/${cleanPath}`;
  }
  
  // Production fallback
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  return `${protocol}//${host}/${cleanPath}`;
};

/**
 * Get the backend server URL (without /api prefix)
 * @returns {string} The backend server URL
 */
export const getBackendUrl = () => {
  const apiUrl = getApiBaseUrl();
  
  // If relative, use current origin
  if (apiUrl.startsWith('/')) {
    return window.location.origin;
  }
  
  // Remove /api suffix if present
  if (apiUrl.endsWith('/api')) {
    return apiUrl.slice(0, -4);
  }
  
  return apiUrl;
};

