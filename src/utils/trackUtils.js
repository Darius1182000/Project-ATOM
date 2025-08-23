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

// --- Enhanced search function with multiple fallbacks ---
async function searchWithFallbacks(player, originalQuery, requester) {
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
  extractVideoTitle,
  clearRetryMap
};