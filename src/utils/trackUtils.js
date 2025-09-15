// Track retry attempts to prevent infinite loops
const trackRetryMap = new Map();

const FIVE_MIN_MS = 5 * 60 * 1000;
const TEN_MIN_MS = 10 * 60 * 1000;
const CLEANUP_INTERVAL_MS = TEN_MIN_MS;
const YT_FALLBACK_QUERY = 'music video';

// --- Utility Functions ---
function getTrackKey(track) {
    return `${track.info?.identifier || track.identifier || 'unknown'}_${track.info?.title || track.title || 'unknown'}`;
}

function hasRecentlyRetried(trackKey) {
    const lastRetry = trackRetryMap.get(trackKey);
    const cutoff = Date.now() - FIVE_MIN_MS;
    return Boolean(lastRetry) && lastRetry > cutoff;
}

function markRetryAttempt(trackKey) {
    trackRetryMap.set(trackKey, Date.now());
}

// Extracted cleanup to a named function for clarity and reuse
function cleanOldRetries() {
    const cutoff = Date.now() - TEN_MIN_MS;
    for (const [key, timestamp] of trackRetryMap.entries()) {
        if (timestamp < cutoff) {
            trackRetryMap.delete(key);
        }
    }
}

// Clean up old retry records every 10 minutes
setInterval(() => {
    cleanOldRetries();
}, CLEANUP_INTERVAL_MS);

// --- Spotify URL Detection ---
function isSpotifyUrl(query) {
    return query.includes('spotify.com') || query.includes('spotify:');
}

function isYouTubeUrl(query) {
    return query.includes('youtube.com') || query.includes('youtu.be');
}

// --- Strategy helpers ---
function buildSearchStrategies(originalQuery) {
    const baseQuery = originalQuery.replace('ytsearch:', '').trim();
    const strategies = [
        originalQuery,
        isYouTubeUrl(originalQuery) ? `ytsearch:${extractVideoTitle(originalQuery)}` : null,
        `ytsearch:${baseQuery} official`,
        `ytsearch:${baseQuery} audio`,
        `ytsearch:${baseQuery} music`,
        `ytsearch:${baseQuery.split(' ').slice(0, 4).join(' ')}`,
        `ytsearch:${baseQuery} topic`,
        `ytsearch:${baseQuery} lyrics`
    ];
    return strategies.filter(Boolean);
}

function scoreTrack(track) {
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

    return score;
}

// --- Enhanced search function with Spotify support ---
async function searchWithFallbacks(player, originalQuery, requester) {
    // Handle Spotify URLs/URIs first
    if (isSpotifyUrl(originalQuery)) {
        console.log('🎵 Spotify URL detected, using LavaSrc...');
        return await searchSpotifyTrack(player, originalQuery, requester);
    }

    // For non-Spotify queries, use existing YouTube search strategies
    const searchStrategies = buildSearchStrategies(originalQuery);

    for (let i = 0; i < searchStrategies.length; i++) {
        try {
            const strategy = searchStrategies[i];
            console.log(`🔍 Search strategy ${i + 1}: "${strategy}"`);
            const result = await player.search(strategy, requester);

            if (result && Array.isArray(result.tracks) && result.tracks.length > 0) {
                // For strategies after the first, try to find the best match
                if (i > 0 && result.tracks.length > 1) {
                    const rankedTracks = result.tracks
                        .map((track) => ({track, score: scoreTrack(track)}))
                        .sort((a, b) => b.score - a.score);

                    const best = rankedTracks[0];
                    console.log(`📊 Selected track "${best.track.info?.title}" with score ${best.score}`);
                    return {...result, tracks: [best.track]};
                }
                return result;
            }
        } catch (error) {
            console.log(`❌ Search strategy ${i + 1} failed:`, error.message);
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
        if (!spotifyResult || !Array.isArray(spotifyResult.tracks) || spotifyResult.tracks.length === 0) {
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

// --- Search for Spotify track on YouTube ---
async function searchSpotifyOnYouTube(player, spotifyTrack, requester) {
    const title = spotifyTrack.info?.title || '';
    const artist = spotifyTrack.info?.author || '';
    const spotifyUri = spotifyTrack.info?.uri || spotifyTrack.uri;

    try {
        // Just use the Spotify URI - LavaSrc handles everything based on YAML config
        const result = await player.search(spotifyUri || `spsearch:${title} ${artist}`, requester);

        if (result && Array.isArray(result.tracks) && result.tracks.length > 0) {
            const track = result.tracks[0];

            // Preserve original Spotify metadata
            track.userData = track.userData || {};
            track.userData.originalSpotify = {
                title: spotifyTrack.info?.title,
                artist: spotifyTrack.info?.author,
                album: spotifyTrack.info?.albumName,
                isrc: spotifyTrack.info?.isrc,
                spotifyId: spotifyTrack.info?.identifier,
                uri: spotifyUri
            };

            console.log(`✅ Found: "${track.info?.title}" by "${track.info?.author}"`);
            return result;
        }
    } catch (error) {
        console.log(`❌ Search failed: ${error.message}`);
    }

    return null;
}

function extractVideoTitle(url) {
    // This is a simple extraction - in a real bot you might want to fetch the actual title
    // For now, return a generic search term
    return YT_FALLBACK_QUERY;
}

function clearRetryMap() {
    trackRetryMap.clear();
}

module.exports = {
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
