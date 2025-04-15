import axios from "axios";
import { MetaDetail } from "stremio-addon-sdk";
import { CINEMETA_BASE_URL } from '../constants/urls';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Properly check for required environment variables
const OMDB_API_KEY = process.env.OMDB_API_KEY;

// Validate API key presence
if (!OMDB_API_KEY) {
  console.warn('WARNING: OMDB_API_KEY is not defined in environment variables. Rating functionality will be limited.');
}

export async function getMetadata(imdb: string, type: string): Promise<MetaDetail> {
  try {
    const url = `${CINEMETA_BASE_URL}/meta/${type}/${imdb}.json`;
    const response = await axios.get(url)
    return response.data.meta;
  } catch (error) {
    console.error(`Error fetching metadata: ${(error as Error).message}`);
    return {} as MetaDetail;
  }
}

export async function fetchRatingsFromOMDb(title: string, year: string = ''): Promise<{ [key: string]: string }> {
  try {
    if (!OMDB_API_KEY) {
      console.error('Cannot fetch ratings: OMDB_API_KEY environment variable is not set');
      return {};
    }
    
    console.log(`Fetching ratings from OMDb for: ${title} ${year}`);
    const url = `http://www.omdbapi.com/?apikey=${OMDB_API_KEY}&t=${encodeURIComponent(title)}${year ? `&y=${year}` : ''}`;
    
    const response = await axios.get(url, { timeout: 5000 });
    const ratingMap: { [key: string]: string } = {};
    
    if (response.data && response.data.Response === 'True') {
      // IMDb rating
      if (response.data.imdbRating && response.data.imdbRating !== 'N/A') {
        ratingMap['imdb'] = formatScore(response.data.imdbRating);
      }
      
      // Metacritic rating
      if (response.data.Metascore && response.data.Metascore !== 'N/A') {
        ratingMap['metacritic'] = formatScore(response.data.Metascore);
      }
      
      // Rotten Tomatoes rating
      if (response.data.Ratings) {
        const rtRating = response.data.Ratings.find((r: any) => r.Source === 'Rotten Tomatoes');
        if (rtRating) {
          ratingMap['rotten_tomatoes'] = formatScore(rtRating.Value);
        }
      }
    }
    
    return ratingMap;
  } catch (error) {
    console.error(`Error fetching ratings from OMDb: ${(error as Error).message}`);
    return {};
  }
}

// These functions are kept as empty placeholders for backward compatibility
export async function fetchGoogleRatings(query: string): Promise<{ [key: string]: string }> {
  console.log('Google ratings fetch bypassed, using OMDb instead');
  return {};
}

export async function fetchBingRatings(query: string): Promise<{ [key: string]: string }> {
  console.log('Bing ratings fetch bypassed, using OMDb instead');
  return {};
}

export async function fetchYahooRatings(query: string): Promise<{ [key: string]: string }> {
  console.log('Yahoo ratings fetch bypassed, using OMDb instead');
  return {};
}

export function formatSourceKey(source: string): string {
  return source
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function formatScore(score: string): string {
  score = score.split('/')[0];
  score = score.split(' ')[0]; 
  score = score.split('%')[0];
  score = score.replace(/[^0-9.]/g, '');
  return score;
}
