import jwt from 'jsonwebtoken';
import CryptoJS from 'crypto-js';
import logger from './LoggerService.js';

/**
 * Authentication & Secrets Service
 * Handles JWT issuing/verification and encryption/decryption of client secrets
 */
export default class AuthService {
  constructor() {
    this.jwtSecret = process.env.JWT_SECRET || 'fallback_jwt_secret';
    this.encryptionKey = process.env.ENCRYPTION_KEY || 'fallback_32_char_encryption_key_';
  }

  /**
   * Generates a JWT token for the client
   */
  generateToken(payload, expiresIn = '24h') {
    return jwt.sign(payload, this.jwtSecret, { expiresIn });
  }

  /**
   * Verifies a JWT token
   */
  verifyToken(token) {
    try {
      return jwt.verify(token, this.jwtSecret);
    } catch (err) {
      logger.error('Invalid token verification attempted');
      return null;
    }
  }

  /**
   * Encrypts a sensitive string (like ATS API keys)
   */
  encryptSecret(secret) {
    return CryptoJS.AES.encrypt(secret, this.encryptionKey).toString();
  }

  /**
   * Decrypts a sensitive string
   */
  decryptSecret(encryptedSecret) {
    const bytes = CryptoJS.AES.decrypt(encryptedSecret, this.encryptionKey);
    return bytes.toString(CryptoJS.enc.Utf8);
  }
}
