import { request } from './client.js';

/** Where the browser goes to start sign-in. A normal link, never a fetch (spec 8.3). */
export const SIGN_IN_URL = '/api/auth/github';

/** @returns {Promise<{ id: string, login: string, avatarUrl: string | null, aiNoticeAcknowledged: boolean }>} */
export const getMe = () => request('/me');

/** @returns {Promise<null>} */
export const logout = () => request('/auth/logout', { method: 'POST' });
