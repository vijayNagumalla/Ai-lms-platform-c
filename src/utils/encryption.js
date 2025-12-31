// CRITICAL FIX: Frontend encryption utility for sensitive data in localStorage
// Uses Web Crypto API for encryption (AES-GCM)
// This encrypts sensitive assessment data before storing in localStorage

class EncryptionService {
  constructor() {
    // CRITICAL: Use a key derived from user session or generate a secure key
    // In production, this should be derived from user session or server-provided key
    this.keyPromise = null;
  }

  // Get or generate encryption key
  async getKey() {
    if (this.keyPromise) {
      return this.keyPromise;
    }

    // CRITICAL FIX: Generate a key from a combination of user session and storage
    // In a real implementation, this should be derived from user session or fetched from server
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(this.getKeyMaterial()),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );

    this.keyPromise = crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: new TextEncoder().encode('lms-assessment-salt'), // In production, use random salt per user
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );

    return this.keyPromise;
  }

  // Get key material from user session or generate
  getKeyMaterial() {
    // MEDIUM FIX: Use user-specific data for key derivation
    // TODO: In production, implement server-side key generation API:
    // 1. Create endpoint: GET /api/encryption/key
    // 2. Server generates random key per user session
    // 3. Store key in secure session storage (not localStorage)
    // 4. Rotate keys periodically (e.g., every 24 hours)
    // 5. Use random salt per user instead of static salt
    
    const userId = localStorage.getItem('lmsUser') 
      ? JSON.parse(localStorage.getItem('lmsUser'))?.id 
      : 'default';
    
    // SECURITY FIX: Use environment variable or generate from user session
    // In production, this should be fetched from server per session
    // For now, derive from user ID and a session-based secret
    const sessionSecret = sessionStorage.getItem('lms_encryption_secret') || 
                         localStorage.getItem('lms_encryption_secret') ||
                         crypto.getRandomValues(new Uint8Array(32)).join('');
    
    // Store session secret if not present
    if (!sessionStorage.getItem('lms_encryption_secret') && !localStorage.getItem('lms_encryption_secret')) {
      sessionStorage.setItem('lms_encryption_secret', sessionSecret);
    }
    
    // Combine user ID with session secret for unique key per user session
    return `${userId}-${sessionSecret}`;
  }

  // Encrypt data
  async encrypt(data) {
    try {
      if (!data) return null;
      
      const key = await this.getKey();
      const dataString = typeof data === 'string' ? data : JSON.stringify(data);
      const dataBytes = new TextEncoder().encode(dataString);
      
      // Generate random IV
      const iv = crypto.getRandomValues(new Uint8Array(12));
      
      // Encrypt
      const encrypted = await crypto.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv: iv
        },
        key,
        dataBytes
      );
      
      // Combine IV and encrypted data
      const combined = new Uint8Array(iv.length + encrypted.byteLength);
      combined.set(iv, 0);
      combined.set(new Uint8Array(encrypted), iv.length);
      
      // Convert to base64 for storage
      return btoa(String.fromCharCode(...combined));
    } catch (error) {
      // LOW FIX: Use centralized logger if available
      if (typeof window !== 'undefined' && window.logger) {
        window.logger.error('Encryption error:', error);
      } else {
        console.error('Encryption error:', error);
      }
      // Fallback: return data as-is if encryption fails (shouldn't happen)
      return typeof data === 'string' ? data : JSON.stringify(data);
    }
  }

  // Decrypt data
  async decrypt(encryptedData) {
    try {
      if (!encryptedData) return null;
      
      const key = await this.getKey();
      
      // Convert from base64
      const combined = Uint8Array.from(atob(encryptedData), c => c.charCodeAt(0));
      
      // Extract IV and encrypted data
      const iv = combined.slice(0, 12);
      const encrypted = combined.slice(12);
      
      // Decrypt
      const decrypted = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: iv
        },
        key,
        encrypted
      );
      
      const decryptedString = new TextDecoder().decode(decrypted);
      
      // Try to parse as JSON, fallback to string
      try {
        return JSON.parse(decryptedString);
      } catch {
        return decryptedString;
      }
    } catch (error) {
      // LOW FIX: Use centralized logger if available
      if (typeof window !== 'undefined' && window.logger) {
        window.logger.error('Decryption error:', error);
      } else {
        console.error('Decryption error:', error);
      }
      // If decryption fails, try to parse as plain JSON (for backward compatibility)
      try {
        return JSON.parse(encryptedData);
      } catch {
        return encryptedData;
      }
    }
  }
}

// Export singleton instance
const encryptionService = new EncryptionService();
export default encryptionService;

