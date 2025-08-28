// Track retry attempts to prevent infinite loops
const trackRetryMap = new Map();

// --- Utility Functions ---
function getTrackKey(track) {
  return `${track.info?.identifier || track.identifier || 'unknown'}_${track.info?.title || track.title || 'unknown'}`;
}

function hasRecentlyRetried(trackKey) {
  const lastRetry = trackRetryMap.get(trackKey);
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
  return lastRetry && lastRetry > fiveMinutesAgo;
}

function markRetryAttempt(trackKey) {
  trackRetryMap.set(trackKey, Date.now());
}

// Clean up old retry records every 10 minutes
setInterval(() => {
  const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
  for (const [key, timestamp] of trackRetryMap.entries()) {
    if (timestamp < tenMinutesAgo) {
      trackRetryMap.delete(key);
    }
  }
}, 10 * 60 * 1000);

// --- Spotify URL Detection ---
function isSpotifyUrl(query) {
  return query.includes('spotify.com') || query.includes('spotify:');
}

function isYouTubeUrl(query) {
  return query.includes('youtube.com') || query.includes('youtu.be');
}

// --- Enhanced search function with Spotify support ---
async function searchWithFallbacks(player, originalQuery, requester) {
  // Handle Spotify URLs/URIs first
  if (isSpotifyUrl(originalQuery)) {
    console.log('🎵 Spotify URL detected, using LavaSrc...');
    return await searchSpotifyTrack(player, originalQuery, requester);
  }
  
  // For non-Spotify queries, use existing YouTube search strategies
  const searchStrategies = [
    // Strategy 1: Original query
    originalQuery,
    
    // Strategy 2: If it's a URL, try ytsearch with extracted info
    originalQuery.includes('youtube.com') || originalQuery.includes('youtu.be') 
      ? `ytsearch:${extractVideoTitle(originalQuery)}` 
      : null,
    
    // Strategy 3: Add "official" to potentially get better quality/format
    `ytsearch:${originalQuery.replace('ytsearch:', '')} official`,
    
    // Strategy 4: Add "audio" to get audio-only versions (often more stable)
    `ytsearch:${originalQuery.replace('ytsearch:', '')} audio`,
    
    // Strategy 5: Add "music" to get music-focused results
    `ytsearch:${originalQuery.replace('ytsearch:', '')} music`,
    
    // Strategy 6: Try without extra words that might complicate search
    `ytsearch:${originalQuery.replace('ytsearch:', '').split(' ').slice(0, 4).join(' ')}`,
    
    // Strategy 7: Add "topic" to get auto-generated music videos (often more stable)
    `ytsearch:${originalQuery.replace('ytsearch:', '')} topic`,
    
    // Strategy 8: Try with "lyrics" to get lyric videos (different encoding)
    `ytsearch:${originalQuery.replace('ytsearch:', '')} lyrics`
  ].filter(Boolean);

  for (let i = 0; i < searchStrategies.length; i++) {
    try {
      console.log(`🔍 Search strategy ${i + 1}: "${searchStrategies[i]}"`);
      const result = await player.search(searchStrategies[i], requester);
      
      if (result && result.tracks && result.tracks.length > 0) {
        // For strategies after the first, try to find the best match
        if (i > 0 && result.tracks.length > 1) {
          // Sort tracks by quality indicators and format preferences
          const rankedTracks = result.tracks.map(track => {
            let score = 0;
            const title = track.info?.title?.toLowerCase() || '';
            const author = track.info?.author?.toLowerCase() || '';
            
            // Prefer tracks without problematic indicators
            if (title.includes('official')) score += 3;
            if (title.includes('audio')) score += 2;
            if (title.includes('music')) score += 2;
            if (author.includes('topic')) score += 2;
            if (title.includes('lyrics')) score += 1;
            
            // Penalize potentially problematic content
            if (title.includes('live')) score -= 2;
            if (title.includes('stream')) score -= 2;
            if (title.includes('radio')) score -= 1;
            if (title.includes('remix') && !title.includes('official')) score -= 1;
            
            return { track, score };
          }).sort((a, b) => b.score - a.score);
          
          const bestTrack = rankedTracks[0].track;
          console.log(`📊 Selected track "${bestTrack.info?.title}" with score ${rankedTracks[0].score}`);
          
          return { ...result, tracks: [bestTrack] };
        }
        return result;
      }
    } catch (error) {
      console.log(`❌ Search strategy ${i + 1} failed:`, error.message);
      continue;
    }
  }
  
  return null;
}

// --- Spotify-specific search function ---
async function searchSpotifyTrack(player, spotifyQuery, requester) {
  try {
    console.log(`🎵 Searching Spotify: ${spotifyQuery}`);
    
    // First, get Spotify track info using LavaSrc
    const spotifyResult = await player.search(spotifyQuery, requester);
    
    if (!spotifyResult || !spotifyResult.tracks || spotifyResult.tracks.length === 0) {
      console.log('❌ No Spotify results found');
      return null;
    }
    
    // Get the first Spotify track for metadata
    const spotifyTrack = spotifyResult.tracks[0];
    console.log(`🎵 Found Spotify track: "${spotifyTrack.info?.title}" by "${spotifyTrack.info?.author}"`);
    
    // Now search for this track on YouTube using the metadata
    const youtubeSearchResult = await searchSpotifyOnYouTube(player, spotifyTrack, requester);
    
    if (youtubeSearchResult) {
      console.log(`✅ Successfully found YouTube version of Spotify track`);
      return youtubeSearchResult;
    } else {
      console.log('⚠️ Could not find YouTube version, returning original Spotify result');
      return spotifyResult;
    }
    
  } catch (error) {
    console.error('❌ Error in Spotify search:', error);
    return null;
  }
}

// --- Search for Spotify track on YouTube using various methods ---
async function searchSpotifyOnYouTube(player, spotifyTrack, requester) {
  const title = spotifyTrack.info?.title || '';
  const artist = spotifyTrack.info?.author || '';
  const album = spotifyTrack.info?.albumName || '';
  const isrc = spotifyTrack.info?.isrc || '';
  
  // Priority 1: Search by ISRC if available (most accurate)
  if (isrc) {
    try {
      console.log(`🔍 Searching YouTube by ISRC: ${isrc}`);
      const isrcResult = await player.search(`ytsearch:${isrc}`, requester);
      
      if (isrcResult && isrcResult.tracks && isrcResult.tracks.length > 0) {
        console.log(`✅ Found track using ISRC: ${isrcResult.tracks[0].info?.title}`);
        return isrcResult;
      }
    } catch (error) {
      console.log(`❌ ISRC search failed: ${error.message}`);
    }
  }
  
  // Priority 2: Search by title + artist (most common)
  const searchQueries = [
    `${title} ${artist}`,
    `${title} ${artist} official`,
    `${title} ${artist} audio`,
    `${title} ${artist} music`,
    `${title} ${artist} ${album}`,
    `${title} ${artist} topic`,
    `${artist} ${title}`, // Sometimes artist first works better
    `${title}` // Title only as last resort
  ].filter(query => query.trim().length > 0);
  
  for (const query of searchQueries) {
    try {
      console.log(`🔍 YouTube search: "${query}"`);
      const result = await player.search(`ytsearch:${query}`, requester);
      
      if (result && result.tracks && result.tracks.length > 0) {
        // Try to find the best match based on similarity
        const bestMatch = findBestMatch(result.tracks, title, artist, spotifyTrack.info?.duration);
        
        if (bestMatch) {
          console.log(`✅ Found YouTube match: "${bestMatch.info?.title}" by "${bestMatch.info?.author}"`);
          
          // Preserve original Spotify metadata in userData
          bestMatch.userData = bestMatch.userData || {};
          bestMatch.userData.originalSpotify = {
            title: spotifyTrack.info?.title,
            artist: spotifyTrack.info?.author,
            album: spotifyTrack.info?.albumName,
            isrc: spotifyTrack.info?.isrc,
            spotifyId: spotifyTrack.info?.identifier
          };
          
          return { ...result, tracks: [bestMatch] };
        }
      }
    } catch (error) {
      console.log(`❌ YouTube search "${query}" failed: ${error.message}`);
      continue;
    }
  }
  
  return null;
}

// --- Find best matching track from YouTube results ---
function findBestMatch(tracks, targetTitle, targetArtist, targetDuration) {
  if (!tracks || tracks.length === 0) return null;
  
  const normalizeString = (str) => str.toLowerCase().replace(/[^\w\s]/g, '').trim();
  const normalizedTitle = normalizeString(targetTitle || '');
  const normalizedArtist = normalizeString(targetArtist || '');
  
  let bestTrack = null;
  let bestScore = -1;
  
  for (const track of tracks) {
    const trackTitle = normalizeString(track.info?.title || '');
    const trackAuthor = normalizeString(track.info?.author || '');
    
    let score = 0;
    
    // Title similarity (most important)
    if (trackTitle.includes(normalizedTitle) || normalizedTitle.includes(trackTitle)) {
      score += 50;
    }
    
    // Artist similarity
    if (trackAuthor.includes(normalizedArtist) || normalizedArtist.includes(trackAuthor)) {
      score += 30;
    }
    
    // Duration similarity (if available)
    if (targetDuration && track.info?.duration) {
      const durationDiff = Math.abs(targetDuration - track.info.duration);
      if (durationDiff < 10000) score += 20; // Within 10 seconds
      else if (durationDiff < 30000) score += 10; // Within 30 seconds
      else if (durationDiff > 120000) score -= 20; // More than 2 minutes off
    }
    
    // Prefer official/audio versions
    if (trackTitle.includes('official')) score += 10;
    if (trackTitle.includes('audio')) score += 8;
    if (trackAuthor.includes('topic')) score += 5;
    
    // Penalize live versions, covers, remixes
    if (trackTitle.includes('live')) score -= 15;
    if (trackTitle.includes('cover')) score -= 15;
    if (trackTitle.includes('remix') && !trackTitle.includes('official')) score -= 10;
    if (trackTitle.includes('karaoke')) score -= 20;
    
    if (score > bestScore) {
      bestScore = score;
      bestTrack = track;
    }
  }
  
  // Only return a match if the score is reasonable
  return bestScore > 20 ? bestTrack : tracks[0]; // Fallback to first track if no good match
}

function extractVideoTitle(url) {
  // This is a simple extraction - in a real bot you might want to fetch the actual title
  // For now, return a generic search term
  return "music video";
}

function clearRetryMap() {
  trackRetryMap.clear();
}

module.exports = {
  trackRetryMap,
  getTrackKey,
  hasRecentlyRetried,
  markRetryAttempt,
  searchWithFallbacks,
  searchSpotifyTrack,
  searchSpotifyOnYouTube,
  isSpotifyUrl,
  isYouTubeUrl,
  extractVideoTitle,
  clearRetryMap
};