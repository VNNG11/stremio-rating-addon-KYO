import { MetaDetail } from 'stremio-addon-sdk';
import { fetchRatingsFromOMDb, getMetadata } from './api';
import { RedisClientType } from 'redis';
import { addRatingToImage } from './image';
import axios from 'axios';
import { getRatingsfromTTIDs } from '../repository';
import { getContext } from '../context';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Simple in-memory cache as fallback when Redis is not available
const memoryCache = new Map<string, { value: string, timestamp: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

// Helper function to get ratings from cache (Redis or in-memory)
async function getRatingsFromCache(imdbId: string, cacheClient: RedisClientType | null): Promise<Record<string, string>> {
  const ratingMap: Record<string, string> = {};
  const ratingKeys = ['imdb', 'metacritic', 'rotten_tomatoes'];
  
  // First try Redis if available
  if (cacheClient) {
    try {
      if (!cacheClient.isOpen) {
        await cacheClient.connect().catch(() => {
          console.log('Failed to connect to Redis, using in-memory cache instead');
          return null;
        });
      }
      
      if (cacheClient.isOpen) {
        for (const key of ratingKeys) {
          const cacheKey = `${imdbId}_${key}_v1.0`;
          const rating = await cacheClient.get(cacheKey);
          if (rating) {
            ratingMap[key] = rating;
          }
        }
        
        if (Object.keys(ratingMap).length > 0) {
          console.log(`Retrieved ratings from Redis cache for ${imdbId}`);
          return ratingMap;
        }
      }
    } catch (error) {
      console.error(`Error accessing Redis cache: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  // Try in-memory cache as fallback
  for (const key of ratingKeys) {
    const cacheKey = `${imdbId}_${key}_v1.0`;
    const cachedItem = memoryCache.get(cacheKey);
    
    if (cachedItem && (Date.now() - cachedItem.timestamp) < CACHE_TTL) {
      ratingMap[key] = cachedItem.value;
    }
  }
  
  if (Object.keys(ratingMap).length > 0) {
    console.log(`Retrieved ratings from in-memory cache for ${imdbId}`);
  }
  
  return ratingMap;
}

// Helper function to save ratings to cache (Redis or in-memory)
async function saveRatingsToCache(imdbId: string, ratings: Record<string, string>, cacheClient: RedisClientType | null): Promise<void> {
  // Try Redis first if available
  if (cacheClient) {
    try {
      if (!cacheClient.isOpen) {
        await cacheClient.connect().catch(() => {
          console.log('Failed to connect to Redis, using in-memory cache instead');
          return null;
        });
      }
      
      if (cacheClient.isOpen) {
        for (const [key, value] of Object.entries(ratings)) {
          const cacheKey = `${imdbId}_${key}_v1.0`;
          console.log('Caching in Redis:', cacheKey, value);
          await cacheClient.set(cacheKey, value);
          await cacheClient.expire(cacheKey, 86400); // Cache for 1 day
        }
        
        console.log(`Saved ratings to Redis cache for ${imdbId}`);
        return;
      }
    } catch (error) {
      console.error(`Error saving to Redis cache: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  // Use in-memory cache as fallback
  for (const [key, value] of Object.entries(ratings)) {
    const cacheKey = `${imdbId}_${key}_v1.0`;
    console.log('Caching in memory:', cacheKey, value);
    memoryCache.set(cacheKey, {
      value,
      timestamp: Date.now()
    });
  }
  
  console.log(`Saved ratings to in-memory cache for ${imdbId}`);
}

// Main function to fetch or retrieve ratings from cache
export async function scrapeRatings(imdbId: string, type: string, providers: string[]): Promise<MetaDetail> {
  const cacheClient = getContext().cacheClient;
  const metadata = await getMetadata(imdbId, type);
  
  try {
    // Check if ratings are already cached
    let ratingMap: Record<string, string> = await getRatingsFromCache(imdbId, cacheClient);
    
    if (Object.keys(ratingMap).length === 0) {
      console.log('Ratings not found in cache, fetching from OMDB...');
      
      // Fetch from OMDB API
      const year = (metadata as any).year ? String((metadata as any).year) : '';
ratingMap = await fetchRatingsFromOMDb(metadata.name, year);
      
      // Save to cache if we got any ratings
      if (Object.keys(ratingMap).length > 0) {
        await saveRatingsToCache(imdbId, ratingMap, cacheClient);
      }
    }
    
    console.log('Ratings:', ratingMap);
    
    // Update description with ratings
    metadata.description = metadata.description || '';
    const filteredRatings: Record<string, string> = {};
    
    for (const [key, value] of Object.entries(ratingMap)) {
      if (providers.includes('all') || providers.includes(key)) {
        metadata.description += `(${key.replace('_', ' ')}: ${value}) `;
        filteredRatings[key] = value;
      }
    }
    
    // Modify the poster if available
    if (metadata.poster && Object.keys(filteredRatings).length > 0) {
      const response = await axios.get(metadata.poster, { responseType: 'arraybuffer' });
      const posterBase64 = Buffer.from(response.data).toString('base64');
      const modifiedPoster = await addRatingToImage(posterBase64, filteredRatings);
      metadata.poster = modifiedPoster;
    }
    
    return metadata;
  } catch (error) {
    console.error(`Error fetching ratings: ${error instanceof Error ? error.message : String(error)}`);
    return metadata;
  }
}

// Support for bulk rating retrieval
export async function getRatingsfromDB(metas: MetaDetail[], providers: string[]): Promise<MetaDetail[]> {
  const ttids = metas.map(meta => meta.id);
  const ratings = await getRatingsfromTTIDs(ttids);
  
  const modifiedMetaPromises = await metas.map(async meta => {
    if (!ratings[meta.id]) {
      return meta;
    }
    
    // update description with ratings
    meta.description = meta.description || '';
    let filteredRatings: Record<string, string> = {};
    for (const [key, value] of Object.entries(ratings[meta.id])) {
      if (providers.includes('all') || providers.includes(key)) {
        meta.description += `(${key.replace('_', ' ')}: ${value}) `;
        filteredRatings[key] = value;
      }
    }
    
    if (meta.poster && Object.keys(ratings[meta.id]).length > 0) {
      const response = await axios.get(meta.poster, { responseType: 'arraybuffer' });
      const posterBase64 = Buffer.from(response.data).toString('base64');
      const modifiedPoster = await addRatingToImage(posterBase64, filteredRatings);
      meta.poster = modifiedPoster;
    }
    
    return meta;
  });
  
  return await Promise.all(modifiedMetaPromises);
}

// Legacy functions kept for compatibility - these replace the web scraping functions
export const getRatingsFromGoogle = async () => ({});
export const getRatingsFromBing = async () => ({});
export const getRatingsFromYahoo = async () => ({});
export const fetchGoogleRatings = async () => ({});
export const fetchBingRatings = async () => ({});
export const fetchYahooRatings = async () => ({});

export default scrapeRatings;
