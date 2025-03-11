import { Redis } from '@upstash/redis';

// Initialize Redis client with prefixed environment variables
export const redis = new Redis({
  url: process.env.metana__KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.metana__KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Add some helper functions for common Redis operations
export async function getStatus(uploadId) {
  const uploadKey = `upload:${uploadId}`;
  return await redis.get(uploadKey);
}

export async function setStatus(uploadId, status, ttlSeconds = 3600) {
  const uploadKey = `upload:${uploadId}`;
  await redis.set(uploadKey, status);
  if (ttlSeconds > 0) {
    await redis.expire(uploadKey, ttlSeconds);
  }
  return true;
}

export async function updateStatus(uploadId, updates) {
  const uploadKey = `upload:${uploadId}`;
  const current = await redis.get(uploadKey) || {};
  await redis.set(uploadKey, {
    ...current,
    ...updates,
    lastUpdated: new Date().toISOString()
  });
  return true;
} 